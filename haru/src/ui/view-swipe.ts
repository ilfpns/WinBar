import { type View, currentView, goTo, onView } from './router';
import { pageOrder, swipeViews } from './page-order';
import { lessMotion } from './motion';

const TURN_MS = 300;           // one page turn
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const WHEEL_TRIGGER = 40;      // accumulated wheel/trackpad px that turns the page
const SWIPE_TRIGGER = 50;      // touch travel in px
const NOTCH_GAP = 110;         // a mouse-wheel notch this long after the last turn turns again
const STREAM_GAP = 120;        // silence that ends a trackpad stream (its inertia) for sure
/** Only the pages above the rail's rule turn by wheel or swipe (switched-on ones, in the rail's order). */
const swipePages = swipeViews;

/**
 * The pages are stacked in the rail's order. Between the pages above the rail's rule, a gesture past a small threshold turns exactly one
 * page with a crisp, short slide (transform only, on the compositor). The next gesture is taken
 * as soon as the previous one's trackpad inertia stops — even while the slide is finishing.
 */
export function mountViewSwipe(pages: Record<View, HTMLElement>): void {
  let running: Animation[] = [];

  onView((view, prev) => {
    for (const [name, el] of Object.entries(pages)) el.classList.toggle('current', name === view);
    // a field on the page left behind lets go of the keyboard: typing on the new page must not land in a hidden
    // editor (opened with a command or a shortcut, the focus would otherwise stay where it was)
    const held = document.activeElement;
    if (held instanceof HTMLElement && held.closest('.page:not(.current)')) held.blur();
    if (!prev || prev === view) return;
    // a new turn cuts the previous one short instead of queueing behind it
    running.forEach((a) => a.finish());
    if (lessMotion()) return;
    const down = pageOrder().indexOf(view) > pageOrder().indexOf(prev);
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
    if (el?.closest('.drawer, .time-pop, textarea, input, select, md-editor')) return false;
    // an inner area that can still scroll that way (e.g. the calendar's day panel) scrolls first
    const page = pages[currentView()];
    for (let n = el; n && n !== page; n = n.parentElement) {
      if (n.scrollHeight <= n.clientHeight + 1) continue;
      const oy = getComputedStyle(n).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      if (dir > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0) return false;
    }
    const order = swipePages();
    const i = order.indexOf(currentView());
    if (i < 0 || i + dir < 0 || i + dir >= order.length) return false;
    // only once the current page is scrolled to its edge in that direction
    return dir > 0 ? page.scrollTop + page.clientHeight >= page.scrollHeight - 2 : page.scrollTop <= 0;
  };
  const turn = (dir: 1 | -1) => goTo(swipePages()[swipePages().indexOf(currentView()) + dir]!);

  // ---------- wheel / trackpad: one gesture, one page
  let acc = 0;
  let locked = false;
  let quiet = 0;
  let lastAbs = 0;
  let lastT = 0;
  let turnedAt = -Infinity;
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
      // a mouse wheel sends whole, equal steps (trackpad inertia sends a smooth, shrinking stream):
      // every notch counts, even while spinning the wheel fast — no dead time between turns
      const notch = abs >= 50 && Number.isInteger(abs) && (abs >= lastAbs || gap > NOTCH_GAP) && now - turnedAt > NOTCH_GAP;
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
      turnedAt = now;
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
