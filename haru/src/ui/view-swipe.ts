import { type View, currentView, goTo, onView } from './router';
import { pageOrder, swipeViews } from './page-order';
import { lessMotion } from './motion';

const TURN_MS = 300;           // one page turn
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const WHEEL_TRIGGER = 60;      // accumulated wheel/trackpad px that turns the page
const SWIPE_TRIGGER = 50;      // touch travel in px
const NOTCH_GAP = 110;         // a mouse-wheel notch this long after the last turn turns again
const STREAM_GAP = 120;        // silence that ends a trackpad stream (its inertia) for sure
const HOLD_MS = 1500;          // after a stop at a page's edge, the next push this soon turns the page
/** Only the pages above the rail's rule turn by wheel or swipe (switched-on ones, in the rail's order). */
const swipePages = swipeViews;

/**
 * The pages are stacked in the rail's order. Between the pages above the rail's rule, a gesture past a small threshold turns exactly one
 * page with a crisp, short slide (transform only, on the compositor). The next gesture is taken
 * as soon as the previous one's trackpad inertia stops — even while the slide is finishing.
 *
 * A page (or an area in it) that scrolls stops once at its top or end: the gesture that scrolled it there never
 * turns the page, nor does the first push against the edge — the page gives a small bump instead — and the next
 * push, within HOLD_MS, turns it. A page that doesn't scroll has no edge to stop at and turns at once.
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

  /**
   * What a gesture on `target` in `dir` meets now: 'no' (it belongs to something else, or there's no page that
   * way), 'scroll' (something under it can still scroll that way, and does), 'edge' (it scrolls, but is at its
   * top or end: a stop first), or 'flat' (nothing there scrolls: the page may turn).
   */
  const where = (target: EventTarget | null, dir: 1 | -1): 'no' | 'scroll' | 'edge' | 'flat' => {
    const el = target instanceof Element ? target : null;
    // inside drawers, editors, popovers and text fields the wheel belongs to them
    if (el?.closest('.drawer, .time-pop, textarea, input, select, md-editor')) return 'no';
    // an inner area that can still scroll that way (e.g. the calendar's day panel) scrolls first
    const page = pages[currentView()];
    let scrolls = false;
    for (let n = el; n && n !== page; n = n.parentElement) {
      if (n.scrollHeight <= n.clientHeight + 1) continue;
      const oy = getComputedStyle(n).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      scrolls = true;
      if (dir > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0) return 'scroll';
    }
    const order = swipePages();
    const i = order.indexOf(currentView());
    if (i < 0 || i + dir < 0 || i + dir >= order.length) return 'no';
    // only once the current page is scrolled to its edge in that direction
    if (page.scrollHeight > page.clientHeight + 2) {
      scrolls = true;
      if (dir > 0 ? page.scrollTop + page.clientHeight < page.scrollHeight - 2 : page.scrollTop > 0) return 'scroll';
    }
    return scrolls ? 'edge' : 'flat';
  };
  const turn = (dir: 1 | -1) => goTo(swipePages()[swipePages().indexOf(currentView()) + dir]!);

  /** The stop at an edge: where and when, so the next push the same way turns the page. */
  let held: { view: View; dir: 1 | -1; at: number } | null = null;
  const holding = (dir: 1 | -1, now: number) => !!held && held.view === currentView() && held.dir === dir && now - held.at < HOLD_MS;
  /** The page gives a little at its edge: it gets pushed a few pixels that way and springs back. */
  const bump = (dir: 1 | -1, now: number) => {
    held = { view: currentView(), dir, at: now };
    if (lessMotion()) return;
    const page = pages[currentView()];
    page.animate([
      { transform: 'translate3d(0, 0, 0)' },
      { transform: `translate3d(0, ${-dir * 14}px, 0)`, offset: 0.35 },
      { transform: 'translate3d(0, 0, 0)' },
    ], { duration: 360, easing: EASE });
  };

  // ---------- wheel / trackpad: one gesture, one page
  let acc = 0;
  let locked = false;
  let quiet = 0;
  let lastAbs = 0;
  let lastT = 0;
  let turnedAt = -Infinity;
  /** This gesture has scrolled something: it ends where it is, whatever comes after. */
  let scrolled = false;
  /** Where everything that scrolls under the pointer stood at the last wheel event. Browsers often scroll before
   *  the event reaches the page, so the event that carried the page to its end already finds it there: that it
   *  moved since the last event is what tells it was a scroll, not a push against the edge. */
  let lastPos = '';
  const positions = (target: EventTarget | null): string => {
    const page = pages[currentView()];
    const out: number[] = [page.scrollTop];
    for (let n = target instanceof Element ? target : null; n && n !== page; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 1) out.push(n.scrollTop);
    return `${currentView()}:${out.map(Math.round).join(',')}`;
  };
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
    // a new gesture (after a pause, or a fresh notch) starts with nothing scrolled yet
    if (gap > STREAM_GAP) scrolled = false;
    const notchNow = abs >= 50 && Number.isInteger(abs) && gap > NOTCH_GAP;
    if (notchNow) scrolled = false;
    lastAbs = abs;
    lastT = now;
    clearTimeout(quiet);
    quiet = window.setTimeout(() => {
      locked = false;
      acc = 0;
      scrolled = false;
    }, STREAM_GAP);
    const dir = d > 0 ? 1 : -1;
    const pos = positions(e.target);
    const moved = lastPos !== '' && pos !== lastPos && pos.split(':')[0] === lastPos.split(':')[0];
    lastPos = pos;
    let at = where(e.target, dir);
    if (at === 'edge' && moved) at = 'scroll';
    if (at === 'no' || at === 'scroll') {
      if (at === 'scroll') scrolled = true;
      acc = 0;
      return;
    }
    if (Math.sign(acc) !== dir) acc = 0;
    acc += d;
    if (Math.abs(acc) < WHEEL_TRIGGER) return;
    acc = 0;
    // the stop at the edge: what scrolled up to it, or the first push against it, only bumps; the next one turns
    if (at === 'edge' && (scrolled || !holding(dir, now))) {
      locked = true;
      turnedAt = now;
      scrolled = false;
      bump(dir, now);
      return;
    }
    locked = true;
    turnedAt = now;
    held = null;
    turn(dir);
  }, { passive: true });

  // ---------- touch: a swipe past the threshold turns one page
  let start: { y: number; x: number; target: EventTarget | null; tops: number[] } | null = null;
  /** Where the scrolling parts under a touch stand, to tell a swipe that scrolled from one that met the edge. */
  const scrollTops = (target: EventTarget | null): number[] => {
    const out: number[] = [];
    const page = pages[currentView()];
    for (let n = target instanceof Element ? target : null; n; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1) out.push(n.scrollTop);
      if (n === page) break;
    }
    return out;
  };
  addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t || e.touches.length > 1) return;
    // the dial's ring and the globe use drags themselves (planning tasks, spinning the earth)
    if (e.target instanceof Element && e.target.closest('#dial, #globe')) return;
    start = { y: t.clientY, x: t.clientX, target: e.target, tops: scrollTops(e.target) };
  }, { passive: true });
  addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dy = start.y - t.clientY;
    const dx = start.x - t.clientX;
    const { target, tops } = start;
    start = null;
    if (Math.abs(dy) < SWIPE_TRIGGER || Math.abs(dx) > Math.abs(dy)) return;
    const dir = dy > 0 ? 1 : -1;
    const at = where(target, dir);
    if (at === 'no' || at === 'scroll') return;
    // a swipe that scrolled the page to its edge, or the first one against it, stops there; the next one turns
    const moved = scrollTops(target).some((v, k) => Math.abs(v - (tops[k] ?? v)) > 1);
    if (at === 'edge' && (moved || !holding(dir, e.timeStamp))) return bump(dir, e.timeStamp);
    held = null;
    turn(dir);
  }, { passive: true });
}
