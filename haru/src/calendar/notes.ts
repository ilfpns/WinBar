import { db } from '../storage/db';

/**
 * Per-day memos, kept in IndexedDB (one record per date) so they can grow for years without
 * hitting localStorage's few-MB limit. Everything is mirrored in memory for instant rendering.
 */
const STORE = 'notes';

export interface NoteRecord {
  date: string; // YYYY-MM-DD
  text: string;
  updated: number;
}

export interface Notes {
  get(date: string): string;
  /** Saves (or removes, when blank) the memo for a date. */
  set(date: string, text: string): void;
  /** Every memo, for backups. */
  all(): NoteRecord[];
  /** Replaces all memos (restoring a backup). */
  replace(records: NoteRecord[]): void;
  /** Applies a memo that came from the cloud (no change notification back to the sync). */
  setFromRemote(record: NoteRecord | { date: string; text: ''; updated: number }): void;
  /** When each memo was last changed (for the sync). */
  record(date: string): NoteRecord | undefined;
  ready: Promise<void>;
}

const listeners = new Set<() => void>();
/** Fires after any memo changes (used by the file backup). */
export function onNotesChanged(fn: () => void): void {
  listeners.add(fn);
}

let shared: Notes | null = null;
/** The memo store once created (backups read it). */
export const notesStore = (): Notes | null => shared;

export function createNotes(onChange: () => void): Notes {
  const cache = new Map<string, NoteRecord>();
  let handle: IDBDatabase | null = null;
  const changed = () => {
    onChange();
    listeners.forEach((fn) => fn());
  };

  const ready = db()
    .then((opened) => {
      handle = opened;
      return new Promise<void>((resolve) => {
        const req = opened.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => {
          for (const r of req.result as NoteRecord[]) if (r.text.trim()) cache.set(r.date, r);
          resolve();
        };
        req.onerror = () => resolve();
      });
    })
    .catch(() => {
      // private mode or blocked storage: memos still work for this session
    })
    .then(onChange);

  shared = {
    ready,
    record: (date) => cache.get(date),
    setFromRemote(record) {
      const blank = !record.text.trim();
      if (blank) cache.delete(record.date);
      else cache.set(record.date, record as NoteRecord);
      onChange();
      if (!handle) return;
      const store = handle.transaction(STORE, 'readwrite').objectStore(STORE);
      if (blank) store.delete(record.date);
      else store.put(record);
    },
    get: (date) => cache.get(date)?.text ?? '',
    all: () => [...cache.values()],
    set(date, text) {
      const blank = !text.trim();
      const record = { date, text, updated: Date.now() };
      if (blank) cache.delete(date);
      else cache.set(date, record);
      changed();
      if (!handle) return;
      const store = handle.transaction(STORE, 'readwrite').objectStore(STORE);
      if (blank) store.delete(date);
      else store.put(record satisfies NoteRecord);
    },
    replace(records) {
      cache.clear();
      for (const r of records) if (r.text?.trim()) cache.set(r.date, r);
      changed();
      if (!handle) return;
      const store = handle.transaction(STORE, 'readwrite').objectStore(STORE);
      store.clear();
      for (const r of cache.values()) store.put(r);
    },
  };
  return shared;
}
