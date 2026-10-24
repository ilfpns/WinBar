import { DAY, SNAP, formatDuration, hhmm, mod, nowMinutes, snap } from './time';
import { R_IN, R_MID, R_OUT, angleOf, arcPath, pointAt, polarOf, sectorPath, setRing } from './geometry';
import { type Block, type Draft, type Status, blockAt, blocksInRange, contains, freeAround, labelOf, progressOf, statusOf } from './model';
import { clearSelection, closeDraft, onCancelled, onRemoved, onSaved, openDraft, select, setState, state, subscribe, toggleSelected } from './state';
import { centeredText, svgEl } from './svg';
import { createOrb } from './orb';
import { onHover, setHover } from './hover';
import { onTheme } from '../ui/theme';
import { icon } from '../ui/icons';
import { lang } from '../ui/i18n';
import { onResetAt, resetAt, setResetAt } from './day-reset';

/** Pointer counts as "on the ring" a little inside the hole and out over the hour labels. */
const onRing = (r: number): boolean => r >= R_IN - 10 && r <= R_OUT + 60;

/** Rough advance width of a glyph in the 21-unit block label font. */
const glyphWidth = (ch: string): number =>
  /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(ch) ? 21 : /[A-Z0-9]/.test(ch) ? 13.5 : 11;
const textWidth = (s: string): number => [...s].reduce((w, ch) => w + glyphWidth(ch), 0);

/**
 * Fits a label into `room` units, ellipsising down to a single glyph and "…" (a Korean syllable is twice a
 * Latin letter's width, so a narrow slice holds only one); '' when not even that fits.
 */
function fitLabel(text: string, room: number): string {
  if (textWidth(text) <= room) return text;
  const chars = [...text];
  while (chars.length > 1 && textWidth(chars.join('')) + 12 > room) chars.pop();
  const cut = chars.join('').trimEnd();
  return cut && textWidth(cut) + 12 <= room ? `${cut}…` : '';
}

/** Within this many minutes of the clock hand, pointing means "now": snap to the hand, not the grid. */
const NOW_MAGNET = 5;

/** Where a pointer at minute `m` lands: the current minute near the hand, otherwise the 15-minute grid. */
function snapTime(m: number): { at: number; now: boolean } {
  const now = Math.floor(nowMinutes());
  const off = Math.abs(mod(m - now + DAY / 2) - DAY / 2);
  return off < NOW_MAGNET ? { at: now, now: true } : { at: mod(snap(m)), now: false };
}

/** Accumulates the shortest angular step so dragging across 00:00 keeps going. */
function stepBetween(prev: number, m: number): number {
  let step = m - prev;
  if (step > DAY / 2) step -= DAY;
  if (step < -DAY / 2) step += DAY;
  return step;
}

/** Range covered by a drag, normalised so `dur` is positive. */
function dragRange(delta: number, start: number): { start: number; dur: number } {
  return delta > 0 ? { start, dur: delta } : { start: mod(start + delta), dur: -delta };
}

export type DialStyle = 'full' | 'thin';
export interface Dial {
  /** full: the wide ring with names inside; thin: slices — a numbered donut, the day so far lit, names around the rim. */
  setStyle(style: DialStyle): void;
}

/** Ring radii per style (dial units). */
const RINGS: Record<DialStyle, [number, number]> = { full: [170, 400], thin: [335, 400] };

export function mountDial(svg: SVGSVGElement): Dial {
  const layer = (name: string) => svg.appendChild(svgEl('g', { class: `layer-${name}` }));
  const gBase = layer('base');
  // slices: the lit (past) part of each task again, blurred into a glow; the blur is on the outer group and the
  // ring's clip on the inner one, so the glow spills past the ring instead of being cut at it
  const gHalo = layer('halo').appendChild(svgEl('g', { class: 'halo-clip' }));
  const gBlocks = layer('blocks');
  const gCallouts = layer('callouts');
  // (named so a block's own `style` string in render() can't shadow it)
  let dialStyle: DialStyle = 'full';
  const gReset = layer('reset');
  const gGhost = layer('ghost');
  const gNow = layer('now');
  const gHover = layer('hover');
  const gTip = layer('tip');
  // the centre emblem and its core live in a sibling svg layered over the dial (see #orb-layer)
  const gCenter = svg.parentElement!.querySelector<SVGSVGElement>('#orb-layer')!.appendChild(svgEl('g', { class: 'layer-center' }));

  drawBase(gBase);

  // centre: a persistent dot emblem (so its fill transitions can play) plus a text layer on top
  const orb = createOrb(svg.parentElement!.querySelector<HTMLCanvasElement>('#orb-canvas')!);
  const gInfo = gCenter.appendChild(svgEl('g', { class: 'center-info' }));

  /** Sweep-select in progress: started on a task, extends over every task the pointer passes. */
  let sweep: { hit: Block; anchor: number; prev: number; acc: number; moved: boolean } | null = null;

  // ---------- rendering

  /** Stored blocks, with the one being edited swapped for its live draft. */
  function visibleBlocks(): (Block | Draft)[] {
    const { blocks, draft } = state;
    const rest = draft ? blocks.filter((b) => b.id !== draft.id) : blocks;
    return draft ? [...rest, draft] : rest;
  }

  // status as of the last paint (the task open in the editor counts as its draft, so picking a status there plays
  // at once): a badge whose status changed since then swaps with an animation (never on first paint)
  let statusSeen: Map<string, Status> | null = null;
  // task id → when its badge began swapping and from which status; a repaint mid-swap resumes the animation
  const popping = new Map<string, { t0: number; from: Status }>();
  const popStyle = (id: string | null): BadgePop | null => {
    const p = id === null ? undefined : popping.get(id);
    return p ? { style: `--pop-at:${Math.round(p.t0 - performance.now())}ms`, from: p.from } : null;
  };

  function render(): void {
    const now = nowMinutes();
    const statusNow = new Map(visibleBlocks().flatMap((b) => (b.id === null ? [] : [[b.id, statusOf(b)] as const])));
    // only a known task changing status swaps; tasks arriving with one (a sync, a restore) just appear
    if (statusSeen) {
      for (const [id, st] of statusNow) {
        const was = statusSeen.get(id);
        if (was && was !== st) popping.set(id, { t0: performance.now(), from: was });
      }
    }
    for (const id of popping.keys()) if (!statusNow.has(id)) popping.delete(id);
    statusSeen = statusNow;
    for (const [id, p] of popping) if (performance.now() - p.t0 > 800) popping.delete(id);
    // once the swap is over, a repaint drops the outgoing icon (no lingering shape if nothing else redraws)
    if (popping.size) window.setTimeout(() => {
      for (const [id, p] of popping) if (performance.now() - p.t0 > 800) popping.delete(id);
      if (!popping.size) render();
    }, 850);
    const { draft, drag } = state;
    const picked = new Set(state.selected);

    gBlocks.replaceChildren();
    gHalo.replaceChildren();
    if (dialStyle === 'thin') renderSlices(picked, now);
    else {
      for (const b of visibleBlocks()) {
        const isSel = b === draft || (b.id !== null && picked.has(b.id));
        gBlocks.append(...blockShapes(b, isSel, !isSel && contains(b, now), popStyle(b.id)));
      }
      // every task is in its colour here: only two of one colour need a line where they meet
      gBlocks.append(...seams(visibleBlocks(), () => true));
    }

    renderCallouts(visibleBlocks(), picked, now);
    renderReset();
    renderTip();

    gGhost.replaceChildren();
    if (drag?.delta) {
      const r = dragRange(drag.delta, drag.start);
      gGhost.append(svgEl('path', { class: 'ghost', d: sectorPath(r.start, r.dur) }));
    }

    if (dialStyle === 'thin') {
      // slices: the edge between the day so far and the rest, lit
      const [x0, y0] = pointAt(R_IN, now);
      const [x1, y1] = pointAt(R_OUT - 1.5, now);
      gNow.replaceChildren(svgEl('line', { class: 'now-edge', x1: x0, y1: y0, x2: x1, y2: y1 }));
    } else {
      const [x0, y0] = pointAt(R_IN - 14, now);
      const [x1, y1] = pointAt(R_OUT + 14, now);
      gNow.replaceChildren(
        svgEl('line', { class: 'now-hand', x1: x0, y1: y0, x2: x1, y2: y1 }),
        svgEl('circle', { class: 'now-dot', cx: x1, cy: y1, r: 6 }),
      );
    }

    renderCenter();
  }

  /** The ↺ badge being dragged round the ring to a new reset time (shown there until released). */
  let resetDrag: { at: number; moved: boolean } | null = null;
  /** Is a point (dial units) on the ↺ badge? */
  const onResetBadge = (x: number, y: number): boolean => {
    const at = resetAt();
    if (at === null) return false;
    const [bx, by] = pointAt(R_OUT - 22, at);
    return Math.hypot(x - bx, y - by) <= 22;
  };

  /**
   * Where a new day begins (Settings → Today, or drag the badge round the ring): a dashed cut across the ring,
   * ending in a ↺ badge inside the rim.
   */
  function renderReset(): void {
    const at = resetDrag?.at ?? resetAt();
    if (at === null) {
      gReset.replaceChildren();
      return;
    }
    // inside the rim, so it never sits on the hour numbers round the outside
    const [bx, by] = pointAt(R_OUT - 22, at);
    const [x0, y0] = pointAt(R_IN, at);
    const [x1, y1] = pointAt(R_OUT - 36, at);
    const badge = icon('rotate-ccw', 'reset-ic');
    for (const [k, v] of Object.entries({ x: bx - 8, y: by - 8, width: 16, height: 16 })) badge.setAttribute(k, String(v));
    const label = svgEl('title', {}, lang() === 'ko' ? `${hhmm(at)}에 새 하루 시작 · 끌어서 바꾸기` : `New day at ${hhmm(at)} · drag to change`);
    gReset.replaceChildren(
      svgEl('line', { class: 'reset-cut', x1: x0, y1: y0, x2: x1, y2: y1 }),
      svgEl('circle', { class: `reset-badge${resetDrag ? ' dragging' : ''}`, cx: bx, cy: by, r: 14 }),
      badge,
      label,
    );
  }
  onResetAt(render);

  /**
   * Centre: the dot emblem plus one short value in its core. The emblem reacts to what the
   * user is doing — hovering a task, drawing a new one, or holding a selection tints that time.
   */
  // a saved task sparkles across its stretch of the emblem in its category colour
  onSaved((b) => orb.play('save', `var(--cat-${b.cat})`, b));

  onRemoved((gone) => gone.forEach((b) => orb.play('delete', `var(--cat-${b.cat})`, b)));
  // abandoning a task mid-creation: its would-be stretch fizzles out in neutral grey
  onCancelled((d) => orb.play('cancel', 'var(--text-muted)', d));

  // finishing (or un-finishing) a task — from the list, the editor or a batch — plays over its own dots
  let doneBefore: Map<string, boolean> | null = null;
  subscribe(() => {
    const now = new Map(state.blocks.map((b) => [b.id, b.done]));
    if (doneBefore) {
      for (const b of state.blocks) {
        const was = doneBefore.get(b.id);
        if (was === undefined || was === b.done) continue;
        orb.play(b.done ? 'done' : 'undone', `var(--cat-${b.cat})`, b);
      }
    }
    doneBefore = now;
  });

  let hoverId: string | null = null;
  let lastPct = -1;
  onHover((id) => {
    hoverId = id;
    renderCenter();
    renderTip();
  });

  /**
   * The hovered task's whole name (and hours) in a small label just above its name on the ring, so a name cut
   * short (or left out) in a narrow slice can still be read. Only on the full dial: the slices view names
   * every task outside the ring already.
   */
  function renderTip(): void {
    const b = hoverId && dialStyle === 'full' && !state.drag ? state.blocks.find((x) => x.id === hoverId) : undefined;
    if (!b) return void gTip.replaceChildren();
    const [x, y] = pointAt(R_MID, b.start + b.dur / 2);
    const ty = y - (b.dur >= 90 ? 46 : 36);
    const g = svgEl('g', { class: 'dial-tip', style: `--c:var(--cat-${b.cat})` });
    const name = centeredText('dial-tip-name', x, ty - 8, labelOf(b));
    const time = centeredText('dial-tip-time', x, ty + 11, `${hhmm(b.start)}–${hhmm(b.start + b.dur)} · ${formatDuration(b.dur)}`);
    const box = svgEl('rect', { class: 'dial-tip-box', rx: 10 });
    g.append(box, name, time);
    gTip.replaceChildren(g);
    // sized to what was drawn
    const w = Math.max(name.getBBox().width, time.getBBox().width) + 28;
    for (const [k, v] of Object.entries({ x: x - w / 2, y: ty - 27, width: w, height: 50 })) box.setAttribute(k, String(v));
  }

  function core(text: string, fill: string, ink: string, pulse = false): SVGElement[] {
    return [
      svgEl('circle', { class: `orb-core${pulse ? ' pulse' : ''}`, r: 40, style: `fill:${fill}` }),
      centeredText('orb-pct', 0, 1, text, `fill:${ink};font-size:${text.length > 4 ? 17 : 25}px`),
    ];
  }

  function renderCenter(): void {
    const { drag, blocks, selected } = state;
    const catColor = (b: Block) => `var(--cat-${b.cat})`;

    if (drag?.delta) {
      const r = dragRange(drag.delta, drag.start);
      orb.focus([{ ...r, color: 'var(--text-strong)' }]);
      gInfo.replaceChildren(...core(formatDuration(r.dur), 'var(--text-strong)', 'var(--bg)'));
      return;
    }
    if (selected.length) {
      const picked = blocks.filter((b) => selected.includes(b.id));
      orb.focus(picked.map((b) => ({ start: b.start, dur: b.dur, color: catColor(b) })));
      gInfo.replaceChildren(...core(String(selected.length), 'var(--text)', 'var(--bg)'));
      return;
    }
    const hovered = hoverId ? blocks.find((b) => b.id === hoverId) : undefined;
    if (hovered) {
      orb.focus([{ start: hovered.start, dur: hovered.dur, color: catColor(hovered) }]);
      gInfo.replaceChildren(...core(formatDuration(hovered.dur), catColor(hovered), 'var(--text-strong)'));
      return;
    }
    const { done } = progressOf(blocks);
    const pct = Math.round((done / DAY) * 100);
    orb.focus(null);
    // slices: the emblem carries the slices' colours inward, with a radar trail behind the hand
    orb.setSlices(dialStyle === 'thin' ? blocks.map((b) => ({ start: b.start, dur: b.dur, color: catColor(b), done: b.done })) : null, nowMinutes());
    orb.setDone(blocks.filter((b) => b.done).map((b) => ({ start: b.start, dur: b.dur, color: catColor(b) })));
    // finishing something makes the core bounce once
    gInfo.replaceChildren(...core(`${pct}%`, 'var(--accent)', 'var(--bg)', lastPct >= 0 && pct > lastPct));
    lastPct = pct;
  }

  // ---------- pointer interaction

  function toDial(e: PointerEvent): { r: number; m: number; x: number; y: number } {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { r: Infinity, m: 0, x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { ...polarOf(p.x, p.y), x: p.x, y: p.y };
  }

  /**
   * Slices: every task a numbered slice in time order. What has passed is lit in its category colour (brightest
   * just behind now), what is still ahead stays gray.
   */
  function renderSlices(picked: Set<string>, now: number): void {
    const list = [...visibleBlocks()].sort((a, b) => a.start - b.start);
    const passedOf = (b: Block | Draft) => (contains(b, now) ? mod(now - b.start) : b.start + b.dur <= now ? b.dur : 0);
    list.forEach((b) => {
      const sel = b === state.draft || (b.id !== null && picked.has(b.id));
      const live = contains(b, now);
      const passed = passedOf(b);
      const style = `--c:var(--cat-${b.cat})`;
      gBlocks.append(svgEl('path', { class: `slice${sel ? ' sel' : ''}${b.done ? ' done' : ''}`, d: sectorPath(b.start, b.dur), style }));
      if (passed > 0) {
        gBlocks.append(svgEl('path', { class: 'slice-past', d: sectorPath(b.start, passed), style }));
        gHalo.append(svgEl('path', { class: 'halo', d: sectorPath(b.start, passed), style }));
      }
      // the running task glows toward the now edge (stacked washes: a gradient along the arc)
      if (live) {
        for (const span of [120, 60, 25]) {
          const from = Math.max(0, passed - span);
          if (passed - from > 0) gBlocks.append(svgEl('path', { class: 'slice-glow', d: sectorPath(b.start + from, passed - from), style }));
        }
      }
    });
    // where two tasks meet: lit on both sides (the earlier one wholly past, the later one begun) they only need a
    // line when they share a colour; still gray ahead of now they always do
    gBlocks.append(...seams(list, (a, b) => a.start + a.dur <= now && passedOf(b) > 0));
  }

  /**
   * Thin style: every task named outside the ring — a leader line from its middle out past the rim to its
   * name, share of the day and time (labels spread per side so they never overlap) — and the current task
   * as the title in the middle.
   */
  function renderCallouts(blocks: (Block | Draft)[], picked: Set<string>, now: number): void {
    if (dialStyle !== 'thin') {
      gCallouts.replaceChildren();
      return;
    }
    const NAME = 22, DETAIL = 15, GAP = NAME + DETAIL + 10, LIMIT = 500;
    // every task gets its name, as many as a side's column holds (2 × LIMIT tall, a label every GAP); if a side
    // ever has more, the task being edited or picked and the one on now go first, then the longest
    const PER_SIDE = Math.floor((2 * LIMIT) / GAP) + 1;
    const must = (b: Block | Draft) => b === state.draft || (b.id !== null && picked.has(b.id)) || contains(b, now);
    const ordered = [...blocks.filter(must), ...blocks.filter((b) => !must(b)).sort((a, b) => b.dur - a.dur)];
    const taken = { 1: 0, [-1]: 0 } as Record<number, number>;
    const items = ordered.map((b) => {
      const a = angleOf(b.start + b.dur / 2);
      return { b, dx: Math.cos(a), dy: Math.sin(a), side: Math.cos(a) >= 0 ? 1 : -1, y: (R_OUT + 70) * Math.sin(a) };
    }).filter((it) => taken[it.side]!++ < PER_SIDE);
    for (const side of [1, -1]) {
      const col = items.filter((it) => it.side === side).sort((a, b) => a.y - b.y);
      for (let k = 1; k < col.length; k++) col[k]!.y = Math.max(col[k]!.y, col[k - 1]!.y + GAP);
      const over = (col.at(-1)?.y ?? 0) - LIMIT;
      if (over > 0) col.forEach((it) => (it.y -= over));
      for (let k = col.length - 2; k >= 0; k--) col[k]!.y = Math.min(col[k]!.y, col[k + 1]!.y - GAP);
    }
    const legX = R_OUT + 112;
    const out: SVGElement[] = items.map(({ b, dx, dy, side, y }) => {
      const sel = b === state.draft || (b.id !== null && picked.has(b.id));
      const cls = `callout${b.done ? ' done' : ''}${sel ? ' sel' : ''}${contains(b, now) ? ' now' : ''}`;
      const g = svgEl('g', { class: cls, style: `--c:var(--cat-${b.cat})` });
      const p0 = [(R_OUT + 4) * dx, (R_OUT + 4) * dy];
      const p1 = [(R_OUT + 70) * dx, y];
      const p2 = [side * (legX - 8), y];
      const anchor = side > 0 ? 'start' : 'end';
      // a done task gets a check badge right after its name; on the left the name steps aside so the badge
      // sits between it and the leader's end
      const label = labelOf(b);
      const nameW = textWidth(label) * (22 / 21);
      // every task carries its status badge after its name (done, in progress, not started)
      const tx = side > 0 ? legX : -(legX + 34);
      const right = side > 0 ? tx + nameW : tx;
      g.append(
        svgEl('polyline', { class: 'callout-line', points: `${p0.join(',')} ${p1.join(',')} ${p2.join(',')}` }),
        svgEl('circle', { class: 'callout-dot', cx: p0[0]!, cy: p0[1]!, r: 3.5 }),
        svgEl('text', { class: 'callout-name', x: tx, y: y - 3, 'text-anchor': anchor }, label),
        svgEl('text', { class: 'callout-detail', x: tx, y: y + DETAIL + 3, 'text-anchor': anchor },
          `${hhmm(b.start)}–${hhmm(b.start + b.dur)} · ${Math.round((b.dur / DAY) * 100)}%`),
      );
      const [bx, by] = [right + 17, y - 10];
      g.append(statusBadge(b, bx, by, 11, 14, popStyle(b.id)));
      const after = bx + 18;
      // a note on the task: a small dot at the name's top right (past the check, when there is one)
      if (b.note?.trim()) g.append(noteDot(after, y - 20));
      return g;
    });
    // the middle keeps the dot emblem; either side of it, on its channel's line, what is on and how long it still runs
    const cur = state.blocks.find((b) => contains(b, now));
    const next = [...state.blocks].sort((a, b) => mod(a.start - now) - mod(b.start - now))[0];
    const name = cur ? fitLabel(labelOf(cur), 104) || '…' : 'free';
    const rest = cur ? `${formatDuration(Math.ceil(cur.dur - mod(now - cur.start)))} left` : next ? `next ${hhmm(next.start)}` : '';
    out.push(
      svgEl('text', { class: `slice-sub${cur ? ' on' : ''}`, x: -172, y: 1, 'text-anchor': 'end', 'dominant-baseline': 'central' }, name),
      svgEl('text', { class: 'slice-sub', x: 172, y: 1, 'text-anchor': 'start', 'dominant-baseline': 'central' }, rest),
    );
    gCallouts.replaceChildren(...out);
  }

  /** While a new task is being dragged out: the time under the pointer (and where it started), on the ring. */
  function showDragTimes(start: number, end: number): void {
    const mark = (m: number, cls: string) => {
      const [x0, y0] = pointAt(R_IN, m);
      const [x1, y1] = pointAt(R_OUT + 10, m);
      const [tx, ty] = pointAt(R_OUT + 46, m);
      return [
        svgEl('line', { class: 'hover-tick', x1: x0, y1: y0, x2: x1, y2: y1 }),
        centeredText(`hover-label drag-time ${cls}`, tx, ty, hhmm(m)),
      ];
    };
    gHover.replaceChildren(...mark(start, 'from'), ...(mod(end - start) ? mark(end, 'to') : []));
  }

  function showHover(m: number): void {
    const { at: s, now } = snapTime(m);
    // label sits inside the empty ring band, clear of the centre hole and its progress ring
    const [tx, ty] = pointAt(R_IN + 30, s);
    if (now) {
      // on the clock hand: no second line beside it, just the exact current time
      gHover.replaceChildren(centeredText('hover-label now', tx, ty, hhmm(s)));
      return;
    }
    const [x0, y0] = pointAt(R_IN + 54, s);
    const [x1, y1] = pointAt(R_OUT, s);
    gHover.replaceChildren(
      svgEl('line', { class: 'hover-tick', x1: x0, y1: y0, x2: x1, y2: y1 }),
      centeredText('hover-label', tx, ty, hhmm(s)),
    );
  }

  svg.addEventListener('pointerdown', (e) => {
    const { r, m, x, y } = toDial(e);
    // the ↺ badge: drag it round the ring to move when the day starts over
    if (e.button === 0 && dialStyle === 'full' && onResetBadge(x, y)) {
      svg.setPointerCapture(e.pointerId);
      resetDrag = { at: resetAt() ?? 0, moved: false };
      gHover.replaceChildren();
      return;
    }
    if (!onRing(r)) {
      // clicking the centre hole closes the editor / drops the selection
      if (r < R_IN - 10) {
        if (state.draft) closeDraft();
        clearSelection();
      }
      return;
    }
    const hit = blockAt(state.blocks, m);
    if (hit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        toggleSelected(hit.id);
        return;
      }
      svg.setPointerCapture(e.pointerId);
      sweep = { hit, anchor: m, prev: m, acc: 0, moved: false };
      return;
    }
    const start = snapTime(m).at;
    const { fwd, back } = freeAround(state.blocks, start);
    if (!fwd && !back) return;
    svg.setPointerCapture(e.pointerId);
    setState({ draft: null, selected: [], drag: { start, prev: m, acc: 0, delta: 0, fwd, back, moved: false } });
    showDragTimes(start, start);
  });

  svg.addEventListener('pointermove', (e) => {
    const { r, m, x, y } = toDial(e);
    // dots near the pointer swell while it moves over the emblem
    orb.attract(r < R_IN - 10 ? { x, y } : null);
    if (resetDrag) {
      const at = mod(snap(m));
      if (at !== resetDrag.at) {
        resetDrag = { at, moved: true };
        renderReset();
      }
      const [tx, ty] = pointAt(R_IN + 30, at);
      gHover.replaceChildren(centeredText('hover-label', tx, ty, hhmm(at)));
      return;
    }
    if (sweep) {
      sweep.acc += stepBetween(sweep.prev, m);
      sweep.prev = m;
      if (!sweep.moved && Math.abs(sweep.acc) < 4) return;
      sweep.moved = true;
      const ids = blocksInRange(state.blocks, dragRange(sweep.acc || 0.01, sweep.anchor)).map((b) => b.id);
      if (ids.join() !== state.selected.join()) select(ids);
      return;
    }
    const drag = state.drag;
    if (drag) {
      const acc = drag.acc + stepBetween(drag.prev, m);
      const delta = Math.max(-drag.back, Math.min(drag.fwd, snap(acc)));
      setState({ drag: { ...drag, prev: m, acc, delta, moved: drag.moved || Math.abs(acc) > 5 } });
      showDragTimes(drag.start, mod(drag.start + delta));
      return;
    }
    if (!onRing(r)) {
      svg.style.cursor = 'default';
      gHover.replaceChildren();
      setHover(null);
      return;
    }
    if (dialStyle === 'full' && onResetBadge(x, y)) {
      svg.style.cursor = 'grab';
      gHover.replaceChildren();
      setHover(null);
      return;
    }
    const over = blockAt(state.blocks, m);
    setHover(over?.id ?? null);
    svg.style.cursor = over ? 'pointer' : 'crosshair';
    if (over) gHover.replaceChildren();
    else showHover(m);
  });

  svg.addEventListener('pointerleave', () => {
    if (!state.drag) gHover.replaceChildren();
    orb.attract(null);
    setHover(null);
  });

  svg.addEventListener('pointerup', () => {
    if (resetDrag) {
      const { at, moved } = resetDrag;
      resetDrag = null;
      gHover.replaceChildren();
      // the new time is kept (Settings shows it too); a plain click changes nothing
      if (moved) setResetAt(at);
      else renderReset();
      return;
    }
    if (sweep) {
      // a click without sweeping opens that task in the editor
      if (!sweep.moved) openDraft({ ...sweep.hit });
      sweep = null;
      return;
    }
    const drag = state.drag;
    if (!drag) return;
    let range: { start: number; dur: number };
    if (!drag.moved || !drag.delta) {
      // plain click: an hour forward, or backward when there's no room ahead
      range = { start: drag.start, dur: Math.min(60, drag.fwd) };
      if (range.dur < SNAP) {
        const dur = Math.min(60, drag.back);
        range = { start: mod(drag.start - dur), dur };
      }
    } else {
      range = dragRange(drag.delta, drag.start);
    }
    gHover.replaceChildren();
    if (range.dur < SNAP) {
      setState({ drag: null });
      return;
    }
    openDraft({ id: null, title: '', cat: state.lastCat, done: false, ...range });
  });

  // Esc mid-drag abandons the drag on the spot: the ghost goes, and releasing afterwards creates nothing
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const drag = state.drag;
    if (drag) {
      if (drag.delta) orb.play('cancel', 'var(--text-muted)', dragRange(drag.delta, drag.start));
      gHover.replaceChildren();
      setState({ drag: null });
    }
    if (sweep) {
      sweep = null;
      clearSelection();
    }
  });

  svg.addEventListener('pointercancel', () => {
    if (resetDrag) {
      resetDrag = null;
      renderReset();
    }
    sweep = null;
    gHover.replaceChildren();
    setState({ drag: null });
  });

  subscribe(render);
  // the emblem's resting dots take the new theme's line colour
  onTheme(render);
  render();
  // keep the clock hand moving
  setInterval(() => {
    if (!state.drag) render();
  }, 20_000);

  return {
    setStyle(next) {
      if (next === dialStyle) return;
      dialStyle = next;
      setRing(...RINGS[next]);
      svg.classList.toggle('thin', next === 'thin');
      gBase.replaceChildren();
      drawBase(gBase, next);
      render();
    },
  };
}

/**
 * A task's status as a small round badge: done — a check on its colour; in progress — an hourglass on blue;
 * not started — a faint dashed ring. A task just checked springs in (`pop`).
 */
/** A status badge mid-swap: when it started (as a CSS delay) and the status it is leaving. */
interface BadgePop { style: string; from: Status }

function statusBadge(b: Block | Draft, cx: number, cy: number, r: number, size: number, pop: BadgePop | null = null): SVGGElement {
  const one = (status: Status, cls: string): SVGGElement => {
    const g = svgEl('g', {
      class: `status-badge ${status}${status === 'done' ? ' done-badge' : ''}${cls}`,
      style: `transform-origin:${cx}px ${cy}px;${pop?.style ?? ''}`,
    });
    g.append(svgEl('circle', { cx, cy, r }));
    if (status !== 'yet') {
      const ic = icon(status === 'done' ? 'check' : 'hourglass', status === 'done' ? 'done-ic' : 'doing-ic');
      const s = status === 'done' ? size : size * 0.78;
      for (const [k, v] of Object.entries({ x: cx - s / 2, y: cy - s / 2, width: s, height: s })) ic.setAttribute(k, String(v));
      g.append(ic);
    }
    return g;
  };
  const status = statusOf(b);
  if (!pop) return one(status, '');
  // a swap: the old badge spins away and shrinks while the new one springs in after it
  const wrap = svgEl('g', { class: 'status-swap' });
  wrap.append(one(pop.from, ' leaving'), one(status, ' pop'));
  return wrap;
}

/**
 * Lines where one task ends just as the next begins — only where the two would otherwise run together into
 * one: the same colour on both sides, or (`lit` false) both still gray. Tasks of different colours simply
 * meet, with no dark gap between them.
 */
function seams(blocks: readonly (Block | Draft)[], lit: (a: Block | Draft, b: Block | Draft) => boolean): SVGElement[] {
  const out: SVGElement[] = [];
  for (const b of blocks) {
    const a = blocks.find((x) => x !== b && mod(x.start + x.dur) === mod(b.start));
    if (!a) continue;
    const colored = lit(a, b);
    if (colored && a.cat !== b.cat) continue;
    const [x0, y0] = pointAt(R_IN, b.start);
    const [x1, y1] = pointAt(R_OUT, b.start);
    out.push(svgEl('line', { class: `seam${colored ? '' : ' gray'}`, x1: x0, y1: y0, x2: x1, y2: y1 }));
  }
  return out;
}

/**
 * One task on the full dial: its slice, its arc on the rim, and (when it fits) its name and hours. A done
 * task reads at a glance: filled in its colour, a full-strength rim, and a check badge by the inner edge.
 */
function blockShapes(b: Block | Draft, isSel: boolean, isNow: boolean, pop: BadgePop | null = null): SVGElement[] {
  const style = `--c:var(--cat-${b.cat});--cf:var(--cat-${b.cat}-fill)`;
  const out: SVGElement[] = [
    svgEl('path', { class: `block${isSel ? ' sel' : ''}${b.done ? ' done' : ''}`, d: sectorPath(b.start, b.dur), style }),
    svgEl('path', { class: `block-arc${b.done ? ' done' : b.doing ? ' doing' : ''}`, d: arcPath(b.start, b.dur, R_OUT - 3.5), style }),
  ];
  if (b.dur >= 20) {
    const [cx, cy] = pointAt(R_IN + 26, b.start + b.dur / 2);
    const badge = statusBadge(b, cx, cy, 16, 22, pop);
    badge.setAttribute('style', `${style};${badge.getAttribute('style') ?? ''}`);
    out.push(badge);
  }
  if (b.dur < 45) return out;
  const [x, y] = pointAt(R_MID, b.start + b.dur / 2);
  const room = Math.min((b.dur / DAY) * Math.PI * 2 * R_MID - 12, 210);
  // done blocks read from their solid arc, muted label and glowing dots — no glyph needed
  const label = fitLabel(labelOf(b), room);
  if (!label) return out;
  const withTime = b.dur >= 90;
  const cls = `block-label${isNow ? ' now' : ''}${isSel ? ' sel' : ''}${b.done ? ' done' : ''}`;
  const ly = withTime ? y - 10 : y;
  out.push(centeredText(cls, x, ly, label));
  // a note on the task: a small dot at the name's top right
  if (b.note?.trim()) out.push(noteDot(x + textWidth(label) / 2 + 6, ly - 11));
  if (withTime) out.push(centeredText('block-time', x, y + 16, `${hhmm(b.start)}–${hhmm(b.start + b.dur)}`));
  return out;
}

/** The small dot that says a task has a note. */
const noteDot = (cx: number, cy: number): SVGElement => svgEl('circle', { class: 'note-dot', cx, cy, r: 4.5 });

/**
 * Someone else's day drawn as a dial, read only (see peek): the same ring, tasks and clock hand as your
 * own Today, with the done share of the day in the middle. `svg` uses the dial's viewBox.
 */
export function drawReadOnlyDial(svg: SVGSVGElement, blocks: Block[]): void {
  const now = nowMinutes();
  const g = (name: string) => svg.appendChild(svgEl('g', { class: `layer-${name}` }));
  svg.replaceChildren();
  drawBase(g('base'));
  const gBlocks = g('blocks');
  for (const b of blocks) gBlocks.append(...blockShapes(b, false, contains(b, now)));
  gBlocks.append(...seams(blocks, () => true));
  const [x0, y0] = pointAt(R_IN - 14, now);
  const [x1, y1] = pointAt(R_OUT + 14, now);
  g('now').append(
    svgEl('line', { class: 'now-hand', x1: x0, y1: y0, x2: x1, y2: y1 }),
    svgEl('circle', { class: 'now-dot', cx: x1, cy: y1, r: 6 }),
  );
  const pct = Math.round((progressOf(blocks).done / DAY) * 100);
  g('center').append(
    svgEl('circle', { class: 'peek-core', r: 52 }),
    centeredText('peek-pct', 0, 1, `${pct}%`),
  );
}

function drawBase(g: SVGGElement, style: DialStyle = 'full'): void {
  if (style === 'thin') {
    // slices sit on a black disk with only a faint track: no hour numbers or ticks, the slices carry the day.
    // Disk and slices end on one clean rim, a hair inside the ring — and start a hair outside the hole: the
    // slices' dividing strokes are clipped at both edges, so no dark line runs round the outside or along the
    // inside (the colour meets the centre directly).
    const rim = R_OUT - 1.5;
    const inner = R_IN + 1.5;
    const clip = svgEl('clipPath', { id: 'ring-clip' });
    clip.append(svgEl('path', { d: sectorPath(0, DAY, inner, rim) }));
    g.append(svgEl('defs'), svgEl('circle', { class: 'disk', r: rim }), svgEl('path', { class: 'ring-bg', d: sectorPath(0, DAY, R_IN, rim) }));
    g.firstElementChild!.append(clip);
    return;
  }
  g.append(svgEl('path', { class: 'ring-bg', d: sectorPath(0, DAY) }));
  for (let h = 0; h < 24; h++) {
    const m = h * 60;
    const [x0, y0] = pointAt(R_IN, m);
    const [x1, y1] = pointAt(R_OUT, m);
    g.append(svgEl('line', { class: `tick${h % 3 === 0 ? ' major' : ''}`, x1: x0, y1: y0, x2: x1, y2: y1 }));
    const [tx, ty] = pointAt(R_OUT + 42, m);
    g.append(centeredText(`hour${h % 6 === 0 ? ' major' : ''}`, tx, ty, String(h)));
    const [a0, b0] = pointAt(R_OUT + 8, m + 30);
    const [a1, b1] = pointAt(R_OUT + 14, m + 30);
    g.append(svgEl('line', { class: 'tick', x1: a0, y1: b0, x2: a1, y2: b1 }));
  }
  g.append(svgEl('circle', { class: 'edge', r: R_OUT }), svgEl('circle', { class: 'edge', r: R_IN }));
}
