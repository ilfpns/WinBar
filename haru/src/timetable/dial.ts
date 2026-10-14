import { DAY, SNAP, formatDuration, hhmm, mod, nowMinutes, snap } from './time';
import { R_IN, R_MID, R_OUT, arcPath, pointAt, polarOf, sectorPath } from './geometry';
import { type Block, type Draft, blockAt, blocksInRange, contains, freeAround, labelOf, progressOf } from './model';
import { clearSelection, closeDraft, onCancelled, onRemoved, onSaved, openDraft, select, setState, state, subscribe, toggleSelected } from './state';
import { centeredText, svgEl } from './svg';
import { createOrb } from './orb';
import { onHover, setHover } from './hover';

/** Pointer counts as "on the ring" a little inside the hole and out over the hour labels. */
const onRing = (r: number): boolean => r >= R_IN - 10 && r <= R_OUT + 60;

/** Rough advance width of a glyph in the 21-unit block label font. */
const glyphWidth = (ch: string): number =>
  /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(ch) ? 21 : /[A-Z0-9]/.test(ch) ? 13.5 : 11;
const textWidth = (s: string): number => [...s].reduce((w, ch) => w + glyphWidth(ch), 0);

/** Fits a label into `room` units, ellipsising; returns '' when not even two glyphs fit. */
function fitLabel(text: string, room: number): string {
  if (textWidth(text) <= room) return text;
  const chars = [...text];
  while (chars.length > 2 && textWidth(chars.join('')) + 12 > room) chars.pop();
  return chars.length > 2 ? `${chars.join('').trimEnd()}…` : '';
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

export function mountDial(svg: SVGSVGElement): void {
  const layer = (name: string) => svg.appendChild(svgEl('g', { class: `layer-${name}` }));
  const gBase = layer('base');
  const gBlocks = layer('blocks');
  const gGhost = layer('ghost');
  const gNow = layer('now');
  const gHover = layer('hover');
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

  function render(): void {
    const now = nowMinutes();
    const { draft, drag } = state;
    const picked = new Set(state.selected);

    gBlocks.replaceChildren();
    for (const b of visibleBlocks()) {
      const isSel = b === draft || (b.id !== null && picked.has(b.id));
      const isNow = !isSel && contains(b, now);
      const style = `--c:var(--cat-${b.cat});--cf:var(--cat-${b.cat}-fill)`;
      gBlocks.append(
        svgEl('path', { class: `block${isSel ? ' sel' : ''}`, d: sectorPath(b.start, b.dur), style }),
        svgEl('path', { class: `block-arc${b.done ? ' done' : ''}`, d: arcPath(b.start, b.dur, R_OUT - 3.5), style }),
      );
      if (b.dur < 45) continue;
      const [x, y] = pointAt(R_MID, b.start + b.dur / 2);
      const room = Math.min((b.dur / DAY) * Math.PI * 2 * R_MID - 12, 210);
      const name = labelOf(b);
      // done blocks read from their solid arc, muted label and glowing dots — no glyph needed
      const label = fitLabel(name, room);
      if (!label) continue;
      const withTime = b.dur >= 90;
      const cls = `block-label${isNow ? ' now' : ''}${isSel ? ' sel' : ''}${b.done ? ' done' : ''}`;
      gBlocks.append(centeredText(cls, x, withTime ? y - 10 : y, label));
      if (withTime) gBlocks.append(centeredText('block-time', x, y + 16, `${hhmm(b.start)}–${hhmm(b.start + b.dur)}`));
    }

    gGhost.replaceChildren();
    if (drag?.delta) {
      const r = dragRange(drag.delta, drag.start);
      gGhost.append(svgEl('path', { class: 'ghost', d: sectorPath(r.start, r.dur) }));
    }

    const [x0, y0] = pointAt(R_IN - 14, now);
    const [x1, y1] = pointAt(R_OUT + 14, now);
    gNow.replaceChildren(
      svgEl('line', { class: 'now-hand', x1: x0, y1: y0, x2: x1, y2: y1 }),
      svgEl('circle', { class: 'now-dot', cx: x1, cy: y1, r: 6 }),
    );

    renderCenter();
  }

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
  });

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
    const { r, m } = toDial(e);
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
    gHover.replaceChildren();
    setState({ draft: null, selected: [], drag: { start, prev: m, acc: 0, delta: 0, fwd, back, moved: false } });
  });

  svg.addEventListener('pointermove', (e) => {
    const { r, m, x, y } = toDial(e);
    // dots near the pointer swell while it moves over the emblem
    orb.attract(r < R_IN - 10 ? { x, y } : null);
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
      return;
    }
    if (!onRing(r)) {
      svg.style.cursor = 'default';
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
      setState({ drag: null });
    }
    if (sweep) {
      sweep = null;
      clearSelection();
    }
  });

  svg.addEventListener('pointercancel', () => {
    sweep = null;
    setState({ drag: null });
  });

  subscribe(render);
  render();
  // keep the clock hand moving
  setInterval(() => {
    if (!state.drag) render();
  }, 20_000);
}

function drawBase(g: SVGGElement): void {
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
