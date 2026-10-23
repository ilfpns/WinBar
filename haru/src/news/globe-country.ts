import type { Marker } from './globe';
import { DEG, TAU, bump, smooth } from './globe-math';
import type { Paint } from './globe-pins';

/** A picked country on the globe: which dots light up, and how they pop up green and fade back. */
export const POP_MS = 650;          // one dot of a picked country popping up
export const POP_SPREAD_MS = 650;   // dots pop at random moments within this window, all over the country
export const UNLIGHT_MS = 300;      // letting go of a country fades its dots back

/** The globe's dots as unit vectors (x right, y up, z toward the viewer at lon 0) and their countries;
 *  the first `n` are land dots, the rest the finer dots of small countries. */
export interface Dots { px: Float32Array; py: Float32Array; pz: Float32Array; cc: string[]; n: number; total: number }

/** The picked country's dots: index, pop delay, and whether it is a land dot (vs. a small-country extra). */
export interface Lit { dots: { i: number; delay: number }[]; start: number; until: number }

/** The dots of `m`'s countries, each with the moment it pops. */
export function lightUp(m: Marker, d: Dots, now: number): Lit {
  const { px, py, pz, cc, n, total } = d;
  const want = new Set(m.iso);
  const φ = m.lat * DEG, λ = m.lon * DEG;
  const ax = Math.cos(φ) * Math.sin(λ), ay = Math.sin(φ), az = Math.cos(φ) * Math.cos(λ);
  const angle = (i: number) => Math.acos(Math.max(-1, Math.min(1, px[i]! * ax + py[i]! * ay + pz[i]! * az)));
  let picked: number[] = [];
  for (let i = 0; i < total; i++) if (want.has(cc[i]!)) picked.push(i);
  // a country too small for the dot grid: light the land right around its pin instead
  if (picked.length < 8) picked = picked.concat([...Array(n).keys()].filter((i) => !want.has(cc[i]!) && angle(i) < 2.5 * DEG));
  // the whole country lights up together: every dot pops at its own random moment (a slight lead near the pin)
  const far = Math.max(1e-3, ...picked.map(angle));
  return {
    start: now,
    until: Infinity,
    dots: picked.map((i) => ({ i, delay: (0.8 * Math.random() + 0.2 * (angle(i) / far)) * POP_SPREAD_MS })),
  };
}

/**
 * The picked country: each dot pops (swells, then settles a little larger) and turns green, rippling
 * out from the pin like the Today emblem; letting go fades it back. Batched into a few alpha buckets.
 */
export function drawCountry(paint: Paint, d: Dots, now: number, base: number, lit: Lit | null, fading: Lit | null): Lit | null {
  const { ctx, R, cx, cy, M, colors } = paint;
  const { px, py, pz, n } = d;
  if (fading && now > fading.until) fading = null;
  const sets: [Lit, number][] = [];
  if (fading) sets.push([fading, Math.max(0, (fading.until - now) / UNLIGHT_MS)]);
  if (lit) sets.push([lit, 1]);
  if (!sets.length) return fading;
  const BUCKETS = 4;
  const green: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D());
  const plain = new Path2D();
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = M as [number, number, number, number, number, number, number, number, number];
  for (const [set, strength] of sets) {
    for (const { i, delay } of set.dots) {
      const x = px[i]!, y = py[i]!, z = pz[i]!;
      const z2 = m6 * x + m7 * y + m8 * z;
      if (z2 <= 0) continue;
      const sx = cx + R * (m0 * x + m1 * y + m2 * z), sy = cy - R * (m3 * x + m4 * y + m5 * z);
      const small = i >= n; // a small country's own finer dots
      const size = base * (0.6 + 0.55 * z2) * (small ? 0.75 : 1);
      const t = (now - set.start - delay) / POP_MS;
      if (t < 0) {
        // not reached by the ripple yet: a land dot keeps its plain look, an extra dot isn't there yet
        if (!small && set === lit) {
          plain.moveTo(sx + size, sy);
          plain.arc(sx, sy, size, 0, TAU);
        }
        continue;
      }
      const p = Math.min(1, t);
      const r = size * (p < 1 ? 1 + 1.3 * bump(p, 0.35) + 0.35 * smooth(p) : 1.35);
      const a = Math.min(1, p * 2.5) * strength * (0.8 + 0.2 * z2);
      const path = green[Math.min(BUCKETS - 1, Math.floor(a * BUCKETS))]!;
      path.moveTo(sx + r, sy);
      path.arc(sx, sy, r, 0, TAU);
    }
  }
  ctx.fillStyle = colors.dot;
  ctx.globalAlpha = 0.6;
  ctx.fill(plain);
  ctx.fillStyle = colors.accent;
  for (let b = 0; b < BUCKETS; b++) {
    ctx.globalAlpha = (b + 1) / BUCKETS;
    ctx.fill(green[b]!);
  }
  ctx.globalAlpha = 1;
  return fading;
}
