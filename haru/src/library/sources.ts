/**
 * Library sources: places notes live outside Haru — an Obsidian vault (a folder on this computer), a folder in a
 * GitHub repository, a Notion workspace. Each is read into one shape, a tree of folders and notes, so the Library
 * shows them all the same way. Which sources there are is remembered per browser (`haru:library`); tokens are kept
 * apart (`haru:library-keys`) and never leave this browser — not to the cloud sync, not into a backup.
 */
export type SourceKind = 'obsidian' | 'github' | 'notion';

export interface SourceConf {
  id: string;
  kind: SourceKind;
  name: string;
  /** GitHub: `owner/name`, the branch (empty: the default one) and the folder in it (empty: the whole repo). */
  repo?: string;
  branch?: string;
  path?: string;
}

/** A folder or a note. Ids are unique within a source; `parent` null sits at the top. */
export interface Item {
  id: string;
  name: string;
  kind: 'folder' | 'note';
  parent: string | null;
  /** Where it is, for showing (`Projects/Haru/plan.md`). */
  path: string;
  /** When it last changed (ms), where the source tells. */
  modified?: number;
  /** GitHub: the file's blob, needed to change it. */
  sha?: string;
  /** Notion: the page's own address. */
  url?: string;
}

export interface Driver {
  /** Every folder and note. Throws `NeedsAccess` when the source must be opened again by a click. */
  load(): Promise<Item[]>;
  read(item: Item): Promise<string>;
  /** Saves a note; resolves to what to tell (`Committed`, `Saved`). Missing: read only. */
  write?(item: Item, text: string): Promise<string>;
  /** Makes a new note in `folder` (null: the top); missing where notes can't be made. */
  create?(folder: Item | null, name: string): Promise<Item>;
}

/** The source has to be allowed again (a folder's permission lapses when the browser restarts). */
export class NeedsAccess extends Error {}

const KEY = 'haru:library';
const KEYS = 'haru:library-keys';

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // for this visit only
  }
}

const listeners = new Set<() => void>();
export const onSources = (fn: () => void): void => void listeners.add(fn);

export const sources = (): SourceConf[] =>
  readJson<SourceConf[]>(KEY, []).filter((s) => s && typeof s.id === 'string' && ['obsidian', 'github', 'notion'].includes(s.kind));

export function saveSource(s: SourceConf, token?: string): void {
  const list = sources().filter((x) => x.id !== s.id);
  writeJson(KEY, [...list, s]);
  if (token !== undefined) {
    const keys = readJson<Record<string, string>>(KEYS, {});
    if (token) keys[s.id] = token;
    else delete keys[s.id];
    writeJson(KEYS, keys);
  }
  listeners.forEach((fn) => fn());
}

export function removeSource(id: string): void {
  writeJson(KEY, sources().filter((x) => x.id !== id));
  const keys = readJson<Record<string, string>>(KEYS, {});
  delete keys[id];
  writeJson(KEYS, keys);
  listeners.forEach((fn) => fn());
}

export const tokenOf = (id: string): string => readJson<Record<string, string>>(KEYS, {})[id] ?? '';

export const newSourceId = (): string => `src-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
