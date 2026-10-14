export type View = 'today' | 'calendar' | 'news';

/** Views are stacked like pages: Today on top, then Calendar, then News. */
export const VIEW_ORDER: View[] = ['today', 'calendar', 'news'];

type Listener = (view: View, prev: View | null) => void;
const listeners = new Set<Listener>();

export const currentView = (): View =>
  location.hash.startsWith('#/calendar') ? 'calendar' : location.hash.startsWith('#/news') ? 'news' : 'today';

export function onView(fn: Listener): void {
  listeners.add(fn);
}

export function goTo(view: View): void {
  location.hash = view === 'today' ? '#/' : `#/${view}`;
}

/** Hash routes: `#/` is Today (the dial), `#/calendar` the month view, `#/news` the globe. */
export function mountRouter(): void {
  let prev: View | null = null;
  const apply = () => {
    const view = currentView();
    if (view === prev) return;
    document.body.dataset.view = view;
    document.querySelectorAll<HTMLElement>('.nav-item[data-view]').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const was = prev;
    prev = view;
    listeners.forEach((fn) => fn(view, was));
  };
  addEventListener('hashchange', apply);
  apply();
}
