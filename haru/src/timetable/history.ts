import { db } from '../storage/db';
import { resetAt } from './day-reset';
import { type Block } from './model';
import { setState, state, subscribe } from './state';

/**
 * Day history: Today's timetable is snapshotted under the date it was on (kv store, key `day:YYYY-MM-DD`),
 * so any past day can be looked at again from the calendar. A day without its own snapshot had the
 * timetable carried over from the last day that has one.
 */
const PREFIX = 'day:';
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day `d` belongs to: the date it was `resetAt()` minutes earlier (plain midnight when the reset is off). */
export const dayOf = (d = new Date()): string => dayKey(new Date(d.getTime() - (resetAt() ?? 0) * 60_000));
/** Which day Today's timetable belongs to (per browser), so a reset missed while Haru was closed still runs. */
const OWNER_KEY = 'haru:timetable-day';

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

/** Drops every day's snapshot (another account takes over this device; its own come back from the cloud). */
export async function clearDays(): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(IDBKeyRange.bound(PREFIX, `${PREFIX}￿`));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Keeps today's snapshot current: on start, on every change, and when the day rolls over. A new day (see
 * day-reset) files the timetable under the day that ended and starts Today empty; with the reset off the
 * same timetable carries into the new day.
 */
export function trackHistory(): void {
  let timer = 0;
  let last = state.blocks;
  let today = dayOf();
  try {
    today = localStorage.getItem(OWNER_KEY) ?? today;
  } catch {
    // the day it is now
  }
  const own = (day: string) => {
    today = day;
    try {
      localStorage.setItem(OWNER_KEY, day);
    } catch {
      // for this visit only
    }
  };
  const snap = () => {
    clearTimeout(timer);
    const s = { date: today, blocks: state.blocks, saved: Date.now() };
    void put(s).then(() => savedListeners.forEach((fn) => fn(s))).catch(() => {});
  };
  /**
   * Moves on only when the day is past the one the timetable belongs to: setting a later reset time never
   * steps back onto (and overwrites) a day that is already filed.
   */
  function roll(): void {
    const now = dayOf();
    if (now <= today) return;
    // the day that ended keeps the timetable as it was
    snap();
    own(now);
    if (resetAt() !== null && state.blocks.length) setState({ blocks: [], draft: null, selected: [] });
    else snap();
  }
  subscribe(() => {
    if (state.blocks === last) return;
    last = state.blocks;
    clearTimeout(timer);
    timer = window.setTimeout(snap, 400);
  });
  addEventListener('pagehide', snap);
  // a new day may have begun while Haru was closed
  roll();
  own(today);
  snap();
  setInterval(roll, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') roll();
  });
}
