import { state, subscribe, toggleDrawer } from '../timetable/state';
import { currentView, onView } from './router';

const WIDE = 1000;   // above this the dial makes room for open drawers; below, drawers overlay it
const GUTTER = 40;   // space kept between an open drawer and the dial
const EDGE = 56;     // stage side padding when a drawer is closed (its tab sits there)

/** Side drawers: tucked off-screen with a tab peeking out; the tab slides them in and out. */
export function mountDrawers(dialWrap: HTMLElement): void {
  const sides = (['left', 'right'] as const).map((side) => ({
    side,
    tab: document.querySelector<HTMLButtonElement>(`.drawer-tab[data-drawer="${side}"]`)!,
    panel: document.getElementById(`panel-${side}`)!,
  }));

  for (const { side, tab, panel } of sides) {
    tab.addEventListener('click', () => toggleDrawer(side));
    // stagger index for the contents' entrance animation
    [...panel.children].forEach((child, k) => (child as HTMLElement).style.setProperty('--k', String(k)));
  }

  // background click: the dial's centre splits the screen — left half pulls the left drawer, right half the right
  const dial = dialWrap.querySelector<SVGSVGElement>('svg')!;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    if (t.closest('.drawer, .time-pop, button, input, textarea, a, .cal-day')) return;
    if (currentView() === 'calendar') {
      // calendar: empty space splits at the month grid's centre
      const grid = document.querySelector('.cal-main')!.getBoundingClientRect();
      toggleDrawer(e.clientX < grid.left + grid.width / 2 ? 'left' : 'right');
      return;
    }
    const box = dial.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    // the ring and its hour labels belong to the dial (dial units: outer edge 400 + labels ≈ 460 of 520)
    const ringPx = (box.width / 1040) * 460;
    if (Math.hypot(e.clientX - cx, e.clientY - cy) < ringPx) return;
    toggleDrawer(e.clientX < cx ? 'left' : 'right');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.target as Element).closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '[') toggleDrawer('left');
    if (e.key === ']') toggleDrawer('right');
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
    const right = state.drawers.right ? px('--panel-right-w') + 2 * inset + GUTTER : EDGE;
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
    const key = `${state.drawers.left}${state.drawers.right}`;
    for (const { side, tab, panel } of sides) {
      const open = state.drawers[side];
      document.body.classList.toggle(`${side}-open`, open);
      tab.setAttribute('aria-expanded', String(open));
      // a tucked-away panel must not take focus
      panel.inert = !open;
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
    placeDial();
  });
  addEventListener('resize', () => {
    // shrinking to a narrow layout with both drawers out: keep the right one (tasks)
    if (innerWidth <= WIDE && state.drawers.left && state.drawers.right) toggleDrawer('left', false);
    placeDial();
  });
  subscribe(render);
  render();
}
