import { type Feature, featureOn, onFeatures } from './features';
import { VIEW_ORDER, type View } from './router';

/**
 * The pages' order in the rail, the overview and the title bar, and where the rule between them sits: the
 * pages above the rule turn by wheel or swipe (Today and Calendar to begin with), the ones below open from the
 * rail. Pages and the rule are dragged into place (see page-drag); remembered per browser.
 */
export const RULE = 'rule';
export type Slot = View | typeof RULE;

const KEY = 'haru:page-order';
const listeners = new Set<() => void>();

let order: View[] = [...VIEW_ORDER];
/** How many pages sit above the rule. */
let split = 2;
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { order?: unknown; split?: unknown } | null;
  const known = Array.isArray(saved?.order) ? saved.order.filter((v): v is View => VIEW_ORDER.includes(v as View)) : [];
  // pages added since it was saved go at the end
  if (known.length) order = [...new Set([...known, ...VIEW_ORDER])];
  if (typeof saved?.split === 'number' && saved.split >= 0 && saved.split <= order.length) split = saved.split;
} catch {
  // the default order
}

const shown = (v: View) => v === 'today' || featureOn(v as Feature);
export const pageOrder = (): readonly View[] => order;
/** The pages that turn by wheel or swipe, top to bottom (switched-off ones left out). */
export const swipeViews = (): View[] => order.slice(0, split).filter(shown);
/** Pages and the rule, top to bottom. */
export const layout = (): Slot[] => [...order.slice(0, split), RULE, ...order.slice(split)];

export function onPageOrder(fn: () => void): void {
  listeners.add(fn);
}

export function setLayout(slots: readonly Slot[]): void {
  order = slots.filter((s): s is View => s !== RULE);
  split = Math.max(0, slots.indexOf(RULE));
  try {
    localStorage.setItem(KEY, JSON.stringify({ order, split }));
  } catch {
    // for this visit only
  }
  apply();
  listeners.forEach((fn) => fn());
}

/** The lists that show the pages: each holds `[data-view]` links and one `[data-split]` rule. */
const lists = (): { list: HTMLElement; before: Element | null }[] =>
  [
    { list: document.getElementById('rail'), before: document.querySelector('#rail .rail-fill') },
    { list: document.querySelector<HTMLElement>('.panel-left .nav'), before: null },
    { list: document.querySelector<HTMLElement>('.tb-tabs'), before: null },
  ].flatMap((x) => (x.list ? [{ list: x.list, before: x.before }] : []));

/**
 * Puts every list in the saved order. The rule goes when the pages on one side of it are all switched off; at an
 * end of the list it stays, to be dragged back.
 */
export function apply(): void {
  const allOff = (side: View[]) => side.length > 0 && !side.some(shown);
  const lone = allOff(order.slice(0, split)) || allOff(order.slice(split));
  for (const { list, before } of lists()) {
    for (const slot of layout()) {
      const el = list.querySelector<HTMLElement>(slot === RULE ? ':scope > [data-split]' : `:scope > [data-view="${slot}"]`);
      if (el) list.insertBefore(el, before);
    }
    const rule = list.querySelector<HTMLElement>(':scope > [data-split]');
    if (rule) rule.hidden = lone;
  }
}

export function mountPageOrder(): void {
  apply();
  onFeatures(apply);
}
