import { CATEGORY_KEYS, type Block, type Category } from './model';
import { allDays, dayOf, onDaySaved } from './history';
import { state, subscribe } from './state';

/**
 * Days in a row: for each category, how many days running something in it was done (checked off), up to today.
 * Today still open doesn't break a run — a run that reached yesterday carries on until today ends without one.
 * Read from the day history (and Today as it stands), the same days the calendar and the Dot board show.
 */
export interface DayTotals { date: string; planned: Record<Category, number>; done: Record<Category, number> }
export interface Streak { cat: Category; days: number; best: number }

const zero = () => Object.fromEntries(CATEGORY_KEYS.map((c) => [c, 0])) as Record<Category, number>;
export function totalsOf(date: string, blocks: readonly Block[]): DayTotals {
  const planned = zero();
  const done = zero();
  for (const b of blocks) {
    planned[b.cat] += b.dur;
    if (b.done) done[b.cat] += b.dur;
  }
  return { date, planned, done };
}

/** Every kept day with tasks and Today as it stands, oldest first. */
export async function keptDays(): Promise<DayTotals[]> {
  const today = dayOf();
  const days = (await allDays()).filter((s) => s.date !== today && s.blocks?.length).map((s) => totalsOf(s.date, s.blocks));
  if (state.blocks.length) days.push(totalsOf(today, state.blocks));
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

const prevDate = (date: string) => {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Each category's current run and its longest, longest current first; categories never done are left out. */
export function streaksOf(days: readonly DayTotals[], today = dayOf()): Streak[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const did = (date: string, cat: Category) => (byDate.get(date)?.done[cat] ?? 0) > 0;
  return CATEGORY_KEYS.flatMap((cat) => {
    let best = 0;
    let run = 0;
    let last = '';
    for (const d of days) {
      if (!did(d.date, cat)) continue;
      run = last && prevDate(d.date) === last ? run + 1 : 1;
      last = d.date;
      best = Math.max(best, run);
    }
    if (!best) return [];
    // the run still going: from today back, or from yesterday while today has none yet
    let at = did(today, cat) ? today : prevDate(today);
    let days_ = 0;
    while (did(at, cat)) {
      days_++;
      at = prevDate(at);
    }
    return [{ cat, days: days_, best }];
  }).sort((a, b) => b.days - a.days || b.best - a.best);
}

/** Days in a row with Today kept (any task on it): from today back, or from yesterday while today has none yet. */
export function keptRunOf(days: readonly DayTotals[], today = dayOf()): { days: number; best: number } {
  const kept = new Set(days.filter((d) => Object.values(d.planned).some((m) => m > 0)).map((d) => d.date));
  let best = 0;
  let run = 0;
  let last = '';
  for (const d of [...kept].sort()) {
    run = last && prevDate(d) === last ? run + 1 : 1;
    last = d;
    best = Math.max(best, run);
  }
  let at = kept.has(today) ? today : prevDate(today);
  let n = 0;
  while (kept.has(at)) {
    n++;
    at = prevDate(at);
  }
  return { days: n, best };
}

/** The streaks, kept up to date as days are saved and Today changes. */
let current: Streak[] = [];
let keptRun = { days: 0, best: 0 };
export const todayRun = (): { days: number; best: number } => keptRun;
const listeners = new Set<(s: Streak[]) => void>();
export const streaks = (): Streak[] => current;
export function onStreaks(fn: (s: Streak[]) => void): void {
  listeners.add(fn);
}
export function mountStreaks(): void {
  let timer = 0;
  const refresh = () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const all = await keptDays();
      const next = streaksOf(all);
      const run = keptRunOf(all);
      if (JSON.stringify(next) === JSON.stringify(current) && run.days === keptRun.days && run.best === keptRun.best) return;
      current = next;
      keptRun = run;
      listeners.forEach((fn) => fn(current));
    }, 300);
  };
  onDaySaved(refresh);
  let blocks = state.blocks;
  subscribe(() => {
    if (state.blocks === blocks) return;
    blocks = state.blocks;
    refresh();
  });
  refresh();
}
