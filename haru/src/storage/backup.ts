import { kvGet, kvSet, requestPersistence } from './db';
import { type Block, isBlock } from '../timetable/model';
import { setState, state, subscribe } from '../timetable/state';
import { type NoteRecord, notesStore, onNotesChanged } from '../calendar/notes';
import { type ImageRecord, fromDataUrl, imagesStore, onImagesChanged, toDataUrl } from '../calendar/images';

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
  return { app: 'haru', version: 1, exportedAt: new Date().toISOString(), timetable: state.blocks, notes: notesStore()?.all() ?? [], images };
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
      // localStorage lost but the mirror survived: bring the day back
      if (!state.blocks.length && saved?.length) setState({ blocks: saved });
      else if (state.blocks.length) void kvSet('timetable', state.blocks);
    })
    .catch(() => {});
  onNotesChanged(() => scheduleFileSave());
  onImagesChanged(() => scheduleFileSave());

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
      if (!confirm('Replace today’s tasks and all memos with this backup?')) return;
      // only well-formed entries come in (a hand-edited or older file must not break the app)
      const blocks = data.timetable.filter(isBlock).map((b) => ({ ...b, done: b.done === true }));
      const notes = (Array.isArray(data.notes) ? data.notes : []).filter((n): n is NoteRecord => typeof n?.date === 'string' && typeof n.text === 'string');
      setState({ blocks, draft: null, selected: [] });
      notesStore()?.replace(notes);
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
