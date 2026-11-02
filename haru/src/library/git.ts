import { GitHubError, encodePath, ghCall } from './github';
import { secret, setSecret } from './secrets';
import type { Item, SourceConf } from './sources';

/**
 * Git, the way it is used at a terminal, for any note in the Library (a vault's, a repo's, a Notion page): Add puts
 * the note as it reads now into the staging area, Commit turns what is staged into a commit with a message, Push
 * sends the commits waiting, in order, to the repository chosen once in Git settings — each one a commit of its own
 * on GitHub, under `<path>/<source>/<the note's path>.md`. Staged notes and commits waiting are kept in this browser
 * until they are pushed. The repository's token is sealed with the others (secrets.ts).
 */
export interface GitConf { repo: string; branch: string; path: string }
export interface Staged { key: string; path: string; name: string; content: string; at: number }
export interface Commit { message: string; files: { path: string; content: string }[]; at: number }

const CONF = 'haru:library-git';
const STAGED = 'haru:library-git-staged';
const COMMITS = 'haru:library-git-commits';

const read = <T>(k: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // this visit only
  }
};

const listeners = new Set<() => void>();
export const onGit = (fn: () => void): void => void listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

export function gitConf(): GitConf | null {
  const c = read<GitConf | null>(CONF, null);
  return c && typeof c.repo === 'string' && c.repo ? { repo: c.repo, branch: c.branch ?? '', path: c.path ?? '' } : null;
}
export const gitToken = (): string => secret('git');
export function saveGitConf(c: GitConf, token: string): void {
  write(CONF, c);
  if (token) setSecret('git', token);
  changed();
}

export const staged = (): Staged[] => read<Staged[]>(STAGED, []);
export const commits = (): Commit[] => read<Commit[]>(COMMITS, []);

const safe = (s: string) => s.replace(/[\\:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
/** Where a note goes in the repository. */
export function gitPath(c: GitConf, src: SourceConf, item: Item): string {
  const note = item.path.replace(/\.md$/i, '').split('/').map(safe).join('/');
  return [c.path.replace(/^\/+|\/+$/g, ''), safe(src.name), `${note}.md`].filter(Boolean).join('/');
}

/** git add: the note as it reads now (adding it again replaces what was staged for it). */
export function add(src: SourceConf, item: Item, content: string): void {
  const c = gitConf();
  if (!c) throw new Error('Choose the repository in Git settings first');
  const key = `${src.id}|${item.id}`;
  const list = staged().filter((s) => s.key !== key);
  list.push({ key, path: gitPath(c, src, item), name: item.name, content, at: Date.now() });
  write(STAGED, list);
  changed();
}
export const isStaged = (src: SourceConf, item: Item): boolean => staged().some((s) => s.key === `${src.id}|${item.id}`);
export function unstage(key: string): void {
  write(STAGED, staged().filter((s) => s.key !== key));
  changed();
}

/** git commit -m: what is staged becomes one commit waiting to be pushed. */
export function commit(message: string): Commit | null {
  const list = staged();
  if (!list.length) return null;
  const c: Commit = { message: message.trim() || `Haru: ${list.map((s) => s.name).join(', ')}`.slice(0, 200), files: list.map((s) => ({ path: s.path, content: s.content })), at: Date.now() };
  write(COMMITS, [...commits(), c]);
  write(STAGED, []);
  changed();
  return c;
}

/** git push: every commit waiting goes up, oldest first, each on top of the branch as it is then. */
export async function push(onStep?: (done: number, of: number) => void): Promise<number> {
  const c = gitConf();
  if (!c) throw new Error('Choose the repository in Git settings first');
  const token = gitToken();
  const queue = commits();
  if (!queue.length) return 0;
  const branch = c.branch || (await ghCall<{ default_branch: string }>(token, `/repos/${c.repo}`)).default_branch;
  let done = 0;
  for (const k of queue) {
    onStep?.(done, queue.length);
    // the branch's tip now (another push, or a commit on GitHub, may have moved it)
    let tip: string | null = null;
    let baseTree: string | undefined;
    try {
      const ref = await ghCall<{ object: { sha: string } }>(token, `/repos/${c.repo}/git/ref/heads/${encodePath(branch)}`);
      tip = ref.object.sha;
      baseTree = (await ghCall<{ tree: { sha: string } }>(token, `/repos/${c.repo}/git/commits/${tip}`)).tree.sha;
    } catch (e) {
      // an empty repository has no branch yet: the first commit starts it
      if (!(e instanceof GitHubError && (e.status === 404 || e.status === 409))) throw e;
    }
    const tree = await ghCall<{ sha: string }>(token, `/repos/${c.repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: k.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }),
    });
    const made = await ghCall<{ sha: string }>(token, `/repos/${c.repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: k.message, tree: tree.sha, parents: tip ? [tip] : [] }),
    });
    if (tip) {
      await ghCall(token, `/repos/${c.repo}/git/refs/heads/${encodePath(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: made.sha, force: false }) });
    } else {
      await ghCall(token, `/repos/${c.repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: made.sha }) });
    }
    // pushed: off the queue at once, so a failure later never sends it twice
    write(COMMITS, commits().filter((x) => x.at !== k.at));
    done++;
    changed();
  }
  onStep?.(done, queue.length);
  return done;
}

/** Drops the commits waiting (they were never pushed). */
export function dropCommits(): void {
  write(COMMITS, []);
  changed();
}
