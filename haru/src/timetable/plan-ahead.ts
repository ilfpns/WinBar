import { CATEGORIES, type Block, labelOf } from './model';
import { allTemplates } from './templates';
import { type PlanBlock, clearPlan, onPlans, planOn, setPlan } from './plans';
import { planEditable, planForm } from './plan-form';
import { dayOf, onDaySaved } from './history';
import { state } from './state';
import { DAY, SNAP, formatDuration, hhmm, mod, snap } from './time';
import { R_IN, R_OUT, polarOf, sectorPath } from './geometry';
import { drawReadOnlyDial } from './dial';
import { svgEl } from './svg';
import { icon } from '../ui/icons';
import { onView } from '../ui/router';

/**
 * Planning a day ahead from Today: the "Tomorrow" chip under the greeting turns the dial into tomorrow's plan,
 * with a small panel beside it; the panel's arrows step on to the days after. Drag on the ring to lay out a task
 * (the panel's form opens with those hours), click a task on the ring or in the list to change it. The plan is
 * the Calendar's (plans.ts): it becomes Today when that day begins. Today itself is only hidden underneath, never
 * touched. The chip again, X, Esc or leaving Today comes back to Today.
 */
const MAX_AHEAD = 90;

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const short = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const weekday = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short' });

export function mountPlanAhead(row: HTMLElement, stage: HTMLElement): void {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'greet-streak greet-ahead';
  chip.style.setProperty('--c', 'var(--text-muted)');
  chip.setAttribute('aria-expanded', 'false');
  const chipText = document.createElement('span');
  chip.append(icon('calendar-plus'), chipText);
  row.append(chip);

  const pop = document.createElement('div');
  pop.className = 'ahead-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Plan a day ahead');
  pop.hidden = true;
  document.body.append(pop);

  // the day ahead as the dial, in the dial's place (Today's own dial waits hidden underneath, as with peek)
  const wrap = stage.querySelector<HTMLElement>('.dial-wrap')!;
  const face = svgEl('svg', { class: 'peek-dial plan-dial', viewBox: '-520 -520 1040 1040', role: 'img' }) as SVGSVGElement;
  face.style.display = 'none';
  wrap.append(face);

  /** How many days ahead is shown (1: tomorrow). */
  let ahead = 1;
  const dateNow = () => addDays(dayOf(), ahead);
  const isOpen = () => !pop.hidden;

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

  let list = document.createElement('ul');
  /** The plan's tasks as the dial draws them. */
  const shown = (): Block[] => (planOn(dateNow())?.blocks ?? []).map((b, i) => ({ ...b, id: `plan-${i}`, done: false }));
  function drawFace(ghost?: { start: number; dur: number }): void {
    drawReadOnlyDial(face, shown(), { clock: false, center: weekday(dateNow()) });
    face.setAttribute('aria-label', `Plan for ${short(dateNow())}`);
    if (ghost?.dur) face.append(svgEl('path', { class: 'ghost', d: sectorPath(ghost.start, ghost.dur) }));
  }

  function render(): void {
    stale = false;
    const date = dateNow();
    const plan = planOn(date);
    // the day, with arrows to the one before (not past tomorrow) and after, and the way back to Today
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
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ahead-step ahead-close';
    close.setAttribute('aria-label', 'Back to Today');
    close.title = 'Back to Today';
    close.append(icon('x'));
    close.addEventListener('click', () => setOpen(false));
    head.append(step(-1, 'Day before', 'chevron-left'), title, step(1, 'Next day', 'chevron-right'), close);

    // the plan's tasks, each opening the form; the form for a new one goes at the end
    list = document.createElement('ul');
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
    tools.append(button('Add task', 'plus', () => planForm(list, null, date, null, say)));
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
    foot.textContent = plan ? (plan.from ? `Planned · ${plan.from}` : 'Planned') : 'Drag on the ring to add a task';
    pop.replaceChildren(head, foot, list, tools, status);
    drawFace();
    place();
  }

  /** Under the chip, kept on screen as the panel grows (an open form, more tasks). */
  function place(): void {
    if (!isOpen()) return;
    const r = chip.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, innerHeight - h - 8) : r.bottom + 6}px`;
  }

  function setOpen(open: boolean): void {
    if (open === isOpen()) return;
    pop.hidden = !open;
    face.style.display = open ? '' : 'none';
    wrap.classList.toggle('peeking', open);
    document.body.classList.toggle('planning', open);
    chip.setAttribute('aria-expanded', String(open));
    if (!open) {
      face.replaceChildren();
      drag = null;
      return;
    }
    ahead = 1;
    render();
  }
  chip.addEventListener('click', () => setOpen(!isOpen()));
  onView((page) => {
    if (page !== 'today') setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    // the form keeps its own Esc (it closes the form); a picker open over the page closes first
    if (e.key !== 'Escape' || !isOpen() || e.defaultPrevented || document.querySelector(':popover-open')) return;
    setOpen(false);
  });

  // ---------- on the ring: drag out a stretch for a new task, or click a task to change it
  let drag: { id: number; start: number; prev: number; acc: number; moved: boolean } | null = null;
  const at = (e: PointerEvent) => {
    const m = face.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return polarOf(p.x, p.y);
  };
  /** The stretch dragged so far: snapped, either way round, never a whole day. */
  const span = (d: NonNullable<typeof drag>) => {
    const a = snap(d.start);
    const b = snap(d.start + Math.max(-DAY + SNAP, Math.min(DAY - SNAP, d.acc)));
    return b >= a ? { start: mod(a), dur: b - a } : { start: mod(b), dur: a - b };
  };
  face.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = at(e);
    if (!p || p.r < R_IN - 10 || p.r > R_OUT + 20) return;
    e.preventDefault();
    face.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, start: p.m, prev: p.m, acc: 0, moved: false };
  });
  face.addEventListener('pointermove', (e) => {
    const p = drag?.id === e.pointerId ? at(e) : null;
    if (!drag || !p) return;
    // across midnight the minute jumps by a day: count the short way round
    let d = p.m - drag.prev;
    if (d > DAY / 2) d -= DAY;
    if (d < -DAY / 2) d += DAY;
    drag.prev = p.m;
    drag.acc += d;
    if (Math.abs(drag.acc) >= SNAP / 2) drag.moved = true;
    if (drag.moved) drawFace(span(drag));
  });
  const finish = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    const date = dateNow();
    if (d.moved) {
      const s = span(d);
      if (s.dur) {
        planForm(list, null, date, null, say, s);
        drawFace(s);
        return;
      }
      drawFace();
      return;
    }
    // a click: the task under it, if any, opens in the form under its row
    const blocks = planOn(date)?.blocks ?? [];
    const i = blocks.findIndex((b: PlanBlock) => mod(d.start - b.start) < b.dur);
    if (i < 0) return;
    planForm(list, list.querySelectorAll<HTMLElement>('li:not(.plan-form)')[i] ?? null, date, blocks[i]!, say);
  };
  face.addEventListener('pointerup', finish);
  face.addEventListener('pointercancel', (e) => {
    if (drag?.id !== e.pointerId) return;
    drag = null;
    drawFace();
  });

  // a changed plan redraws the open panel, but never under a task being written: a change made by a press in
  // the panel (the form's Save or Remove) redraws once that press is handled, one from elsewhere when the form closes
  let stale = false;
  let pressing = false;
  let byPress = false;
  onPlans(() => {
    paintChip();
    if (!isOpen()) return;
    if (pressing) byPress = true;
    else if (pop.querySelector('.plan-form')) {
      stale = true;
      drawFace();
    } else render();
  });
  for (const type of ['submit', 'click', 'keydown']) {
    pop.addEventListener(type, () => {
      // after every handler of this press has run (a microtask would run before the form's own)
      pressing = true;
      setTimeout(() => {
        pressing = false;
        const go = byPress || (stale && !pop.querySelector('.plan-form'));
        byPress = false;
        if (go && isOpen()) render();
        // the form closed without saving: the stretch dragged for it goes
        else if (isOpen() && !pop.querySelector('.plan-form')) drawFace();
      });
    }, true);
  }
  new ResizeObserver(place).observe(pop);
  addEventListener('resize', place);
  // a new day: "tomorrow" moves on
  onDaySaved(() => {
    paintChip();
    if (isOpen()) render();
  });
  paintChip();
}
