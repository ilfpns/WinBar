import { LARGE, ringsChart } from '../calendar/day-charts';
import type { Dial } from './dial';
import { CATEGORIES, type Category } from './model';
import { select, state, subscribe } from './state';
import { DAY, formatDuration } from './time';
import { icon, type IconName } from '../ui/icons';

/**
 * Today can show the day three ways, all interactive:
 *  - dial:   the wide ring with names inside (default);
 *  - slices: the same dial in a slimmer style, every task named outside on a leader line
 *            (hover, click to edit, drag to create, sweep-select all work as on the dial);
 *  - rings:  one ring per category — hover shows its hours in the middle, click selects its tasks.
 */
type TodayView = 'dial' | 'slices' | 'rings';
const KEY = 'haru:today-view';
const VIEWS: [TodayView, string, IconName][] = [['dial', 'Dial', 'clock'], ['slices', 'Slices', 'chart-pie'], ['rings', 'By category', 'target']];

export function mountTodayViews(wrap: HTMLElement, stage: HTMLElement, dial: Dial): void {
  let view: TodayView = 'dial';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'slices' || saved === 'rings') view = saved;
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
    const cat = (e.target as Element).closest<SVGElement>('[data-cat]')?.dataset.cat as Category | undefined;
    if (!cat) return;
    // the category's tasks become a selection: the Tasks drawer opens with the batch editor
    select(totals(cat).ids);
  });
  const sub = document.createElement('p');
  sub.className = 'today-chart-sub';

  let shownBlocks = state.blocks;
  function render(): void {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === view));
    dial.setStyle(view === 'slices' ? 'thin' : 'full');
    wrap.classList.toggle('alt', view === 'rings');
    wrap.classList.toggle('thin', view === 'slices');
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
    if (view === 'rings' && state.blocks !== shownBlocks) render();
  });
  render();
}
