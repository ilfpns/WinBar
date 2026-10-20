import { kvGet, kvSet, requestPersistence } from './db';
import { type Block, blocksStored, blocksUpdated, isBlock, stampBlocks } from '../timetable/model';
import { setState, state, subscribe, fromOutside } from '../timetable/state';
import { type NoteRecord, notesStore, onNotesChanged } from '../calendar/notes';
import { type ImageRecord, fromDataUrl, imagesStore, onImagesChanged, toDataUrl } from '../calendar/images';
import { type Template, allTemplates, onTemplates, replaceTemplates, templatesFromRemote, templatesUpdated } from '../timetable/templates';
import { type DaySnapshot, allDays, clearDays, restoreDays } from '../timetable/history';
import { type Word, wordsStore } from '../words/words';
import { type Entry, type Folder, folderStore, journalStore } from '../journal/journal';
import { checkinStore } from '../calendar/attendance';
import { askConfirm } from '../ui/modal';

/**
 * Keeping data no matter what:
 *  1. ask the browser for persistent storage (no silent eviction under disk pressure);
 *  2. mirror the timetable into IndexedDB and restore it if localStorage comes back empty;
 *  3. back up to a real file — on demand (Export / Import) or continuously (Auto-backup, Chrome/Edge),
 *     which also survives clearing the browser's site data.
 */
interface BackupFile {
  app: 'haru';
  version: 1;
  exportedAt: string;
  timetable: Block[];
  notes: NoteRecord[];
  /** Memo images; `data` is a data URL. Missing in backups made before images existed. */
  images?: { id: string; date: string; created: number; data: string }[];
  /** Day templates. Missing in backups made before templates existed. */
  templates?: Template[];
  /** Each day's timetable as it was. Missing in older backups. */
  days?: DaySnapshot[];
  /** Vocabulary cards and journal entries. Missing in older backups. */
  words?: Word[];
  journal?: Entry[];
  journalFolders?: Folder[];
  /** Days checked in on (attendance). Missing in older backups. */
  checkins?: string[];
}

// File System Access API (Chromium); not in TypeScript's DOM lib yet
interface FileHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandle>;
const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;

export interface BackupRefs {
  status: HTMLElement;
  auto: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
  importBtn: HTMLButtonElement;
  file: HTMLInputElement;
}

async function snapshot(): Promise<BackupFile> {
  const images = await Promise.all((imagesStore()?.all() ?? []).map(async (r) => ({ id: r.id, date: r.date, created: r.created, data: await toDataUrl(r.blob) })));
  return { app: 'haru', version: 1, exportedAt: new Date().toISOString(), timetable: state.blocks, notes: notesStore()?.all() ?? [], images, templates: allTemplates(), days: await allDays().catch(() => []), words: wordsStore.all(), journal: journalStore.all(), journalFolders: folderStore.all(), checkins: checkinStore.all() };
}

/** What an account kept on this device while another one was signed in (IndexedDB `kv`, `stash:{uid}`). */
interface Stash { data: BackupFile; stamps: { blocks: number; templates: number; lists: Record<string, number> } }
const LISTS = { words: wordsStore, journal: journalStore, journalFolders: folderStore, checkins: checkinStore } as const;
type ListKey = keyof typeof LISTS;

/**
 * One device, several accounts: when another account signs in, everything on the device is put aside for
 * the account that used it, and the newcomer's own comes in — what it left here earlier, or nothing (its
 * cloud copy then fills the device). The time stamps travel with the data, so an emptied device never
 * counts as newer than an account's cloud copy and never overwrites it.
 */
export async function switchAccountData(from: string | null, to: string): Promise<void> {
  if (from === to) return;
  if (from) {
    const lists = Object.fromEntries((Object.keys(LISTS) as ListKey[]).map((k) => [k, LISTS[k].updated()]));
    const stash: Stash = { data: await snapshot(), stamps: { blocks: blocksUpdated(), templates: templatesUpdated(), lists } };
    await kvSet(`stash:${from}`, stash);
  }
  const back = await kvGet<Stash | null>(`stash:${to}`).catch(() => undefined);
  const d = back?.data;
  const stamps = back?.stamps;
  fromOutside(() => setState({ blocks: (d?.timetable ?? []).filter(isBlock).map((b) => ({ ...b, done: b.done === true })), draft: null, selected: [] }));
  stampBlocks(stamps?.blocks ?? 0);
  notesStore()?.replace(d?.notes ?? []);
  templatesFromRemote(d?.templates ?? [], stamps?.templates ?? 0);
  await clearDays();
  if (d?.days) await restoreDays(d.days);
  for (const k of Object.keys(LISTS) as ListKey[]) LISTS[k].fromRemote((d?.[k] as unknown[] | undefined) ?? [], stamps?.lists[k] ?? 0);
  const imgs: ImageRecord[] = [];
  for (const i of d?.images ?? []) imgs.push({ id: i.id, date: i.date, created: i.created, blob: await fromDataUrl(i.data) });
  imagesStore()?.replace(imgs);
  if (back) await kvSet(`stash:${to}`, null);
}

export function mountBackup(refs: BackupRefs): void {
  void requestPersistence();

  // ---- 2. IndexedDB mirror of the timetable
  let mirrorTimer = 0;
  let lastBlocks = state.blocks;
  subscribe(() => {
    if (state.blocks === lastBlocks) return;
    lastBlocks = state.blocks;
    clearTimeout(mirrorTimer);
    mirrorTimer = window.setTimeout(mirror, 300);
    scheduleFileSave();
  });
  function mirror(): void {
    clearTimeout(mirrorTimer);
    void kvSet('timetable', state.blocks).catch(() => {});
  }
  // leaving the page (or switching tabs) flushes a pending mirror write right away
  addEventListener('pagehide', mirror);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') mirror();
  });
  void kvGet<Block[]>('timetable')
    .then((saved) => {
      // localStorage lost but the mirror survived: bring the day back (an emptied day — a new day,
      // Clear all — is still stored, so it stays empty)
      if (!blocksStored() && saved?.length) fromOutside(() => setState({ blocks: saved }));
      // otherwise the mirror follows, empty included, so it never holds a day that was already filed away
      else if (blocksStored()) void kvSet('timetable', state.blocks);
    })
    .catch(() => {});
  onNotesChanged(() => scheduleFileSave());
  onImagesChanged(() => scheduleFileSave());
  onTemplates(() => scheduleFileSave());
  wordsStore.onChange(() => scheduleFileSave());
  journalStore.onChange(() => scheduleFileSave());
  folderStore.onChange(() => scheduleFileSave());
  checkinStore.onChange(() => scheduleFileSave());

  // ---- 3a. Export / Import
  refs.exportBtn.addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await snapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `haru-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  refs.importBtn.addEventListener('click', () => refs.file.click());
  refs.file.addEventListener('change', async () => {
    const f = refs.file.files?.[0];
    refs.file.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as Partial<BackupFile>;
      if (data.app !== 'haru' || !Array.isArray(data.timetable)) throw new Error('not a Haru backup');
      if (!(await askConfirm({ title: 'Restore this backup?', body: 'Today’s tasks and all memos are replaced with the ones in the file.', ok: 'Restore', icon: 'hard-drive' }))) return;
      // only well-formed entries come in (a hand-edited or older file must not break the app)
      const blocks = data.timetable.filter(isBlock).map((b) => ({ ...b, done: b.done === true }));
      const notes = (Array.isArray(data.notes) ? data.notes : []).filter((n): n is NoteRecord => typeof n?.date === 'string' && typeof n.text === 'string');
      fromOutside(() => setState({ blocks, draft: null, selected: [] }));
      notesStore()?.replace(notes);
      if (Array.isArray(data.templates)) replaceTemplates(data.templates);
      if (Array.isArray(data.days)) await restoreDays(data.days);
      // older backups have no words or journal: keep the current ones then (the stores drop malformed entries)
      if (Array.isArray(data.words)) wordsStore.set(data.words.filter((w) => typeof w?.id === 'string' && typeof w.word === 'string' && typeof w.meaning === 'string'));
      if (Array.isArray(data.journal)) journalStore.set(data.journal.filter((e) => typeof e?.id === 'string' && typeof e.date === 'string' && typeof e.body === 'string'));
      if (Array.isArray(data.journalFolders)) folderStore.set(data.journalFolders.filter((f) => typeof f?.id === 'string' && typeof f.name === 'string'));
      // check-ins are only ever added: keep today's and the backup's together
      if (Array.isArray(data.checkins)) checkinStore.set([...new Set([...checkinStore.all(), ...data.checkins.filter((k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k))])].sort());
      // older backups have no images: leave the current ones alone then
      if (Array.isArray(data.images)) {
        const imgs: ImageRecord[] = [];
        for (const i of data.images) {
          if (typeof i?.date !== 'string' || typeof i.data !== 'string' || !i.data.startsWith('data:image/')) continue;
          imgs.push({ id: String(i.id), date: i.date, created: Number(i.created) || Date.now(), blob: await fromDataUrl(i.data) });
        }
        imagesStore()?.replace(imgs);
      }
      show('Restored');
    } catch {
      show('Not a Haru backup', true);
    }
  });

  // ---- 3b. Auto-backup to a file the user picks (kept in sync on every change)
  let handle: FileHandle | null = null;
  let granted = false;
  let saveTimer = 0;
  function scheduleFileSave(): void {
    if (!handle || !granted) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void writeFile(), 800);
  }
  async function writeFile(): Promise<void> {
    if (!handle) return;
    try {
      const w = await handle.createWritable();
      await w.write(JSON.stringify(await snapshot(), null, 2));
      await w.close();
      show(`Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
    } catch {
      granted = false;
      render();
    }
  }
  function render(): void {
    if (!picker) {
      refs.auto.hidden = true;
      return;
    }
    refs.auto.textContent = handle ? (granted ? 'Auto-backup on' : 'Reconnect backup') : 'Auto-backup';
    refs.auto.setAttribute('aria-pressed', String(!!handle && granted));
  }
  let statusTimer = 0;
  function show(text: string, bad = false): void {
    refs.status.textContent = text;
    refs.status.classList.toggle('bad', bad);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (refs.status.textContent = ''), 4000);
  }

  refs.auto.addEventListener('click', async () => {
    try {
      if (handle && !granted) {
        granted = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
      } else if (picker) {
        handle = await picker({ suggestedName: 'haru-backup.json', types: [{ description: 'Haru backup', accept: { 'application/json': ['.json'] } }] });
        granted = true;
        await kvSet('backupHandle', handle);
      }
      render();
      if (granted) await writeFile();
    } catch {
      // picker dismissed
    }
  });

  if (picker) {
    void kvGet<FileHandle>('backupHandle')
      .then(async (saved) => {
        if (!saved) return;
        handle = saved;
        granted = (await saved.queryPermission({ mode: 'readwrite' })) === 'granted';
        render();
      })
      .catch(() => {});
  }
  render();
}
