import { state, subscribe, toggleDrawer } from '../timetable/state';
import { type View, currentView, onView } from './router';

const WIDE = 1000;   // above this the dial makes room for open drawers; below, drawers overlay it
const GUTTER = 40;   // space kept between an open drawer and the dial
const EDGE = 56;     // stage side padding when a drawer is closed (its tab sits there)

type Side = 'left' | 'right';

/** Which drawer lives on which side of which page. The open/closed state is per side. */
const DRAWERS: { id: string; side: Side; views: View[] }[] = [
  { id: 'drawer-left', side: 'left', views: ['today', 'calendar', 'news'] },
  { id: 'drawer-right', side: 'right', views: ['today'] },  // tasks
  { id: 'drawer-news', side: 'right', views: ['news'] },    // news feed (empty for now)
];

/** Side drawers: tucked off-screen with a tab peeking out; the tab slides them in and out. */
export function mountDrawers(dialWrap: HTMLElement): void {
  const drawers = DRAWERS.map((d) => {
    const el = document.getElementById(d.id)!;
    return { ...d, el, tab: el.querySelector<HTMLButtonElement>('.drawer-tab')!, panel: el.querySelector<HTMLElement>('.panel')! };
  });
  const hasDrawer = (side: Side, view = currentView()) => drawers.some((d) => d.side === side && d.views.includes(view));
  const pull = (side: Side) => {
    if (hasDrawer(side)) toggleDrawer(side);
  };

  for (const { side, tab, panel } of drawers) {
    tab.addEventListener('click', () => toggleDrawer(side));
    // stagger index for the contents' entrance animation
    [...panel.children].forEach((child, k) => (child as HTMLElement).style.setProperty('--k', String(k)));
  }

  // background click: the page's centre splits the screen — left half pulls the left drawer, right half the right
  const dial = dialWrap.querySelector<SVGSVGElement>('svg')!;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    if (t.closest('.drawer, .time-pop, button, input, textarea, a, .cal-day, #globe')) return;
    const view = currentView();
    if (view === 'news') {
      const globe = document.getElementById('globe')!.getBoundingClientRect();
      pull(e.clientX < globe.left + globe.width / 2 ? 'left' : 'right');
      return;
    }
    if (view === 'calendar') {
      const grid = document.querySelector('.cal-main')!.getBoundingClientRect();
      pull(e.clientX < grid.left + grid.width / 2 ? 'left' : 'right');
      return;
    }
    const box = dial.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    // the ring and its hour labels belong to the dial (dial units: outer edge 400 + labels ≈ 460 of 520)
    const ringPx = (box.width / 1040) * 460;
    if (Math.hypot(e.clientX - cx, e.clientY - cy) < ringPx) return;
    pull(e.clientX < cx ? 'left' : 'right');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.target as Element).closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '[') pull('left');
    if (e.key === ']') pull('right');
  });

  /**
   * Slide and shrink the dial into the space between the drawers. Only `transform` changes,
   * so the browser animates it on the compositor at the display's refresh rate.
   */
  function placeDial(): void {
    const css = getComputedStyle(document.documentElement);
    const px = (name: string) => parseFloat(css.getPropertyValue(name)) || 0;
    const inset = px('--panel-inset');
    if (innerWidth <= WIDE) {
      // narrow screens: drawers overlay the dial, which stays put
      dialWrap.style.setProperty('--dial-x', '0px');
      dialWrap.style.setProperty('--dial-s', '1');
      return;
    }
    const left = state.drawers.left ? px('--panel-left-w') + 2 * inset + GUTTER : EDGE;
    const right = state.drawers.right && hasDrawer('right', 'today') ? px('--panel-right-w') + 2 * inset + GUTTER : EDGE;
    const room = innerWidth - left - right;
    const base = dialWrap.offsetWidth; // layout size, unaffected by the transform
    const scale = base ? Math.min(1, room / base) : 1;
    const shift = left + room / 2 - innerWidth / 2;
    dialWrap.style.setProperty('--dial-x', `${shift.toFixed(1)}px`);
    dialWrap.style.setProperty('--dial-s', scale.toFixed(4));
  }

  let last = '';
  let settle = 0;
  function render(): void {
    const view = currentView();
    const key = `${state.drawers.left}${state.drawers.right}${view}`;
    for (const side of ['left', 'right'] as const) {
      // a side with no drawer on this page reads as closed (nothing to push aside)
      document.body.classList.toggle(`${side}-open`, state.drawers[side] && hasDrawer(side, view));
    }
    for (const d of drawers) {
      const here = d.views.includes(view);
      const open = state.drawers[d.side] && here;
      d.el.hidden = !here;
      d.tab.setAttribute('aria-expanded', String(open));
      // a tucked-away panel must not take focus
      d.panel.inert = !open;
    }
    if (key === last) return;
    last = key;
    // pause busy decorations for the length of the slide so every frame stays cheap
    document.body.classList.add('drawer-moving');
    clearTimeout(settle);
    settle = window.setTimeout(() => document.body.classList.remove('drawer-moving'), 650);
    placeDial();
  }

  onView(() => {
    // narrow screens: picking a view from the overlaying menu should reveal it
    if (innerWidth <= WIDE && state.drawers.left) toggleDrawer('left', false);
    render();
  });
  addEventListener('resize', () => {
    // shrinking to a narrow layout with both drawers out: keep the right one
    if (innerWidth <= WIDE && state.drawers.left && state.drawers.right) toggleDrawer('left', false);
    placeDial();
  });
  subscribe(render);
  render();
}
