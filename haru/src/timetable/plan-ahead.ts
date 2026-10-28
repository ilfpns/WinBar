import { CATEGORIES, labelOf } from './model';
import { allTemplates } from './templates';
import { clearPlan, onPlans, planOn, setPlan } from './plans';
import { planEditable, planForm } from './plan-form';
import { dayOf, onDaySaved } from './history';
import { state } from './state';
import { formatDuration, hhmm } from './time';
import { icon } from '../ui/icons';
import { asPopover, hidePop, isPopOpen, onPopToggle, showPop } from '../ui/popover';

/**
 * Planning a day ahead from Today: a small "Tomorrow" chip under the greeting opens a picker for tomorrow's
 * plan, and its arrows step on to the days after. The plan is the Calendar's (plans.ts): it becomes Today when that
 * day begins. Tasks are added and changed with the Calendar's form (plan-form.ts); an empty day can also start
 * from a template or a copy of Today.
 */
const MAX_AHEAD = 90;

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const short = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function mountPlanAhead(row: HTMLElement): void {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'greet-streak greet-ahead';
  chip.style.setProperty('--c', 'var(--text-muted)');
  chip.setAttribute('aria-haspopup', 'dialog');
  const chipText = document.createElement('span');
  chip.append(icon('calendar-plus'), chipText);
  row.append(chip);

  const pop = document.createElement('div');
  pop.className = 'ahead-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Plan a day ahead');
  asPopover(pop);
  document.body.append(pop);

  /** How many days ahead the picker shows (1: tomorrow). */
  let ahead = 1;
  const dateNow = () => addDays(dayOf(), ahead);

  const status = document.createElement('p');
  status.className = 'meta ahead-status';
  status.setAttribute('role', 'status');
  let statusTimer = 0;
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle('bad', bad);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (status.textContent = ''), bad ? 4000 : 2200);
  };

  const paintChip = () => {
    const n = planOn(addDays(dayOf(), 1))?.blocks.length ?? 0;
    chipText.textContent = n ? `Tomorrow · ${n} task${n === 1 ? '' : 's'}` : 'Tomorrow';
    chip.title = n ? 'Tomorrow’s plan' : 'Plan tomorrow';
  };

  const button = (label: string, ic: Parameters<typeof icon>[0], run: () => void, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    if (cls) b.className = cls;
    const text = document.createElement('span');
    text.textContent = label;
    b.append(icon(ic), text);
    b.addEventListener('click', run);
    return b;
  };

  function render(): void {
    stale = false;
    const date = dateNow();
    const plan = planOn(date);
    // the day, with arrows to the one before (not past tomorrow) and after
    const head = document.createElement('div');
    head.className = 'ahead-head';
    const step = (by: number, label: string, ic: 'chevron-left' | 'chevron-right') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ahead-step';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.disabled = ahead + by < 1 || ahead + by > MAX_AHEAD;
      b.append(icon(ic));
      b.addEventListener('click', () => {
        ahead += by;
        render();
        pop.querySelector<HTMLButtonElement>(`.ahead-step[aria-label="${label}"]:not(:disabled)`)?.focus();
      });
      return b;
    };
    const title = document.createElement('p');
    title.className = 'ahead-title';
    title.innerHTML = '<span></span><span class="meta"></span>';
    title.firstElementChild!.textContent = ahead === 1 ? 'Tomorrow' : `In ${ahead} days`;
    title.lastElementChild!.textContent = short(date);
    head.append(step(-1, 'Day before', 'chevron-left'), title, step(1, 'Next day', 'chevron-right'));

    // the plan's tasks, each opening the form; the form for a new one goes at the end
    const list = document.createElement('ul');
    list.className = 'cal-tt-list ahead-list';
    for (const b of plan?.blocks ?? []) {
      const li = document.createElement('li');
      li.style.setProperty('--c', `var(--cat-${b.cat})`);
      li.innerHTML = '<span class="t"></span><span class="dot"></span><span class="n"></span><span class="d"></span>';
      li.querySelector('.t')!.textContent = `${hhmm(b.start)}–${hhmm(b.start + b.dur)}`;
      li.querySelector('.n')!.textContent = labelOf(b);
      li.querySelector('.n')!.setAttribute('title', CATEGORIES[b.cat]);
      li.querySelector('.d')!.textContent = formatDuration(b.dur);
      if (b.note?.trim()) {
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.innerHTML = '<span class="mark"></span><span class="sub-text"></span>';
        sub.querySelector('.sub-text')!.textContent = b.note.trim();
        li.append(sub);
      }
      planEditable(li, list, date, b, say);
      list.append(li);
    }

    const tools = document.createElement('div');
    tools.className = 'ahead-tools';
    tools.append(button('Add task', 'plus', () => {
      planForm(list, null, date, null, say);
      place();
    }));
    if (plan) {
      tools.append(button('Clear plan', 'eraser', () => {
        clearPlan(date);
        say('Plan cleared');
      }, 'danger'));
    } else {
      // an empty day can start from a template or from Today as it is now
      for (const t of allTemplates().filter((x) => x.blocks.length)) {
        tools.append(button(t.name, 'file-text', () => {
          setPlan(date, t.blocks, t.name);
          say(`Planned with ${t.name}`);
        }));
      }
      if (state.blocks.length) {
        tools.append(button('Copy Today', 'copy', () => {
          setPlan(date, state.blocks, 'Today');
          say('Planned with Today');
        }));
      }
    }
    const foot = document.createElement('p');
    foot.className = 'meta ahead-from';
    foot.textContent = plan ? (plan.from ? `Planned · ${plan.from}` : 'Planned') : 'Not planned yet';
    pop.replaceChildren(head, foot, list, tools, status);
    place();
  }

  /** Under the chip, kept on screen as the picker grows (an open form, more tasks). */
  function place(): void {
    if (!isPopOpen(pop)) return;
    const r = chip.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, innerHeight - h - 8) : r.bottom + 6}px`;
  }

  chip.addEventListener('click', () => {
    if (isPopOpen(pop)) {
      hidePop(pop);
      return;
    }
    ahead = 1;
    if (!showPop(pop, chip)) return;
    render();
    pop.querySelector<HTMLElement>('.ahead-list li, .ahead-tools button')?.focus();
  });
  onPopToggle(pop, (open) => chip.setAttribute('aria-expanded', String(open)));
  new ResizeObserver(place).observe(pop);
  addEventListener('resize', place);
  // a changed plan redraws an open picker, but never under a task being written: a change made by a press in the
  // picker (the form's Save or Remove) redraws once that press is handled, one from elsewhere when the form closes
  let stale = false;
  let pressing = false;
  let byPress = false;
  onPlans(() => {
    paintChip();
    if (!isPopOpen(pop)) return;
    if (pressing) byPress = true;
    else if (pop.querySelector('.plan-form')) stale = true;
    else render();
  });
  for (const type of ['submit', 'click', 'keydown']) {
    pop.addEventListener(type, () => {
      // after every handler of this press has run (a microtask would run before the form's own)
      pressing = true;
      setTimeout(() => {
        pressing = false;
        const go = byPress || (stale && !pop.querySelector('.plan-form'));
        byPress = false;
        if (go && isPopOpen(pop)) render();
      });
    }, true);
  }
  // a new day: "tomorrow" moves on
  onDaySaved(paintChip);
  paintChip();
}
