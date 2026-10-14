export type View = 'today' | 'calendar';

type Listener = (view: View) => void;
const listeners = new Set<Listener>();

export const currentView = (): View => (location.hash.startsWith('#/calendar') ? 'calendar' : 'today');

export function onView(fn: Listener): void {
  listeners.add(fn);
}

/** Hash routes: `#/` is Today (the dial), `#/calendar` the month view. */
export function mountRouter(): void {
  const apply = () => {
    const view = currentView();
    document.body.dataset.view = view;
    document.querySelectorAll<HTMLElement>('.nav-item[data-view]').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    listeners.forEach((fn) => fn(view));
  };
  addEventListener('hashchange', apply);
  apply();
}
