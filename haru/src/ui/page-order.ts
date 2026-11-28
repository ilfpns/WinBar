import { type Feature, featureOn, onFeatures } from './features';
import { VIEW_ORDER, currentView, onView, type View } from './router';

/**
 * The pages' order in the rail, the overview and the title bar. Today, Journal and Calendar are the tabs: always
 * first, in that order, and the only pages that turn by wheel or swipe. The rest follow in the saved order (dragged
 * in the overview, see page-drag) and, in the rail, sit behind the All button (mountRailAll). Remembered per browser.
 */
export const RULE = 'rule';
export type Slot = View | typeof RULE;
export const TABS: readonly View[] = ['today', 'journal', 'calendar'];
const isTab = (v: View) => TABS.includes(v);

const KEY = 'haru:page-order';
const listeners = new Set<() => void>();

let rest: View[] = VIEW_ORDER.filter((v) => !isTab(v));
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { order?: unknown } | null;
  const known = Array.isArray(saved?.order) ? saved.order.filter((v): v is View => VIEW_ORDER.includes(v as View) && !isTab(v as View)) : [];
  // pages added since it was saved go at the end
  if (known.length) rest = [...new Set([...known, ...rest])];
} catch {
  // the default order
}

const shown = (v: View) => v === 'today' || featureOn(v as Feature);
export const pageOrder = (): readonly View[] => [...TABS, ...rest];
/** The pages that turn by wheel or swipe, top to bottom (switched-off ones left out). */
export const swipeViews = (): View[] => TABS.filter(shown);
/** Pages and the rule, top to bottom. */
export const layout = (): Slot[] => [...TABS, RULE, ...rest];

export function onPageOrder(fn: () => void): void {
  listeners.add(fn);
}

/** A new order for the pages after the tabs (the tabs keep their place). */
export function setLayout(slots: readonly Slot[]): void {
  rest = slots.filter((s): s is View => s !== RULE && !isTab(s));
  try {
    localStorage.setItem(KEY, JSON.stringify({ order: rest }));
  } catch {
    // for this visit only
  }
  apply();
  listeners.forEach((fn) => fn());
}

/** The lists that show every page as `[data-view]` links. */
const lists = (): HTMLElement[] =>
  [document.querySelector<HTMLElement>('.panel-left .nav'), document.querySelector<HTMLElement>('.tb-tabs')].filter((l) => !!l);

/** Puts every list in order: in the rail the tabs above the All button, the other pages in its menu. */
export function apply(): void {
  for (const list of lists()) {
    for (const v of pageOrder()) {
      const el = list.querySelector<HTMLElement>(`:scope > [data-view="${v}"]`);
      if (el) list.append(el);
    }
  }
  const rail = document.getElementById('rail');
  const all = document.getElementById('rail-all');
  const menu = document.getElementById('rail-all-menu');
  if (!rail || !all || !menu) return;
  for (const v of TABS) {
    const el = document.querySelector<HTMLElement>(`#rail [data-view="${v}"], #rail-all-menu [data-view="${v}"]`);
    if (el) rail.insertBefore(el, all);
  }
  for (const v of rest) {
    const el = document.querySelector<HTMLElement>(`#rail [data-view="${v}"], #rail-all-menu [data-view="${v}"]`);
    if (el) menu.append(el);
  }
}

export function mountPageOrder(): void {
  apply();
  onFeatures(apply);
}

/**
 * The All button at the end of the tabs: hovering it (or a click, on touch) opens a menu of every other page —
 * switched-off ones too, so nothing is out of reach. The menu lives outside the rail so the rail's scroll never
 * clips it, and sits beside the button (above it when the rail is a tab bar along the bottom).
 */
export function mountRailAll(): void {
  const rail = document.getElementById('rail');
  const btn = document.getElementById('rail-all');
  const menu = document.getElementById('rail-all-menu');
  if (!rail || !btn || !menu) return;
  let closeTimer = 0;

  const place = () => {
    const r = btn.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    if (rr.width > rr.height) {
      // the rail is a bottom tab bar: open upward
      menu.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - m.width / 2, innerWidth - m.width - 8))}px`;
      menu.style.top = `${Math.max(8, r.top - m.height - 10)}px`;
    } else {
      menu.style.left = `${rr.right + 10}px`;
      menu.style.top = `${Math.max(8, Math.min(r.top, innerHeight - m.height - 8))}px`;
    }
  };
  const open = () => {
    clearTimeout(closeTimer);
    if (!menu.hidden) return;
    // names next to the icons, in the language the labels are in now
    for (const a of menu.querySelectorAll<HTMLElement>('[data-view]')) {
      let name = a.querySelector<HTMLElement>(':scope > .rail-all-name');
      if (!name) a.append((name = Object.assign(document.createElement('span'), { className: 'rail-all-name' })));
      name.textContent = a.getAttribute('aria-label') ?? '';
    }
    menu.hidden = false;
    place();
    btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => menu.classList.add('on'));
  };
  const close = () => {
    clearTimeout(closeTimer);
    menu.classList.remove('on');
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  // a short grace, so the pointer can cross the gap between the button and the menu
  const closeSoon = () => {
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(close, 160);
  };

  for (const el of [btn, menu]) {
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') open();
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') closeSoon();
    });
  }
  btn.addEventListener('click', () => (menu.hidden ? open() : btn.matches(':hover') ? undefined : close()));
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-view]')) close();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !(e.target as Element).closest('#rail-all, #rail-all-menu')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      close();
      btn.focus();
    }
  });
  addEventListener('resize', close);
  // the button lights up while the page you are on is one of its pages
  const mark = (v: View) => btn.classList.toggle('holds-current', !isTab(v));
  onView(mark);
  mark(currentView());
}
