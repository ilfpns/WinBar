import { formatDuration, hhmm, nowMinutes, snap } from './time';
import { type Block, contains, firstFreeSlot, labelOf } from './model';
import { openDraft, select, state, subscribe, toggleDone, toggleSelected } from './state';
import { setHover } from './hover';
import { icon } from '../ui/icons';

export interface ScheduleRefs {
  list: HTMLElement;
  count: HTMLElement;
  add: HTMLButtonElement;
}

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
 * Right panel list. Click a row to edit it; drag across rows to select a range;
 * shift-click extends from the last row, ctrl/cmd-click toggles one.
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
    const id = rowId(e.target);
    const task = id && e.detail === 0 ? state.blocks.find((b) => b.id === id) : undefined;
    if (task) openDraft({ ...task });
  });

  // what the list showed last time: typing in the editor (a draft's title, its note) changes nothing here, and
  // redrawing anyway would replay every done task's check animation at each keystroke
  let lastKey = '';
  let doneBefore = new Map<string, boolean>();
  function render(): void {
    const now = nowMinutes();
    const shown = visibleTasks();
    const picked = new Set(state.selected);
    const key = JSON.stringify([shown, state.blocks.length, state.selected, state.draft?.id ?? null, Math.floor(now)]);
    if (key === lastKey) return;
    lastKey = key;
    const wasDone = doneBefore;
    doneBefore = new Map(shown.map((b) => [b.id, b.done]));
    refs.count.textContent = String(state.blocks.length);
    refs.add.disabled = !firstFreeSlot(state.blocks, 0);

    if (!shown.length) {
      refs.list.replaceChildren();
      return;
    }
    refs.list.replaceChildren(...shown.map((b) => {
      const li = document.createElement('li');
      li.classList.toggle('now', contains(b, now));
      li.classList.toggle('done', b.done);
      const check = document.createElement('button');
      check.type = 'button';
      // the check pops only when the task has just been checked (not on every redraw of a done task)
      check.className = `check${b.done && wasDone.get(b.id) === false ? ' just' : ''}`;
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', String(b.done));
      check.setAttribute('aria-label', `Mark ${labelOf(b)} ${b.done ? 'not done' : 'done'}`);
      check.append(icon('check'));
      check.addEventListener('click', () => toggleDone(b.id));
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.dataset.id = b.id;
      row.classList.toggle('sel', state.draft?.id === b.id || picked.has(b.id));
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
      li.append(check, row);
      return li;
    }));
  }

  subscribe(render);
  render();
  setInterval(render, 60_000);
}
