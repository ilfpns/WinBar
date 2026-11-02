/** Notes opened last, per source (most recent first): Recent for a source that has no dates, and the Library's home. */
export interface Opened { id: string; at: number; name?: string; path?: string }

export const openedKey = (id: string) => `haru:library-opened:${id}`;
export function openedIn(source: string): Opened[] {
  try {
    const v = JSON.parse(localStorage.getItem(openedKey(source)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((o): o is Opened => typeof o?.id === 'string' && typeof o?.at === 'number') : [];
  } catch {
    return [];
  }
}
export function noteOpened(source: string, note: { id: string; name: string; path: string }): void {
  try {
    const entry: Opened = { id: note.id, at: Date.now(), name: note.name, path: note.path };
    localStorage.setItem(openedKey(source), JSON.stringify([entry, ...openedIn(source).filter((o) => o.id !== note.id)].slice(0, 20)));
  } catch {
    // not remembered
  }
}
