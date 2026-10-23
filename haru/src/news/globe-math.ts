/** The globe's maths: easing curves and 3×3 rotations (row-major), so drags roll the ball freely. */
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const smooth = (t: number) => t * t * (3 - 2 * t);
/** 0 → 1 → 0 hump peaking at `peak` (the Today emblem's "pop"). */
export const bump = (t: number, peak: number) => (t < peak ? smooth(t / peak) : smooth((1 - t) / (1 - peak)));

export const mul = (a: number[], b: number[]) => [
  a[0]! * b[0]! + a[1]! * b[3]! + a[2]! * b[6]!, a[0]! * b[1]! + a[1]! * b[4]! + a[2]! * b[7]!, a[0]! * b[2]! + a[1]! * b[5]! + a[2]! * b[8]!,
  a[3]! * b[0]! + a[4]! * b[3]! + a[5]! * b[6]!, a[3]! * b[1]! + a[4]! * b[4]! + a[5]! * b[7]!, a[3]! * b[2]! + a[4]! * b[5]! + a[5]! * b[8]!,
  a[6]! * b[0]! + a[7]! * b[3]! + a[8]! * b[6]!, a[6]! * b[1]! + a[7]! * b[4]! + a[8]! * b[7]!, a[6]! * b[2]! + a[7]! * b[5]! + a[8]! * b[8]!,
];
/** Rotation about the vertical axis (left/right). */
export const rotY = (t: number) => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
/** Rotation about the horizontal axis (up/down). */
export const rotX = (t: number) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
/** `M` made a clean rotation again after many small steps (Gram–Schmidt on the rows). */
export const tidy = (M: number[]): number[] => {
  const r0 = [M[0]!, M[1]!, M[2]!], r1 = [M[3]!, M[4]!, M[5]!];
  const n0 = Math.hypot(...r0); r0.forEach((v, i) => (r0[i] = v / n0));
  const d = r0[0]! * r1[0]! + r0[1]! * r1[1]! + r0[2]! * r1[2]!;
  r1.forEach((v, i) => (r1[i] = v - d * r0[i]!));
  const n1 = Math.hypot(...r1); r1.forEach((v, i) => (r1[i] = v / n1));
  const r2 = [r0[1]! * r1[2]! - r0[2]! * r1[1]!, r0[2]! * r1[0]! - r0[0]! * r1[2]!, r0[0]! * r1[1]! - r0[1]! * r1[0]!];
  return [...r0, ...r1, ...r2];
};
/** Rodrigues rotation (row-major) of `angle` about the unit `axis`. */
export const rotAxis = (ax: number, ay: number, az: number, angle: number) => {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
  ];
};
