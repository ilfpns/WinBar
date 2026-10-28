import { listStore } from '../storage/list-store';
import { IMG_LINE } from '../ui/markdown';

/** Journal's data: pages and the folders they are filed in, kept on this device and synced. */
export interface Entry {
  id: string;
  /** YYYY-MM-DD the entry is about. */
  date: string;
  title: string;
  body: string;
  created: number;
  updated: number;
  /** The folder it is filed in (an id from folderStore); none: it sits at the top level (root). */
  folder?: string;
  /** Kept at the top of its folder's list. */
  pinned?: boolean;
}
export interface Folder {
  id: string;
  name: string;
  created: number;
  /** Hidden from Claude: the MCP neither lists, reads, changes nor logs its pages (the key only when set). */
  private?: boolean;
}

const isEntry = (v: unknown): v is Entry => {
  const e = v as Partial<Entry> | null;
  return !!e && typeof e.id === 'string' && typeof e.date === 'string' && typeof e.body === 'string';
};
export const journalStore = listStore<Entry>('journal', isEntry);
const isFolder = (v: unknown): v is Folder => {
  const f = v as Partial<Folder> | null;
  return !!f && typeof f.id === 'string' && typeof f.name === 'string';
};
export const folderStore = listStore<Folder>('journal-folders', isFolder);
/** The top level: pages outside every folder (no folder, or one deleted elsewhere). Also a tab of its own. */
export const ROOT = '/';

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
/** A Markdown line as plain words (marks, fences and dividers dropped). */
export const plain = (line: string) =>
  IMG_LINE.test(line) || /^\s*(```|([-*_])(\s*\2){2,}\s*$|\|(\s*:?-{3,}:?\s*\|)+\s*$)/.test(line) ? '' : line
    .replace(/^\s*\|(.*)\|\s*$/, (_, cells: string) => cells.split('|').map((x) => x.trim()).filter(Boolean).join(' · '))
    .replace(/^\s*(#{1,6} |[-*] \[[ xX]\] |[-*+] |\d+\. |> )/, '')
    .replace(/@\[([^\]]+)\]\(user:[\w-]+\)/g, '@$1').replace(/\*\*|__|~~|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
export const fmtDay = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
