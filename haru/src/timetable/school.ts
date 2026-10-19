import { dayKey } from './history';
import { type Block, newId, overlaps } from './model';
import { setState, state } from './state';

/**
 * The school's class timetable (컴시간알리미, published by scripts/fetch-school-timetable.mjs as
 * data/school-timetable.json): pick your class in Settings → Today, and Apply lays today's lessons onto
 * Today as School tasks at their periods' hours — one task per subject run (the same subject in a row is one
 * task). Tasks in their way are replaced; everything else on Today stays.
 */
interface Lesson { period: number; subject: string }
interface Week { start: string; periods: string[]; classes: Record<string, Record<string, Lesson[]>> }
interface Timetable { school: string; weeks: Week[] }

const CLASS_KEY = 'haru:school-class';
/** A period lasts this long unless the next one starts sooner. */
const PERIOD_MIN = 50;

let data: Timetable | null = null;
let loading: Promise<Timetable | null> | null = null;

/** The published timetable (read once). */
export function schoolTimetable(): Promise<Timetable | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/school-timetable.json?t=${Math.floor(Date.now() / 3_600_000)}`)
    .then((r) => (r.ok ? (r.json() as Promise<Timetable>) : null))
    .then((t) => (data = t))
    .catch(() => null);
  return loading;
}

export function schoolClass(): string {
  try {
    return localStorage.getItem(CLASS_KEY) ?? '';
  } catch {
    return '';
  }
}
export function setSchoolClass(cls: string): void {
  try {
    localStorage.setItem(CLASS_KEY, cls);
  } catch {
    // for this visit
  }
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Today's lessons for a class as tasks, or why there are none. */
export function lessonsToday(cls: string, now = new Date()): Block[] | string {
  if (!data) return 'The school timetable isn’t loaded yet';
  const today = dayKey(now);
  const week = data.weeks.find((w) => {
    const end = new Date(`${w.start}T00:00`);
    end.setDate(end.getDate() + 7);
    return w.start <= today && today < dayKey(end);
  });
  if (!week) return 'No timetable for this week yet';
  const day = now.getDay();
  const lessons = week.classes[cls]?.[String(day)] ?? [];
  if (day === 0 || day === 6 || !lessons.length) return 'No classes today';
  const blocks: Block[] = [];
  for (const l of lessons) {
    const at = week.periods[l.period - 1];
    if (!at) continue;
    const start = toMin(at);
    const next = week.periods[l.period];
    const dur = next ? Math.min(PERIOD_MIN, toMin(next) - start) : PERIOD_MIN;
    const prev = blocks.at(-1);
    // the same subject straight after (across a break of up to 10 minutes) carries the one task on
    if (prev && prev.title === l.subject && start - (prev.start + prev.dur) <= 10) prev.dur = start + dur - prev.start;
    else blocks.push({ id: newId(), title: l.subject, cat: 'school', start, dur, done: false });
  }
  return blocks;
}

/** Puts the lessons on Today: tasks they would overlap are taken off. Returns what was replaced. */
export function applyLessons(lessons: Block[]): Block[] {
  const kept = state.blocks.filter((b) => !lessons.some((l) => overlaps([l], { ...b, id: null })));
  const replaced = state.blocks.filter((b) => !kept.includes(b));
  setState({ blocks: [...kept, ...lessons], draft: null, selected: [] });
  return replaced;
}
