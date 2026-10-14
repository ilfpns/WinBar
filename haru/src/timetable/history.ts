import { db } from '../storage/db';
import { type Block } from './model';
import { state, subscribe } from './state';

/**
 * Day history: Today's timetable is snapshotted under the date it was on (kv store, key `day:YYYY-MM-DD`),
 * so any past day can be looked at again from the calendar. A day without its own snapshot had the
 * timetable carried over from the last day that has one.
 */
const PREFIX = 'day:';
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface DaySnapshot { date: string; blocks: Block[]; saved: number }

const savedListeners = new Set<(s: DaySnapshot) => void>();
/** Fires after a day's snapshot is written locally (not for ones applied from the cloud). */
export function onDaySaved(fn: (s: DaySnapshot) => void): void {
  savedListeners.add(fn);
}
/** Writes a snapshot that came from the cloud, unless this device has a newer one for that day. */
export async function putFromRemote(snap: DaySnapshot): Promise<void> {
  const mine = await timetableOn(snap.date);
  if (mine && !mine.carried && mine.snap.saved >= snap.saved) return;
  await put(snap);
}

async function put(snap: DaySnapshot): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(snap, PREFIX + snap.date);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** The timetable as it was on `date`: that day's snapshot, or the closest earlier one (carried over). */
export async function timetableOn(date: string): Promise<{ snap: DaySnapshot; carried: boolean } | null> {
  const d = await db();
  return new Promise((resolve) => {
    const range = IDBKeyRange.bound(`${PREFIX}0000-00-00`, PREFIX + date);
    const req = d.transaction('kv').objectStore('kv').openCursor(range, 'prev');
    req.onsuccess = () => {
      const cur = req.result;
      const snap = cur?.value as DaySnapshot | undefined;
      resolve(snap ? { snap, carried: snap.date !== date } : null);
    };
    req.onerror = () => resolve(null);
  });
}

/** Every snapshot, for backups. */
export async function allDays(): Promise<DaySnapshot[]> {
  const d = await db();
  return new Promise((resolve) => {
    const req = d.transaction('kv').objectStore('kv').getAll(IDBKeyRange.bound(PREFIX, `${PREFIX}￿`));
    req.onsuccess = () => resolve(req.result as DaySnapshot[]);
    req.onerror = () => resolve([]);
  });
}

/** Restores snapshots from a backup (existing days are overwritten, others kept). */
export async function restoreDays(list: unknown[]): Promise<void> {
  for (const v of list) {
    const s = v as Partial<DaySnapshot>;
    if (typeof s?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Array.isArray(s.blocks)) {
      await put({ date: s.date, blocks: s.blocks as Block[], saved: Number(s.saved) || Date.now() });
    }
  }
}

/** Keeps today's snapshot current: on start, on every change, and when the date rolls over. */
export function trackHistory(): void {
  let timer = 0;
  let last = state.blocks;
  const snap = () => {
    clearTimeout(timer);
    const s = { date: dayKey(), blocks: state.blocks, saved: Date.now() };
    void put(s).then(() => savedListeners.forEach((fn) => fn(s))).catch(() => {});
  };
  subscribe(() => {
    if (state.blocks === last) return;
    last = state.blocks;
    clearTimeout(timer);
    timer = window.setTimeout(snap, 400);
  });
  addEventListener('pagehide', snap);
  snap();
  // past midnight the same timetable carries into the new day
  let today = dayKey();
  setInterval(() => {
    if (dayKey() === today) return;
    today = dayKey();
    snap();
  }, 60_000);
}
