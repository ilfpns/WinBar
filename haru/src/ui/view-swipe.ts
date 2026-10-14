import { VIEW_ORDER, type View, currentView, goTo, onView } from './router';

const DURATION = 650;
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const WHEEL_THRESHOLD = 90;  // accumulated px before a wheel/trackpad gesture turns the page
const SWIPE_THRESHOLD = 70;  // touch travel in px

/**
 * Today and Calendar are stacked pages. Changing view slides the whole page vertically —
 * Today leaves upward while Calendar rises from below, and back — with transform only,
 * so it runs on the compositor and always finishes (nothing stops half-way).
 * A wheel / trackpad / touch gesture past a threshold also turns the page.
 */
export function mountViewSwipe(pages: Record<View, HTMLElement>): void {
  let running: Animation[] = [];

  onView((view, prev) => {
    if (!prev || prev === view) return;
    running.forEach((a) => a.finish());
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const down = VIEW_ORDER.indexOf(view) > VIEW_ORDER.indexOf(prev);
    const out = pages[prev];
    const into = pages[view];
    // keep the leaving page on screen until the slide ends
    document.body.classList.add('switching');
    out.classList.add('leaving');
    const timing: KeyframeAnimationOptions = { duration: DURATION, easing: EASE };
    running = [
      out.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(0, ${down ? -100 : 100}%, 0)` }], timing),
      into.animate([{ transform: `translate3d(0, ${down ? 100 : -100}%, 0)` }, { transform: 'translate3d(0, 0, 0)' }], timing),
    ];
    void Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(() => {
      out.classList.remove('leaving');
      document.body.classList.remove('switching');
      running = [];
    });
  });

  // ---------- gestures: down from Today reaches Calendar; up from the top of Calendar returns
  const canTurn = (target: EventTarget | null, dir: 1 | -1): boolean => {
    if (running.length) return false;
    const el = target instanceof Element ? target : null;
    // inside drawers, editors, popovers and text fields the wheel belongs to them
    if (el?.closest('.drawer, .time-pop, textarea, input, select')) return false;
    const view = currentView();
    const i = VIEW_ORDER.indexOf(view) + dir;
    if (i < 0 || i >= VIEW_ORDER.length) return false;
    const page = pages[view];
    // only turn once the current page is scrolled to its edge in that direction
    if (dir > 0) return page.scrollTop + page.clientHeight >= page.scrollHeight - 2;
    return page.scrollTop <= 0;
  };
  const turn = (dir: 1 | -1) => goTo(VIEW_ORDER[VIEW_ORDER.indexOf(currentView()) + dir]!);

  let acc = 0;
  let reset = 0;
  addEventListener('wheel', (e) => {
    const dir = e.deltaY > 0 ? 1 : -1;
    if (!canTurn(e.target, dir)) { acc = 0; return; }
    if (Math.sign(acc) !== dir) acc = 0;
    acc += e.deltaY;
    clearTimeout(reset);
    reset = window.setTimeout(() => (acc = 0), 220);
    if (Math.abs(acc) > WHEEL_THRESHOLD) {
      acc = 0;
      turn(dir);
    }
  }, { passive: true });

  let startY: number | null = null;
  let startTarget: EventTarget | null = null;
  addEventListener('touchstart', (e) => {
    startY = e.touches[0]?.clientY ?? null;
    startTarget = e.target;
  }, { passive: true });
  addEventListener('touchend', (e) => {
    if (startY === null) return;
    const dy = startY - (e.changedTouches[0]?.clientY ?? startY);
    startY = null;
    // the dial's ring is a drawing surface; drags there plan tasks, not pages
    if (startTarget instanceof Element && startTarget.closest('#dial')) return;
    const dir = dy > 0 ? 1 : -1;
    if (Math.abs(dy) > SWIPE_THRESHOLD && canTurn(startTarget, dir)) turn(dir);
  }, { passive: true });
}
