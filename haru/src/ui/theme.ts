/** The theme showing right now (set on <html data-theme> before the first paint, changed from Settings). */
export const shownTheme = (): 'dark' | 'light' => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

/** The light theme's background, for the browser's bar (the dark one is in index.html). */
const LIGHT_BAR = '#e9eaee';

const listeners = new Set<() => void>();
/** Fires after the theme changed: canvas drawings read their colours from CSS again. */
export function onTheme(fn: () => void): void {
  listeners.add(fn);
}
export function showTheme(theme: 'dark' | 'light'): void {
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? LIGHT_BAR : '#0d0e10');
  listeners.forEach((fn) => fn());
}
