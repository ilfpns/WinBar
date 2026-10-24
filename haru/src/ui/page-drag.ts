import { RULE, type Slot, layout, setLayout } from './page-order';
import { lessMotion } from './motion';

/**
 * Dragging pages — and the rule between them — into another order, in the rail and the overview. A press that
 * moves a few pixels picks the item up: it follows the pointer while the others slide aside to make room, and on
 * release everything glides into its new place (transform only). A plain click still opens the page.
 */
const PICK = 6; // px of travel before a press becomes a drag
const EASE = 'cubic-bezier(.22, 1, .36, 1)';

const slotOf = (el: HTMLElement): Slot => (el.dataset.split !== undefined ? RULE : (el.dataset.view as Slot));
const move = (axis: 'x' | 'y', d: number) => `translate3d(${axis === 'x' ? d : 0}px, ${axis === 'y' ? d : 0}px, 0)`;

/** Puts the visible slots in their new order; switched-off pages stay next to the page they followed. */
function merge(visible: Slot[]): Slot[] {
  const full = layout();
  const lead: Slot[] = [];
  const trail = new Map<Slot, Slot[]>();
  let last: Slot | null = null;
  for (const s of full) {
    if (visible.includes(s)) {
      last = s;
      trail.set(s, []);
    } else if (last === null) lead.push(s);
    else trail.get(last)!.push(s);
  }
  return [...lead, ...visible.flatMap((s) => [s, ...(trail.get(s) ?? [])])];
}

export function makeSortable(list: HTMLElement): void {
  let press: { el: HTMLElement; x: number; y: number; id: number } | null = null;
  let drag: { el: HTMLElement; items: HTMLElement[]; from: number; to: number; axis: 'x' | 'y'; span: number; centers: number[] } | null = null;
  let swallow = false;

  /** The pages and the rule as they show (switched-off ones and a hidden rule left out). */
  const items = () =>
    [...list.querySelectorAll<HTMLElement>(':scope > [data-view], :scope > [data-split]')].filter((el) => el.getClientRects().length);

  // links would otherwise start the browser's own drag
  list.addEventListener('dragstart', (e) => {
    if ((e.target as Element).closest?.('[data-view]')) e.preventDefault();
  });

  list.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = (e.target as Element).closest<HTMLElement>('[data-view], [data-split]');
    if (!el || el.parentElement !== list) return;
    press = { el, x: e.clientX, y: e.clientY, id: e.pointerId };
  });

  function begin(): void {
    const { el, id } = press!;
    const all = items();
    const rects = all.map((it) => it.getBoundingClientRect());
    // which way the list runs, from where its items actually sit (a grid or a flex column alike)
    const [a, b] = [rects[0]!, rects[rects.length - 1]!];
    const row = Math.abs(b.left - a.left) > Math.abs(b.top - a.top);
    const axis = row ? 'x' : 'y';
    const from = all.indexOf(el);
    const r = rects[from]!;
    const cs = getComputedStyle(el);
    const gap = parseFloat(getComputedStyle(list)[row ? 'columnGap' : 'rowGap']) || 0;
    // how far the others step aside: the dragged item's whole slot, margins and gap included
    const span = row
      ? r.width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight) + gap
      : r.height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom) + gap;
    drag = { el, items: all, from, to: from, axis, span, centers: rects.map((q) => (row ? q.left + q.width / 2 : q.top + q.height / 2)) };
    list.setPointerCapture(id);
    list.classList.add('sorting');
    el.classList.add('dragging');
  }

  list.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < PICK) return;
      begin();
    }
    const d = drag!;
    // kept within the list, from the first item's place to the last's
    const raw = d.axis === 'x' ? e.clientX - press.x : e.clientY - press.y;
    const delta = Math.max(d.centers[0]! - d.centers[d.from]!, Math.min(d.centers[d.centers.length - 1]! - d.centers[d.from]!, raw));
    d.el.style.transform = move(d.axis, delta);
    const c = d.centers[d.from]! + delta;
    d.to = d.centers.filter((x, i) => i !== d.from && x < c).length;
    d.items.forEach((it, i) => {
      if (it === d.el) return;
      const shift = d.from < d.to && i > d.from && i <= d.to ? -d.span : d.from > d.to && i >= d.to && i < d.from ? d.span : 0;
      it.style.transform = shift ? move(d.axis, shift) : '';
    });
  });

  function end(cancel: boolean): void {
    press = null;
    const d = drag;
    if (!d) return;
    drag = null;
    // the click that follows the release must not open the page
    swallow = true;
    setTimeout(() => (swallow = false), 0);
    const before = new Map(d.items.map((it) => [it, it.getBoundingClientRect()]));
    list.classList.remove('sorting');
    d.el.classList.remove('dragging');
    for (const it of d.items) it.style.transform = '';
    if (!cancel && d.to !== d.from) {
      const seq = d.items.map(slotOf);
      const [moved] = seq.splice(d.from, 1);
      seq.splice(d.to, 0, moved!);
      setLayout(merge(seq));
    }
    if (lessMotion()) return;
    // from where each item was drawn to its new place
    for (const it of d.items) {
      const a = before.get(it)!;
      const b = it.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      it.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'none' }], { duration: it === d.el ? 280 : 220, easing: EASE });
    }
  }
  list.addEventListener('pointerup', () => end(false));
  list.addEventListener('pointercancel', () => end(true));
  list.addEventListener('lostpointercapture', () => end(false));
  list.addEventListener('click', (e) => {
    if (!swallow) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
