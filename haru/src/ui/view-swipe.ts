import { VIEW_ORDER, type View, currentView, goTo, onView } from './router';

const NAV_MS = 380;            // page turn triggered by a link or key
const SETTLE_MIN = 160;        // finishing a gesture: never slower than…
const SETTLE_MAX = 380;        // …nor than this, scaled by the distance left
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const COMMIT = 0.18;           // fraction of the screen that commits a slow drag
const FLICK = 0.9;             // px/ms that commits a quick flick regardless of distance
const QUIET_MS = 110;          // wheel silence that ends a trackpad gesture
const INERTIA_MS = 160;        // after a turn, trackpad inertia is ignored until it pauses this long

/**
 * Today, Calendar and News are stacked pages. Changing view slides the pages vertically with
 * transforms only (compositor). Trackpad and touch drags move the pages under your hand and
 * settle — forward or back — when you let go; a mouse-wheel notch or a flick turns at once.
 */
export function mountViewSwipe(pages: Record<View, HTMLElement>): void {
  const H = () => innerHeight;
  let running: Animation[] = [];
  let skipNext = false;                 // a gesture already moved the pages for this view change

  const finishRunning = () => {
    running.forEach((a) => a.finish());
    running = [];
  };
  const clearInline = () => Object.values(pages).forEach((el) => {
    el.style.transform = '';
    el.classList.remove('peek');
  });

  // ---------- link / key navigation: a short animated turn
  onView((view, prev) => {
    for (const [name, el] of Object.entries(pages)) el.classList.toggle('current', name === view);
    if (!prev || prev === view) return;
    if (skipNext) {
      skipNext = false;
      return;
    }
    finishRunning();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const down = VIEW_ORDER.indexOf(view) > VIEW_ORDER.indexOf(prev);
    const out = pages[prev];
    const into = pages[view];
    out.classList.add('leaving');
    document.body.classList.add('switching');
    const timing: KeyframeAnimationOptions = { duration: NAV_MS, easing: EASE };
    running = [
      out.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(0, ${down ? -100 : 100}%, 0)` }], timing),
      into.animate([{ transform: `translate3d(0, ${down ? 100 : -100}%, 0)` }, { transform: 'translate3d(0, 0, 0)' }], timing),
    ];
    void Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(() => {
      out.classList.remove('leaving');
      document.body.classList.remove('switching');
    });
  });

  // ---------- gestures that move the pages directly
  const neighbour = (from: View, dir: number): View | null => VIEW_ORDER[VIEW_ORDER.indexOf(from) + Math.sign(dir)] ?? null;

  /** May a gesture starting on `target` turn the page in `dir` right now? */
  const canStart = (target: EventTarget | null, dir: number): boolean => {
    const el = target instanceof Element ? target : null;
    // inside drawers, editors, popovers and text fields the wheel/drag belongs to them
    if (el?.closest('.drawer, .time-pop, textarea, input, select')) return false;
    const page = pages[currentView()];
    // only once the current page is scrolled to its edge in that direction
    return dir > 0 ? page.scrollTop + page.clientHeight >= page.scrollHeight - 2 : page.scrollTop <= 0;
  };

  interface Gesture { from: View; offset: number; samples: { t: number; d: number }[]; events: number }
  let g: Gesture | null = null;

  /** offset > 0 pulls the next page up; < 0 brings the previous one down. Past the ends it resists. */
  function follow(offset: number): void {
    if (!g) return;
    const h = H();
    const clamped = Math.max(-h, Math.min(h, offset));
    const to = neighbour(g.from, clamped);
    const shown = to ? clamped : clamped * 0.25; // rubber band at the first/last page
    g.offset = clamped;
    pages[g.from].style.transform = `translate3d(0, ${-shown}px, 0)`;
    for (const [name, el] of Object.entries(pages) as [View, HTMLElement][]) {
      if (name === g.from) continue;
      const peeking = name === to;
      el.classList.toggle('peek', peeking);
      el.style.transform = peeking ? `translate3d(0, ${(clamped > 0 ? h : -h) - shown}px, 0)` : '';
    }
    document.body.classList.add('switching');
  }

  /** Let go: finish the turn or spring back, from wherever the pages are. */
  function release(velocity: number): void {
    if (!g) return;
    const { from, offset } = g;
    g = null;
    const h = H();
    const dir = Math.sign(offset);
    const to = dir ? neighbour(from, dir) : null;
    const commit = !!to && (Math.abs(offset) > h * COMMIT || velocity * dir > FLICK);
    const fromEl = pages[from];
    const toEl = to ? pages[to] : null;
    const shown = to ? offset : offset * 0.25;
    const left = commit ? h - Math.abs(offset) : Math.abs(shown);
    const timing: KeyframeAnimationOptions = {
      duration: Math.max(SETTLE_MIN, Math.min(SETTLE_MAX, (left / h) * SETTLE_MAX * 1.4)),
      easing: EASE,
    };
    running = [
      fromEl.animate([{ transform: `translate3d(0, ${-shown}px, 0)` }, { transform: `translate3d(0, ${commit ? -dir * h : 0}px, 0)` }], timing),
    ];
    if (toEl) {
      running.push(toEl.animate([{ transform: `translate3d(0, ${dir * h - shown}px, 0)` }, { transform: `translate3d(0, ${commit ? 0 : dir * h}px, 0)` }], timing));
    }
    clearInline();
    toEl?.classList.add('peek'); // stays visible while it animates
    void Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(() => {
      toEl?.classList.remove('peek');
      document.body.classList.remove('switching');
      if (commit && to && toEl) {
        toEl.classList.add('current');
        fromEl.classList.remove('current');
        skipNext = true;
        goTo(to);
      }
    });
  }

  const velocityOf = (samples: { t: number; d: number }[]) => {
    const now = performance.now();
    const recent = samples.filter((s) => now - s.t < 80);
    if (recent.length < 2) return 0;
    const span = Math.max(16, recent[recent.length - 1]!.t - recent[0]!.t);
    return recent.reduce((sum, s) => sum + s.d, 0) / span;
  };

  // ---------- wheel / trackpad
  let quiet = 0;
  let lockedUntilQuiet = false;
  addEventListener('wheel', (e) => {
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * H() : e.deltaY;
    if (!d) return;
    clearTimeout(quiet);
    if (lockedUntilQuiet) {
      // trackpad inertia from the previous turn: wait for it to stop
      quiet = window.setTimeout(() => (lockedUntilQuiet = false), INERTIA_MS);
      return;
    }
    if (!g) {
      if (!canStart(e.target, d)) return;
      finishRunning();
      g = { from: currentView(), offset: 0, samples: [], events: 0 };
    }
    g.events++;
    g.samples.push({ t: performance.now(), d });
    // a single big notch (mouse wheel) turns straight away; trackpads end the gesture on silence
    const notch = g.events === 1 && Math.abs(d) >= 50;
    follow(g.offset + d);
    const end = () => {
      if (!g) return;
      const v = notch ? Math.sign(g.offset) * (FLICK + 1) : velocityOf(g.samples);
      const turning = notch || Math.abs(g.offset) > H() * COMMIT || Math.abs(v) > FLICK;
      release(v);
      if (turning) lockedUntilQuiet = true;
      quiet = window.setTimeout(() => (lockedUntilQuiet = false), INERTIA_MS);
    };
    if (notch) end();
    else quiet = window.setTimeout(end, QUIET_MS);
  }, { passive: true });

  // ---------- touch: the page follows the finger
  let touch: { y: number; x: number; target: EventTarget | null; decided: boolean } | null = null;
  addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t || e.touches.length > 1) return;
    // the dial's ring and the globe use drags themselves (planning tasks, spinning the earth)
    if (e.target instanceof Element && e.target.closest('#dial, #globe')) return;
    touch = { y: t.clientY, x: t.clientX, target: e.target, decided: false };
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!touch || !t) return;
    const dy = touch.y - t.clientY;
    const dx = touch.x - t.clientX;
    if (!touch.decided) {
      if (Math.abs(dy) < 8) return;
      touch.decided = true;
      // horizontal or scrolling-within-page gestures aren't page turns
      if (Math.abs(dx) > Math.abs(dy) || !canStart(touch.target, dy)) {
        touch = null;
        return;
      }
      finishRunning();
      g = { from: currentView(), offset: 0, samples: [], events: 0 };
    }
    if (!g) return;
    e.preventDefault();
    g.samples.push({ t: performance.now(), d: dy - g.offset });
    follow(dy);
  }, { passive: false });
  const touchEnd = () => {
    if (g && touch?.decided) release(velocityOf(g.samples));
    touch = null;
  };
  addEventListener('touchend', touchEnd, { passive: true });
  addEventListener('touchcancel', touchEnd, { passive: true });
}
