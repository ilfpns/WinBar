import { kvGet, kvSet } from '../storage/db';
import { type Gone, cleanGone, markGone } from '../storage/gone';
import { CATEGORIES, type Block, type Category, newId } from './model';
import type { TemplateBlock } from './templates';

/**
 * Plans: a day ahead laid out in advance (Calendar → Week). A plan is a list of tasks under a date; when that
 * day begins (see history's roll) its plan becomes Today and is used up. Kept in localStorage — read at once
 * when the day rolls over — and mirrored to IndexedDB like the templates.
 */
/** A planned task: a template's, with the note it carries into Today. */
export type PlanBlock = TemplateBlock;

export interface Plan {
  date: string;
  blocks: PlanBlock[];
  /** Where the tasks came from (a template's name, a day copied), shown under the day. */
  from: string;
  saved: number;
}

const KEY = 'haru:plans:v1';
const STAMP = 'haru:plans:updated';
const GONE = 'haru:plans:gone';
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

/** The task as kept: `note` only when it says something (the cloud copy takes no undefined fields). */
const planBlock = ({ title, cat, start, dur, note }: PlanBlock): PlanBlock =>
  note?.trim() ? { title, cat, start, dur, note } : { title, cat, start, dur };
const cleanBlocks = (blocks: unknown[]): PlanBlock[] =>
  blocks.flatMap((b) => {
    const x = b as Record<string, unknown>;
    return typeof x?.start === 'number' && typeof x.dur === 'number' && typeof x.cat === 'string' && x.cat in CATEGORIES
      ? [planBlock({ title: typeof x.title === 'string' ? x.title : '', cat: x.cat as Category, start: x.start, dur: x.dur, note: typeof x.note === 'string' ? x.note : undefined })]
      : [];
  });
const clean = (list: unknown[]): Plan[] =>
  list.flatMap((v) => {
    const p = v as Record<string, unknown>;
    return typeof p?.date === 'string' && DATE.test(p.date) && Array.isArray(p.blocks)
      ? [{ date: p.date, blocks: cleanBlocks(p.blocks), from: typeof p.from === 'string' ? p.from : '', saved: Number(p.saved) || 0 }]
      : [];
  });
// after the helpers above: read any earlier, they aren't defined yet and the saved plans load as none
let plans: Plan[] = load();
/** Days whose plan was dropped, and when (by date), for the merge with the cloud's copy. */
let gone: Gone = (() => {
  try {
    return cleanGone(JSON.parse(localStorage.getItem(GONE) ?? '{}'));
  } catch {
    return {};
  }
})();
export const plansGone = (): Gone => gone;

function load(): Plan[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? clean(raw) : [];
  } catch {
    return [];
  }
}
function save(stamp = Date.now(), before: readonly Plan[] = plans, remoteGone?: Gone): void {
  gone = remoteGone ?? markGone(gone, before, plans, (p) => p.date);
  try {
    localStorage.setItem(STAMP, String(stamp));
    localStorage.setItem(KEY, JSON.stringify(plans));
    localStorage.setItem(GONE, JSON.stringify(gone));
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

/** Lays out `date` with these tasks (replacing its plan); `from` says where they came from. Notes come along. */
export function setPlan(date: string, blocks: readonly PlanBlock[], from: string): void {
  const p: Plan = {
    date,
    blocks: blocks.map(planBlock).sort((a, b) => a.start - b.start),
    from,
    saved: Date.now(),
  };
  const before = plans;
  plans = [...plans.filter((x) => x.date !== date), p].sort((a, b) => a.date.localeCompare(b.date));
  save(Date.now(), before);
}

export function clearPlan(date: string): void {
  if (!planOn(date)) return;
  const before = plans;
  plans = plans.filter((p) => p.date !== date);
  save(Date.now(), before);
}

/**
 * The day `date` has begun: its plan as Today's tasks (none done), or null without one. That plan and any
 * older ones (days that went by while Haru was closed) are dropped.
 */
export function takePlan(date: string): Block[] | null {
  const p = planOn(date);
  const left = plans.filter((x) => x.date > date);
  if (left.length !== plans.length) {
    const before = plans;
    plans = left;
    save(Date.now(), before);
  }
  return p ? p.blocks.map((b) => ({ ...b, id: newId(), done: false })) : null;
}

/** Applies the plan list (and its tombstones) from the cloud, keeping its time stamp. */
export function plansFromRemote(list: unknown[], stamp: number, remoteGone?: Gone): void {
  const before = plans;
  plans = clean(list).sort((a, b) => a.date.localeCompare(b.date));
  save(stamp, before, remoteGone);
}

/** Replaces all plans (restoring a backup). */
export function replacePlans(list: unknown[]): void {
  const before = plans;
  plans = clean(list);
  save(Date.now(), before);
}
