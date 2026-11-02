import { kvGet, kvSet } from '../storage/db';
import { type Driver, type Item, NeedsAccess, type SourceConf } from './sources';

/**
 * An Obsidian vault: a folder on this computer, opened with the browser's folder picker (Chrome, Edge). The
 * folder's handle is kept in IndexedDB, so the vault opens again on the next visit — after a browser restart
 * with one click to allow it again. Notes are the `.md` files; hidden folders (`.obsidian`, `.git`, `.trash`) are
 * left out. Saving writes the file itself, so Obsidian sees the change at once.
 *
 * Browsers without the picker (Safari, Firefox) pick the folder through a file input instead: read only, and
 * held for this visit only.
 */
interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

const picker = (window as unknown as { showDirectoryPicker?: (o?: { mode?: 'readwrite' }) => Promise<DirHandle> }).showDirectoryPicker;
export const canPickFolder = !!picker;

const handleKey = (id: string) => `library:vault:${id}`;
const NOTE = /\.md$/i;
const hidden = (name: string) => name.startsWith('.');

/** Asks for the vault folder; null when cancelled. */
export async function pickVault(id: string): Promise<string | null> {
  if (picker) {
    const dir = await picker({ mode: 'readwrite' }).catch(() => null);
    if (!dir) return null;
    await kvSet(handleKey(id), dir);
    return dir.name;
  }
  const files = await pickFilesFallback();
  if (!files?.length) return null;
  loose.set(id, files);
  return files[0]!.webkitRelativePath.split('/')[0] || 'Vault';
}

/** Allows the saved folder again (needs a click). */
export async function allowVault(id: string): Promise<boolean> {
  const dir = await kvGet<DirHandle>(handleKey(id));
  return !!dir && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export const forgetVault = (id: string): Promise<void> => kvSet(handleKey(id), undefined);

/** Folders picked through the file input: the files themselves, this visit only. */
const loose = new Map<string, File[]>();

function pickFilesFallback(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.addEventListener('change', () => resolve(input.files ? [...input.files] : null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

export function obsidianDriver(conf: SourceConf): Driver {
  const files = new Map<string, FileHandle | File>();
  let root: DirHandle | null = null;

  async function walk(dir: DirHandle, parent: string | null, at: string, out: Item[]): Promise<void> {
    for await (const h of dir.values()) {
      if (hidden(h.name)) continue;
      const path = at ? `${at}/${h.name}` : h.name;
      if (h.kind === 'directory') {
        out.push({ id: path, name: h.name, kind: 'folder', parent, path });
        await walk(h, path, path, out);
      } else if (NOTE.test(h.name)) {
        const f = await h.getFile().catch(() => null);
        files.set(path, h);
        out.push({ id: path, name: h.name.replace(NOTE, ''), kind: 'note', parent, path, modified: f?.lastModified });
      }
    }
  }

  function fromLoose(list: File[]): Item[] {
    const out: Item[] = [];
    const folders = new Set<string>();
    for (const f of list) {
      // drop the vault's own name from the front
      const parts = f.webkitRelativePath.split('/').slice(1);
      if (!NOTE.test(f.name) || parts.some(hidden)) continue;
      for (let k = 1; k < parts.length; k++) {
        const path = parts.slice(0, k).join('/');
        if (folders.has(path)) continue;
        folders.add(path);
        out.push({ id: path, name: parts[k - 1]!, kind: 'folder', parent: k > 1 ? parts.slice(0, k - 1).join('/') : null, path });
      }
      const path = parts.join('/');
      files.set(path, f);
      out.push({ id: path, name: f.name.replace(NOTE, ''), kind: 'note', parent: parts.length > 1 ? parts.slice(0, -1).join('/') : null, path, modified: f.lastModified });
    }
    return out;
  }

  const driver: Driver = {
    async load() {
      files.clear();
      const list = loose.get(conf.id);
      if (list) return fromLoose(list);
      root = (await kvGet<DirHandle>(handleKey(conf.id))) ?? null;
      if (!root || (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') throw new NeedsAccess();
      const out: Item[] = [];
      await walk(root, null, '', out);
      return out;
    },
    async read(item) {
      const h = files.get(item.id);
      if (!h) return '';
      return (h instanceof File ? h : await h.getFile()).text();
    },
  };
  if (picker) {
    driver.write = async (item, text) => {
      const h = files.get(item.id);
      if (!h || h instanceof File) throw new Error('read only');
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      return 'Saved to the vault';
    };
    driver.create = async (folder, name) => {
      if (!root) throw new NeedsAccess();
      let dir: DirHandle = root;
      for (const part of folder ? folder.path.split('/') : []) {
        let next: DirHandle | null = null;
        for await (const h of dir.values()) if (h.kind === 'directory' && h.name === part) next = h;
        if (!next) throw new Error('folder gone');
        dir = next;
      }
      const file = `${name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Untitled'}.md`;
      const h = await dir.getFileHandle(file, { create: true });
      const path = folder ? `${folder.path}/${file}` : file;
      files.set(path, h);
      return { id: path, name: file.replace(NOTE, ''), kind: 'note', parent: folder?.id ?? null, path, modified: Date.now() };
    };
  }
  return driver;
}
