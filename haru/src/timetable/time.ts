/** Minutes in a day. All times are minutes from 00:00, durations are minutes. */
export const DAY = 1440;
/** Grid that drags and time pickers snap to. */
export const SNAP = 15;

export const mod = (m: number): number => ((m % DAY) + DAY) % DAY;
export const snap = (m: number): number => Math.round(m / SNAP) * SNAP;

export function hhmm(m: number): string {
  const t = mod(Math.round(m));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function formatDuration(d: number): string {
  const h = Math.floor(d / 60);
  const m = Math.round(d % 60);
  const parts = [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '0m';
}

export function nowMinutes(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}
