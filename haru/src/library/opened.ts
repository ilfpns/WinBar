/** Notes opened last, per source (most recent first): Recent for a source that has no dates. */
export const openedKey = (id: string) => `haru:library-opened:${id}`;
export function openedIn(source: string): { id: string; at: number }[] {
  try {
    const v = JSON.parse(localStorage.getItem(openedKey(source)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((o): o is { id: string; at: number } => typeof o?.id === 'string' && typeof o?.at === 'number') : [];
  } catch {
    return [];
  }
}
export function noteOpened(source: string, id: string): void {
  try {
    localStorage.setItem(openedKey(source), JSON.stringify([{ id, at: Date.now() }, ...openedIn(source).filter((o) => o.id !== id)].slice(0, 20)));
  } catch {
    // not remembered
  }
}
