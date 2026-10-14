import { kvGet, kvSet } from '../storage/db';
import { CATEGORIES, type Block, type Category, newId } from './model';
import { setState, state } from './state';

/**
 * Day templates: a named copy of a whole day's timetable ("Weekday", "Exam day"…). Applying one
 * replaces Today's tasks with it (undoable). Kept in localStorage and mirrored to IndexedDB like the timetable.
 */
export interface TemplateBlock { title: string; cat: Category; start: number; dur: number }
export interface Template { id: string; name: string; blocks: TemplateBlock[]; updated: number }

const KEY = 'haru:templates:v1';
const listeners = new Set<() => void>();
let templates: Template[] = load();

function isTemplate(v: unknown): v is Template {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.blocks);
}
const cleanBlocks = (blocks: unknown[]): TemplateBlock[] =>
  blocks.flatMap((b) => {
    const x = b as Record<string, unknown>;
    return typeof x?.start === 'number' && typeof x.dur === 'number' && typeof x.cat === 'string' && x.cat in CATEGORIES
      ? [{ title: typeof x.title === 'string' ? x.title : '', cat: x.cat as Category, start: x.start, dur: x.dur }]
      : [];
  });
const clean = (list: unknown[]): Template[] =>
  list.filter(isTemplate).map((t) => ({ id: t.id, name: t.name, blocks: cleanBlocks(t.blocks), updated: Number(t.updated) || 0 }));

function load(): Template[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? clean(raw) : [];
  } catch {
    return [];
  }
}
function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates));
  } catch {
    // storage unavailable — the IndexedDB mirror below still has them
  }
  void kvSet('templates', templates).catch(() => {});
  listeners.forEach((fn) => fn());
}

// localStorage lost but the mirror survived: bring the templates back
void kvGet<unknown[]>('templates')
  .then((saved) => {
    if (!templates.length && Array.isArray(saved) && saved.length) {
      templates = clean(saved);
      save();
    }
  })
  .catch(() => {});

export const allTemplates = (): Template[] => templates;
export function onTemplates(fn: () => void): void {
  listeners.add(fn);
}

/** Saves Today's tasks under `name` (a template with the same name is updated). */
export function saveTemplate(name: string): Template {
  const blocks = state.blocks.map(({ title, cat, start, dur }) => ({ title, cat, start, dur })).sort((a, b) => a.start - b.start);
  const same = templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
  const t: Template = { id: same?.id ?? newId(), name, blocks, updated: Date.now() };
  templates = same ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t];
  save();
  return t;
}

export function removeTemplate(id: string): void {
  templates = templates.filter((t) => t.id !== id);
  save();
}

/** Replaces Today's tasks with the template's (all not done). Returns the tasks it replaced, for undo. */
export function applyTemplate(id: string): Block[] | null {
  const t = templates.find((x) => x.id === id);
  if (!t) return null;
  const before = state.blocks;
  setState({ blocks: t.blocks.map((b) => ({ ...b, id: newId(), done: false })), draft: null, selected: [] });
  return before;
}

/** Replaces all templates (restoring a backup). */
export function replaceTemplates(list: unknown[]): void {
  templates = clean(list);
  save();
}
