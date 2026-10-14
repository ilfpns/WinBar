import { kvGet, kvSet, requestPersistence } from './db';
import { type Block } from '../timetable/model';
import { setState, state, subscribe } from '../timetable/state';
import { type NoteRecord, notesStore, onNotesChanged } from '../calendar/notes';

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

function snapshot(): BackupFile {
  return { app: 'haru', version: 1, exportedAt: new Date().toISOString(), timetable: state.blocks, notes: notesStore()?.all() ?? [] };
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
    mirrorTimer = window.setTimeout(() => void kvSet('timetable', state.blocks).catch(() => {}), 300);
    scheduleFileSave();
  });
  void kvGet<Block[]>('timetable')
    .then((saved) => {
      // localStorage lost but the mirror survived: bring the day back
      if (!state.blocks.length && saved?.length) setState({ blocks: saved });
      else if (state.blocks.length) void kvSet('timetable', state.blocks);
    })
    .catch(() => {});
  onNotesChanged(() => scheduleFileSave());

  // ---- 3a. Export / Import
  refs.exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
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
      setState({ blocks: data.timetable, draft: null, selected: [] });
      notesStore()?.replace(Array.isArray(data.notes) ? data.notes : []);
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
      await w.write(JSON.stringify(snapshot(), null, 2));
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
