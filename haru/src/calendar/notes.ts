/**
 * Per-day memos, kept in IndexedDB (one record per date) so they can grow for years without
 * hitting localStorage's few-MB limit. Everything is mirrored in memory for instant rendering.
 */
const DB = 'haru';
const STORE = 'notes';

interface NoteRecord {
  date: string; // YYYY-MM-DD
  text: string;
  updated: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'date' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface Notes {
  get(date: string): string;
  /** Saves (or removes, when blank) the memo for a date. */
  set(date: string, text: string): void;
  ready: Promise<void>;
}

export function createNotes(onChange: () => void): Notes {
  const cache = new Map<string, string>();
  let db: IDBDatabase | null = null;

  const ready = open()
    .then((opened) => {
      db = opened;
      return new Promise<void>((resolve) => {
        const req = opened.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => {
          for (const r of req.result as NoteRecord[]) if (r.text.trim()) cache.set(r.date, r.text);
          resolve();
        };
        req.onerror = () => resolve();
      });
    })
    .catch(() => {
      // private mode or blocked storage: memos still work for this session
    })
    .then(onChange);

  return {
    ready,
    get: (date) => cache.get(date) ?? '',
    set(date, text) {
      const blank = !text.trim();
      if (blank) cache.delete(date);
      else cache.set(date, text);
      onChange();
      if (!db) return;
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      if (blank) store.delete(date);
      else store.put({ date, text, updated: Date.now() } satisfies NoteRecord);
    },
  };
}
