import { formatDuration, hhmm, mod, nowMinutes, snap } from './time';
import { type Block, STATUS_LABEL, STATUSES, contains, firstFreeSlot, labelOf, statusOf } from './model';
import { cycleStatus, openDraft, select, state, subscribe, toggleSelected } from './state';
import { setHover } from './hover';
import { icon } from '../ui/icons';
import { cheersFor, onCheers } from '../cloud/cheers';

export interface ScheduleRefs {
  list: HTMLElement;
  count: HTMLElement;
  add: HTMLButtonElement;
  /** How the day is going, above the list. */
  sum: HTMLElement;
  /** The task editor: it opens in the list, in the place of what it edits. */
  editor: HTMLFormElement;
}

/** Free time between two tasks shorter than this isn't offered. */
const MIN_GAP = 15;

/** The day's tasks in list order. */
function visibleTasks(): Block[] {
  return [...state.blocks].sort((a, b) => a.start - b.start);
}

/** Ids from `a` to `b` inclusive, in list order. */
function idsBetween(a: string, b: string): string[] {
  const ids = visibleTasks().map((t) => t.id);
  const i = ids.indexOf(a);
  const j = ids.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return ids.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * Right panel list. Click a row to edit it (the editor opens in its place); drag across rows to select a range;
 * shift-click extends from the last row, ctrl/cmd-click toggles one. The task going on now is a card with the time
 * it has left, free time between tasks is a line that adds a task there, and the day's progress sits on top.
 */
export function mountSchedule(refs: ScheduleRefs): void {
  refs.add.addEventListener('click', () => {
    const slot = firstFreeSlot(state.blocks, snap(nowMinutes()));
    if (slot) openDraft({ id: null, title: '', cat: state.lastCat, done: false, ...slot });
  });

  let anchor: string | null = null;
  let press: { id: string; moved: boolean } | null = null;
  const rowId = (t: EventTarget | null): string | undefined =>
    t instanceof Element ? t.closest<HTMLElement>('.row')?.dataset.id : undefined;

  refs.list.addEventListener('pointerdown', (e) => {
    const id = rowId(e.target);
    if (!id || e.button !== 0) return;
    e.preventDefault(); // no text selection while sweeping rows
    if (e.shiftKey && anchor) {
      select(idsBetween(anchor, id));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      anchor = id;
      toggleSelected(id);
      return;
    }
    anchor = id;
    press = { id, moved: false };
  });

  // rows are re-rendered while sweeping, so track the row under the pointer by delegation
  refs.list.addEventListener('pointerover', (e) => {
    const id = rowId(e.target);
    setHover(id ?? null);
    if (!press || !id || !(e.buttons & 1)) return;
    if (id === press.id && !press.moved) return;
    press.moved = true;
    const ids = idsBetween(press.id, id);
    if (ids.join() !== state.selected.join()) select(ids);
  });

  refs.list.addEventListener('pointerleave', () => setHover(null));

  document.addEventListener('pointerup', () => {
    if (!press) return;
    const task = state.blocks.find((b) => b.id === press?.id);
    if (!press.moved && task) openDraft({ ...task });
    press = null;
  });

  // keyboard activation (Enter/Space on a focused row) arrives as a click with detail 0
  refs.list.addEventListener('click', (e) => {
    const gap = (e.target as Element).closest<HTMLElement>('.gap-add');
    if (gap) {
      openDraft({ id: null, title: '', cat: state.lastCat, done: false, start: Number(gap.dataset.start), dur: Number(gap.dataset.dur) });
      return;
    }
    const id = rowId(e.target);
    const task = id && e.detail === 0 ? state.blocks.find((b) => b.id === id) : undefined;
    if (task) openDraft({ ...task });
  });

  // the editor's place in the list: it stays put while the rows around it are redrawn (moving it would take the
  // focus from what is being typed)
  const slot = document.createElement('li');
  slot.className = 'edit-slot';
  slot.hidden = true;
  slot.append(refs.editor);
  refs.list.append(slot);

  /** The day's progress: tasks done of all, the minutes the open ones still need, a bar of the done time. */
  function paintSum(shown: Block[], now: number): void {
    refs.sum.hidden = !shown.length;
    if (!shown.length) return;
    const done = shown.filter((b) => b.done);
    const all = shown.reduce((n, b) => n + b.dur, 0);
    const doneMin = done.reduce((n, b) => n + b.dur, 0);
    // what the open tasks still need: a task going on now only its rest
    const left = shown.filter((b) => !b.done).reduce((n, b) => n + (contains(b, now) ? b.dur - mod(now - b.start) : b.dur), 0);
    refs.sum.innerHTML = '<div class="sum-line"><strong></strong><span class="meta"></span></div><div class="sum-bar"><i></i></div>';
    refs.sum.querySelector('strong')!.textContent = `${done.length}/${shown.length} done`;
    refs.sum.querySelector('.meta')!.textContent = left ? `${formatDuration(Math.round(left))} left` : 'All done';
    refs.sum.querySelector<HTMLElement>('.sum-bar i')!.style.transform = `scaleX(${all ? doneMin / all : 0})`;
  }

  /** Free time after each task until the next one starts (the last task's end to the first's start isn't offered). */
  function gapAfter(b: Block, next: Block | undefined): HTMLLIElement | null {
    if (!next) return null;
    const from = mod(b.start + b.dur);
    const len = mod(next.start - from);
    if (len < MIN_GAP || from === next.start) return null;
    const li = document.createElement('li');
    li.className = 'gap';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'gap-add';
    add.dataset.start = String(from);
    add.dataset.dur = String(Math.min(len, 60));
    add.setAttribute('aria-label', `Add a task at ${hhmm(from)} (${formatDuration(len)} free)`);
    add.append(icon('plus'), Object.assign(document.createElement('span'), { textContent: `${formatDuration(len)} free` }));
    li.append(add);
    return li;
  }

  // what the list showed last time: typing in the editor (a draft's title, its note) changes nothing here, and
  // redrawing anyway would replay every done task's check animation at each keystroke
  let lastKey = '';
  let statusBefore = new Map<string, string>();
  function render(): void {
    const now = nowMinutes();
    const shown = visibleTasks();
    const picked = new Set(state.selected);
    const d = state.draft;
    const key = JSON.stringify([shown, state.blocks.length, state.selected, d ? [state.draftKey, d.id] : null, Math.floor(now)]);
    if (key === lastKey) return;
    lastKey = key;
    const wasStatus = statusBefore;
    statusBefore = new Map(shown.map((b) => [b.id, statusOf(b)]));
    refs.count.textContent = String(state.blocks.length);
    refs.add.disabled = !firstFreeSlot(state.blocks, 0);
    paintSum(shown, now);

    const items: HTMLLIElement[] = [];
    shown.forEach((b, i) => {
      const li = document.createElement('li');
      li.dataset.id = b.id;
      li.classList.toggle('now', contains(b, now));
      li.classList.toggle('done', b.done);
      const status = statusOf(b);
      li.classList.toggle('doing', status === 'doing');
      // the button plays only when the task's status has just changed (not on every redraw)
      const was = wasStatus.get(b.id);
      const just = was !== undefined && was !== status;
      // the status button: not started (dashed) → in progress (hourglass) → done (check), a press each
      const check = document.createElement('button');
      check.type = 'button';
      // the check pops only when the task has just been checked (not on every redraw of a done task)
      check.className = `check${just ? ' just' : ''}`;
      check.dataset.status = status;
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', status === 'done' ? 'true' : status === 'doing' ? 'mixed' : 'false');
      const next = STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length]!;
      check.setAttribute('aria-label', `${labelOf(b)}: ${STATUS_LABEL[status]}. Press for ${STATUS_LABEL[next]}`);
      check.title = `${STATUS_LABEL[status]} → ${STATUS_LABEL[next]}`;
      check.append(icon(status === 'done' ? 'check' : status === 'doing' ? 'hourglass' : 'circle-dashed'));
      check.addEventListener('click', () => cycleStatus(b.id));
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.dataset.id = b.id;
      row.classList.toggle('sel', picked.has(b.id));
      row.setAttribute('aria-pressed', String(picked.has(b.id)));
      row.style.setProperty('--c', `var(--cat-${b.cat})`);
      row.innerHTML = `<span class="t">${hhmm(b.start)}–${hhmm(b.start + b.dur)}</span><span class="dot"></span><span class="n"></span><span class="d">${formatDuration(b.dur)}</span>`;
      const n = row.querySelector<HTMLElement>('.n')!;
      n.textContent = labelOf(b);
      // a note on the task: a small dot after its name, and the note itself on hover
      if (b.note) {
        const mark = document.createElement('i');
        mark.className = 'note-mark';
        n.append(mark);
        row.title = b.note;
      }
      // hearts from the others on this task today
      const got = cheersFor(b.id);
      if (got.length) {
        const h = document.createElement('span');
        h.className = 'row-cheers';
        h.title = got.map((c) => c.fromName).filter(Boolean).join(', ');
        h.append(icon('heart'), ...(got.length > 1 ? [String(got.length)] : []));
        row.querySelector('.d')!.prepend(h);
      }
      // the task going on now: how long it has left, under its name
      if (li.classList.contains('now') && !b.done) {
        const rest = Math.max(1, Math.round(b.dur - mod(now - b.start)));
        const sub = document.createElement('span');
        sub.className = 'left';
        sub.textContent = `${status === 'doing' ? 'In progress' : 'Now'} · ${formatDuration(rest)} left`;
        row.append(sub);
      }
      li.append(check, row);
      items.push(li);
      const gap = gapAfter(b, shown[i + 1]);
      if (gap) items.push(gap);
    });
    if (!shown.length && !d) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing planned yet';
      items.push(empty);
    }

    // the editor: in the place of the task it edits, or (a new one) where its time puts it
    // (closed, it waits hidden at the end: the editor stays in the page for whatever looks it up)
    for (const c of [...refs.list.children]) if (c !== slot) c.remove();
    if (slot.parentElement !== refs.list) refs.list.append(slot);
    const opened = slot.hidden !== !d && !!d;
    slot.hidden = !d;
    if (!d) {
      slot.before(...items);
      return;
    }
    const editing = d.id ? items.findIndex((li) => li.dataset.id === d.id) : -1;
    let at = editing >= 0 ? editing : items.findIndex((li) => li.dataset.id && (state.blocks.find((b) => b.id === li.dataset.id)?.start ?? 0) > d.start);
    if (at < 0) at = items.length;
    if (editing >= 0) {
      // the row it replaces goes, and so does the free time after it (the editor shows the times)
      items.splice(editing, items[editing + 1]?.classList.contains('gap') ? 2 : 1);
    } else if (items[at - 1]?.classList.contains('gap')) at -= 1;
    slot.before(...items.slice(0, at));
    slot.after(...items.slice(at));
    if (opened) requestAnimationFrame(() => slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  subscribe(render);
  onCheers(render);
  render();
  setInterval(render, 60_000);
}
