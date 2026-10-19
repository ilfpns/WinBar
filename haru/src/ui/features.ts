import { currentView, goTo, onView, type View } from './router';

/**
 * Pages and tools that can be switched off in Settings → Features. Off means out of sight — the rail, the
 * overview, page turns and its shortcut — never deleted: switching it back on brings everything back.
 * Remembered per browser. Today is always on.
 */
export type Feature = 'calendar' | 'news' | 'words' | 'journal' | 'archive' | 'chat';
export const FEATURES: { id: Feature; label: string; hint: string }[] = [
  { id: 'calendar', label: 'Calendar', hint: 'Month view, memos and statistics' },
  { id: 'news', label: 'News', hint: 'Headlines on the globe, attendance' },
  { id: 'words', label: 'Words', hint: 'TOEIC vocabulary cards' },
  { id: 'journal', label: 'Journal', hint: 'Pages in folders' },
  { id: 'archive', label: 'Archive', hint: 'Journal pages everyone shared' },
  { id: 'chat', label: 'Chat', hint: 'One room for everyone invited' },
];
const KEY = 'haru:features-off';
const listeners = new Set<() => void>();

let off = new Set<Feature>();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
  if (Array.isArray(saved)) off = new Set(saved.filter((f): f is Feature => FEATURES.some((x) => x.id === f)));
} catch {
  // all on
}

export const featureOn = (f: Feature): boolean => !off.has(f);
export function onFeatures(fn: () => void): void {
  listeners.add(fn);
}
export function setFeature(f: Feature, on: boolean): void {
  if (on) off.delete(f);
  else off.add(f);
  try {
    localStorage.setItem(KEY, JSON.stringify([...off]));
  } catch {
    // for this visit
  }
  apply();
  listeners.forEach((fn) => fn());
}

const isPage = (v: View): v is Exclude<View, 'today'> => v !== 'today';
function apply(): void {
  for (const f of FEATURES) document.body.classList.toggle(`off-${f.id}`, off.has(f.id));
  // the page you are on was switched off: back to Today
  const v = currentView();
  if (isPage(v) && off.has(v)) goTo('today');
}

export function mountFeatures(): void {
  apply();
  // a link or a typed address to a page that is off lands on Today
  onView((v) => {
    if (isPage(v) && off.has(v)) goTo('today');
  });
}
