import { CATEGORIES, CATEGORY_KEYS, type Category, labelOf } from './model';
import { type PlanBlock, clearPlan, planOn, setPlan } from './plans';
import { templateBlock } from './templates';
import { hhmm, minutesOf, mod } from './time';

/**
 * Editing a day ahead's plan one task at a time, in a list of its tasks: the Calendar's day panel and Today's
 * "Tomorrow" picker (plan-ahead.ts) both use it. `say` puts a short line in the caller's status (bad: an error).
 */
export type Say = (text: string, bad?: boolean) => void;

/** A planned task's row opens the form to change it. */
export function planEditable(li: HTMLElement, list: HTMLElement, date: string, task: PlanBlock | null, say: Say): void {
  if (!task) return;
  li.classList.add('editable');
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', `Edit ${labelOf(task)}`);
  li.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.sub.long')) planForm(list, li, date, task, say);
  });
  li.addEventListener('keydown', (e) => {
    if (e.target !== li || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    planForm(list, li, date, task, say);
  });
}
const catOptions = (sel: Category) =>
  CATEGORY_KEYS.map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${CATEGORIES[c]}</option>`).join('');
/**
 * The form for one task of a day ahead — name, category, start and end, note — under its row (`row`), or at the
 * end of the list for a new one (`task` null). Save writes the plan (tasks never overlap), Remove takes the task
 * out (the last one: the plan goes), Esc or Cancel leaves it as it was.
 */
export function planForm(list: HTMLElement, row: HTMLElement | null, date: string, task: PlanBlock | null, say: Say): void {
  list.querySelector('.plan-form')?.remove();
  list.querySelectorAll<HTMLElement>('li.editing').forEach((x) => x.classList.remove('editing'));
  const plan = planOn(date);
  // the task as it is in the plan now (it may have been redrawn from another device meanwhile)
  const others = (plan?.blocks ?? []).filter((x) => !task || x.start !== task.start || x.dur !== task.dur);
  // a new task starts where the day's last one ends, for an hour
  const last = [...others].sort((a, b) => a.start - b.start).at(-1);
  const base: PlanBlock = task ?? { title: '', cat: 'work', start: last ? mod(last.start + last.dur) : 9 * 60, dur: 60 };
  const li = document.createElement('li');
  li.className = 'plan-form';
  li.innerHTML = `
    <form autocomplete="off">
      <div class="pf-row">
        <input name="title" maxlength="40" placeholder="Task" aria-label="Task name">
        <select name="cat" aria-label="Category">${catOptions(base.cat)}</select>
      </div>
      <div class="pf-row pf-times">
        <input name="start" inputmode="numeric" maxlength="5" placeholder="HH:MM" aria-label="Start time">
        <span class="meta">to</span>
        <input name="end" inputmode="numeric" maxlength="5" placeholder="HH:MM" aria-label="End time">
      </div>
      <textarea name="note" rows="1" placeholder="Note" aria-label="Note"></textarea>
      <p class="err pf-err" role="alert"></p>
      <div class="pf-foot">
        ${task ? '<button type="button" class="btn-text danger pf-remove">Remove</button>' : '<span></span>'}
        <span class="pf-end">
          <button type="button" class="btn-text pf-cancel">Cancel</button>
          <button type="submit" class="btn-sm">Save</button>
        </span>
      </div>
    </form>`;
  const form = li.querySelector('form')!;
  const f = <T extends HTMLElement = HTMLInputElement>(n: string) => form.elements.namedItem(n) as unknown as T;
  const title = f('title');
  const note = f<HTMLTextAreaElement>('note');
  const err = li.querySelector<HTMLElement>('.pf-err')!;
  title.value = base.title;
  title.placeholder = CATEGORIES[base.cat];
  f('start').value = hhmm(base.start);
  f('end').value = hhmm(base.start + base.dur);
  note.value = base.note ?? '';
  const fit = () => {
    note.style.height = 'auto';
    note.style.height = `${note.scrollHeight}px`;
  };
  note.addEventListener('input', fit);
  f<HTMLSelectElement>('cat').addEventListener('change', (e) => {
    title.placeholder = CATEGORIES[(e.target as HTMLSelectElement).value as Category];
  });
  const close = () => {
    li.remove();
    row?.classList.remove('editing');
    (row ?? list).focus?.();
  };
  form.addEventListener('keydown', (e) => {
    // the page's own keys (the calendar's arrows and t, Today's shortcuts) stay out of the form
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
  });
  li.querySelector('.pf-cancel')!.addEventListener('click', close);
  const write = (blocks: PlanBlock[], msg: string) => {
    if (blocks.length) setPlan(date, blocks, plan?.from || 'By hand');
    else clearPlan(date);
    say(msg);
  };
  li.querySelector('.pf-remove')?.addEventListener('click', () => write(others, `Removed ${labelOf(base)}`));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = minutesOf(f('start').value);
    const en = minutesOf(f('end').value);
    if (s === null || en === null) {
      err.textContent = 'Times look like 09:00';
      return;
    }
    const next = templateBlock({ title: title.value.trim(), cat: f<HTMLSelectElement>('cat').value as Category, start: s, dur: mod(en - s), note: note.value.replace(/\s+$/, '') });
    if (!next.dur) {
      err.textContent = 'Start and end can’t be the same';
      return;
    }
    const hit = others.find((x) => mod(next.start - x.start) < x.dur || mod(x.start - next.start) < next.dur);
    if (hit) {
      err.textContent = `Overlaps ${labelOf(hit)} (${hhmm(hit.start)}–${hhmm(hit.start + hit.dur)})`;
      return;
    }
    // the plan list changes and the panel draws again with the task in place
    write([...others, next], task ? 'Plan saved' : `Added ${labelOf(next)}`);
  });
  if (row) {
    row.classList.add('editing');
    row.after(li);
  } else list.append(li);
  fit();
  title.focus();
}
