/**
 * The theme showing right now (set on <html data-theme> before the first paint, changed from Settings). Neon and
 * Liquid are dark themes: whatever only asks light or dark hears dark.
 */
export type ShownTheme = 'dark' | 'light' | 'neon' | 'liquid';
export const shownTheme = (): 'dark' | 'light' => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

/** Each theme's background, for the browser's bar (also in index.html, for the first paint). */
const BAR: Record<ShownTheme, string> = { dark: '#0d0e10', light: '#e9eaee', neon: '#020205', liquid: '#0b1024' };

const listeners = new Set<() => void>();
/** Fires after the theme changed: canvas drawings read their colours from CSS again. */
export function onTheme(fn: () => void): void {
  listeners.add(fn);
}
export function showTheme(theme: ShownTheme): void {
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
  listeners.forEach((fn) => fn());
}
