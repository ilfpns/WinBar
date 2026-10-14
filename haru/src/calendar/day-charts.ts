import { angleOf, sectorPath } from '../timetable/geometry';
import { CATEGORIES, CATEGORY_KEYS, type Block, type Category, labelOf, progressOf } from '../timetable/model';
import { centeredText, svgEl } from '../timetable/svg';
import { DAY, formatDuration } from '../timetable/time';

/**
 * Two read-only views of a day, used small in the calendar's day panel and large on Today:
 *  - slices: a thin ring of the day's tasks around 24 h, each named outside the ring on a leader line
 *    (name + share of the day), the done % in the middle;
 *  - rings:  one concentric ring per category — its planned share of the day, the done part solid — with a legend.
 * Each chart is one SVG in its own coordinate space; `ChartSize` scales geometry and type together.
 */
export interface ChartSize {
  w: number;
  h: number;
  /** slices: ring radii */
  rOut: number;
  rIn: number;
  /** callout / legend type: name, detail */
  name: number;
  detail: number;
  /** done % in the middle */
  pct: number;
  /** rings: stroke width and spacing, outermost radius */
  ringW: number;
  ringGap: number;
  ringOuter: number;
  maxCallouts: number;
}

/** The calendar's day panel. */
export const SMALL: ChartSize = { w: 260, h: 184, rOut: 62, rIn: 52, name: 9.5, detail: 8, pct: 17, ringW: 7, ringGap: 4, ringOuter: 76, maxCallouts: 6 };
/** Today, in place of the dial. */
export const LARGE: ChartSize = { w: 1040, h: 1040, rOut: 300, rIn: 270, name: 24, detail: 18, pct: 64, ringW: 22, ringGap: 12, ringOuter: 330, maxCallouts: 10 };

const CJK = /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/;
/** Rough text width (SVG units) at a font size: wide for Hangul/CJK, narrow for Latin. */
const textW = (s: string, size: number) => [...s].reduce((w, ch) => w + (CJK.test(ch) ? size : size * 0.58), 0);
function fit(s: string, room: number, size: number): string {
  if (textW(s, size) <= room) return s;
  const chars = [...s];
  while (chars.length > 1 && textW(`${chars.join('')}…`, size) > room) chars.pop();
  return `${chars.join('')}…`;
}
const share = (min: number) => `${Math.round((min / DAY) * 100)}%`;

/** Done % in the middle, counting up as the chart comes in. */
function centrePct(blocks: Block[], x: number, y: number, size: number): SVGTextElement {
  const pct = Math.round((progressOf(blocks).done / DAY) * 100);
  const text = centeredText('tt-pct', x, y, '0%', `font-size:${size}px`);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) text.textContent = `${pct}%`;
  else {
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 700);
      text.textContent = `${Math.round(pct * (1 - (1 - t) ** 3))}%`;
      if (t < 1 && text.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  return text;
}

const frame = (S: ChartSize, cls: string, label: string) =>
  svgEl('svg', { class: cls, viewBox: `${-S.w / 2} ${-S.h / 2} ${S.w} ${S.h}`, role: 'img', 'aria-label': label }) as SVGSVGElement;

// ---------------------------------------------------------------- slices + callouts
export function slicesChart(blocks: Block[], S: ChartSize = SMALL): SVGSVGElement {
  const svg = frame(S, 'cal-tt-dial', 'Timetable');
  svg.style.setProperty('--name', `${S.name}px`);
  svg.style.setProperty('--detail', `${S.detail}px`);
  svg.append(svgEl('path', { class: 'tt-bg', d: sectorPath(0, DAY, S.rIn, S.rOut) }));
  [...blocks].sort((a, b) => a.start - b.start).forEach((b, i) => {
    svg.append(svgEl('path', {
      class: `tt-block${b.done ? ' done' : ''}`,
      d: sectorPath(b.start, b.dur, S.rIn, S.rOut),
      style: `--c:var(--cat-${b.cat});--cf:var(--cat-${b.cat}-fill);--i:${i}`,
    }));
  });
  svg.append(centrePct(blocks, 0, 1, S.pct));

  // callouts for the longest tasks, laid out per side so they never overlap
  const unit = S.name / 9.5; // geometry of the callouts follows the type size
  const items = [...blocks].sort((a, b) => b.dur - a.dur).slice(0, S.maxCallouts).map((b) => {
    const a = angleOf(b.start + b.dur / 2);
    const dx = Math.cos(a), dy = Math.sin(a);
    return { b, dx, dy, side: dx >= 0 ? 1 : -1, y: (S.rOut + 12 * unit) * dy };
  });
  const GAP = S.name + S.detail + 3.5 * unit;
  const LIMIT = S.h / 2 - S.detail - 4 * unit;
  for (const side of [1, -1]) {
    const col = items.filter((it) => it.side === side).sort((a, b) => a.y - b.y);
    for (let k = 1; k < col.length; k++) col[k]!.y = Math.max(col[k]!.y, col[k - 1]!.y + GAP);
    const over = (col.at(-1)?.y ?? 0) - LIMIT;
    if (over > 0) col.forEach((it) => (it.y -= over));
    for (let k = col.length - 2; k >= 0; k--) col[k]!.y = Math.min(col[k]!.y, col[k + 1]!.y - GAP);
  }
  const legX = S.rOut + 20 * unit;
  const room = S.w / 2 - legX - 6 * unit;
  items.forEach((it, k) => {
    const { b, dx, dy, side } = it;
    const g = svgEl('g', { class: `tt-callout${b.done ? ' done' : ''}`, style: `--c:var(--cat-${b.cat});--i:${k}` });
    const p0 = [(S.rOut + 2 * unit) * dx, (S.rOut + 2 * unit) * dy];
    const p1 = [(S.rOut + 10 * unit) * dx, it.y];
    const p2 = [side * (legX - 3 * unit), it.y];
    g.append(
      svgEl('polyline', { class: 'tt-leader', points: `${p0.join(',')} ${p1.join(',')} ${p2.join(',')}`, style: `stroke-width:${0.8 * unit}` }),
      svgEl('circle', { class: 'tt-leader-dot', cx: p0[0]!, cy: p0[1]!, r: 1.6 * unit }),
    );
    const anchor = side > 0 ? 'start' : 'end';
    const x = side * legX;
    g.append(
      svgEl('text', { class: 'tt-co-name', x, y: it.y - 2 * unit, 'text-anchor': anchor }, fit(labelOf(b), room, S.name)),
      svgEl('text', { class: 'tt-co-pct', x, y: it.y + S.detail + 1 * unit, 'text-anchor': anchor }, `${share(b.dur)} · ${formatDuration(b.dur)}`),
    );
    svg.append(g);
  });
  return svg;
}

// ---------------------------------------------------------------- category rings + legend
export function ringsChart(blocks: Block[], S: ChartSize = SMALL): SVGSVGElement {
  const svg = frame(S, 'cal-tt-dial cal-tt-rings', 'By category');
  svg.style.setProperty('--name', `${S.name}px`);
  svg.style.setProperty('--detail', `${S.detail}px`);
  svg.style.setProperty('--ring', `${S.ringW}px`);
  const unit = S.name / 9.5;
  const totals = new Map<Category, { plan: number; done: number }>();
  for (const b of blocks) {
    const t = totals.get(b.cat) ?? { plan: 0, done: 0 };
    t.plan += b.dur;
    if (b.done) t.done += b.dur;
    totals.set(b.cat, t);
  }
  const cats = CATEGORY_KEYS.filter((k) => totals.has(k)).sort((a, b) => totals.get(b)!.plan - totals.get(a)!.plan).slice(0, 6);
  // the rings sit left, the legend right; together they're centred in the frame
  const legendW = Math.min(130 * unit, S.w - 2 * S.ringOuter - 18 * unit - 8 * unit);
  const cx = -(2 * S.ringOuter + 18 * unit + legendW) / 2 + S.ringOuter;
  cats.forEach((k, i) => {
    const t = totals.get(k)!;
    const r = S.ringOuter - i * (S.ringW + S.ringGap);
    const base = { cx, cy: 0, r, pathLength: 1, transform: `rotate(-90 ${cx} 0)` };
    svg.append(
      svgEl('circle', { ...base, class: 'tt-ring-track' }),
      svgEl('circle', { ...base, class: 'tt-ring plan', style: `--c:var(--cat-${k});--f:${t.plan / DAY};--i:${i}` }),
      svgEl('circle', { ...base, class: 'tt-ring done', style: `--c:var(--cat-${k});--f:${t.done / DAY};--i:${i}` }),
    );
  });
  const inner = S.ringOuter - cats.length * (S.ringW + S.ringGap) + S.ringGap;
  if (inner > S.pct * 0.9) svg.append(centrePct(blocks, cx, 1, Math.min(S.pct, inner * 0.7)));

  const lx = cx + S.ringOuter + 18 * unit;
  const rowH = Math.min(26 * unit, (S.h - 16 * unit) / Math.max(1, cats.length));
  const top = -((cats.length - 1) * rowH) / 2;
  cats.forEach((k, i) => {
    const t = totals.get(k)!;
    const y = top + i * rowH;
    const g = svgEl('g', { class: 'tt-legend', style: `--c:var(--cat-${k});--i:${i}` });
    g.append(
      svgEl('circle', { class: 'tt-legend-dot', cx: lx, cy: y, r: 4.5 * unit }),
      svgEl('text', { class: 'tt-co-name', x: lx + 10 * unit, y: y - 2 * unit }, CATEGORIES[k]),
      svgEl('text', { class: 'tt-co-pct', x: lx + 10 * unit, y: y + S.detail + 1 * unit }, `${share(t.plan)} · ${formatDuration(t.done)} done`),
    );
    svg.append(g);
  });
  return svg;
}
