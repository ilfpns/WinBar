import { state, subscribe, toggleDrawer } from '../timetable/state';
import { type View, currentView, onView } from './router';

const WIDE = 1000;   // above this the dial makes room for open drawers; below, drawers overlay it
const GUTTER = 40;   // space kept between an open drawer and the dial
const EDGE = 56;     // stage side padding when a drawer is closed (its tab sits there)
const RAIL_GAP = 24; // space kept between the left rail and the dial
const MIN_W = 220;   // narrowest a drawer can be dragged
const WIDTHS_KEY = 'haru:drawer-widths';

type Side = 'left' | 'right';

/** Which drawer lives on which side of which page. The open/closed state is per side. */
const DRAWERS: { id: string; side: Side; views: View[] }[] = [
  { id: 'drawer-left', side: 'left', views: ['today', 'calendar', 'news', 'words', 'journal', 'archive', 'chat'] },
  { id: 'drawer-right', side: 'right', views: ['today'] },  // tasks
  { id: 'drawer-news', side: 'right', views: ['news'] },    // news feed (empty for now)
];

/** Side drawers: tucked off-screen with a tab peeking out (on the left, the rail); either slides them in and out. */
export function mountDrawers(dialWrap: HTMLElement): void {
  const drawers = DRAWERS.map((d) => {
    const el = document.getElementById(d.id)!;
    return { ...d, el, panel: el.querySelector<HTMLElement>('.panel')! };
  });
  const rail = document.getElementById('rail')!;
  // every toggle of a side: its tab, the rail's buttons, the panel's own close button
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('button[data-drawer]')];
  const hasDrawer = (side: Side, view = currentView()) => drawers.some((d) => d.side === side && d.views.includes(view));
  const pull = (side: Side) => {
    if (hasDrawer(side)) toggleDrawer(side);
  };

  for (const t of toggles) t.addEventListener('click', () => toggleDrawer(t.dataset.drawer as Side));
  for (const { panel } of drawers) {
    // stagger index for the contents' entrance animation
    [...panel.children].forEach((child, k) => (child as HTMLElement).style.setProperty('--k', String(k)));
  }

  // ---------- widths: drag a drawer's inner edge to resize it (double-click the edge to reset)
  const root = document.documentElement.style;
  let widths: Record<string, number> = {};
  try {
    widths = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}') as Record<string, number>;
  } catch {
    // unreadable: defaults
  }
  const maxW = () => Math.max(MIN_W, Math.min(900, innerWidth - 160));
  /** Puts the current page's drawer widths into the layout variables (each right drawer keeps its own). */
  function applyWidths(): void {
    const view = currentView();
    for (const side of ['left', 'right'] as const) {
      const d = drawers.find((x) => x.side === side && x.views.includes(view));
      const w = d ? widths[d.id] : undefined;
      if (w) root.setProperty(`--panel-${side}-w`, `${Math.min(w, maxW())}px`);
      else root.removeProperty(`--panel-${side}-w`);
    }
  }
  for (const d of drawers) {
    const grip = document.createElement('div');
    grip.className = 'drawer-resize';
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'vertical');
    grip.setAttribute('aria-label', 'Resize panel');
    grip.title = 'Drag to resize · double-click to reset';
    d.el.append(grip);
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-inset')) || 0;
      const move = (ev: PointerEvent) => {
        const raw = d.side === 'left' ? ev.clientX - inset : innerWidth - ev.clientX - inset;
        widths[d.id] = Math.round(Math.max(MIN_W, Math.min(maxW(), raw)));
        applyWidths();
        placeDial();
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing');
        try {
          localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
        } catch {
          // storage unavailable: the width lasts for this session
        }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => {
      delete widths[d.id];
      try {
        localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
      } catch {
        // ignore
      }
      applyWidths();
      placeDial();
    });
  }
  applyWidths();

  // background click: the page's centre splits the screen — left half pulls the left drawer, right half the right
  const dial = dialWrap.querySelector<SVGSVGElement>('svg')!;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    // controls and cards (the attendance bar, menus) are not background
    if (t.closest('.drawer, .time-pop, button, input, textarea, select, a, .cal-day, .attend, .glass-card, .logo-menu, dialog, .split')) return;
    const view = currentView();
    if (view === 'words' || view === 'journal' || view === 'archive' || view === 'chat') {
      // text pages: only the margin around the content pulls the overview out
      if (t.closest('.pg-body')) return;
      pull(e.clientX < innerWidth / 2 ? 'left' : 'right');
      return;
    }
    if (view === 'news') {
      const globe = document.getElementById('globe')!.getBoundingClientRect();
      const gx = globe.left + globe.width / 2;
      // the sphere (radius 0.42 of the canvas, more while zoomed in) spins; everything around it is background
      const r = Number((t.closest('#globe') as HTMLElement | null)?.dataset.r ?? 0.42);
      if (t.closest('#globe') && Math.hypot(e.clientX - gx, e.clientY - (globe.top + globe.height / 2)) <= globe.width * r) return;
      pull(e.clientX < gx ? 'left' : 'right');
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
    if ((e.target as Element).closest('input, select, textarea, md-editor') || e.metaKey || e.ctrlKey || e.altKey) return;
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
    const left = state.drawers.left ? px('--panel-left-w') + 2 * inset + GUTTER : rail.offsetWidth + inset + RAIL_GAP;
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
  /** Drawers sliding away with the page they belong to (kept on screen until the slide ends). */
  const closing = new Set<string>();
  function render(): void {
    const view = currentView();
    applyWidths();
    const key = `${state.drawers.left}${state.drawers.right}${view}`;
    for (const side of ['left', 'right'] as const) {
      // a side with no drawer on this page reads as closed (nothing to push aside)
      document.body.classList.toggle(`${side}-open`, state.drawers[side] && hasDrawer(side, view));
    }
    for (const d of drawers) {
      const here = d.views.includes(view);
      const open = state.drawers[d.side] && here;
      // a page's own drawer (tab included) comes and goes with the page; an open one first slides away
      if (here || !closing.has(d.id)) d.el.hidden = !here;
      for (const t of d.el.querySelectorAll('button[data-drawer]')) t.setAttribute('aria-expanded', String(open));
      // a tucked-away panel must not take focus
      d.panel.inert = !open;
    }
    // only a panel that is actually out covers the rail (a page without one must keep its way out)
    const leftOpen = state.drawers.left && hasDrawer('left', view);
    for (const t of rail.querySelectorAll('button[data-drawer]')) t.setAttribute('aria-expanded', String(leftOpen));
    // the rail sits under the open panel: out of the tab order while covered
    rail.inert = leftOpen;
    if (key === last) return;
    last = key;
    // pause busy decorations for the length of the slide so every frame stays cheap
    document.body.classList.add('drawer-moving');
    clearTimeout(settle);
    settle = window.setTimeout(() => document.body.classList.remove('drawer-moving'), 650);
    placeDial();
  }

  /** An open drawer leaving with its page slides out, tab and all, instead of vanishing. */
  function slideAway(d: (typeof drawers)[number]): void {
    closing.add(d.id);
    d.el.hidden = false;
    const off = d.side === 'right' ? 'calc(100% + var(--panel-inset))' : 'calc(-100% - var(--panel-inset))';
    const anim = d.el.animate(
      [{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(${off}, 0, 0)` }],
      { duration: 380, easing: 'cubic-bezier(.4, 0, .2, 1)' },
    );
    const done = () => {
      closing.delete(d.id);
      anim.cancel();
      d.el.hidden = !d.views.includes(currentView());
    };
    anim.onfinish = done;
    anim.oncancel = () => closing.has(d.id) && done();
  }

  onView((view, prev) => {
    // the right drawer belongs to its page (Tasks on Today, News on News): leaving the page closes it
    const leaving = prev ? drawers.filter((d) => state.drawers[d.side] && d.views.includes(prev) && !d.views.includes(view) && !d.el.hidden) : [];
    if (prev && state.drawers.right) toggleDrawer('right', false);
    for (const d of leaving) if (d.side === 'right') slideAway(d);
    // narrow screens: picking a view from the overlaying menu should reveal it
    if (innerWidth <= WIDE && state.drawers.left) toggleDrawer('left', false);
    render();
  });
  addEventListener('resize', () => {
    // shrinking to a narrow layout with both drawers out: keep the right one
    if (innerWidth <= WIDE && state.drawers.left && state.drawers.right) toggleDrawer('left', false);
    placeDial();
  });
  subscribe(render, { drawers: true });
  render();
}
