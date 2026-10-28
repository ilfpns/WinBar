/**
 * New day: Today is one day's timetable, so at a time of your choosing (Settings → Today) it is kept in the
 * calendar under the day it belonged to and Today starts empty. Off, the timetable carries on past midnight.
 * Before that time it still counts as the day before: at 02:00 with a 04:00 reset, you are finishing yesterday.
 * The choice is the account's, not the browser's: it is stamped and synced (`meta/settings`) so every device —
 * and Claude through the MCP — counts the same day.
 */
const KEY = 'haru:day-reset';
const STAMP = 'haru:day-reset:updated';
/** Minute of day a new day starts at, unless set otherwise. */
export const DEFAULT_RESET = 4 * 60;

const listeners = new Set<() => void>();

// chosen before it was synced (no stamp yet): still a choice, older than any made from now on, newer than none
try {
  if (localStorage.getItem(KEY) !== null && localStorage.getItem(STAMP) === null) localStorage.setItem(STAMP, '1');
} catch {
  // unreadable: nothing to keep
}

/** The minute of day Today starts over at, or null when it never does. */
export function resetAt(): number | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // unreadable: the default
  }
  if (raw === 'off') return null;
  const m = Number(raw);
  return raw !== null && Number.isInteger(m) && m >= 0 && m < 1440 ? m : DEFAULT_RESET;
}

/** When the reset time was last chosen on this device (0: never, it is the default here). */
export function resetUpdated(): number {
  try {
    return Number(localStorage.getItem(STAMP) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function setResetAt(m: number | null, stamp = Date.now()): void {
  try {
    localStorage.setItem(KEY, m === null ? 'off' : String(m));
    localStorage.setItem(STAMP, String(stamp));
  } catch {
    // for this visit only
  }
  listeners.forEach((fn) => fn());
}

/** Takes the reset time chosen on another device, keeping its stamp (so it isn't sent straight back). */
export function resetFromRemote(m: unknown, stamp: number): void {
  const valid = m === null || (typeof m === 'number' && Number.isInteger(m) && m >= 0 && m < 1440);
  if (valid) setResetAt(m as number | null, stamp);
}

/** Fires after the reset time is changed or turned on/off (here or from another device). */
export function onResetAt(fn: () => void): void {
  listeners.add(fn);
}
