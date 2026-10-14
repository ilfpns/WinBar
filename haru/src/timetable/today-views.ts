import { LARGE, ringsChart, slicesChart } from '../calendar/day-charts';
import { state, subscribe } from './state';
import { icon, type IconName } from '../ui/icons';

/**
 * Today can show the day three ways: the interactive dial (default), the same tasks as a thin ring with named
 * callouts, or one ring per category. The charts take the dial's place (same box, so drawers still move them).
 */
type TodayView = 'dial' | 'slices' | 'rings';
const KEY = 'haru:today-view';
const VIEWS: [TodayView, string, IconName][] = [['dial', 'Dial', 'clock'], ['slices', 'Slices', 'chart-pie'], ['rings', 'By category', 'target']];

export function mountTodayViews(wrap: HTMLElement, stage: HTMLElement): void {
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

  let shownBlocks = state.blocks;
  function render(): void {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === view));
    wrap.classList.toggle('alt', view !== 'dial');
    if (view === 'dial') {
      host.replaceChildren();
      return;
    }
    shownBlocks = state.blocks;
    if (!state.blocks.length) {
      const empty = document.createElement('p');
      empty.className = 'today-chart-empty';
      empty.textContent = 'Nothing planned yet';
      host.replaceChildren(empty);
      return;
    }
    host.replaceChildren(view === 'rings' ? ringsChart(state.blocks, LARGE) : slicesChart(state.blocks, LARGE));
  }
  // redraw when the day's tasks change (not on every state change: the chart animates in each time)
  subscribe(() => {
    if (view !== 'dial' && state.blocks !== shownBlocks) render();
  });
  render();
}
