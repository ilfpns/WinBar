/**
 * How much Haru moves: Full (every slide, pop and glow) or Less (Settings → Appearance → Motion), and Less also
 * whenever the system asks for reduced motion. Less keeps what tells you something changed (short fades, a quick
 * drawer) and drops the decoration: breathing dots, staggered entrances, bounces, the page-turn slide.
 */
export type Motion = 'full' | 'less';
const KEY = 'haru:motion';
const system = matchMedia('(prefers-reduced-motion: reduce)');

export function savedMotion(): Motion {
  try {
    return localStorage.getItem(KEY) === 'less' ? 'less' : 'full';
  } catch {
    return 'full';
  }
}

/** Whether to keep things still: the system's setting or Haru's own. */
export const lessMotion = (): boolean => system.matches || document.documentElement.classList.contains('calm');

const listeners = new Set<() => void>();
/** Called when the answer of `lessMotion()` may have changed. */
export function onMotion(fn: () => void): void {
  listeners.add(fn);
}

function apply(m: Motion): void {
  document.documentElement.classList.toggle('calm', m === 'less');
  listeners.forEach((fn) => fn());
}

export function setMotion(m: Motion): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // for this visit
  }
  apply(m);
}

system.addEventListener('change', () => listeners.forEach((fn) => fn()));
apply(savedMotion());
