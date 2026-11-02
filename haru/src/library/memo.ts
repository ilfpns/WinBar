import { GitHubError, encodePath, ghCall, toBase64 } from './github';
import type { Item, SourceConf } from './sources';

/**
 * Memos on notes: whatever note is open — from a vault, a repo or Notion — can carry a memo of your own, kept as a
 * Markdown file in a GitHub repository you choose (the memo repo), the way Obsidian keeps notes: one file per note
 * under `<path>/<source>/<the note's path>.md`, front matter saying which note it is about, a [[link]] to it. A memo
 * is committed (that is, pushed) a few seconds after typing stops.
 *
 * The memo repo is chosen once per browser (`haru:library-memo`); its token sits with the sources' tokens
 * (`haru:library-keys` → `memo`) and never leaves this browser.
 */
export interface MemoConf { repo: string; branch: string; path: string }
const KEY = 'haru:library-memo';
const KEYS = 'haru:library-keys';

export function memoConf(): MemoConf | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as MemoConf | null;
    return v && typeof v.repo === 'string' && v.repo ? { repo: v.repo, branch: v.branch ?? '', path: v.path ?? '' } : null;
  } catch {
    return null;
  }
}
export function memoToken(): string {
  try {
    return (JSON.parse(localStorage.getItem(KEYS) ?? '{}') as Record<string, string>).memo ?? '';
  } catch {
    return '';
  }
}
export function saveMemoConf(c: MemoConf, token: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
    const keys = JSON.parse(localStorage.getItem(KEYS) ?? '{}') as Record<string, string>;
    if (token) keys.memo = token;
    else delete keys.memo;
    localStorage.setItem(KEYS, JSON.stringify(keys));
  } catch {
    // for this visit: nothing kept
  }
  branch = '';
}

/** A name safe as a folder or file name in a repo. */
const safe = (s: string) => s.replace(/[\\:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';

/** Where the memo on `item` lives in the memo repo. */
export function memoPath(c: MemoConf, src: SourceConf, item: Item): string {
  const base = c.path.replace(/^\/+|\/+$/g, '');
  const note = item.path.replace(/\.md$/i, '').split('/').map(safe).join('/');
  return [base, safe(src.name), `${note}.md`].filter(Boolean).join('/');
}

let branch = '';
async function branchOf(c: MemoConf, token: string): Promise<string> {
  if (c.branch) return c.branch;
  if (!branch) branch = (await ghCall<{ default_branch: string }>(token, `/repos/${c.repo}`)).default_branch;
  return branch;
}

export interface Memo { text: string; sha: string | null; path: string }

/** The memo on `item`: its text without the front matter Haru wrote, or empty (sha null) when there is none yet. */
export async function readMemo(src: SourceConf, item: Item): Promise<Memo> {
  const c = memoConf();
  if (!c) throw new Error('No memo repo');
  const token = memoToken();
  const path = memoPath(c, src, item);
  const ref = await branchOf(c, token);
  try {
    const meta = await ghCall<{ sha: string; content: string; encoding: string }>(token, `/repos/${c.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    const bytes = Uint8Array.from(atob(meta.content.replace(/\s/g, '')), (ch) => ch.charCodeAt(0));
    const raw = new TextDecoder().decode(bytes);
    // the body: after the front matter and the link line Haru puts on top
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\[\[[^\]]*\]\]\r?\n\r?\n?/, '');
    return { text: body, sha: meta.sha, path };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return { text: '', sha: null, path };
    throw e;
  }
}

/** Commits the memo; resolves to the new blob (the next save goes over it). */
export async function writeMemo(src: SourceConf, item: Item, text: string, sha: string | null): Promise<string> {
  const c = memoConf();
  if (!c) throw new Error('No memo repo');
  const token = memoToken();
  const path = memoPath(c, src, item);
  const ref = await branchOf(c, token);
  const quote = (s: string) => JSON.stringify(s);
  const file = [
    '---',
    `source: ${quote(src.name)}`,
    `kind: ${src.kind}`,
    `note: ${quote(item.path)}`,
    ...(item.url ? [`link: ${item.url}`] : []),
    `updated: ${new Date().toISOString()}`,
    '---',
    `[[${item.name}]]`,
    '',
    text,
  ].join('\n');
  const res = await ghCall<{ content: { sha: string } }>(token, `/repos/${c.repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `Haru: memo on ${item.name}`, content: toBase64(file), branch: ref, ...(sha ? { sha } : {}) }),
  });
  return res.content.sha;
}
