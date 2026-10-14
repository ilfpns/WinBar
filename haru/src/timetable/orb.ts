import { DAY, mod } from './time';

/**
 * Dot-matrix emblem in the dial's centre hole (after alphamark's Monobotics identity).
 *
 * Drawn on a small <canvas> from one requestAnimationFrame loop: breathing, colour changes,
 * pointer swell and one-off effects are all evaluated on the same clock, so motion never snaps
 * or gets cut short, and a frame costs a fraction of a millisecond — well inside a 120–144 Hz budget.
 */
const R = 112;        // emblem radius in dial units
const GAP = 17;       // grid pitch
const CORE = 50;      // clear zone around the centre dot
const REACH = 72;     // pointer influence radius
export const ORB_SPAN = 280; // the canvas covers this many dial units, centred on the dial
const BREATH_MS = 3600;
const FX_MS = 1150;
const SPREAD_MS = 700;

type RGB = [number, number, number];

interface Dot {
  x: number;
  y: number;
  d: number;
  base: number;
  /** Minute of day this dot stands for: dots are laid out clockwise from 12 o'clock like the ring. */
  minute: number;
  /** Breathing phase offset (the wave travels outward from the centre). */
  phase: number;
  // displayed values ease toward their targets every frame
  rgb: RGB;
  alpha: number;
  swell: number;
  // targets
  doneRgb: RGB | null;
  hlRgb: RGB | null;
}

/** A time range to tint on the emblem; `color` is any CSS colour (custom properties allowed). */
export interface OrbRange {
  start: number;
  dur: number;
  color: string;
}

/** Entrance orders for effects: each maps a dot to a 0..1 start delay. One is picked at random. */
const PATTERNS: Record<string, (dot: Dot) => number> = {
  'ripple-out': (p) => p.d / R,
  'ripple-in': (p) => 1 - p.d / R,
  cross: (p) => Math.min(Math.abs(p.x), Math.abs(p.y)) / R,
  diagonal: (p) => Math.min(Math.abs(p.x - p.y), Math.abs(p.x + p.y)) / (R * Math.SQRT2),
  spiral: (p) => ((p.minute / DAY) + (p.d / R) * 0.6) % 1,
  sweep: (p) => p.minute / DAY,
  rain: (p) => (p.y + R) / (2 * R),
  twinkle: () => Math.random(),
};

/** Which entrance orders and motions suit each moment; both are drawn at random every time. */
const MOMENTS = {
  save: { orders: ['ripple-out', 'sweep', 'rain', 'twinkle', 'spiral'], motions: ['pop', 'flare', 'wave'], ms: FX_MS, spread: SPREAD_MS },
  done: { orders: ['cross', 'ripple-out', 'diagonal', 'spiral', 'ripple-in'], motions: ['pop', 'blink', 'wave'], ms: FX_MS, spread: SPREAD_MS },
  delete: { orders: ['ripple-in', 'twinkle', 'sweep', 'rain'], motions: ['collapse', 'blink'], ms: FX_MS, spread: SPREAD_MS },
  undone: { orders: ['sweep', 'ripple-in', 'diagonal'], motions: ['sink', 'collapse'], ms: FX_MS, spread: SPREAD_MS },
  // cancel is over almost as soon as it starts: the abandoned stretch just blinks away
  cancel: { orders: ['ripple-in', 'twinkle', 'sweep'], motions: ['fizzle', 'dissolve'], ms: 480, spread: 160 },
} as const;
export type OrbMoment = keyof typeof MOMENTS;

const smooth = (t: number) => t * t * (3 - 2 * t);
/** 0 → 1 → 0 hump peaking at `peak`. */
const bump = (t: number, peak: number) => (t < peak ? smooth(t / peak) : smooth((1 - t) / (1 - peak)));

/**
 * Motions over t ∈ [0, 1]: size multiplier, radial push (dial units, + = outward) and how far
 * toward the task's softened tone a dot leans. Colours stay soft; the movement carries the moment.
 */
type Motion = (t: number) => { scale: number; push: number; tint: number };
const MOTIONS: Record<string, Motion> = {
  pop: (t) => ({ scale: 1 + 1.1 * bump(t, 0.38), push: 0, tint: bump(t, 0.38) }),
  flare: (t) => ({ scale: 1 + 0.8 * bump(t, 0.45), push: 8 * bump(t, 0.45), tint: bump(t, 0.45) }),
  blink: (t) => ({
    scale: t < 0.28 ? 1 - 0.6 * smooth(t / 0.28) : t < 0.62 ? 0.4 + 1.5 * smooth((t - 0.28) / 0.34) : 1.9 - 0.9 * smooth((t - 0.62) / 0.38),
    push: 0,
    tint: bump(t, 0.6),
  }),
  wave: (t) => ({ scale: 1 + 0.7 * bump(t, 0.42), push: 15 * Math.sin(Math.PI * t) * (1 - t * 0.35), tint: bump(t, 0.42) }),
  collapse: (t) => ({ scale: 1 - 0.85 * bump(t, 0.42), push: -14 * bump(t, 0.42), tint: 0.6 * bump(t, 0.3) }),
  sink: (t) => ({ scale: 1 - 0.6 * bump(t, 0.5), push: -8 * bump(t, 0.5), tint: 0.45 * bump(t, 0.5) }),
  // cancel: a nervous little shake that settles, or a quick fade-out-and-back — "never mind"
  fizzle: (t) => ({ scale: 1 - 0.35 * bump(t, 0.3), push: 6 * Math.sin(t * Math.PI * 7) * (1 - t) ** 2, tint: 0.5 * bump(t, 0.3) }),
  dissolve: (t) => ({ scale: 1 - 0.8 * bump(t, 0.35), push: 5 * bump(t, 0.35), tint: 0.4 * bump(t, 0.35) }),
};

interface Effect {
  start: number;
  ms: number;
  dots: { dot: Dot; delay: number }[];
  motion: Motion;
  tint: RGB;
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface Orb {
  /** Dots inside finished tasks take a faint tint of the task's colour. */
  setDone(ranges: OrbRange[]): void;
  /** Tint the dots that fall inside these ranges and fade the rest; null clears. */
  focus(ranges: OrbRange[] | null): void;
  /** Swell the dots near a point in dial coordinates; null relaxes them. */
  attract(p: { x: number; y: number } | null): void;
  /** One-off effect for a moment (task saved, task done) over that task's own dots. */
  play(moment: OrbMoment, color: string, range: { start: number; dur: number }): void;
}

export function createOrb(canvas: HTMLCanvasElement): Orb {
  const ctx = canvas.getContext('2d')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // resolve CSS colours (custom properties, color-mix) to numbers once per change, not per frame
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.append(probe);
  const rgbOf = (css: string): RGB => {
    probe.style.color = css;
    const m = getComputedStyle(probe).color.match(/[\d.]+/g) ?? ['0', '0', '0'];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  };
  let restRgb = rgbOf('var(--line-strong)');

  const dots: Dot[] = [];
  for (let y = -R; y <= R; y += GAP) {
    for (let x = -R; x <= R; x += GAP) {
      const d = Math.hypot(x, y);
      if (d > R || d < CORE) continue;
      // a horizontal channel through the middle splits the emblem into two lobes
      if (Math.abs(y) < GAP / 2 && Math.abs(x) < R * 0.6) continue;
      // smooth pseudo-noise so dot sizes swell and shrink across the field
      const base = 2.2 + 4.6 * (0.5 + 0.5 * Math.sin(x * 0.043 + 1.3) * Math.cos(y * 0.051 - 0.7));
      const minute = (((Math.atan2(x, -y) / (Math.PI * 2)) + 1) % 1) * DAY;
      dots.push({ x, y, d, base, minute, phase: (d / R) * 2400, rgb: [...restRgb], alpha: 1, swell: 0, doneRgb: null, hlRgb: null });
    }
  }
  const inRange = (dot: Dot, r: { start: number; dur: number }) => mod(dot.minute - r.start) < r.dur;

  let focused = false;
  let pointer: { x: number; y: number } | null = null;
  const effects: Effect[] = [];

  // keep the bitmap sharp at the element's layout size and pixel ratio (transforms don't change it)
  let scale = 1;
  const fit = () => {
    const css = canvas.offsetWidth;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(css * dpr));
    canvas.height = canvas.width;
    scale = canvas.width / ORB_SPAN;
  };
  new ResizeObserver(fit).observe(canvas);
  fit();

  let last = performance.now();
  let painted = false;
  function frame(now: number): void {
    const dt = Math.min(64, now - last);
    last = now;
    // nothing to paint while the dial is off screen (another page is showing)
    const body = document.body;
    // off screen, or sliding with its page (the last frame is held): nothing to paint
    // (it still paints once up front, so it never slides in blank)
    if (!canvas.offsetWidth || (painted && (body.dataset.view !== 'today' || body.classList.contains('switching')))) {
      requestAnimationFrame(frame);
      return;
    }
    // frame-rate independent easing toward targets (≈ a quarter-second transition)
    const ease = 1 - Math.exp(-dt / 90);
    const breathing = !reduced.matches;

    // strongest active effect per dot for this frame
    const fx = new Map<Dot, { scale: number; push: number; tint: number; rgb: RGB; env: number }>();
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]!;
      let alive = false;
      for (const { dot, delay } of e.dots) {
        const t = (now - e.start - delay) / e.ms;
        if (t >= 1) continue;
        alive = true;
        if (t <= 0) continue;
        const m = e.motion(t);
        const prev = fx.get(dot);
        // env: how much of the idle breathing to hold back so the effect shows at full size
        if (!prev || Math.abs(m.scale - 1) > Math.abs(prev.scale - 1)) fx.set(dot, { ...m, rgb: e.tint, env: Math.sin(Math.PI * t) });
      }
      if (!alive) effects.splice(i, 1);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
    for (const dot of dots) {
      const target = dot.hlRgb ? mix(restRgb, dot.hlRgb, 0.55) : dot.doneRgb ? mix(restRgb, dot.doneRgb, 0.4) : restRgb;
      dot.rgb = mix(dot.rgb, target, ease);
      dot.alpha += ((focused && !dot.hlRgb ? 0.45 : 1) - dot.alpha) * ease;
      const k = pointer ? Math.max(0, 1 - Math.hypot(dot.x - pointer.x, dot.y - pointer.y) / REACH) : 0;
      dot.swell += (0.35 * k * k - dot.swell) * Math.min(1, ease * 1.6);

      const effect = fx.get(dot);
      const idle = breathing ? 1 - 0.4 * (0.5 - 0.5 * Math.cos(((now + dot.phase) / BREATH_MS) * Math.PI * 2)) : 1;
      const breath = effect ? idle + (1 - idle) * effect.env : idle;
      const r = dot.base * breath * (1 + dot.swell) * (effect?.scale ?? 1);
      // radial push: dots ride outward (or sink inward) along their spoke from the centre
      const push = effect ? effect.push / (dot.d || 1) : 0;
      // effects only lean toward the task's own softened tone — never a colour that wasn't there
      const rgb = effect ? mix(dot.rgb, mix(restRgb, effect.rgb, 0.5), effect.tint) : dot.rgb;
      ctx.fillStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${dot.alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(dot.x * (1 + push), dot.y * (1 + push), Math.max(0.3, r), 0, Math.PI * 2);
      ctx.fill();
    }
    painted = true;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setDone(ranges) {
      restRgb = rgbOf('var(--line-strong)');
      const colors = new Map(ranges.map((r) => [r, rgbOf(r.color)]));
      for (const dot of dots) {
        const hit = ranges.find((r) => inRange(dot, r));
        dot.doneRgb = hit ? colors.get(hit)! : null;
      }
    },

    focus(ranges) {
      focused = !!ranges?.length;
      const colors = new Map((ranges ?? []).map((r) => [r, rgbOf(r.color)]));
      for (const dot of dots) {
        const hit = ranges?.find((r) => inRange(dot, r));
        dot.hlRgb = hit ? colors.get(hit)! : null;
      }
    },

    attract(p) {
      pointer = p;
    },

    play(moment, color, range) {
      if (reduced.matches) return;
      const kind = MOMENTS[moment];
      const order = PATTERNS[pick(kind.orders)]!;
      const targets = dots.filter((dot) => inRange(dot, range));
      if (!targets.length) return;
      effects.push({
        start: performance.now(),
        ms: kind.ms,
        dots: targets.map((dot) => ({ dot, delay: order(dot) * kind.spread })),
        motion: MOTIONS[pick(kind.motions)]!,
        tint: rgbOf(color),
      });
    },
  };
}
