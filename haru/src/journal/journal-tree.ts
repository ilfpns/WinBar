import { icon } from '../ui/icons';
import { showMenu } from '../ui/modal';
import { type Entry, type Folder, ROOT, fmtDay, plain } from './journal-store';

const TREE_KEY = 'haru:journal-tree-open';

/** What the tree needs from the journal around it. */
export interface TreeDeps {
  list: HTMLUListElement;
  entries: () => Entry[];
  folders: () => Folder[];
  /** The page in the editor (null: a blank page). */
  openId: () => string | null;
  validTab: () => string;
  folderOf: (e: Entry) => string;
  placeName: (id: string) => string;
  setTab: (next: string) => void;
  open: (id: string | null) => void;
  flush: () => void;
  togglePin: (id: string) => void;
  moveTo: (ids: string[], folder: string) => void;
  removePage: (id: string) => Promise<void>;
  folderMenu: (f: Folder, at: HTMLElement | { x: number; y: number }) => void;
}

/** The journal's side list; returns its redraw. */
export function mountTree({ list, entries, folders, openId, validTab, folderOf, placeName, setTab, open, flush, togglePin, moveTo, removePage, folderMenu }: TreeDeps): () => void {
  // ---- the pages as a tree (as Octotree draws a repository): every folder with its pages under it, the root's
  // pages at the top level
  const readJson = <T,>(key: string, fallback: T): T => {
    try {
      return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const writeJson = (key: string, v: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // for this visit
    }
  };
  let unfolded = '';
  /** Folders unfolded in the tree. */
  const treeOpen = new Set<string>(readJson<string[]>(TREE_KEY, []));

  /** The menu a page row offers. */
  const pageMenu = (e: Entry) => [
    { label: e.pinned ? 'Unpin' : 'Pin to top', icon: 'pin' as const, run: () => togglePin(e.id) },
    ...[ROOT, ...folders().map((f) => f.id)].filter((id) => id !== folderOf(e))
      .map((id) => ({ label: `Move to ${placeName(id)}`, icon: (id === ROOT ? 'folder-tree' : 'arrow-right') as 'folder-tree' | 'arrow-right', run: () => moveTo([e.id], id) })),
    { label: 'Delete page', icon: 'trash' as const, danger: true, run: () => void removePage(e.id) },
  ];
  const pageTitle = (e: Entry) => e.title || e.body.split(/\r?\n/).map(plain).find(Boolean) || 'Untitled';

  const byPin = (a: Entry, b: Entry) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date) || b.created - a.created;
  /** A page in the tree (in a folder, or at the root). */
  function pageRow(e: Entry): HTMLLIElement {
    const p = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `jt-row jt-page${e.id === openId() ? ' on' : ''}`;
    b.draggable = true;
    const t = document.createElement('span');
    t.className = 'jt-name';
    t.textContent = pageTitle(e);
    const d = document.createElement('span');
    d.className = 'jt-date';
    d.textContent = fmtDay(e.date);
    b.append(icon(e.pinned ? 'pin' : 'file-text', 'ic jt-ic'), t, d);
    b.title = `${pageTitle(e)} · ${fmtDay(e.date)}`;
    b.addEventListener('click', () => {
      if (folderOf(e) !== validTab()) setTab(folderOf(e));
      open(e.id);
    });
    b.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      showMenu({ x: ev.clientX, y: ev.clientY }, pageMenu(e));
    });
    b.addEventListener('dragstart', (ev) => {
      if (e.id === openId()) flush();
      ev.dataTransfer?.setData('text/x-haru-page', e.id);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    p.append(b);
    return p;
  }

  function renderTree(): void {
    const all = entries();
    const here = validTab();
    // a page opened (or a folder switched to) unfolds its folder; folding it again afterwards is up to you
    const openEntry = openId() ? all.find((e) => e.id === openId()) : undefined;
    const at = openEntry ? folderOf(openEntry) : here;
    const mark = `${openId()}|${here}`;
    if (at && mark !== unfolded) {
      unfolded = mark;
      treeOpen.add(at);
      writeJson(TREE_KEY, [...treeOpen]);
    }
    const rows = folders().map((f) => {
      const pages = all.filter((e) => e.folder === f.id).sort(byPin);
      const isOpen = treeOpen.has(f.id);
      const li = document.createElement('li');
      li.className = `jt-folder${isOpen ? ' open' : ''}${f.id === here ? ' here' : ''}`;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'jt-row jt-dir';
      row.setAttribute('aria-expanded', String(isOpen));
      const count = document.createElement('span');
      count.className = 'jt-count';
      count.textContent = String(pages.length);
      const name = document.createElement('span');
      name.className = 'jt-name';
      name.textContent = f.name;
      row.append(icon('chevron-right', 'ic jt-caret'), icon(isOpen ? 'folder-open' : 'folder', 'ic jt-ic'), name);
      if (f.private) {
        // hidden from Claude: a quiet mark by the name
        row.classList.add('private');
        const mark = icon('eye-off', 'ic jt-private');
        mark.setAttribute('aria-label', 'Hidden from Claude');
        mark.setAttribute('aria-hidden', 'false');
        mark.setAttribute('role', 'img');
        row.append(mark);
      }
      row.append(count);
      row.addEventListener('click', () => {
        if (treeOpen.has(f.id)) treeOpen.delete(f.id);
        else treeOpen.add(f.id);
        writeJson(TREE_KEY, [...treeOpen]);
        renderTree();
      });
      row.addEventListener('dblclick', () => setTab(f.id));
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        folderMenu(f, { x: ev.clientX, y: ev.clientY });
      });
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'jt-more';
      more.setAttribute('aria-label', `${f.name} options`);
      more.title = 'Rename, hide from Claude or delete this folder';
      more.append(icon('ellipsis'));
      more.addEventListener('click', () => folderMenu(f, more));
      // drop a page on a folder to move it there
      row.addEventListener('dragover', (ev) => {
        if (!ev.dataTransfer?.types.includes('text/x-haru-page')) return;
        ev.preventDefault();
        row.classList.add('drop');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (ev) => {
        row.classList.remove('drop');
        const id = ev.dataTransfer?.getData('text/x-haru-page');
        if (!id) return;
        ev.preventDefault();
        treeOpen.add(f.id);
        moveTo([id], f.id);
      });
      const kids = document.createElement('div');
      kids.className = 'jt-kids';
      const ul = document.createElement('ul');
      ul.append(...(pages.length ? pages.map(pageRow) : [Object.assign(document.createElement('li'), { className: 'jt-empty meta', textContent: 'Empty' })]));
      kids.append(ul);
      li.append(row, more, kids);
      return li;
    });
    // the root's pages after the folders, at the top level
    const rootPages = all.filter((e) => folderOf(e) === ROOT).sort(byPin).map((e) => {
      const li = pageRow(e);
      li.classList.add('jt-root-page');
      return li;
    });
    list.replaceChildren(...rows, ...rootPages);
  }
  // the tree's empty space is the root: a page dropped there leaves its folder
  list.addEventListener('dragover', (ev) => {
    if (!ev.dataTransfer?.types.includes('text/x-haru-page') || (ev.target as Element).closest('.jt-dir')) return;
    ev.preventDefault();
    list.classList.add('drop-root');
  });
  list.addEventListener('dragleave', (ev) => {
    if (!list.contains(ev.relatedTarget as Node)) list.classList.remove('drop-root');
  });
  list.addEventListener('drop', (ev) => {
    list.classList.remove('drop-root');
    if ((ev.target as Element).closest('.jt-dir')) return;
    const id = ev.dataTransfer?.getData('text/x-haru-page');
    if (!id) return;
    ev.preventDefault();
    moveTo([id], ROOT);
  });

  return renderTree;
}
