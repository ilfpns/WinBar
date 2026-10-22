/**
 * Small pickers that float over everything (the time picker, the class picker, the chat's emoji): the browser's
 * popover where it has one (Chrome 114+, Safari 17+, Firefox 125+), the same behaviour by hand where it doesn't
 * — fixed on top, closed by a click outside or Esc. Either way a picker opened from inside a modal dialog lives
 * inside that dialog, since a modal dialog leaves everything outside it unclickable (Safari applies that to
 * popovers too).
 */
export const nativePopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

const toggles = new WeakMap<HTMLElement, ((open: boolean) => void)[]>();
const openByHand = new Set<HTMLElement>();
/** The button each hand-made picker was opened from (a press on it toggles, it isn't "outside"). */
const openers = new WeakMap<HTMLElement, Element>();
/** When each picker last closed: the browser closes it on the press of its own button, before that button's
 *  click would open it again — so a click on the same button right after reads as "close", not "open". */
const closedAt = new WeakMap<HTMLElement, number>();

/** Makes `el` a picker (closed to begin with). */
export function asPopover(el: HTMLElement): void {
  if (nativePopover) {
    el.popover = 'auto';
    // the moment it closes, as it happens ("toggle" comes later, after the click that would reopen it)
    el.addEventListener('beforetoggle', (e) => {
      if ((e as ToggleEvent).newState === 'closed') closedAt.set(el, performance.now());
    });
    el.addEventListener('toggle', (e) => (toggles.get(el) ?? []).forEach((fn) => fn((e as ToggleEvent).newState === 'open')));
  } else {
    el.classList.add('pop-fb');
    el.hidden = true;
  }
}

/** Called with true when it opens and false when it closes (however that happened). */
export function onPopToggle(el: HTMLElement, fn: (open: boolean) => void): void {
  toggles.set(el, [...(toggles.get(el) ?? []), fn]);
}

export const isPopOpen = (el: HTMLElement): boolean => (nativePopover ? el.matches(':popover-open') : openByHand.has(el));

/** Whether any picker is open (Esc closes that first). */
export const anyPopOpen = (): boolean => (nativePopover ? !!document.querySelector(':popover-open') : openByHand.size > 0);

/**
 * Opens the picker; `from` (the button that opened it) decides where it lives: in its dialog, or in the page.
 * False when it didn't open (a second press on its own button, which closes it).
 */
export function showPop(el: HTMLElement, from?: Element): boolean {
  const host = from?.closest('dialog') ?? document.body;
  if (el.parentElement !== host) host.append(el);
  if (nativePopover) {
    if (from && openers.get(el) === from && performance.now() - (closedAt.get(el) ?? -1e9) < 300) return false;
    if (from) openers.set(el, from);
    if (!el.matches(':popover-open')) el.showPopover();
    return true;
  }
  if (openByHand.has(el)) return true;
  // like popover="auto": opening one closes the others
  for (const other of [...openByHand]) hidePop(other);
  el.hidden = false;
  openByHand.add(el);
  if (from) openers.set(el, from);
  (toggles.get(el) ?? []).forEach((fn) => fn(true));
  return true;
}

export function hidePop(el: HTMLElement): void {
  if (nativePopover) {
    if (el.matches(':popover-open')) el.hidePopover();
    return;
  }
  if (!openByHand.delete(el)) return;
  el.hidden = true;
  (toggles.get(el) ?? []).forEach((fn) => fn(false));
}

if (!nativePopover && typeof document !== 'undefined') {
  // a press outside an open picker closes it (the press that opened it reaches here first, before it opens)
  document.addEventListener('pointerdown', (e) => {
    for (const el of [...openByHand]) {
      if (el.contains(e.target as Node) || openers.get(el)?.contains(e.target as Node)) continue;
      hidePop(el);
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openByHand.size) return;
    e.stopPropagation();
    for (const el of [...openByHand]) hidePop(el);
  }, true);
}
