import { type Block, contains, labelOf, newId, passedOf, statusOf } from './model';
import { centeredText, svgEl } from './svg';
import { DAY, SNAP, formatDuration, hhmm, mod } from './time';
import { setState, state } from './state';
import { type PlanBlock, clearPlan, planOn, setPlan } from './plans';
import { templateBlock } from './templates';
import { type WeekDay, loadDay, weekDates, weekStart } from '../calendar/week';

/**
 * Three more ways Today shows the day, each one SVG in the dial's own box, drawn in place of the dial like By
 * category (today-views.ts):
 *  - focus: a dial that spends most of the ring on the next three hours, the rest of the day folded thin, with
 *           the task on now in the middle (Start / Done);
 *  - week:  the seven days of this week as 24 h strips from the New day time, now as one line across them; Today's
 *           and the planned days' tasks drag to another time or day (Alt: a copy);
 *  - dots:  this month as dot days (a dot = 30 min, done ones in their colour) over Today as 96 quarter hours.
 * On a narrow screen (`compact`) each draws in a smaller box, so its type and marks come out larger.
 * What a click means is carried on the element: `data-id` (one of Today's tasks: select it), `data-date` (open
 * that day in the calendar), `data-action` (a button: start, done, yet).
 */

const solid = (cat: string) => `var(--cat-${cat})`;
const faint = (cat: string) => `var(--cat-${cat}-fill)`;
/** The task at `m` (minute of day) on a day, if any. */
const at = (blocks: readonly Block[], m: number) => blocks.find((b) => contains(b, m));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The day `n` days from `date` (YYYY-MM-DD). */
export const shiftDate = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};

const CJK = /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/;
const textW = (s: string, size: number) => [...s].reduce((w, ch) => w + (CJK.test(ch) ? size : size * 0.58), 0);
function fit(s: string, room: number, size: number): string {
  if (textW(s, size) <= room) return s;
  const chars = [...s];
  while (chars.length > 1 && textW(`${chars.join('')}…`, size) > room) chars.pop();
  return chars.length > 1 ? `${chars.join('')}…` : '';
}

/** One mode's SVG: `half` is half the box (520 wide, less on a narrow screen so everything in it reads larger). */
const frame = (cls: string, label: string, half: number, compact: boolean) =>
  svgEl('svg', { class: `today-mode ${cls}${compact ? ' compact' : ''}`, viewBox: `${-half} ${-half} ${half * 2} ${half * 2}`, role: 'img', 'aria-label': label }) as SVGSVGElement;

/** A small round button drawn in the SVG (the host turns its click into `data-action`). */
function svgButton(action: string, x: number, y: number, label: string, opts: { k?: number; on?: boolean } = {}): SVGGElement {
  const k = opts.k ?? 1;
  const w = textW(label, 22 * k) + 64 * k;
  const h = 52 * k;
  const g = svgEl('g', { class: `tm-btn${opts.on ? ' on' : ''}`, 'data-action': action, role: 'button', 'aria-label': label, tabindex: 0 });
  g.append(svgEl('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: h / 2 }), svgEl('text', { x, y: y + 1 }, label));
  return g;
}

// ---------------------------------------------------------------- focus: the next three hours, large

const BEFORE = 30;
const WINDOW = 210;
const WINDOW_SHARE = 250 / 360;
const RO = 430;

/** The ring's angle (radians, 0 at 12 o'clock) of minute `m`, now at the top. */
function focusAngle(m: number, now: number): number {
  const d = mod(m - (now - BEFORE));
  const f = d <= WINDOW ? (d / WINDOW) * WINDOW_SHARE : WINDOW_SHARE + ((d - WINDOW) / (DAY - WINDOW)) * (1 - WINDOW_SHARE);
  return (f - (BEFORE / WINDOW) * WINDOW_SHARE) * Math.PI * 2;
}
/** Ring thickness at `m`: wide inside the window, thin outside, easing over 20 minutes at its edges. */
function focusThick(m: number, now: number): number {
  const d = mod(m - (now - BEFORE));
  const edge = d <= WINDOW ? Math.min(d, WINDOW - d) : -Math.min(d - WINDOW, DAY - d);
  const t = Math.max(0, Math.min(1, (edge + 20) / 40));
  return 30 + t * 74;
}
const polar = (a: number, r: number) => [r * Math.sin(a), -r * Math.cos(a)] as const;

function focusSector(start: number, dur: number, now: number): string {
  const n = Math.max(2, Math.ceil(dur / 2));
  const a0 = focusAngle(start, now);
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i <= n; i++) {
    const m = start + (dur * i) / n;
    let a = focusAngle(m, now);
    if (i > 0 && a < a0 - 0.01) a += Math.PI * 2;
    const [x, y] = polar(a, RO);
    const [u, v] = polar(a, RO - focusThick(m, now));
    outer.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    inner.push(`${u.toFixed(1)} ${v.toFixed(1)}`);
  }
  return `M${outer.join(' L')} L${inner.reverse().join(' L')} Z`;
}

export function focusDial(blocks: readonly Block[], now: number, dayStart: number, compact: boolean): SVGSVGElement {
  const svg = frame('tm-focus', 'The next three hours', 520, compact);
  // type sizes: larger on a narrow screen, where the whole box is drawn small
  const k = compact ? 1.4 : 1;
  const inWindow = (m: number) => mod(m - (now - BEFORE)) <= WINDOW;
  svg.append(svgEl('circle', { class: 'tm-track', r: RO - 15 }));
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  for (const [i, b] of sorted.entries()) {
    const gone = passedOf(b, now, dayStart);
    const g = svgEl('g', { class: 'tm-task', 'data-id': b.id, style: `--i:${i}` });
    if (gone < b.dur) g.append(svgEl('path', { d: focusSector(b.start + gone, b.dur - gone, now), style: `fill:${b.done ? solid(b.cat) : faint(b.cat)}` }));
    if (gone > 0) g.append(svgEl('path', { d: focusSector(b.start, gone, now), style: `fill:${solid(b.cat)}` }));
    // named along the ring while it sits in the wide part
    const mid = b.start + b.dur / 2;
    if (inWindow(mid)) {
      const a = focusAngle(mid, now);
      const [x, y] = polar(a, RO - focusThick(mid, now) / 2);
      const deg = (a * 180) / Math.PI;
      const flip = mod(deg) > 90 && mod(deg) < 270;
      const room = Math.abs(focusAngle(b.start + b.dur, now) - focusAngle(b.start, now)) * (RO - 50);
      const name = fit(labelOf(b), room - 16, 22 * k);
      if (name) g.append(svgEl('text', { class: `tm-name${gone > 0 || b.done ? ' lit' : ''}`, x: x.toFixed(1), y: y.toFixed(1), transform: `rotate(${(flip ? deg - 180 : deg).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})` }, name));
    }
    svg.append(g);
  }
  // hours: every one in the window, every four outside (every six on a narrow screen)
  for (let h = 0; h < 24; h++) {
    const m = h * 60;
    const wide = inWindow(m);
    if (!wide && h % (compact ? 6 : 4)) continue;
    const [x, y] = polar(focusAngle(m, now), RO + (wide ? 34 : 24) * (compact ? 1.25 : 1));
    svg.append(svgEl('text', { class: `tm-hour${wide ? ' wide' : ''}`, x: x.toFixed(1), y: y.toFixed(1) }, wide ? hhmm(m) : String(h).padStart(2, '0')));
  }
  svg.append(
    svgEl('line', { class: 'tm-now', x1: 0, y1: -(RO - 112), x2: 0, y2: -(RO + 8) }),
    svgEl('circle', { class: 'tm-now-dot', cy: -(RO + 8), r: 6 }),
  );
  // the middle: what is on now, how long it has left, what comes next, and what to do with it
  const cur = at(blocks, now);
  const next = sorted.filter((b) => b !== cur && mod(b.start - now) > 0).sort((a, b) => mod(a.start - now) - mod(b.start - now))[0];
  const step = 62 * k;
  let y = -130 * k;
  svg.append(centeredText('tm-kicker', 0, y, cur ? 'NOW' : 'FREE'));
  y += step;
  svg.append(centeredText('tm-title', 0, y, cur ? fit(labelOf(cur), 560, 60 * k) : next ? 'Until the next task' : 'Nothing planned'));
  if (cur) {
    y += step;
    const left = Math.ceil(cur.dur - mod(now - cur.start));
    svg.append(centeredText('tm-sub', 0, y, cur.done ? `${hhmm(cur.start)}–${hhmm(cur.start + cur.dur)} · done` : `${hhmm(cur.start)}–${hhmm(cur.start + cur.dur)} · ${formatDuration(left)} left`));
    // how far into it, as a thin bar
    const w = 260 * k;
    y += 30 * k;
    svg.append(
      svgEl('rect', { class: 'tm-bar', x: -w / 2, y, width: w, height: 6 * k, rx: 3 * k }),
      svgEl('rect', { class: 'tm-bar-fill', x: -w / 2, y, width: (w * mod(now - cur.start)) / cur.dur, height: 6 * k, rx: 3 * k, style: `fill:${solid(cur.cat)}` }),
    );
    // start it, or check it off
    y += 64 * k;
    const status = statusOf(cur);
    if (status === 'yet') svg.append(svgButton('start', 0, y, 'Start', { k }));
    else if (status === 'doing') svg.append(svgButton('done', 0, y, 'Done', { k, on: true }));
    else svg.append(svgButton('yet', 0, y, 'Not done', { k }));
    y += 40 * k;
  }
  if (next) {
    y += 34 * k;
    svg.append(centeredText('tm-next', 0, y, `Next ${hhmm(next.start)} · ${fit(labelOf(next), 300 * k, 24 * k)}`));
  }
  return svg;
}

// ---------------------------------------------------------------- week: seven strips

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The geometry of the week strips, kept on the SVG for dragging. */
interface WeekGeo { x0: number; w: number; top: number; row: number; dayStart: number; dates: string[]; today: string }
const weekGeo = new WeakMap<SVGSVGElement, WeekGeo>();

export async function weekStrips(today: string, now: number, dayStart: number, compact: boolean): Promise<SVGSVGElement> {
  const dates = weekDates(weekStart(new Date(`${today}T00:00`)));
  const days = await Promise.all(dates.map(loadDay));
  const half = compact ? 340 : 520;
  const svg = frame('tm-week', 'This week', half, compact);
  const labelW = compact ? 76 : 110;
  const X0 = -half + labelW;
  const W = half * 2 - labelW - 10;
  const TOP = -half + (compact ? 70 : 110);
  const ROW = ((half - TOP) - (compact ? 20 : 30)) / 7 + (compact ? 0 : 6);
  const size = compact ? 17 : 19;
  const pos = (m: number) => X0 + (mod(m - dayStart) / DAY) * W;
  const nx = pos(now);
  // the hours along the top, from the New day time (the now chip takes the place of one near it)
  const every = compact ? 6 : 3;
  for (let h = 0; h <= 24; h += every) {
    const x = X0 + (h / 24) * W;
    svg.append(svgEl('line', { class: 'tm-grid', x1: x, y1: TOP - 6, x2: x, y2: TOP + ROW * 7 }));
    if (h < 24 && Math.abs(x - nx) > (compact ? 56 : 52)) svg.append(svgEl('text', { class: 'tm-tick', x, y: TOP - 22 }, hhmm(dayStart + h * 60)));
  }
  for (const [r, day] of days.entries()) {
    const y = TOP + r * ROW;
    const isToday = day.kind === 'today';
    const ahead = day.date > today;
    const d = new Date(`${day.date}T00:00`);
    const lane = svgEl('rect', { class: `tm-lane${isToday ? ' today' : ''}`, x: X0, y: y + 8, width: W, height: ROW - 16, rx: 14 });
    // a day ahead opens in the calendar, to plan or change it there
    if (ahead) lane.setAttribute('data-date', day.date);
    svg.append(
      svgEl('text', { class: `tm-dow${isToday ? ' today' : ''}${d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : ''}`, x: -half + 4, y: y + ROW * 0.42 }, DOW[d.getDay()]!),
      svgEl('text', { class: `tm-date${isToday ? ' today' : day.kind === 'past' || day.kind === 'carried' ? ' past' : ''}`, x: -half + 4, y: y + ROW * 0.8 }, String(d.getDate())),
      lane,
    );
    if (!day.blocks.length) {
      svg.append(svgEl('text', { class: 'tm-empty', x: X0 + W / 2, y: y + ROW / 2 + 7 }, ahead ? 'Not planned yet · tap to plan' : 'Nothing kept'));
      continue;
    }
    const movable = isToday || ahead;
    for (const b of day.blocks) {
      const kind = stripKind(day, b, now, dayStart);
      // a task over the New day time shows at both ends of its strip
      const a = mod(b.start - dayStart);
      const pieces: [number, number][] = a + b.dur > DAY ? [[a, DAY - a], [0, a + b.dur - DAY]] : [[a, b.dur]];
      const g = svgEl('g', {
        class: `tm-seg ${kind}${movable ? ' movable' : ''}`,
        style: `--c:${solid(b.cat)};--f:${faint(b.cat)}`,
        ...(isToday && { 'data-id': b.id }),
        ...(ahead && { 'data-date': day.date }),
        ...(movable && { 'data-row': r, 'data-start': b.start, 'data-dur': b.dur }),
      });
      for (const [s, dur] of pieces) {
        const x = X0 + (s / DAY) * W;
        const w = Math.max(3, (dur / DAY) * W - 3);
        g.append(svgEl('rect', { x: x.toFixed(1), y: y + 16, width: w.toFixed(1), height: ROW - 32, rx: 7 }));
        const name = fit(labelOf(b), w - 14, size);
        if (name) g.append(svgEl('text', { x: (x + 7).toFixed(1), y: y + ROW / 2 + size * 0.36 }, name));
      }
      svg.append(g);
    }
  }
  // now: one line through the week, its time at the top
  svg.append(
    svgEl('line', { class: 'tm-now', x1: nx, y1: TOP - 4, x2: nx, y2: TOP + ROW * 7 }),
    svgEl('rect', { class: 'tm-now-chip', x: nx - 40, y: TOP - 46, width: 80, height: 32, rx: 16 }),
    svgEl('text', { class: 'tm-now-text', x: nx, y: TOP - 24 }, hhmm(now)),
  );
  weekGeo.set(svg, { x0: X0, w: W, top: TOP, row: ROW, dayStart, dates, today });
  return svg;
}

/** How a task shows on its strip: done, still to do, or (on a day gone by) left undone. */
function stripKind(day: WeekDay, b: Block, now: number, dayStart: number): 'done' | 'plan' | 'missed' {
  if (b.done) return 'done';
  if (day.kind === 'past' || day.kind === 'carried') return 'missed';
  if (day.kind === 'today' && passedOf(b, now, dayStart) >= b.dur) return 'missed';
  return 'plan';
}

// ---- moving tasks between Today and the days ahead

/** A day's tasks as a list to change: Today's (live) or a day ahead's plan. */
const tasksOn = (date: string, today: string): PlanBlock[] | Block[] => (date === today ? state.blocks : planOn(date)?.blocks ?? []);
const clashes = (list: readonly { start: number; dur: number }[], t: { start: number; dur: number }) =>
  list.some((x) => mod(t.start - x.start) < x.dur || mod(x.start - t.start) < t.dur);

/** Everything a move changes, to put back with Undo. */
export interface MoveUndo { today: Block[]; plans: [string, PlanBlock[] | null, string][] }

/**
 * Moves (or, `copy`, copies) the task at `start` on `from` to `start2` on `to` — Today or a day ahead. Refused
 * when it would overlap a task there. Returns what to show, and how to undo it.
 */
export function moveTask(from: string, start: number, to: string, start2: number, copy: boolean, today: string): { msg: string; undo?: MoveUndo } {
  if (to < today) return { msg: 'Only Today and the days ahead can take tasks' };
  const src = tasksOn(from, today).find((b) => b.start === start);
  if (!src) return { msg: 'That task changed meanwhile' };
  if (from === to && start === start2) return { msg: '' };
  const moved = { ...src, start: mod(start2) };
  const same = from === to;
  const others = tasksOn(to, today).filter((b) => !(same && !copy && b.start === start));
  const hit = others.find((x) => clashes([x], moved));
  if (hit) return { msg: `Overlaps ${labelOf(hit)} ${hhmm(hit.start)}–${hhmm(hit.start + hit.dur)}` };
  const undo: MoveUndo = { today: state.blocks, plans: [] };
  const keep = (date: string) => {
    if (date !== today && !undo.plans.some(([d]) => d === date)) undo.plans.push([date, planOn(date)?.blocks ?? null, planOn(date)?.from ?? '']);
  };
  keep(from);
  keep(to);
  const write = (date: string, list: (Block | PlanBlock)[]) => {
    if (date === today) {
      setState({ blocks: list.map((b) => ('id' in b ? b : { ...b, id: newId(), done: false })) as Block[], draft: null });
    } else if (list.length) setPlan(date, list.map((b) => templateBlock(b)), planOn(date)?.from || 'By hand');
    else clearPlan(date);
  };
  // onto Today it is a new task (not started); onto a plan it keeps only what a plan holds
  const placed = to === today ? { ...templateBlock(moved), id: same && !copy && 'id' in src ? src.id : newId(), done: same && 'done' in src ? !!src.done : false } : templateBlock(moved);
  if (!same && !copy) write(from, tasksOn(from, today).filter((b) => b.start !== start));
  write(to, [...others, placed]);
  const when = `${to === today ? 'Today' : new Date(`${to}T00:00`).toLocaleDateString('en-US', { weekday: 'short' })} ${hhmm(moved.start)}`;
  return { msg: `${copy ? 'Copied' : 'Moved'} ${labelOf(src)} to ${when}`, undo };
}

export function undoMove(u: MoveUndo): void {
  setState({ blocks: u.today, draft: null });
  for (const [date, blocks, from] of u.plans) {
    if (blocks?.length) setPlan(date, blocks, from || 'By hand');
    else clearPlan(date);
  }
}

/**
 * Dragging on the week: a movable task follows the pointer (snapped to 15 minutes and to a day's strip) and is
 * dropped there; a press that doesn't move is a click. `drop` gets where it went.
 */
export function dragWeek(svg: SVGSVGElement, drop: (from: string, start: number, to: string, start2: number, copy: boolean) => void): void {
  const geo = weekGeo.get(svg);
  if (!geo) return;
  svg.addEventListener('pointerdown', (e) => {
    const seg = (e.target as Element).closest<SVGGElement>('.tm-seg.movable');
    if (!seg || e.button !== 0) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const toSvg = (ev: PointerEvent) => new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    const p0 = toSvg(e);
    const row = Number(seg.dataset.row);
    const start = Number(seg.dataset.start);
    const dur = Number(seg.dataset.dur);
    let moved = false;
    let target = { row, start };
    const ghost = seg.cloneNode(true) as SVGGElement;
    ghost.classList.add('ghost');
    ghost.removeAttribute('data-id');
    const label = svgEl('g', { class: 'tm-drag-label' });
    label.append(svgEl('rect', { rx: 8, height: 34, y: -46 }), svgEl('text', { y: -23 }));
    const move = (ev: PointerEvent) => {
      const p = toSvg(ev);
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 8) return;
      if (!moved) {
        moved = true;
        seg.classList.add('lifted');
        svg.append(ghost, label);
        svg.setPointerCapture(e.pointerId);
      }
      const dm = Math.round((((p.x - p0.x) / geo.w) * DAY) / SNAP) * SNAP;
      const dr = Math.round((p.y - p0.y) / geo.row);
      target = { row: Math.max(0, Math.min(6, row + dr)), start: mod(start + dm) };
      const tx = ((mod(target.start - geo.dayStart) - mod(start - geo.dayStart)) / DAY) * geo.w;
      ghost.setAttribute('transform', `translate(${tx.toFixed(1)} ${((target.row - row) * geo.row).toFixed(1)})`);
      const ok = geo.dates[target.row]! >= geo.today;
      ghost.classList.toggle('bad', !ok);
      const x = geo.x0 + (mod(target.start - geo.dayStart) / DAY) * geo.w;
      const y = geo.top + target.row * geo.row + 16;
      const text = `${DOW[new Date(`${geo.dates[target.row]}T00:00`).getDay()]} ${hhmm(target.start)}–${hhmm(target.start + dur)}${ev.altKey ? ' · copy' : ''}`;
      label.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      label.querySelector('text')!.textContent = text;
      label.querySelector('rect')!.setAttribute('width', String(textW(text, 18) + 24));
    };
    const end = (ev: PointerEvent) => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', end);
      svg.removeEventListener('pointercancel', end);
      if (!moved) return;
      // the click that follows a drag (if the browser sends one) is not a click on the task
      const eat = (c: Event) => c.stopPropagation();
      svg.addEventListener('click', eat, { capture: true });
      setTimeout(() => svg.removeEventListener('click', eat, { capture: true }), 0);
      seg.classList.remove('lifted');
      ghost.remove();
      label.remove();
      if (ev.type === 'pointerup') drop(geo.dates[row]!, start, geo.dates[target.row]!, target.start, ev.altKey);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  });
}

// ---- yesterday's unfinished tasks

/** Yesterday's tasks left undone (for the week's carry-over bar). */
export async function unfinishedYesterday(today: string): Promise<{ date: string; tasks: Block[] }> {
  const date = shiftDate(today, -1);
  const day = await loadDay(date);
  return { date, tasks: day.kind === 'past' ? day.blocks.filter((b) => !b.done) : [] };
}

/** Puts `tasks` on `date` (Today or a day ahead) where they fit; returns how many went on and how many didn't. */
export function carryOver(tasks: readonly Block[], date: string, today: string): { added: number; skipped: number } {
  const list: (Block | PlanBlock)[] = [...tasksOn(date, today)];
  let added = 0;
  for (const t of tasks) {
    if (clashes(list, t)) continue;
    list.push(date === today ? { ...templateBlock(t), id: newId(), done: false } : templateBlock(t));
    added++;
  }
  if (added) {
    if (date === today) setState({ blocks: list as Block[], draft: null });
    else setPlan(date, list.map((b) => templateBlock(b)), planOn(date)?.from || 'Carried over');
  }
  return { added, skipped: tasks.length - added };
}

// ---------------------------------------------------------------- dots: the month, and Today in quarter hours

/** A day as dots of `step` minutes from the New day time: done in its colour, planned faint, free blank. */
function dayDots(blocks: readonly Block[], step: number, dayStart: number, ahead: boolean): { fill: string; id: string | null; cls: string }[] {
  return Array.from({ length: DAY / step }, (_, k) => {
    const b = at(blocks, dayStart + k * step + step / 2);
    if (!b) return { fill: '', id: null, cls: 'free' };
    return { fill: b.done ? solid(b.cat) : faint(b.cat), id: b.id, cls: b.done ? 'done' : ahead ? 'ahead' : 'plan' };
  });
}

export async function monthDots(today: string, dayStart: number, compact: boolean): Promise<SVGSVGElement> {
  const d0 = new Date(`${today}T00:00`);
  const first = new Date(d0.getFullYear(), d0.getMonth(), 1);
  const count = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
  const dates = Array.from({ length: count }, (_, i) => `${today.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
  const days = await Promise.all(dates.map(loadDay));
  const half = compact ? 460 : 520;
  const svg = frame('tm-dots', 'This month in dots', half, compact);
  const lead = first.getDay();
  const rows = Math.ceil((lead + count) / 7);
  const GAP = compact ? 6 : 10;
  const CW = (half * 2 - 20 - GAP * 6) / 7;
  const X0 = -((CW * 7 + GAP * 6) / 2);
  const CH = CW * 0.7;
  const TOP = -half + 10;
  svg.append(svgEl('text', { class: 'tm-month', x: X0, y: TOP + 26 }, d0.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })));
  for (let i = 0; i < 7; i++) svg.append(svgEl('text', { class: `tm-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`, x: X0 + i * (CW + GAP) + CW / 2, y: TOP + 66 }, compact ? DOW[i]!.charAt(0) : DOW[i]!));
  const gridTop = TOP + 84;
  for (const [i, day] of days.entries()) {
    const cell = lead + i;
    const x = X0 + (cell % 7) * (CW + GAP);
    const y = gridTop + Math.floor(cell / 7) * (CH + GAP);
    const isToday = day.date === today;
    const g = svgEl('g', { class: 'tm-day', 'data-date': day.date, role: 'button', 'aria-label': `Open ${day.date}`, tabindex: 0 });
    g.append(svgEl('rect', { class: `tm-cell${isToday ? ' today' : ''}`, x, y, width: CW, height: CH, rx: compact ? 10 : 14 }));
    g.append(svgEl('text', { class: `tm-num${isToday ? ' today' : ''}`, x: x + (compact ? 8 : 12), y: y + (compact ? 24 : 28) }, String(i + 1)));
    const dots = day.blocks.length ? dayDots(day.blocks, 30, dayStart, day.date > today) : [];
    const S = (CW - (compact ? 12 : 20)) / 12;
    const dy = CH - S * 4 - (compact ? 6 : 8);
    for (let k = 0; k < 48; k++) {
      const dot = dots[k];
      g.append(svgEl('circle', {
        class: `tm-dot ${dot?.cls ?? 'free'}`,
        cx: (x + (compact ? 6 : 10) + S * (k % 12) + S / 2).toFixed(1),
        cy: (y + dy + S * Math.floor(k / 12) + S / 2).toFixed(1),
        r: (S * (compact ? 0.4 : 0.36)).toFixed(1),
        ...(dot?.fill && { style: `fill:${dot.fill}` }),
      }));
    }
    svg.append(g);
  }
  // Today, large: 96 quarter hours, four rows of six hours
  const big = dayDots(days.find((d) => d.date === today)?.blocks ?? [], 15, dayStart, false);
  const by = gridTop + rows * (CH + GAP) + (compact ? 40 : 34);
  const span = CW * 7 + GAP * 6;
  const cols = compact ? 16 : 24;
  // as large as the room left under the month allows
  const S = Math.min(span / cols, (half - by - 40) / ((DAY / 15 / cols) * 0.86));
  svg.append(svgEl('text', { class: 'tm-month small', x: X0, y: by }, `Today from ${hhmm(dayStart)} · a dot is 15 min`));
  for (const [k, dot] of big.entries()) {
    svg.append(svgEl('circle', {
      class: `tm-dot big ${dot.cls}`,
      ...(dot.id && { 'data-id': dot.id }),
      cx: (X0 + S * (k % cols) + S / 2).toFixed(1),
      cy: (by + 22 + S * 0.86 * Math.floor(k / cols) + S / 2).toFixed(1),
      r: (S * 0.34).toFixed(1),
      ...(dot.fill && { style: `fill:${dot.fill}` }),
    }));
  }
  return svg;
}
