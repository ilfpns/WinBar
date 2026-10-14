import { VIEW_ORDER, type View, currentView, goTo, onView } from './router';

const TURN_MS = 380;           // one page turn
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const WHEEL_TRIGGER = 40;      // accumulated wheel/trackpad px that turns the page
const SWIPE_TRIGGER = 50;      // touch travel in px
const NOTCH_GAP = 60;          // a big, isolated delta this long after the last one is a mouse-wheel notch
const STREAM_GAP = 250;        // silence that ends a trackpad stream (its inertia) for sure

/**
 * Today, Calendar and News are stacked pages. A gesture past a small threshold turns exactly one
 * page with a crisp, short slide (transform only, on the compositor). The next gesture is taken
 * as soon as the previous one's trackpad inertia stops — even while the slide is finishing.
 */
export function mountViewSwipe(pages: Record<View, HTMLElement>): void {
  let running: Animation[] = [];

  onView((view, prev) => {
    for (const [name, el] of Object.entries(pages)) el.classList.toggle('current', name === view);
    if (!prev || prev === view) return;
    // a new turn cuts the previous one short instead of queueing behind it
    running.forEach((a) => a.finish());
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const down = VIEW_ORDER.indexOf(view) > VIEW_ORDER.indexOf(prev);
    const out = pages[prev];
    const into = pages[view];
    out.classList.add('leaving');
    document.body.classList.add('switching');
    const timing: KeyframeAnimationOptions = { duration: TURN_MS, easing: EASE };
    const anims = [
      out.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(0, ${down ? -100 : 100}%, 0)` }], timing),
      into.animate([{ transform: `translate3d(0, ${down ? 100 : -100}%, 0)` }, { transform: 'translate3d(0, 0, 0)' }], timing),
    ];
    running = anims;
    void Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
      out.classList.remove('leaving');
      if (running === anims) {
        document.body.classList.remove('switching');
        running = [];
      }
    });
  });

  /** May a gesture starting on `target` turn the page in `dir` right now? */
  const canTurn = (target: EventTarget | null, dir: 1 | -1): boolean => {
    const el = target instanceof Element ? target : null;
    // inside drawers, editors, popovers and text fields the wheel belongs to them
    if (el?.closest('.drawer, .time-pop, textarea, input, select')) return false;
    const i = VIEW_ORDER.indexOf(currentView()) + dir;
    if (i < 0 || i >= VIEW_ORDER.length) return false;
    const page = pages[currentView()];
    // only once the current page is scrolled to its edge in that direction
    return dir > 0 ? page.scrollTop + page.clientHeight >= page.scrollHeight - 2 : page.scrollTop <= 0;
  };
  const turn = (dir: 1 | -1) => goTo(VIEW_ORDER[VIEW_ORDER.indexOf(currentView()) + dir]!);

  // ---------- wheel / trackpad: one gesture, one page
  let acc = 0;
  let locked = false;
  let quiet = 0;
  let lastAbs = 0;
  let lastT = 0;
  addEventListener('wheel', (e) => {
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
    if (!d) return;
    // when the input happened (not when we got to it — a busy frame mustn't look like a pause)
    const now = e.timeStamp;
    const abs = Math.abs(d);
    const gap = now - lastT;
    if (locked) {
      // after a turn, the trackpad's inertia keeps sending a fading stream of deltas: ignore that.
      // The next mouse-wheel notch, deltas that suddenly grow again, or a real pause start a new gesture.
      const notch = abs >= 50 && gap > NOTCH_GAP;
      const fresh = notch || abs > lastAbs * 1.4 + 4 || gap > STREAM_GAP;
      lastAbs = abs;
      lastT = now;
      if (!fresh) {
        // still the tail: keep the lock alive until the stream really goes quiet
        clearTimeout(quiet);
        quiet = window.setTimeout(() => {
          locked = false;
          acc = 0;
        }, STREAM_GAP);
        return;
      }
      locked = false;
      acc = 0;
    }
    lastAbs = abs;
    lastT = now;
    clearTimeout(quiet);
    quiet = window.setTimeout(() => {
      locked = false;
      acc = 0;
    }, STREAM_GAP);
    const dir = d > 0 ? 1 : -1;
    if (!canTurn(e.target, dir)) {
      acc = 0;
      return;
    }
    if (Math.sign(acc) !== dir) acc = 0;
    acc += d;
    if (Math.abs(acc) >= WHEEL_TRIGGER) {
      locked = true;
      acc = 0;
      turn(dir);
    }
  }, { passive: true });

  // ---------- touch: a swipe past the threshold turns one page
  let start: { y: number; x: number; target: EventTarget | null } | null = null;
  addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t || e.touches.length > 1) return;
    // the dial's ring and the globe use drags themselves (planning tasks, spinning the earth)
    if (e.target instanceof Element && e.target.closest('#dial, #globe')) return;
    start = { y: t.clientY, x: t.clientX, target: e.target };
  }, { passive: true });
  addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dy = start.y - t.clientY;
    const dx = start.x - t.clientX;
    const target = start.target;
    start = null;
    if (Math.abs(dy) < SWIPE_TRIGGER || Math.abs(dx) > Math.abs(dy)) return;
    const dir = dy > 0 ? 1 : -1;
    if (canTurn(target, dir)) turn(dir);
  }, { passive: true });
}
