import { kvGet, kvSet } from './db';
import { type Gone, cleanGone, markGone } from './gone';

/**
 * A list of records kept twice — localStorage (read at once on start) and IndexedDB `kv` (survives
 * localStorage being cleared) — each copy stamped, so on start the newer one wins. Used by the Words and
 * Journal pages; backups read and restore it through `all` / `replace`.
 */
export interface ListStore<T> {
  all(): T[];
  /** Replaces the whole list (an edit, or a restored backup) and saves it. */
  set(items: T[]): void;
  /** When the list last changed (0: never). Cloud sync compares it with the cloud's copy. */
  updated(): number;
  /** Takes the cloud's copy, keeping its stamp (so it is not sent straight back as a new edit). */
  fromRemote(items: unknown[], updated: number, gone?: Gone): void;
  /** What was deleted from the list and when (by `id`), for the merge with the cloud's copy. */
  gone(): Gone;
  /** Fires after the list changed, here or once the IndexedDB copy turned out newer. */
  onChange(fn: () => void): void;
  /** Settles once the IndexedDB copy has been checked (a migration should wait for it, or it may stamp
   *  stale data as newest). */
  ready: Promise<void>;
}

interface Saved<T> { items: T[]; updated: number; gone?: Gone }

export function listStore<T>(key: string, valid: (v: unknown) => v is T): ListStore<T> {
  const LS = `haru:${key}`;
  const listeners = new Set<() => void>();
  const clean = (v: unknown): Saved<T> | null => {
    const s = v as Partial<Saved<T>> | null;
    return s && Array.isArray(s.items) ? { items: s.items.filter(valid), updated: Number(s.updated) || 0, gone: cleanGone(s.gone) } : null;
  };
  /** The key a tombstone goes under: the record's id (a bare string, like a check-in date, is its own). */
  const idOf = (t: T): string => (typeof t === 'string' ? t : String((t as { id?: unknown }).id ?? ''));
  let current: Saved<T> = { items: [], updated: 0, gone: {} };
  try {
    current = clean(JSON.parse(localStorage.getItem(LS) ?? 'null')) ?? current;
  } catch {
    // unreadable: start empty, the IndexedDB copy may still bring it back
  }
  const ready = kvGet<Saved<T>>(key)
    .then((v) => {
      const other = clean(v);
      if (other && other.updated > current.updated) {
        current = other;
        writeLocal();
        listeners.forEach((fn) => fn());
      } else if (current.updated) void kvSet(key, current).catch(() => {});
    })
    .catch(() => {});

  function writeLocal(): void {
    try {
      localStorage.setItem(LS, JSON.stringify(current));
    } catch {
      // full or blocked: the IndexedDB copy still holds it
    }
  }
  return {
    all: () => current.items,
    set(items) {
      current = { items, updated: Date.now(), gone: markGone(current.gone ?? {}, current.items, items, idOf) };
      writeLocal();
      void kvSet(key, current).catch(() => {});
      listeners.forEach((fn) => fn());
    },
    updated: () => current.updated,
    fromRemote(items, updated, gone) {
      current = clean({ items, updated, gone: gone ?? current.gone }) ?? { items: [], updated, gone: gone ?? current.gone };
      writeLocal();
      void kvSet(key, current).catch(() => {});
      listeners.forEach((fn) => fn());
    },
    gone: () => current.gone ?? {},
    onChange: (fn) => void listeners.add(fn),
    ready,
  };
}
