import { type Driver, type Item, type SourceConf, tokenOf } from './sources';

/**
 * A folder in a GitHub repository (an Obsidian vault kept on GitHub, docs in a project): `owner/name`, a branch and
 * a path chosen when it was added. The tree comes in one request; a note's text when it is opened. Saving a note
 * commits it straight to that branch — the commit is the push, there is no local copy to push from. A note
 * changed on GitHub since it was opened is never overwritten: the save stops and says so. Deleting a note is a commit
 * too; a picture added is committed beside the note and put in as `![[name]]`.
 *
 * The token (a fine-grained one with Contents read and write on that repository) stays in this browser. A public
 * repository is read without one.
 */
const API = 'https://api.github.com';
const NOTE = /\.md$/i;
const PICTURE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
/** Bytes → base64 (pictures go up as they are). */
const bytesToBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
/** UTF-8 text → base64, as the contents API wants it. */
export const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** One GitHub API call with `token` (empty: none); a failure throws a GitHubError saying what went wrong. */
export async function ghCall<T>(token: string, path: string, init: RequestInit = {}, raw = false): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const why = res.status === 401 ? 'The token was refused'
      : res.status === 403 ? 'No access (check the token’s permissions, or the hourly limit)'
      : res.status === 404 ? 'Not found (the repo, branch or path — or a private repo without a token)'
      : res.status === 409 ? 'Changed on GitHub since it was opened'
      : `GitHub said ${res.status}`;
    throw new GitHubError(why, res.status);
  }
  return (raw ? res.text() : res.json()) as Promise<T>;
}

export function githubDriver(conf: SourceConf): Driver {
  const repo = (conf.repo ?? '').trim();
  const base = (conf.path ?? '').replace(/^\/+|\/+$/g, '');
  let branch = (conf.branch ?? '').trim();
  /** Pictures in the folder, by name: their repo path and blob (to show or delete them). */
  const pictures = new Map<string, { path: string; sha: string }>();
  const urls = new Map<string, string>();

  const call = <T>(path: string, init: RequestInit = {}, raw = false) => ghCall<T>(tokenOf(conf.id), path, init, raw);

  /** The repo path of an item (ids are relative to the chosen folder). */
  const full = (rel: string) => (base ? `${base}/${rel}` : rel);

  return {
    async load() {
      if (!branch) branch = (await call<{ default_branch: string }>(`/repos/${repo}`)).default_branch;
      const tree = await call<{ tree: { path: string; type: 'blob' | 'tree'; sha: string }[]; truncated: boolean }>(
        `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      );
      const prefix = base ? `${base}/` : '';
      const out: Item[] = [];
      pictures.clear();
      for (const t of tree.tree) {
        if (!t.path.startsWith(prefix)) continue;
        const rel = t.path.slice(prefix.length);
        if (!rel || rel.split('/').some((p) => p.startsWith('.'))) continue;
        const parts = rel.split('/');
        const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
        const name = parts.at(-1)!;
        if (t.type === 'blob' && PICTURE.test(name)) pictures.set(name, { path: t.path, sha: t.sha });
        if (t.type === 'tree') out.push({ id: rel, name, kind: 'folder', parent, path: rel });
        else if (NOTE.test(name)) out.push({ id: rel, name: name.replace(NOTE, ''), kind: 'note', parent, path: rel, sha: t.sha });
      }
      return out;
    },
    async read(item) {
      return call<string>(`/repos/${repo}/contents/${encodePath(full(item.path))}?ref=${encodeURIComponent(branch)}`, {}, true);
    },
    async write(item, text) {
      const res = await call<{ content: { sha: string } }>(`/repos/${repo}/contents/${encodePath(full(item.path))}`, {
        method: 'PUT',
        body: JSON.stringify({ message: `Haru: update ${item.path}`, content: toBase64(text), branch, ...(item.sha ? { sha: item.sha } : {}) }),
      });
      item.sha = res.content.sha;
      item.modified = Date.now();
      return `Committed to ${branch}`;
    },
    async remove(item) {
      await call(`/repos/${repo}/contents/${encodePath(full(item.path))}`, {
        method: 'DELETE',
        body: JSON.stringify({ message: `Haru: delete ${item.path}`, sha: item.sha, branch }),
      });
      return `Deleted · committed to ${branch}`;
    },
    async imageUrl(_item, ref) {
      const name = ref.split('/').pop()!.split('|')[0]!.trim();
      if (urls.has(name)) return urls.get(name)!;
      const p = pictures.get(name);
      if (!p) return null;
      const res = await fetch(`${API}/repos/${repo}/git/blobs/${p.sha}`, { headers: { Accept: 'application/vnd.github.raw+json', ...(tokenOf(conf.id) ? { Authorization: `Bearer ${tokenOf(conf.id)}` } : {}) } }).catch(() => null);
      if (!res?.ok) return null;
      const url = URL.createObjectURL(await res.blob());
      urls.set(name, url);
      return url;
    },
    async addImage(item, file, text) {
      const dir = item.path.split('/').slice(0, -1).join('/');
      const ext = (file.name.match(/\.\w+$/)?.[0] ?? '.png').toLowerCase();
      const baseName = (file.name.replace(/\.\w+$/, '') || 'Pasted image').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim();
      let name = `${baseName}${ext}`;
      for (let k = 1; pictures.has(name); k++) name = `${baseName} ${k}${ext}`;
      const rel = dir ? `${dir}/${name}` : name;
      const res = await call<{ content: { sha: string } }>(`/repos/${repo}/contents/${encodePath(full(rel))}`, {
        method: 'PUT',
        body: JSON.stringify({ message: `Haru: add ${rel}`, content: bytesToBase64(new Uint8Array(await file.arrayBuffer())), branch }),
      });
      pictures.set(name, { path: full(rel), sha: res.content.sha });
      return { text: `${text.replace(/\s*$/, '')}\n\n![[${name}]]\n`, saved: false };
    },
    async removeImage(_item, ref, text) {
      const name = ref.split('/').pop()!.split('|')[0]!.trim();
      const p = pictures.get(name);
      if (p) await call(`/repos/${repo}/contents/${encodePath(p.path)}`, { method: 'DELETE', body: JSON.stringify({ message: `Haru: delete ${p.path}`, sha: p.sha, branch }) });
      pictures.delete(name);
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { text: text.replace(new RegExp(`^[ \\t]*!\\[\\[${esc}(\\|[^\\]]*)?\\]\\][ \\t]*\\n?`, 'm'), ''), saved: false };
    },
    async create(folder, name) {
      const file = `${name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Untitled'}.md`;
      const rel = folder ? `${folder.path}/${file}` : file;
      const res = await call<{ content: { sha: string } }>(`/repos/${repo}/contents/${encodePath(full(rel))}`, {
        method: 'PUT',
        body: JSON.stringify({ message: `Haru: add ${rel}`, content: toBase64(`# ${file.replace(NOTE, '')}\n`), branch }),
      });
      return { id: rel, name: file.replace(NOTE, ''), kind: 'note', parent: folder?.id ?? null, path: rel, sha: res.content.sha, modified: Date.now() };
    },
  };
}
