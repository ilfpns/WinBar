import { db } from '../storage/db';

/**
 * Images attached to a day's memo, kept in IndexedDB (`images`, one record per image) next to the memos.
 * Everything is mirrored in memory; thumbnails use object URLs made once per image.
 */
const STORE = 'images';
const MAX_SIDE = 2400; // bigger photos are scaled down when added (keeps storage and backups sane)

export interface ImageRecord {
  id: string;
  date: string; // YYYY-MM-DD
  blob: Blob;
  created: number;
}

export interface Images {
  get(date: string): ImageRecord[];
  url(rec: ImageRecord): string;
  add(date: string, files: Blob[]): Promise<number>;
  remove(id: string): void;
  /** Every image, for backups. */
  all(): ImageRecord[];
  /** Replaces all images (restoring a backup). */
  replace(records: ImageRecord[]): void;
  /** Applies an image added or removed elsewhere (cloud), without notifying the sync back. */
  putFromRemote(rec: ImageRecord): void;
  removeFromRemote(id: string): void;
  has(id: string): boolean;
  ready: Promise<void>;
}

const listeners = new Set<() => void>();
/** Fires after any image is added or removed (used by the file backup). */
export function onImagesChanged(fn: () => void): void {
  listeners.add(fn);
}

let shared: Images | null = null;
export const imagesStore = (): Images | null => shared;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Scales very large photos down; small images and GIFs (which may animate) are kept as they are. */
async function shrink(file: Blob): Promise<Blob> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1) {
    bmp.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/webp', 0.9));
}

export function createImages(onChange: () => void): Images {
  const byDate = new Map<string, ImageRecord[]>();
  const urls = new Map<string, string>();
  let handle: IDBDatabase | null = null;
  const changed = () => {
    onChange();
    listeners.forEach((fn) => fn());
  };
  const put = (r: ImageRecord) => byDate.set(r.date, [...(byDate.get(r.date) ?? []), r].sort((a, b) => a.created - b.created));
  const write = (fn: (store: IDBObjectStore) => void) => {
    if (handle) fn(handle.transaction(STORE, 'readwrite').objectStore(STORE));
  };

  const ready = db()
    .then((opened) => {
      handle = opened;
      return new Promise<void>((resolve) => {
        const req = opened.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => {
          for (const r of req.result as ImageRecord[]) put(r);
          resolve();
        };
        req.onerror = () => resolve();
      });
    })
    .catch(() => {
      // private mode or blocked storage: images still work for this session
    })
    .then(onChange);

  const dropLocal = (id: string) => {
    for (const [date, list] of byDate) {
      const next = list.filter((r) => r.id !== id);
      if (next.length === list.length) continue;
      if (next.length) byDate.set(date, next);
      else byDate.delete(date);
    }
    const u = urls.get(id);
    if (u) URL.revokeObjectURL(u);
    urls.delete(id);
    write((s) => s.delete(id));
  };
  shared = {
    ready,
    has: (id) => [...byDate.values()].some((l) => l.some((r) => r.id === id)),
    putFromRemote(rec) {
      if (shared!.has(rec.id)) return;
      put(rec);
      write((s) => s.put(rec));
      onChange();
    },
    removeFromRemote(id) {
      if (!shared!.has(id)) return;
      dropLocal(id);
      onChange();
    },
    get: (date) => byDate.get(date) ?? [],
    all: () => [...byDate.values()].flat(),
    url(rec) {
      let u = urls.get(rec.id);
      if (!u) {
        u = URL.createObjectURL(rec.blob);
        urls.set(rec.id, u);
      }
      return u;
    },
    async add(date, files) {
      const images = files.filter((f) => f.type.startsWith('image/'));
      for (const f of images) {
        const rec: ImageRecord = { id: newId(), date, blob: await shrink(f), created: Date.now() };
        put(rec);
        write((s) => s.put(rec));
      }
      if (images.length) changed();
      return images.length;
    },
    remove(id) {
      for (const [date, list] of byDate) {
        const next = list.filter((r) => r.id !== id);
        if (next.length === list.length) continue;
        if (next.length) byDate.set(date, next);
        else byDate.delete(date);
      }
      const u = urls.get(id);
      if (u) URL.revokeObjectURL(u);
      urls.delete(id);
      write((s) => s.delete(id));
      changed();
    },
    replace(records) {
      byDate.clear();
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
      for (const r of records) put(r);
      write((s) => {
        s.clear();
        for (const r of records) s.put(r);
      });
      changed();
    },
  };
  return shared;
}

/** Blob → data URL (for the JSON backup file). */
export const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Data URL → Blob (restoring a backup). */
export const fromDataUrl = async (url: string) => (await fetch(url)).blob();
