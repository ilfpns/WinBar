import { DAY, SNAP, hhmm, mod } from './time';
import { type Block, type Category, type Draft, labelOf, loadBlocks, newId, overlaps, saveBlocks } from './model';

export interface DragState {
  /** Snapped minute where the drag began. */
  start: number;
  /** Last raw pointer minute, used to accumulate movement across midnight. */
  prev: number;
  acc: number;
  /** Snapped, clamped signed length; negative means dragging counter-clockwise. */
  delta: number;
  fwd: number;
  back: number;
  moved: boolean;
}

export interface AppState {
  blocks: Block[];
  draft: Draft | null;
  /** Bumped every time a draft is opened so the editor knows to refill its fields. */
  draftKey: number;
  drag: DragState | null;
  lastCat: Category;
  /** Ids picked for batch actions (drag across tasks, or shift/ctrl-click). */
  selected: string[];
  /** Side drawers start tucked away with only their tab showing. */
  drawers: { left: boolean; right: boolean };
}

export const state: AppState = {
  blocks: loadBlocks(),
  draft: null,
  draftKey: 0,
  drag: null,
  lastCat: 'work',
  selected: [],
  drawers: { left: false, right: false },
};

type Listener = () => void;
const listeners = new Set<Listener>();
/** The few that care when only a drawer moves (the drawers themselves, the right drawer's tabs). */
const drawerListeners = new Set<Listener>();
const savedListeners = new Set<(b: Block) => void>();

const removedListeners = new Set<(blocks: Block[]) => void>();
const cancelledListeners = new Set<(draft: Draft) => void>();
let committing = false;

/** Fires when a task that was being created is abandoned (Cancel, Esc, another selection…). */
export function onCancelled(fn: (draft: Draft) => void): void {
  cancelledListeners.add(fn);
}

/** Fires with the tasks that were just deleted (single, batch or clear-all). */
export function onRemoved(fn: (blocks: Block[]) => void): void {
  removedListeners.add(fn);
}

/** Fires after a task is saved from the editor (created or changed). */
export function onSaved(fn: (b: Block) => void): void {
  savedListeners.add(fn);
}

/**
 * Called after every change. A change that only opens or closes a drawer reaches only those subscribed with
 * `drawers: true`: the dial, the lists and the charts don't redraw for it, so the drawer's first frames run free.
 */
export function subscribe(fn: Listener, opts: { drawers?: boolean } = {}): void {
  listeners.add(fn);
  if (opts.drawers) drawerListeners.add(fn);
}

export function setState(patch: Partial<AppState>): void {
  const before = patch.blocks ? state.blocks : null;
  const prevDraft = state.draft;
  const prevKey = state.draftKey;
  Object.assign(state, patch);
  // a new task's draft went away (or was replaced) without being saved: it was cancelled
  if (prevDraft && prevDraft.id === null && !committing && (!state.draft || state.draftKey !== prevKey)) {
    cancelledListeners.forEach((fn) => fn(prevDraft));
  }
  if (before) {
    const ids = new Set(state.blocks.map((b) => b.id));
    const gone = before.filter((b) => !ids.has(b.id));
    if (gone.length) removedListeners.forEach((fn) => fn(gone));
  }
  if (patch.blocks) {
    saveBlocks(state.blocks);
    // drop selections whose task no longer exists
    const ids = new Set(state.blocks.map((b) => b.id));
    if (state.selected.some((id) => !ids.has(id))) state.selected = state.selected.filter((id) => ids.has(id));
  }
  const drawersOnly = Object.keys(patch).every((k) => k === 'drawers');
  listeners.forEach((fn) => {
    if (!drawersOnly || drawerListeners.has(fn)) fn();
  });
}

// ---------- actions

export function openDraft(draft: Draft): void {
  // the editor lives in the right drawer, so editing pulls it out
  setState({ draft, draftKey: state.draftKey + 1, drag: null, selected: [], drawers: withDrawer('right', true) });
}

export function patchDraft(patch: Partial<Omit<Draft, 'id'>>): void {
  if (!state.draft) return;
  setState({ draft: { ...state.draft, ...patch }, ...(patch.cat ? { lastCat: patch.cat } : {}) });
}

export function closeDraft(): void {
  setState({ draft: null });
}

/** Names the first task a draft would collide with, e.g. "Overlaps Meetings 13:00–18:00". */
function overlapMessage(d: Draft): string {
  const hit = state.blocks.find((b) => b.id !== d.id && (mod(d.start - b.start) < b.dur || mod(b.start - d.start) < d.dur));
  return hit ? `Overlaps ${labelOf(hit)} ${hhmm(hit.start)}–${hhmm(hit.start + hit.dur)}` : 'Overlaps another task';
}

/** A draft as a saved task: the title trimmed, and the note kept only when it says something (no empty field). */
function toBlock(d: Draft, id: string): Block {
  const { note, ...rest } = d;
  const text = note?.trim();
  return { ...rest, id, title: d.title.trim(), ...(text ? { note: text } : {}) };
}

/** Adds a ready-made task (e.g. from a memo line). Returns an error message if it can't be placed. */
export function addBlock(d: Draft): string | null {
  if (d.dur <= 0 || d.dur >= DAY) return 'Start and end are the same';
  if (overlaps(state.blocks, d)) return overlapMessage(d);
  const block = toBlock(d, newId());
  setState({ blocks: [...state.blocks, block], lastCat: block.cat });
  savedListeners.forEach((fn) => fn(block));
  return null;
}

/** Saves the current draft. Returns an error message instead when it can't be saved. */
export function commitDraft(): string | null {
  const d = state.draft;
  if (!d) return null;
  if (d.dur <= 0 || d.dur >= DAY) return 'Start and end are the same';
  if (overlaps(state.blocks, d)) return overlapMessage(d);
  const block = toBlock(d, d.id ?? newId());
  committing = true;
  setState({ blocks: [...state.blocks.filter((b) => b.id !== block.id), block], draft: null });
  committing = false;
  savedListeners.forEach((fn) => fn(block));
  return null;
}

export function toggleDone(id: string): void {
  const done = !state.blocks.find((b) => b.id === id)?.done;
  // the same task open in the editor follows, so the dial (which draws the draft) and a later Save agree
  const draft = state.draft?.id === id ? { ...state.draft, done } : state.draft;
  setState({ blocks: state.blocks.map((b) => (b.id === id ? { ...b, done } : b)), draft });
}

// ---------- selection & batch actions

export function select(ids: string[]): void {
  // batch actions live in the right drawer too
  setState({ selected: ids, draft: null, ...(ids.length ? { drawers: withDrawer('right', true) } : {}) });
}

/** On narrow screens drawers overlay the dial, so only one may be out at a time. */
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 1000px)').matches;

function withDrawer(side: 'left' | 'right', open: boolean): AppState['drawers'] {
  const other = side === 'left' ? 'right' : 'left';
  return { ...state.drawers, [side]: open, ...(open && narrow() ? { [other]: false } : {}) } as AppState['drawers'];
}

export function toggleDrawer(side: 'left' | 'right', open = !state.drawers[side]): void {
  setState({ drawers: withDrawer(side, open) });
}

export function toggleSelected(id: string): void {
  const set = new Set(state.selected);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  select([...set]);
}

export function clearSelection(): void {
  if (state.selected.length) setState({ selected: [] });
}

/** Applies `fn` to every selected task. The whole batch is refused if any result is invalid or collides. */
export function updateSelected(fn: (b: Block) => Block): string | null {
  const ids = new Set(state.selected);
  const next = state.blocks.map((b) => (ids.has(b.id) ? fn(b) : b));
  for (const b of next) {
    if (!ids.has(b.id)) continue;
    if (b.dur < SNAP) return 'Too short';
    if (b.dur >= DAY) return 'Too long';
    if (overlaps(next, b)) return 'Would overlap another task';
  }
  setState({ blocks: next });
  return null;
}

export function deleteSelected(): void {
  const ids = new Set(state.selected);
  setState({ blocks: state.blocks.filter((b) => !ids.has(b.id)), selected: [] });
}

export function deleteDraftBlock(): void {
  const id = state.draft?.id;
  if (!id) return;
  setState({ blocks: state.blocks.filter((b) => b.id !== id), draft: null });
}
