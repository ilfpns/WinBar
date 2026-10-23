import { kvGet, kvSet } from '../storage/db';
import { CATEGORIES, type Block, type Category, newId } from './model';
import type { TemplateBlock } from './templates';

/**
 * Plans: a day ahead laid out in advance (Calendar → Week). A plan is a list of tasks under a date; when that
 * day begins (see history's roll) its plan becomes Today and is used up. Kept in localStorage — read at once
 * when the day rolls over — and mirrored to IndexedDB like the templates.
 */
export interface Plan {
  date: string;
  blocks: TemplateBlock[];
  /** Where the tasks came from (a template's name, a day copied), shown under the day. */
  from: string;
  saved: number;
}

const KEY = 'haru:plans:v1';
const STAMP = 'haru:plans:updated';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** When the plan list last changed on this device (0 if never). */
export const plansUpdated = (): number => {
  try {
    return Number(localStorage.getItem(STAMP) ?? 0) || 0;
  } catch {
    return 0;
  }
};
const listeners = new Set<() => void>();
let plans: Plan[] = load();

const cleanBlocks = (blocks: unknown[]): TemplateBlock[] =>
  blocks.flatMap((b) => {
    const x = b as Record<string, unknown>;
    return typeof x?.start === 'number' && typeof x.dur === 'number' && typeof x.cat === 'string' && x.cat in CATEGORIES
      ? [{ title: typeof x.title === 'string' ? x.title : '', cat: x.cat as Category, start: x.start, dur: x.dur }]
      : [];
  });
const clean = (list: unknown[]): Plan[] =>
  list.flatMap((v) => {
    const p = v as Record<string, unknown>;
    return typeof p?.date === 'string' && DATE.test(p.date) && Array.isArray(p.blocks)
      ? [{ date: p.date, blocks: cleanBlocks(p.blocks), from: typeof p.from === 'string' ? p.from : '', saved: Number(p.saved) || 0 }]
      : [];
  });

function load(): Plan[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? clean(raw) : [];
  } catch {
    return [];
  }
}
function save(stamp = Date.now()): void {
  try {
    localStorage.setItem(STAMP, String(stamp));
    localStorage.setItem(KEY, JSON.stringify(plans));
  } catch {
    // storage unavailable — the IndexedDB mirror below still has them
  }
  void kvSet('plans', plans).catch(() => {});
  listeners.forEach((fn) => fn());
}

// localStorage lost but the mirror survived: bring the plans back
void kvGet<unknown[]>('plans')
  .then((saved) => {
    if (!plans.length && Array.isArray(saved) && saved.length) {
      plans = clean(saved);
      save();
    }
  })
  .catch(() => {});

export const allPlans = (): Plan[] => plans;
export const planOn = (date: string): Plan | undefined => plans.find((p) => p.date === date);
export function onPlans(fn: () => void): void {
  listeners.add(fn);
}

/** Lays out `date` with these tasks (replacing its plan); `from` says where they came from. */
export function setPlan(date: string, blocks: readonly TemplateBlock[], from: string): void {
  const p: Plan = {
    date,
    blocks: blocks.map(({ title, cat, start, dur }) => ({ title, cat, start, dur })).sort((a, b) => a.start - b.start),
    from,
    saved: Date.now(),
  };
  plans = [...plans.filter((x) => x.date !== date), p].sort((a, b) => a.date.localeCompare(b.date));
  save();
}

export function clearPlan(date: string): void {
  if (!planOn(date)) return;
  plans = plans.filter((p) => p.date !== date);
  save();
}

/**
 * The day `date` has begun: its plan as Today's tasks (none done), or null without one. That plan and any
 * older ones (days that went by while Haru was closed) are dropped.
 */
export function takePlan(date: string): Block[] | null {
  const p = planOn(date);
  const left = plans.filter((x) => x.date > date);
  if (left.length !== plans.length) {
    plans = left;
    save();
  }
  return p ? p.blocks.map((b) => ({ ...b, id: newId(), done: false })) : null;
}

/** Applies the plan list from the cloud, keeping its time stamp. */
export function plansFromRemote(list: unknown[], stamp: number): void {
  plans = clean(list);
  save(stamp);
}

/** Replaces all plans (restoring a backup). */
export function replacePlans(list: unknown[]): void {
  plans = clean(list);
  save();
}
