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

/** A typed time → minutes, or null: "9", "930", "0930", "9:30" and "24:00" all work. */
export const minutesOf = (v: string): number | null => {
  const t = v.trim();
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(t.includes(':') || t.length > 2 ? t.replace(/^(\d{1,2})(\d{2})$/, '$1:$2') : t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h > 24 || min > 59 || (h === 24 && min) ? null : (h * 60 + min) % DAY;
};
