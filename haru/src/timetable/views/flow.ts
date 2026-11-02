import { icon } from '../../ui/icons';
import { type Block, type Category, CATEGORIES, CATEGORY_KEYS, labelOf, passedOf, statusOf } from '../model';
import { CATEGORY_ICON } from '../overview';
import { addBlock, cycleStatus, openDraft, state } from '../state';
import { DAY, SNAP, formatDuration, hhmm, mod, nowMinutes } from '../time';
import { resetAt } from '../day-reset';

/**
 * Flow: the day as a diagram — each task a card, in time order from the New day time, wired to the next one.
 * Cards run left to right and turn down at the edge, the next row coming back (so the wire never jumps across).
 * A wire says how long is free between two tasks; what has passed is lit, the task on now glows, the wire into
 * it carries a moving pulse. The + on a wire with room adds a task right there in the diagram (a name, a length,
 * a category; Enter), the + at the end after the last one. A card's check cycles its status; the card opens it
 * in the editor.
 */
const CARD_W = 232;
const CARD_H = 104;
const GAP_X = 86;
const GAP_Y = 74;
const LENGTHS = [15, 30, 60, 90, 120];

interface Slot { start: number; room: number }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const svgNs = 'http://www.w3.org/2000/svg';

export interface Flow {
  el: HTMLElement;
  /** Redraws; `enter` (coming into view) lets the cards come in one after another. */
  render(enter?: boolean): void;
}

export function createFlow(): Flow {
  const root = el('div', 'flow');
  const scroller = el('div', 'flow-scroll');
  const canvas = el('div', 'flow-canvas');
  const wires = document.createElementNS(svgNs, 'svg');
  wires.classList.add('flow-wires');
  canvas.append(wires);
  scroller.append(canvas);
  const hint = el('p', 'flow-hint');
  root.append(scroller, hint);

  /** The task being added: where it starts and how long it can be. */
  let adding: (Slot & { after: string | null }) | null = null;
  let draft = { title: '', dur: 60, cat: state.lastCat as Category };
  let error = '';

  const ordered = (dayStart: number) => [...state.blocks].sort((a, b) => mod(a.start - dayStart) - mod(b.start - dayStart));
  /** The free time after `a` until `b` (or, after the last task, until the day comes round again). */
  const freeAfter = (a: Block, b: Block | undefined, first: Block | undefined, dayStart: number): Slot => {
    const end = a.start + a.dur;
    const until = b ? b.start : first ? first.start : dayStart;
    const room = mod(until - end) || (b ? 0 : DAY - state.blocks.reduce((m, x) => m + x.dur, 0));
    return { start: mod(end), room };
  };

  function startAdding(slot: Slot, after: string | null): void {
    adding = { ...slot, after };
    const fits = LENGTHS.filter((m) => m <= slot.room);
    draft = { title: '', dur: fits.includes(60) ? 60 : fits.at(-1) ?? Math.max(SNAP, slot.room), cat: state.lastCat as Category };
    error = '';
    render();
    root.querySelector<HTMLInputElement>('.flow-new input')?.focus();
  }

  function addCard(): HTMLElement {
    const c = el('div', 'flow-node flow-new');
    const top = el('div', 'flow-new-top');
    const input = el('input');
    input.placeholder = 'New task';
    input.value = draft.title;
    input.maxLength = 80;
    input.setAttribute('aria-label', 'Task name');
    input.addEventListener('input', () => (draft.title = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        adding = null;
        render();
      }
    });
    const more = el('button', 'flow-mini', 'More');
    more.type = 'button';
    more.title = 'Open in the editor';
    more.addEventListener('click', () => {
      const a = adding!;
      adding = null;
      openDraft({ id: null, title: draft.title, cat: draft.cat, done: false, start: a.start, dur: draft.dur });
    });
    top.append(input, more);
    const lens = el('div', 'flow-lens');
    for (const m of LENGTHS.filter((x) => x <= adding!.room)) {
      const b = el('button', 'flow-len', formatDuration(m));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(m === draft.dur));
      b.addEventListener('click', () => {
        draft.dur = m;
        render();
        root.querySelector<HTMLInputElement>('.flow-new input')?.focus();
      });
      lens.append(b);
    }
    const cats = el('div', 'flow-cats');
    for (const k of CATEGORY_KEYS) {
      const b = el('button', 'flow-cat');
      b.type = 'button';
      b.style.setProperty('--c', `var(--cat-${k})`);
      b.setAttribute('aria-label', CATEGORIES[k]);
      b.title = CATEGORIES[k];
      b.setAttribute('aria-pressed', String(k === draft.cat));
      b.append(icon(CATEGORY_ICON[k]));
      b.addEventListener('click', () => {
        draft.cat = k;
        render();
        root.querySelector<HTMLInputElement>('.flow-new input')?.focus();
      });
      cats.append(b);
    }
    const when = el('span', 'flow-time', `${hhmm(adding!.start)}–${hhmm(adding!.start + draft.dur)}`);
    c.append(top, lens, cats, when);
    if (error) c.append(el('span', 'flow-err', error));
    return c;
  }

  function commit(): void {
    const at = adding;
    if (!at) return;
    // let go first: the state change redraws the diagram with the new task in place
    adding = null;
    const err = addBlock({ id: null, title: draft.title.trim(), cat: draft.cat, done: false, start: at.start, dur: draft.dur });
    if (err) {
      adding = at;
      error = err;
      render();
    }
  }

  function taskCard(b: Block, now: number, dayStart: number): HTMLElement {
    const live = mod(now - b.start) < b.dur;
    const past = passedOf(b, now, dayStart) >= b.dur;
    const st = statusOf(b);
    const c = el('div', `flow-node${live ? ' live' : ''}${past ? ' past' : ''} ${st}`);
    c.style.setProperty('--c', `var(--cat-${b.cat})`);
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', `${labelOf(b)}, ${hhmm(b.start)} to ${hhmm(b.start + b.dur)}, ${st === 'done' ? 'done' : st === 'doing' ? 'in progress' : 'not started'}`);
    const ic = el('span', 'flow-ic');
    ic.append(icon(CATEGORY_ICON[b.cat]));
    const text = el('span', 'flow-text');
    text.append(el('strong', '', labelOf(b)), el('span', 'flow-sub', `${hhmm(b.start)}–${hhmm(b.start + b.dur)} · ${formatDuration(b.dur)}`));
    const check = el('button', `flow-check ${st}`);
    check.type = 'button';
    check.setAttribute('aria-label', st === 'done' ? 'Mark not started' : st === 'doing' ? 'Mark done' : 'Start');
    check.title = st === 'done' ? 'Done' : st === 'doing' ? 'In progress · click when done' : 'Not started · click to start';
    check.append(icon(st === 'done' ? 'check' : st === 'doing' ? 'hourglass' : 'circle-dashed'));
    check.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleStatus(b.id);
    });
    c.append(el('i', 'flow-port in'), ic, text, check, el('i', 'flow-port out'));
    if (live) {
      const left = Math.ceil(b.dur - mod(now - b.start));
      const bar = el('span', 'flow-progress');
      bar.style.setProperty('--p', String(mod(now - b.start) / b.dur));
      c.append(bar, el('span', 'flow-left', `${formatDuration(left)} left`));
    }
    const edit = () => openDraft({ ...b });
    c.addEventListener('click', edit);
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        edit();
      }
    });
    return c;
  }

  function render(enter = false): void {
    root.classList.toggle('enter', enter);
    const dayStart = resetAt() ?? 0;
    const now = nowMinutes();
    const list = ordered(dayStart);
    // the sequence: tasks, with the card being added slotted in after the task it follows
    type Node = { kind: 'task'; b: Block } | { kind: 'new' } | { kind: 'end' };
    const nodes: Node[] = [];
    if (adding && adding.after === null) nodes.push({ kind: 'new' });
    for (const b of list) {
      nodes.push({ kind: 'task', b });
      if (adding?.after === b.id) nodes.push({ kind: 'new' });
    }
    if (!adding) nodes.push({ kind: 'end' });

    const width = Math.max(scroller.clientWidth, CARD_W + 40);
    // room either side for the wire turning down to the next row
    const cols = Math.max(1, Math.floor((width - 2 * 60 + GAP_X) / (CARD_W + GAP_X)));
    root.classList.toggle('one', cols === 1);
    const usedW = cols * CARD_W + (cols - 1) * GAP_X;
    const left0 = Math.max(cols === 1 ? 12 : 60, (width - Math.min(usedW, nodes.length * (CARD_W + GAP_X) - GAP_X)) / 2);
    const pos = nodes.map((_, i) => {
      const row = Math.floor(i / cols);
      const k = i % cols;
      const col = row % 2 ? cols - 1 - k : k;
      return { x: left0 + col * (CARD_W + GAP_X), y: 28 + row * (CARD_H + GAP_Y), row };
    });
    const rows = Math.ceil(nodes.length / cols);
    canvas.style.height = `${rows * (CARD_H + GAP_Y) - GAP_Y + 56}px`;

    canvas.querySelectorAll('.flow-node, .flow-label, .flow-plus, .flow-end').forEach((n) => n.remove());
    wires.replaceChildren();
    wires.setAttribute('width', String(width));
    wires.setAttribute('height', canvas.style.height.replace('px', ''));

    nodes.forEach((n, i) => {
      const p = pos[i]!;
      let card: HTMLElement;
      if (n.kind === 'task') card = taskCard(n.b, now, dayStart);
      else if (n.kind === 'new') card = addCard();
      else {
        card = el('button', 'flow-node flow-end');
        (card as HTMLButtonElement).type = 'button';
        card.append(icon('plus'), el('span', '', list.length ? 'Add after' : 'Add the first task'));
        const last = list.at(-1);
        const slot: Slot = last ? freeAfter(last, undefined, list[0], dayStart) : { start: Math.ceil(now / SNAP) * SNAP % DAY, room: DAY - SNAP };
        card.addEventListener('click', () => startAdding(slot, last?.id ?? null));
        (card as HTMLButtonElement).disabled = slot.room < SNAP;
      }
      card.style.transform = `translate(${p.x}px, ${p.y}px)`;
      card.style.setProperty('--i', String(i));
      canvas.append(card);
    });

    // the wires: from one card's out port to the next one's in port
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = pos[i]!;
      const b = pos[i + 1]!;
      const na = nodes[i]!;
      const nb = nodes[i + 1]!;
      const sameRow = a.row === b.row;
      const dir = a.row % 2 ? -1 : 1;
      let d: string;
      let mid: { x: number; y: number };
      if (cols === 1) {
        // one column (a phone): straight down from one card to the next
        const x = a.x + CARD_W / 2;
        const y1 = a.y + CARD_H;
        const y2 = b.y;
        d = `M${x},${y1} L${x},${y2}`;
        mid = { x: x + 70, y: (y1 + y2) / 2 - 8 };
      } else if (sameRow) {
        const x1 = dir > 0 ? a.x + CARD_W : a.x;
        const x2 = dir > 0 ? b.x : b.x + CARD_W;
        const y = a.y + CARD_H / 2;
        const k = (x2 - x1) / 2;
        d = `M${x1},${y} C${x1 + k},${y} ${x2 - k},${y} ${x2},${y}`;
        mid = { x: (x1 + x2) / 2, y };
      } else {
        // down the edge to the row below, coming in from the same side
        const x = dir > 0 ? a.x + CARD_W : a.x;
        const y1 = a.y + CARD_H / 2;
        const y2 = b.y + CARD_H / 2;
        const out = dir * 52;
        d = `M${x},${y1} C${x + out},${y1} ${x + out},${y2} ${x},${y2}`;
        mid = { x: x + out * 0.75, y: (y1 + y2) / 2 };
      }
      const lit = na.kind === 'task' && passedOf(na.b, now, dayStart) >= na.b.dur;
      const into = nb.kind === 'task' && mod(now - nb.b.start) < nb.b.dur;
      for (const cls of ['flow-wire-glow', 'flow-wire']) {
        const path = document.createElementNS(svgNs, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', `${cls}${lit ? ' lit' : ''}${into ? ' into' : ''}${nb.kind !== 'task' ? ' soft' : ''}`);
        wires.append(path);
      }
      if (into) {
        const pulse = document.createElementNS(svgNs, 'path');
        pulse.setAttribute('d', d);
        pulse.setAttribute('class', 'flow-pulse');
        wires.append(pulse);
      }
      // what lies between: the free time, and a + where a task fits
      if (na.kind === 'task' && nb.kind === 'task') {
        const slot = freeAfter(na.b, nb.b, list[0], dayStart);
        const label = el('span', `flow-label${slot.room ? '' : ' tight'}`, slot.room ? `${formatDuration(slot.room)} free` : 'next');
        label.style.transform = `translate(${mid.x}px, ${mid.y}px) translate(-50%, -150%)`;
        canvas.append(label);
        if (slot.room >= SNAP) {
          const plus = el('button', 'flow-plus');
          plus.type = 'button';
          plus.setAttribute('aria-label', `Add a task at ${hhmm(slot.start)}`);
          plus.title = `Add at ${hhmm(slot.start)}`;
          plus.append(icon('plus'));
          plus.style.transform = `translate(${mid.x}px, ${mid.y}px) translate(-50%, 40%)`;
          plus.addEventListener('click', () => startAdding(slot, na.b.id));
          canvas.append(plus);
        }
      }
    }
    const left = state.blocks.filter((b) => !b.done).length;
    hint.textContent = list.length ? `${list.length} tasks · ${left ? `${left} to go` : 'all done'}` : '';
  }

  // the canvas follows the width it has
  let lastW = 0;
  new ResizeObserver(() => {
    if (!root.isConnected || Math.abs(scroller.clientWidth - lastW) < 8) return;
    lastW = scroller.clientWidth;
    render();
  }).observe(scroller);
  // a click outside the card being added lets it go
  root.addEventListener('pointerdown', (e) => {
    if (!adding || (e.target as Element).closest('.flow-new, .flow-plus, .flow-end')) return;
    adding = null;
    render();
  });

  return { el: root, render };
}
