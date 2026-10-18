/**
 * New day: Today is one day's timetable, so at a time of your choosing (Settings → Today) it is kept in the
 * calendar under the day it belonged to and Today starts empty. Off, the timetable carries on past midnight.
 * Before that time it still counts as the day before: at 02:00 with a 04:00 reset, you are finishing yesterday.
 */
const KEY = 'haru:day-reset';
/** Minute of day a new day starts at, unless set otherwise. */
export const DEFAULT_RESET = 4 * 60;

const listeners = new Set<() => void>();

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

export function setResetAt(m: number | null): void {
  try {
    localStorage.setItem(KEY, m === null ? 'off' : String(m));
  } catch {
    // for this visit only
  }
  listeners.forEach((fn) => fn());
}

/** Fires after the reset time is changed or turned on/off. */
export function onResetAt(fn: () => void): void {
  listeners.add(fn);
}
