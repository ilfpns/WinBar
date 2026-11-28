/**
 * Pages and tools that can be switched off in Settings → Features. Off means out of the way — the overview, the
 * title bar and page turns — never deleted, and still a click away under the rail's All button: switching it back
 * on brings everything back.
 * Remembered per browser. Today is always on. `defaultOff` ones stay hidden until switched on in Settings.
 */
export type Feature = 'calendar' | 'news' | 'words' | 'journal' | 'archive' | 'board' | 'library';
export const FEATURES: { id: Feature; label: string; hint: string; defaultOff?: boolean }[] = [
  { id: 'calendar', label: 'Calendar', hint: 'Month view, memos and statistics' },
  { id: 'news', label: 'News', hint: 'Headlines on the globe, attendance', defaultOff: true },
  { id: 'words', label: 'Words', hint: 'TOEIC vocabulary cards', defaultOff: true },
  { id: 'journal', label: 'Journal', hint: 'Pages in folders' },
  { id: 'archive', label: 'Archive', hint: 'Journal pages everyone shared' },
  { id: 'board', label: 'Dot board', hint: 'Every day you keep, a cell for each category', defaultOff: true },
  { id: 'library', label: 'Library', hint: 'Obsidian, GitHub and Notion notes as cards', defaultOff: true },
];
const KEY = 'haru:features-off';
/** The `defaultOff` features switched on — the rest are remembered in KEY as switched off. */
const ON_KEY = 'haru:features-on';
const listeners = new Set<() => void>();

const isDefaultOff = (f: Feature): boolean => FEATURES.some((x) => x.id === f && x.defaultOff);
function readList(key: string): Feature[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (Array.isArray(saved)) return saved.filter((f): f is Feature => FEATURES.some((x) => x.id === f));
  } catch {
    // nothing saved
  }
  return [];
}

const switchedOn = new Set(readList(ON_KEY).filter(isDefaultOff));
const off = new Set(readList(KEY).filter((f) => !isDefaultOff(f)));
for (const f of FEATURES) if (f.defaultOff && !switchedOn.has(f.id)) off.add(f.id);

export const featureOn = (f: Feature): boolean => !off.has(f);
export function onFeatures(fn: () => void): void {
  listeners.add(fn);
}
export function setFeature(f: Feature, on: boolean): void {
  if (on) off.delete(f);
  else off.add(f);
  try {
    localStorage.setItem(KEY, JSON.stringify([...off].filter((x) => !isDefaultOff(x))));
    localStorage.setItem(ON_KEY, JSON.stringify(FEATURES.filter((x) => x.defaultOff && !off.has(x.id)).map((x) => x.id)));
  } catch {
    // for this visit
  }
  apply();
  listeners.forEach((fn) => fn());
}

function apply(): void {
  for (const f of FEATURES) document.body.classList.toggle(`off-${f.id}`, off.has(f.id));
}

export function mountFeatures(): void {
  apply();
}
