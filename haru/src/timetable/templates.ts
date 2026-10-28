import { kvGet, kvSet } from '../storage/db';
import { type Gone, cleanGone, markGone, nextStamp } from '../storage/gone';
import { CATEGORIES, type Block, type Category, newId } from './model';
import { announceAdded, setState, state } from './state';

/**
 * Day templates: a named copy of a whole day's timetable ("Weekday", "Exam day"…). Applying one
 * replaces Today's tasks with it (undoable). Kept in localStorage and mirrored to IndexedDB like the timetable.
 */
/** A template's task; `note` (what to keep in mind) goes along onto Today and plans, the key only when there is one. */
export interface TemplateBlock { title: string; cat: Category; start: number; dur: number; note?: string }
/** The task as kept: no blank note (the cloud copy takes no undefined fields). */
export const templateBlock = ({ title, cat, start, dur, note }: TemplateBlock): TemplateBlock =>
  note?.trim() ? { title, cat, start, dur, note } : { title, cat, start, dur };
export interface Template { id: string; name: string; blocks: TemplateBlock[]; updated: number }

const KEY = 'haru:templates:v1';
const STAMP = 'haru:templates:updated';
const GONE = 'haru:templates:gone';
/** When the template list last changed on this device (0 if never). */
export const templatesUpdated = (): number => Number(localStorage.getItem(STAMP) ?? 0) || 0;
const listeners = new Set<() => void>();

function isTemplate(v: unknown): v is Template {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.blocks);
}
const cleanBlocks = (blocks: unknown[]): TemplateBlock[] =>
  blocks.flatMap((b) => {
    const x = b as Record<string, unknown>;
    return typeof x?.start === 'number' && typeof x.dur === 'number' && typeof x.cat === 'string' && x.cat in CATEGORIES
      ? [templateBlock({ title: typeof x.title === 'string' ? x.title : '', cat: x.cat as Category, start: x.start, dur: x.dur, note: typeof x.note === 'string' ? x.note : undefined })]
      : [];
  });
const clean = (list: unknown[]): Template[] =>
  list.filter(isTemplate).map((t) => ({ id: t.id, name: t.name, blocks: cleanBlocks(t.blocks), updated: Number(t.updated) || 0 }));
// after the helpers above: read any earlier, they aren't defined yet and the saved templates load as none
let templates: Template[] = load();
/** Templates deleted, and when (by id), for the merge with the cloud's copy. */
let gone: Gone = (() => {
  try {
    return cleanGone(JSON.parse(localStorage.getItem(GONE) ?? '{}'));
  } catch {
    return {};
  }
})();
export const templatesGone = (): Gone => gone;

function load(): Template[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? clean(raw) : [];
  } catch {
    return [];
  }
}
function save(stamp = nextStamp(templatesUpdated()), before: readonly Template[] = templates, remoteGone?: Gone): void {
  gone = remoteGone ?? markGone(gone, before, templates, (t) => t.id);
  try {
    localStorage.setItem(STAMP, String(stamp));
    localStorage.setItem(KEY, JSON.stringify(templates));
    localStorage.setItem(GONE, JSON.stringify(gone));
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
  const blocks = state.blocks.map(templateBlock).sort((a, b) => a.start - b.start);
  const same = templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
  const t: Template = { id: same?.id ?? newId(), name, blocks, updated: Date.now() };
  templates = same ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t];
  save();
  return t;
}

/** A new, empty template to fill in (a template with the same name is returned as is). */
export function createTemplate(name: string): Template {
  const same = templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (same) return same;
  const t: Template = { id: newId(), name, blocks: [], updated: Date.now() };
  templates = [...templates, t];
  save();
  return t;
}

/** Renames a template or replaces its tasks (kept in start order). */
export function updateTemplate(id: string, patch: Partial<Pick<Template, 'name' | 'blocks'>>): void {
  templates = templates.map((t) => (t.id === id
    ? { ...t, ...patch, blocks: (patch.blocks ?? t.blocks).map(templateBlock).sort((a, b) => a.start - b.start), updated: Date.now() }
    : t));
  save();
}

export function removeTemplate(id: string): void {
  const before = templates;
  templates = templates.filter((t) => t.id !== id);
  save(nextStamp(templatesUpdated()), before);
}

/** Replaces Today's tasks with the template's (all not done). Returns the tasks it replaced, for undo. */
export function applyTemplate(id: string): Block[] | null {
  const t = templates.find((x) => x.id === id);
  if (!t) return null;
  const before = state.blocks;
  setState({ blocks: t.blocks.map((b) => ({ ...b, id: newId(), done: false })), draft: null, selected: [] });
  if (t.blocks.length) announceAdded();
  return before;
}

/** Applies the template list from the cloud, keeping its time stamp. */
export function templatesFromRemote(list: unknown[], stamp: number, remoteGone?: Gone): void {
  const before = templates;
  templates = clean(list);
  save(stamp, before, remoteGone);
}

/** Replaces all templates (restoring a backup). */
export function replaceTemplates(list: unknown[]): void {
  const before = templates;
  templates = clean(list);
  save(nextStamp(templatesUpdated()), before);
}
