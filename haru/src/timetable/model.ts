import { DAY, SNAP, mod } from './time';

export const CATEGORIES = {
  work: 'Work',
  study: 'Study',
  health: 'Health',
  personal: 'Personal',
  sleep: 'Sleep',
  etc: 'Other',
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

export interface Block {
  id: string;
  title: string;
  cat: Category;
  /** Minute of day the block starts at. */
  start: number;
  /** Length in minutes; a block may wrap past midnight. */
  dur: number;
  /** Checked off as a finished task. */
  done: boolean;
}

/** A block being created (id null) or edited. */
export type Draft = Omit<Block, 'id'> & { id: string | null };

/**
 * Day progress in minutes: how much of the 24h day is planned, and how much of that is done.
 * Progress is measured against the whole day, so a full, fully-done day is 100%.
 */
export function progressOf(blocks: readonly Block[]): { done: number; planned: number } {
  const sum = (bs: readonly Block[]) => bs.reduce((m, b) => m + b.dur, 0);
  return { done: sum(blocks.filter((b) => b.done)), planned: sum(blocks) };
}

export const labelOf = (b: Pick<Block, 'title' | 'cat'>): string => b.title || CATEGORIES[b.cat];
export const contains = (b: Pick<Block, 'start' | 'dur'>, m: number): boolean => mod(m - b.start) < b.dur;

export function blockAt(blocks: readonly Block[], m: number, excludeId?: string | null): Block | undefined {
  return blocks.find((b) => b.id !== excludeId && contains(b, m));
}

export function overlaps(blocks: readonly Block[], c: Draft): boolean {
  return blocks.some((b) => b.id !== c.id && (mod(c.start - b.start) < b.dur || mod(b.start - c.start) < c.dur));
}

/** Free minutes clockwise (fwd) and counter-clockwise (back) from `m` before hitting another block. */
export function freeAround(blocks: readonly Block[], m: number, excludeId?: string | null): { fwd: number; back: number } {
  const others = blocks.filter((b) => b.id !== excludeId);
  let fwd = DAY;
  let back = DAY;
  for (const b of others) {
    fwd = Math.min(fwd, mod(b.start - m));
    back = Math.min(back, mod(m - (b.start + b.dur)));
  }
  if (others.some((b) => contains(b, m + 0.01))) fwd = 0;
  if (others.some((b) => contains(b, m - 0.01))) back = 0;
  return { fwd, back };
}

/** Tasks touching the arc `range` (used to sweep-select on the dial). */
export function blocksInRange(blocks: readonly Block[], range: { start: number; dur: number }): Block[] {
  const r = { ...range, dur: Math.max(range.dur, 0.01) };
  return blocks.filter((b) => mod(b.start - r.start) < r.dur || mod(r.start - b.start) < b.dur);
}

/** First free slot (up to an hour) at or after `from`, scanning the day in SNAP steps. */
export function firstFreeSlot(blocks: readonly Block[], from: number): { start: number; dur: number } | null {
  for (let i = 0; i < DAY; i += SNAP) {
    const m = mod(from + i);
    if (blockAt(blocks, m)) continue;
    const { fwd } = freeAround(blocks, m);
    if (fwd >= SNAP) return { start: m, dur: Math.min(60, fwd) };
  }
  return null;
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** A filled-in example day (kept for tests and demos; no longer offered in the UI). */
export function sampleDay(): Block[] {
  const t = (h: number, m = 0) => h * 60 + m;
  const day: Omit<Block, 'id' | 'done'>[] = [
    { title: 'Sleep', cat: 'sleep', start: t(23), dur: 8 * 60 },
    { title: 'Morning routine', cat: 'personal', start: t(7), dur: 60 },
    { title: 'Commute', cat: 'etc', start: t(8), dur: 60 },
    { title: 'Deep work', cat: 'work', start: t(9), dur: 180 },
    { title: 'Lunch', cat: 'personal', start: t(12), dur: 60 },
    { title: 'Meetings', cat: 'work', start: t(13), dur: 300 },
    { title: 'Workout', cat: 'health', start: t(19), dur: 60 },
    { title: 'Study', cat: 'study', start: t(20, 30), dur: 90 },
  ];
  return day.map((b) => ({ ...b, id: newId(), done: false }));
}

// ---------- persistence

const STORE_KEY = 'haru:timetable:v1';

export function isBlock(v: unknown): v is Block {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return typeof b.id === 'string' && typeof b.title === 'string' && typeof b.cat === 'string' && b.cat in CATEGORIES
    && typeof b.start === 'number' && typeof b.dur === 'number';
}

export function loadBlocks(): Block[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    // blocks saved before `done` existed load as not done
    return Array.isArray(raw) ? raw.filter(isBlock).map((b) => ({ ...b, done: b.done === true })) : [];
  } catch {
    return [];
  }
}

export function saveBlocks(blocks: readonly Block[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(blocks));
  } catch {
    // storage unavailable (private mode etc.) — keep working in memory
  }
}
