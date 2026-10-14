/**
 * The app's IndexedDB: `notes` (one memo per date), `images` (pictures attached to a day's memo)
 * and `kv` (mirrors and settings that must outlive localStorage hiccups — the timetable copy,
 * the backup file handle). Upgrades only ever add stores, so nothing saved is touched.
 */
const NAME = 'haru';
const VERSION = 3;

let opening: Promise<IDBDatabase> | null = null;

export function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'date' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const opened = req.result;
      // a newer Haru (another tab, after a deploy) needs to upgrade: step aside instead of blocking it
      opened.onversionchange = () => opened.close();
      resolve(opened);
    };
    req.onerror = () => reject(req.error);
  });
  return opening;
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return wrap(d.transaction('kv').objectStore('kv').get(key)) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  await wrap(d.transaction('kv', 'readwrite').objectStore('kv').put(value, key));
}

/** Asks the browser to keep this site's storage even under disk pressure (no-op where unsupported). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
