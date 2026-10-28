import { LARGE, ringsChart } from '../calendar/day-charts';
import type { Dial } from './dial';
import { CATEGORIES, type Category, contains } from './model';
import { select, setStatus, state, subscribe } from './state';
import { carryOver, dragWeek, focusDial, moveTask, monthDots, shiftDate, undoMove, unfinishedYesterday, weekStrips } from './today-modes';
import { remindersOn, toggleReminders } from './reminders';
import { currentView, goTo, onView } from '../ui/router';
import { onResetAt, resetAt } from './day-reset';
import { dayOf } from './history';
import { onPlans } from './plans';
import { nowMinutes } from './time';
import { DAY, formatDuration } from './time';
import { icon, type IconName } from '../ui/icons';

/**
 * Today can show the day three ways, all interactive:
 *  - dial:   the wide ring with names inside (default);
 *  - slices: the same dial in a slimmer style, every task named outside on a leader line
 *            (hover, click to edit, drag to create, sweep-select all work as on the dial);
 *  - rings:  one ring per category — hover shows its hours in the middle, click selects its tasks;
 *  - focus, week, dots: the next three hours large, this week as strips, this month as dots (today-modes.ts);
 *            a click on one of Today's tasks there selects it, on a day opens it in the calendar; the week's
 *            tasks drag to another time or day, and yesterday's unfinished ones can be carried over.
 */
type TodayView = 'dial' | 'slices' | 'rings' | 'focus' | 'week' | 'dots';
const KEY = 'haru:today-view';
const VIEWS: [TodayView, string, IconName][] = [
  ['dial', 'Dial', 'clock'], ['slices', 'Slices', 'chart-pie'], ['rings', 'By category', 'target'],
  ['focus', 'Next 3 hours', 'focus'], ['week', 'This week', 'chart-gantt'], ['dots', 'This month in dots', 'grip'],
];
/** Drawn by today-modes.ts in place of the dial, like the rings. */
const MODES: TodayView[] = ['focus', 'week', 'dots'];

export function mountTodayViews(wrap: HTMLElement, stage: HTMLElement, dial: Dial): void {
  let view: TodayView = 'dial';
  try {
    const saved = localStorage.getItem(KEY);
    if (VIEWS.some(([id]) => id === saved)) view = saved as TodayView;
  } catch {
    // default view
  }

  const host = document.createElement('div');
  host.className = 'today-chart';
  wrap.append(host);

  const bar = document.createElement('div');
  bar.className = 'today-views';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'View');
  const buttons = VIEWS.map(([id, label, ic]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'today-view';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.append(icon(ic));
    b.addEventListener('click', () => {
      if (view === id) return;
      view = id;
      try {
        localStorage.setItem(KEY, id);
      } catch {
        // remembered for this visit only
      }
      render();
    });
    bar.append(b);
    return [id, b] as const;
  });
  stage.append(bar);

  // ---------- rings: hover a ring (or its legend row) for its hours, click to select its tasks
  const totals = (cat: Category) => {
    const mine = state.blocks.filter((b) => b.cat === cat);
    return { plan: mine.reduce((m, b) => m + b.dur, 0), done: mine.filter((b) => b.done).reduce((m, b) => m + b.dur, 0), ids: mine.map((b) => b.id) };
  };
  let hovered: string | null = null;
  const pctText = () => host.querySelector<SVGTextElement>('.tt-pct');
  let restPct = '';
  host.addEventListener('pointerover', (e) => {
    const cat = (e.target as Element).closest<SVGElement>('[data-cat]')?.dataset.cat as Category | undefined;
    if (!cat || cat === hovered) return;
    hovered = cat;
    host.querySelectorAll<SVGElement>('[data-cat]').forEach((el) => el.classList.toggle('dim', el.dataset.cat !== cat));
    const t = pctText();
    if (t) {
      restPct ||= t.textContent ?? '';
      const { plan, done } = totals(cat);
      t.textContent = formatDuration(done);
      t.dataset.sub = `${CATEGORIES[cat]} · ${formatDuration(plan)} planned · ${Math.round((plan / DAY) * 100)}%`;
      sub.textContent = t.dataset.sub;
    }
  });
  host.addEventListener('pointerout', (e) => {
    if ((e.relatedTarget as Element | null)?.closest?.('[data-cat]')) return;
    hovered = null;
    host.querySelectorAll('.dim').forEach((el) => el.classList.remove('dim'));
    const t = pctText();
    if (t && restPct) t.textContent = restPct;
    restPct = '';
    sub.textContent = '';
  });
  host.addEventListener('click', (e) => {
    const action = (e.target as Element).closest<SVGElement>('[data-action]')?.dataset.action;
    if (action) {
      void modeAction(action);
      return;
    }
    const task = (e.target as Element).closest<SVGElement>('[data-id]')?.dataset.id;
    if (task) {
      select([task]);
      return;
    }
    const date = (e.target as Element).closest<SVGElement>('[data-date]')?.dataset.date;
    if (date) {
      openDay(date);
      return;
    }
    const cat = (e.target as Element).closest<SVGElement>('[data-cat]')?.dataset.cat as Category | undefined;
    if (!cat) return;
    // the category's tasks become a selection: the Tasks drawer opens with the batch editor
    select(totals(cat).ids);
  });
  const sub = document.createElement('p');
  sub.className = 'today-chart-sub';

  // the SVG buttons and days answer the keyboard too
  host.addEventListener('keydown', (e) => {
    // (a real button clicks by itself)
    if (e.target instanceof HTMLButtonElement || (e.key !== 'Enter' && e.key !== ' ') || !(e.target as Element).closest('[data-action], [data-date]')) return;
    e.preventDefault();
    (e.target as Element).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  // ---------- what the modes do
  /** A day in the calendar, its timetable (or plan) open. */
  function openDay(date: string): void {
    goTo('calendar');
    dispatchEvent(new CustomEvent('haru:open-day', { detail: date }));
  }
  async function modeAction(action: string): Promise<void> {
    const cur = state.blocks.find((b) => contains(b, nowMinutes()));
    if (action === 'remind') {
      const on = await toggleReminders();
      flash(on ? 'Reminders on · 5 min before, while Haru is open' : typeof Notification === 'undefined' || Notification.permission === 'denied' ? 'Notifications are blocked for Haru in this browser' : 'Reminders off');
      void renderMode();
      return;
    }
    if (!cur) return;
    if (action === 'start') setStatus(cur.id, 'doing');
    else if (action === 'done') setStatus(cur.id, 'done');
    else if (action === 'yet') setStatus(cur.id, 'yet');
  }

  // a line under the mode for what just happened, with Undo when it can be taken back
  const flashEl = document.createElement('div');
  flashEl.className = 'today-flash';
  flashEl.setAttribute('role', 'status');
  wrap.append(flashEl);
  let flashTimer = 0;
  function flash(msg: string, undo?: () => void): void {
    clearTimeout(flashTimer);
    flashEl.replaceChildren(msg);
    if (undo) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-text';
      b.textContent = 'Undo';
      b.addEventListener('click', () => {
        undo();
        flash('Put back');
      });
      flashEl.append(b);
    }
    flashEl.classList.toggle('on', !!msg);
    flashTimer = window.setTimeout(() => flashEl.classList.remove('on'), undo ? 6000 : 3500);
  }

  // yesterday's unfinished tasks, over the week: carried to Today or tomorrow, or let go (once per day)
  const CARRY_KEY = 'haru:carry-seen';
  async function carryBar(today: string): Promise<HTMLElement | null> {
    const { date, tasks } = await unfinishedYesterday(today);
    let seen = '';
    try {
      seen = localStorage.getItem(CARRY_KEY) ?? '';
    } catch {
      // ask again next time
    }
    if (!tasks.length || seen === date) return null;
    const bar = document.createElement('div');
    bar.className = 'today-carry';
    const done = () => {
      try {
        localStorage.setItem(CARRY_KEY, date);
      } catch {
        // for this visit only
      }
      bar.remove();
    };
    const text = document.createElement('span');
    text.className = 'today-carry-text';
    const day = new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    text.textContent = `${tasks.length} unfinished from ${day}`;
    text.title = tasks.map((t) => t.title || CATEGORIES[t.cat]).join(', ');
    const btn = (label: string, run: () => void, cls = 'btn-text') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', run);
      return b;
    };
    const carry = (to: string, name: string) => () => {
      const { added, skipped } = carryOver(tasks, to, today);
      flash(added ? `${added} to ${name}${skipped ? ` · ${skipped} didn’t fit` : ''}` : 'None of them fit there');
      if (added) done();
    };
    bar.append(icon('arrow-right'), text, btn('Let go', done), btn('Tomorrow', carry(shiftDate(today, 1), 'tomorrow')), btn('Today', carry(today, 'Today'), 'btn-sm'));
    return bar;
  }

  // focus's switch: a notification five minutes before each task
  function remindBar(): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'today-remind';
    b.dataset.action = 'remind';
    const on = remindersOn();
    b.setAttribute('aria-pressed', String(on));
    b.append(icon(on ? 'bell' : 'bell-off'), on ? 'Reminding 5 min before' : 'Remind me 5 min before');
    return b;
  }

  /** On a narrow screen the modes draw in a smaller box, so they read larger. */
  const compact = () => host.clientWidth > 0 && host.clientWidth < 620;
  let wasCompact = compact();
  new ResizeObserver(() => {
    if (compact() === wasCompact) return;
    wasCompact = compact();
    if (MODES.includes(view)) void renderMode();
  }).observe(host);

  let shownBlocks = state.blocks;
  /** Draws the mode in view; an older draw still loading (week, dots) is dropped. */
  let drawing = 0;
  async function renderMode(): Promise<void> {
    const n = ++drawing;
    shownBlocks = state.blocks;
    const dayStart = resetAt() ?? 0;
    const now = nowMinutes();
    const today = dayOf();
    const small = compact();
    const svg = view === 'focus' ? focusDial(state.blocks, now, dayStart, small)
      : view === 'week' ? await weekStrips(today, now, dayStart, small)
        : await monthDots(today, dayStart, small);
    const bar = view === 'week' ? await carryBar(today) : view === 'focus' ? remindBar() : null;
    if (n !== drawing || !MODES.includes(view)) return;
    if (view === 'week') {
      dragWeek(svg, (from, start, to, start2, copy) => {
        const r = moveTask(from, start, to, start2, copy, today);
        if (r.msg) flash(r.msg, r.undo && (() => undoMove(r.undo!)));
      });
    }
    // the first draw comes in; the minute's redraw just replaces it
    svg.classList.toggle('enter', !host.querySelector('.today-mode'));
    host.replaceChildren(svg, ...(bar ? [bar] : []));
  }
  function render(): void {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === view));
    dial.setStyle(view === 'slices' ? 'thin' : 'full');
    wrap.classList.toggle('alt', view === 'rings' || MODES.includes(view));
    wrap.classList.toggle('thin', view === 'slices');
    if (MODES.includes(view)) {
      host.replaceChildren();
      void renderMode();
      return;
    }
    drawing++;
    if (view !== 'rings') {
      host.replaceChildren();
      return;
    }
    shownBlocks = state.blocks;
    hovered = null;
    restPct = '';
    if (!state.blocks.length) {
      const empty = document.createElement('p');
      empty.className = 'today-chart-empty';
      empty.textContent = 'Nothing planned yet';
      host.replaceChildren(empty);
      return;
    }
    sub.textContent = '';
    host.replaceChildren(ringsChart(state.blocks, LARGE), sub);
  }
  // redraw when the day's tasks change (not on every state change: the chart animates in each time)
  subscribe(() => {
    if (state.blocks === shownBlocks) return;
    if (view === 'rings') render();
    else if (MODES.includes(view)) void renderMode();
  });
  // the modes follow the clock (now moves through them), the New day time and the days planned ahead
  setInterval(() => {
    if (MODES.includes(view) && !document.hidden && currentView() === 'today') void renderMode();
  }, 60_000);
  // back on Today after a while away: the clock has moved on
  onView((v) => v === 'today' && MODES.includes(view) && void renderMode());
  onResetAt(() => MODES.includes(view) && void renderMode());
  onPlans(() => (view === 'week' || view === 'dots') && void renderMode());
  render();
}
