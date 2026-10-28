import { labelOf } from './model';
import { state } from './state';
import { hhmm, mod, nowMinutes } from './time';

/**
 * Reminders: with them on (Today → Next 3 hours), a system notification five minutes before each of Today's
 * tasks begins, while Haru is open (a tab, the installed app or WinBar's window). Kept per device: the browser's
 * notification permission is too.
 */
const KEY = 'haru:reminders';
const AHEAD = 5;

export function remindersOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** Turns reminders on (asking the browser's permission the first time) or off; false when they can't be on. */
export async function toggleReminders(): Promise<boolean> {
  const on = !remindersOn();
  if (on) {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return false;
  }
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // for this visit only
  }
  return on;
}

export function mountReminders(): void {
  // each task once per start time (a moved task is reminded again)
  const sent = new Set<string>();
  setInterval(() => {
    if (!remindersOn()) return;
    const now = nowMinutes();
    for (const b of state.blocks) {
      const lead = mod(b.start - now);
      const key = `${b.id}@${b.start}`;
      if (b.done || lead > AHEAD || lead <= AHEAD - 1 || sent.has(key)) continue;
      sent.add(key);
      try {
        new Notification(labelOf(b), { body: `${hhmm(b.start)}–${hhmm(b.start + b.dur)} · in ${AHEAD} min`, tag: key, icon: `${import.meta.env.BASE_URL}favicon.png` });
      } catch {
        // some browsers only notify through the service worker; nothing to do then
      }
    }
  }, 20_000);
}
