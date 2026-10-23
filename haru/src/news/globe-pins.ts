import type { GeoPoint, Marker } from './globe';
import { TAU, bump, smooth } from './globe-math';

/** The globe's overlays over the dots: news pins and fresh headlines. */
export const FLASH_MS = 2600;       // a pin that just got news pulses this long
export const ANNOUNCE_MS = 3200;    // a fresh headline floats over its country this long

/** What a frame is drawn with: the canvas, its size and the globe's turn at that moment. */
export interface Paint {
  ctx: CanvasRenderingContext2D;
  /** The canvas's width (and height) in device px. */
  width: number;
  dpr: number;
  R: number;
  cx: number;
  cy: number;
  M: number[];
  colors: { dot: string; hi: string; rim: string; accent: string };
  fonts: { sans: string; mono: string };
  /** lat/lon → screen (device px) + depth (z > 0 faces the viewer). */
  project: (p: GeoPoint) => { x: number; y: number; z: number };
}

/** A fresh headline floating over its country. */
export interface Announcement { m: Marker; text: string; start: number }

/** Fresh headlines: a green dot rises from the pin, and the title floats above it, then both fade. */
export function drawAnnouncements(paint: Paint, now: number, base: number, announcements: Announcement[]): void {
  const { ctx, width, dpr, colors, fonts, project } = paint;
  for (let k = announcements.length - 1; k >= 0; k--) if (now - announcements[k]!.start > ANNOUNCE_MS) announcements.splice(k, 1);
  if (!announcements.length) return;
  ctx.font = `500 ${11.5 * dpr}px ${fonts.sans}`;
  ctx.textBaseline = 'middle';
  for (const a of announcements) {
    const p = project(a.m);
    if (p.z <= 0.05) continue;
    const t = (now - a.start) / ANNOUNCE_MS;
    // the dot: pops up out of the pin and drifts away
    const rise = smooth(Math.min(1, t * 1.6));
    ctx.globalAlpha = Math.max(0, 1 - t * 1.4);
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(p.x, p.y - rise * 26 * dpr, base * (1.4 + 1.6 * bump(Math.min(1, t * 2), 0.3)), 0, TAU);
    ctx.fill();
    // the title: fades in above the pin, holds, fades out
    const alpha = t < 0.12 ? t / 0.12 : t > 0.8 ? (1 - t) / 0.2 : 1;
    const text = a.text.length > 54 ? `${a.text.slice(0, 52).trimEnd()}…` : a.text;
    const w = ctx.measureText(text).width;
    const y = p.y - 34 * dpr - rise * 8 * dpr;
    const x = Math.max(8 * dpr, Math.min(width - w - 20 * dpr, p.x - w / 2));
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = 'rgba(10,10,10,0.88)';
    ctx.beginPath();
    ctx.roundRect(x - 8 * dpr, y - 11 * dpr, w + 16 * dpr, 22 * dpr, 6 * dpr);
    ctx.fill();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = dpr;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colors.hi;
    ctx.fillText(text, x, y + 0.5 * dpr);
  }
  ctx.globalAlpha = 1;
}

/** News pins: a ring sized by how much is new there; the hovered or picked one is filled and named. */
export function drawMarkers(paint: Paint, now: number, base: number, markers: Marker[], selected: Marker | null, hoverPin: Marker | null, flashes: Map<string, number>): void {
  const { ctx, dpr, colors, fonts, project } = paint;
  ctx.font = `500 ${11 * dpr}px ${fonts.mono}`;
  ctx.textBaseline = 'middle';
  for (const m of markers) {
    const p = project(m);
    if (p.z <= 0) continue;
    const fade = Math.min(1, p.z * 2.5); // pins near the rim fade out as they turn away
    const on = m === selected || m === hoverPin;
    const ink = m === selected ? colors.accent : colors.hi;
    const r = base * (2.2 + 1.6 * m.weight) * (on ? 1.25 : 1);
    ctx.globalAlpha = fade;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.3 * dpr;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(p.x, p.y, on ? r * 0.62 : base * 0.9, 0, TAU);
    ctx.fill();
    // fresh news: a ring rippling outward for a few seconds
    const since = now - (flashes.get(m.id) ?? -Infinity);
    if (since < FLASH_MS) {
      const t = (since % 1300) / 1300;
      ctx.globalAlpha = fade * (1 - t) * 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + base * 7 * t, 0, TAU);
      ctx.stroke();
    }
    if (on) {
      ctx.globalAlpha = fade;
      const tx = p.x + r + 6 * dpr;
      const w = ctx.measureText(m.label).width;
      // a dark plate keeps the name readable over the dots
      ctx.fillStyle = 'rgba(10,10,10,0.82)';
      ctx.fillRect(tx - 4 * dpr, p.y - 9 * dpr, w + 8 * dpr, 18 * dpr);
      ctx.fillStyle = ink;
      ctx.fillText(m.label, tx, p.y + 0.5 * dpr);
    }
  }
  ctx.globalAlpha = 1;
}
