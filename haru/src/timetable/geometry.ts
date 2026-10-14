import { DAY, mod } from './time';

/** Dial geometry in SVG units (viewBox is -520..520). */
export const R_IN = 170;
export const R_OUT = 400;
export const R_MID = (R_IN + R_OUT) / 2;

export type Point = readonly [x: number, y: number];

/** 00:00 sits at 12 o'clock, time runs clockwise. */
export const angleOf = (m: number): number => (m / DAY) * Math.PI * 2 - Math.PI / 2;

export function pointAt(r: number, m: number): Point {
  const a = angleOf(m);
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** Inverse of pointAt: SVG coordinates → radius and minute of day. */
export function polarOf(x: number, y: number): { r: number; m: number } {
  const a = Math.atan2(y, x) + Math.PI / 2;
  return { r: Math.hypot(x, y), m: mod((a / (Math.PI * 2)) * DAY) };
}

/** Donut slice from `start` spanning `dur` minutes. */
export function sectorPath(start: number, dur: number, rIn = R_IN, rOut = R_OUT): string {
  const d = Math.min(dur, DAY - 0.01);
  const large = d > DAY / 2 ? 1 : 0;
  const [x0, y0] = pointAt(rOut, start);
  const [x1, y1] = pointAt(rOut, start + d);
  const [x2, y2] = pointAt(rIn, start + d);
  const [x3, y3] = pointAt(rIn, start);
  return `M${x0} ${y0}A${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3}Z`;
}

export function arcPath(start: number, dur: number, r: number): string {
  const d = Math.min(dur, DAY - 0.01);
  const [x0, y0] = pointAt(r, start);
  const [x1, y1] = pointAt(r, start + d);
  return `M${x0} ${y0}A${r} ${r} 0 ${d > DAY / 2 ? 1 : 0} 1 ${x1} ${y1}`;
}
