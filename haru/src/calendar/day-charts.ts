import { angleOf, sectorPath } from '../timetable/geometry';
import { CATEGORIES, CATEGORY_KEYS, type Block, type Category, labelOf, progressOf } from '../timetable/model';
import { centeredText, svgEl } from '../timetable/svg';
import { DAY, formatDuration } from '../timetable/time';

/**
 * Two read-only views of a day for the calendar's day panel:
 *  - slices: a thin ring of the day's tasks around 24 h, each named outside the ring on a leader line
 *    (name + share of the day), the done % in the middle;
 *  - rings:  one concentric ring per category — its planned share of the day, the done part solid — with a legend.
 * Everything is in one SVG coordinate space (W × H) that scales to the panel's width.
 */
const W = 260;
const H = 184;

/** Rough text width (SVG units) for a 9.5-unit label: wide for Hangul/CJK, narrow for Latin. */
const textW = (s: string, size = 9.5) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(ch) ? size : size * 0.58), 0);
function fit(s: string, room: number, size = 9.5): string {
  if (textW(s, size) <= room) return s;
  const chars = [...s];
  while (chars.length > 1 && textW(`${chars.join('')}…`, size) > room) chars.pop();
  return `${chars.join('')}…`;
}
const share = (min: number) => `${Math.round((min / DAY) * 100)}%`;

/** Done % in the middle, counting up as the chart comes in. */
function centrePct(blocks: Block[], x: number, y: number): SVGTextElement {
  const pct = Math.round((progressOf(blocks).done / DAY) * 100);
  const text = centeredText('tt-pct', x, y, '0%');
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

// ---------------------------------------------------------------- slices + callouts
const R_OUT = 62;
const R_IN = 52;
const MAX_CALLOUTS = 6;

export function slicesChart(blocks: Block[]): SVGSVGElement {
  const svg = svgEl('svg', { class: 'cal-tt-dial', viewBox: `${-W / 2} ${-H / 2} ${W} ${H}`, role: 'img', 'aria-label': 'Timetable' }) as SVGSVGElement;
  svg.append(svgEl('path', { class: 'tt-bg', d: sectorPath(0, DAY, R_IN, R_OUT) }));
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  sorted.forEach((b, i) => {
    svg.append(svgEl('path', {
      class: `tt-block${b.done ? ' done' : ''}`,
      d: sectorPath(b.start, b.dur, R_IN, R_OUT),
      style: `--c:var(--cat-${b.cat});--cf:var(--cat-${b.cat}-fill);--i:${i}`,
    }));
  });
  svg.append(centrePct(blocks, 0, 1));

  // callouts for the longest tasks, laid out per side so they never overlap
  const picks = [...blocks].sort((a, b) => b.dur - a.dur).slice(0, MAX_CALLOUTS);
  const items = picks.map((b) => {
    const a = angleOf(b.start + b.dur / 2);
    const dx = Math.cos(a), dy = Math.sin(a);
    return { b, dx, dy, side: dx >= 0 ? 1 : -1, y: (R_OUT + 12) * dy };
  });
  const GAP = 21;
  const LIMIT = H / 2 - 12;
  for (const side of [1, -1]) {
    const col = items.filter((it) => it.side === side).sort((a, b) => a.y - b.y);
    for (let k = 1; k < col.length; k++) col[k]!.y = Math.max(col[k]!.y, col[k - 1]!.y + GAP);
    // pushed past the bottom: shift the whole column up
    const over = (col.at(-1)?.y ?? 0) - LIMIT;
    if (over > 0) col.forEach((it) => (it.y -= over));
    for (let k = col.length - 2; k >= 0; k--) col[k]!.y = Math.min(col[k]!.y, col[k + 1]!.y - GAP);
  }
  const legX = R_OUT + 20;
  const room = W / 2 - legX - 6;
  items.forEach((it, k) => {
    const { b, dx, dy, side } = it;
    const g = svgEl('g', { class: `tt-callout${b.done ? ' done' : ''}`, style: `--c:var(--cat-${b.cat});--i:${k}` });
    const p0 = [(R_OUT + 2) * dx, (R_OUT + 2) * dy];
    const p1 = [(R_OUT + 10) * dx, it.y];
    const p2 = [side * (legX - 3), it.y];
    g.append(
      svgEl('polyline', { class: 'tt-leader', points: `${p0.join(',')} ${p1.join(',')} ${p2.join(',')}` }),
      svgEl('circle', { class: 'tt-leader-dot', cx: p0[0]!, cy: p0[1]!, r: 1.6 }),
    );
    const anchor = side > 0 ? 'start' : 'end';
    const x = side * legX;
    g.append(
      svgEl('text', { class: 'tt-co-name', x, y: it.y - 2, 'text-anchor': anchor }, fit(labelOf(b), room)),
      svgEl('text', { class: 'tt-co-pct', x, y: it.y + 9, 'text-anchor': anchor }, `${share(b.dur)} · ${formatDuration(b.dur)}`),
    );
    svg.append(g);
  });
  return svg;
}

// ---------------------------------------------------------------- category rings + legend
const RING_W = 7;
const RING_GAP = 4;
const RINGS_CX = -W / 2 + 84;

export function ringsChart(blocks: Block[]): SVGSVGElement {
  const svg = svgEl('svg', { class: 'cal-tt-dial cal-tt-rings', viewBox: `${-W / 2} ${-H / 2} ${W} ${H}`, role: 'img', 'aria-label': 'By category' }) as SVGSVGElement;
  const totals = new Map<Category, { plan: number; done: number }>();
  for (const b of blocks) {
    const t = totals.get(b.cat) ?? { plan: 0, done: 0 };
    t.plan += b.dur;
    if (b.done) t.done += b.dur;
    totals.set(b.cat, t);
  }
  const cats = CATEGORY_KEYS.filter((k) => totals.has(k)).sort((a, b) => totals.get(b)!.plan - totals.get(a)!.plan).slice(0, 6);
  const outer = 76;
  cats.forEach((k, i) => {
    const t = totals.get(k)!;
    const r = outer - i * (RING_W + RING_GAP);
    const base = { cx: RINGS_CX, cy: 0, r, pathLength: 1, transform: `rotate(-90 ${RINGS_CX} 0)` };
    svg.append(
      svgEl('circle', { ...base, class: 'tt-ring-track' }),
      svgEl('circle', { ...base, class: 'tt-ring plan', style: `--c:var(--cat-${k});--f:${t.plan / DAY};--i:${i}` }),
      svgEl('circle', { ...base, class: 'tt-ring done', style: `--c:var(--cat-${k});--f:${t.done / DAY};--i:${i}` }),
    );
  });
  const inner = outer - cats.length * (RING_W + RING_GAP) + RING_GAP;
  if (inner > 16) svg.append(centrePct(blocks, RINGS_CX, 1));

  // legend: colour, name, planned time and its share of the day
  const lx = RINGS_CX + outer + 18;
  const rowH = Math.min(26, (H - 16) / Math.max(1, cats.length));
  const top = -((cats.length - 1) * rowH) / 2;
  cats.forEach((k, i) => {
    const t = totals.get(k)!;
    const y = top + i * rowH;
    const g = svgEl('g', { class: 'tt-legend', style: `--c:var(--cat-${k});--i:${i}` });
    g.append(
      svgEl('circle', { class: 'tt-legend-dot', cx: lx, cy: y, r: 4.5 }),
      svgEl('text', { class: 'tt-co-name', x: lx + 10, y: y - 2 }, CATEGORIES[k]),
      svgEl('text', { class: 'tt-co-pct', x: lx + 10, y: y + 9 }, `${share(t.plan)} · ${formatDuration(t.done)} done`),
    );
    svg.append(g);
  });
  return svg;
}
