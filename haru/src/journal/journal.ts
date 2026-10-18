import { listStore } from '../storage/list-store';
import { dayKey } from '../timetable/history';
import { icon } from '../ui/icons';
import { mdPad } from '../ui/md-pad';
import { type MdEditor } from '../ui/md-editor';
import { printPdf } from '../ui/print';
import { askConfirm, askText, showMenu } from '../ui/modal';
import { onSession, session } from '../cloud/session';
import { sharePage, unsharePage } from '../archive/archive';

/**
 * Journal: pages written in your own words — a summary of the day, a thought, a plan — always filed in a
 * folder (tabs over the list). The list keeps a folder's pages by date; the editor saves as you type. Next
 * to the date, how that day's timetable went. Pages move between folders (the picker, or drag one onto a
 * folder tab; a folder's ⋯ or right-click renames or deletes it); deleting asks first and can be undone for a few seconds.
 */
export interface Entry {
  id: string;
  /** YYYY-MM-DD the entry is about. */
  date: string;
  title: string;
  body: string;
  created: number;
  updated: number;
  /** The folder it is filed in (an id from folderStore). Older entries had none: they are filed on start. */
  folder?: string;
}
export interface Folder { id: string; name: string; created: number }

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
/** Which folder was open (per browser). */
const TAB_KEY = 'haru:journal-folder';
/** The folder made when there is none (and where pages from before folders are filed). */
const FIRST_FOLDER = 'Journal';

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
/** A Markdown line as plain words (marks, fences and dividers dropped). */
const plain = (line: string) =>
  /^\s*(```|([-*_])(\s*\2){2,}\s*$|\|(\s*:?-{3,}:?\s*\|)+\s*$)/.test(line) ? '' : line
    .replace(/^\s*\|(.*)\|\s*$/, (_, cells: string) => cells.split('|').map((x) => x.trim()).filter(Boolean).join(' · '))
    .replace(/^\s*(#{1,6} |[-*] \[[ xX]\] |[-*+] |\d+\. |> )/, '')
    .replace(/\*\*|__|~~|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
const fmtDay = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function mountJournal(body: HTMLElement): void {
  body.innerHTML = `
    <aside class="j-side glass-card" aria-label="Pages">
      <div class="j-side-head">
        <span class="card-title">Folders</span>
        <button type="button" class="btn-sm j-new"></button>
      </div>
      <div class="j-folders" role="tablist" aria-label="Folders"></div>
      <p class="meta j-status" aria-live="polite"></p>
      <ul class="j-list"></ul>
    </aside>
    <article class="j-editor glass-card">
      <div class="j-ed-head">
        <span class="j-date"></span>
        <button type="button" class="j-folder" aria-haspopup="menu" title="Move to another folder"><span class="j-folder-name"></span></button>
        <span class="j-head-fill"></span>
        <button type="button" class="icon-btn j-share" aria-label="Share to Archive" title="Share to Archive" hidden></button>
        <button type="button" class="icon-btn j-pdf" aria-label="Export this page as PDF" title="Export as PDF"></button>
        <button type="button" class="icon-btn j-del" aria-label="Delete page" title="Delete page"></button>
      </div>
      <input class="j-title" placeholder="Title" maxlength="120" aria-label="Title">
      <md-editor class="j-text" aria-label="Page (Markdown)"></md-editor>
      <div class="j-foot meta"></div>
    </article>`;
  const $ = <T extends Element>(sel: string) => body.querySelector<T>(sel)!;
  const newBtn = $<HTMLButtonElement>('.j-new');
  newBtn.append(icon('plus'), 'New page');
  const del = $<HTMLButtonElement>('.j-del');
  del.append(icon('x'));
  const list = $<HTMLUListElement>('.j-list');
  const dateEl = $<HTMLElement>('.j-date');
  const titleIn = $<HTMLInputElement>('.j-title');
  const text = $<MdEditor>('.j-text');
  text.placeholder = 'Write, or type / for headings, lists, to-dos…';
  const foot = $<HTMLElement>('.j-foot');
  const status = $<HTMLElement>('.j-status');
  // Markdown that formats itself as you type
  const pad = mdPad(text, 'j-pad');
  const pdfOne = $<HTMLButtonElement>('.j-pdf');
  pdfOne.append(icon('file-down'));
  const asSection = (e: { date: string; title: string; body: string }) => ({
    title: e.title || 'Untitled',
    meta: new Date(`${e.date}T00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    body: e.body,
  });
  pdfOne.addEventListener('click', () => {
    flush();
    const date = draftDate;
    printPdf(`Haru Journal ${date}`, 'Journal', [asSection({ date, title: titleIn.value.trim(), body: text.value })]);
  });
  const entries = () => journalStore.all();

  // ---- Share: a copy of the page goes to the Archive, for everyone invited (signed in only)
  const shareBtn = $<HTMLButtonElement>('.j-share');
  shareBtn.append(icon('share'));
  onSession((s) => (shareBtn.hidden = !s));
  shareBtn.hidden = !session();
  shareBtn.addEventListener('click', async () => {
    flush();
    const s = session();
    const page = openId ? entries().find((e) => e.id === openId) : undefined;
    if (!s) return;
    if (!page) {
      tell('Write something to share first');
      return;
    }
    try {
      await sharePage(s, page);
      tell('Shared to Archive', () => void unsharePage(s, s.uid, page.id).catch(() => {}));
    } catch {
      tell('Couldn’t share. Check your connection.');
    }
  });
  /** The page in the editor; null = a fresh page that becomes an entry once something is written. */
  let openId: string | null = null;
  let draftDate = dayKey();

  // ---- a line under the folder bar: what just happened, with Undo where it can be taken back
  let statusTimer = 0;
  function tell(msg: string, undo?: () => void): void {
    status.replaceChildren(msg);
    if (undo) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-text j-undo';
      b.textContent = 'Undo';
      b.addEventListener('click', () => {
        undo();
        tell('Restored');
      });
      status.append(b);
    }
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => status.replaceChildren(), undo ? 5000 : 3000);
  }

  // ---- folders: every page lives in one; the open folder is the tab
  const tabsEl = $<HTMLElement>('.j-folders');
  const folderBtn = $<HTMLButtonElement>('.j-folder');
  folderBtn.prepend(icon('notebook-pen'));
  folderBtn.append(icon('chevron-down'));
  /** The folder the open page is in (a blank page: the open folder). */
  let pageFolder = '';
  const folders = () => folderStore.all();
  let tab = '';
  try {
    tab = localStorage.getItem(TAB_KEY) ?? '';
  } catch {
    // the first folder
  }
  const validTab = () => (folders().some((f) => f.id === tab) ? tab : folders()[0]?.id ?? '');
  const inTab = (e: Entry) => e.folder === validTab();
  function setTab(next: string): void {
    tab = next;
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // for this visit
    }
    // the editor follows: the folder's newest page, or a blank one
    const page = openId ? entries().find((e) => e.id === openId) : undefined;
    if (page && !inTab(page)) {
      const newest = [...entries()].filter(inTab).sort((x, y) => y.date.localeCompare(x.date) || y.created - x.created)[0];
      open(newest?.id ?? null);
      return;
    }
    renderFolders();
    renderList();
  }

  /**
   * Every page in a folder: makes the first folder when there is none and files pages that have no (or a
   * missing) folder into the open one. Runs once both stores have their IndexedDB copies, so it never
   * stamps a stale list as the newest.
   */
  let filed = false;
  function fileEverything(): void {
    if (!filed) return;
    if (!folders().length) folderStore.set([{ id: newId(), name: FIRST_FOLDER, created: Date.now() }]);
    const home = validTab();
    const ids = new Set(folders().map((f) => f.id));
    if (entries().some((e) => !e.folder || !ids.has(e.folder))) {
      journalStore.set(entries().map((e) => (e.folder && ids.has(e.folder) ? e : { ...e, folder: home })));
    }
  }
  void Promise.all([journalStore.ready, folderStore.ready]).then(() => {
    filed = true;
    fileEverything();
    renderFolders();
    renderList();
  });

  /**
   * Moves pages to a folder (the picker, or a drop on a folder tab). `follow` opens the destination tab too,
   * so the open page stays in the list beside it instead of vanishing from the old folder's.
   */
  function moveTo(ids: string[], folder: string, follow = false): void {
    const f = folders().find((x) => x.id === folder);
    if (!f) return;
    const before = entries();
    const moving = before.filter((e) => ids.includes(e.id) && e.folder !== folder);
    if (!moving.length) return;
    const from = validTab();
    journalStore.set(before.map((e) => (moving.includes(e) ? { ...e, folder, updated: Date.now() } : e)));
    if (follow) setTab(folder);
    tell(`Moved to ${f.name}`, () => {
      const back = new Map(moving.map((e) => [e.id, e.folder]));
      journalStore.set(entries().map((e) => (back.has(e.id) ? { ...e, folder: back.get(e.id) } : e)));
      if (follow) setTab(from);
    });
  }

  /** Renames a folder (a dialog asks for the name). */
  async function renameFolder(f: Folder): Promise<void> {
    const name = await askText({ title: 'Rename folder', label: 'Folder name', value: f.name, ok: 'Rename', icon: 'pencil', max: 40 });
    if (name && name !== f.name) folderStore.set(folders().map((x) => (x.id === f.id ? { ...x, name } : x)));
  }
  /** Deletes a folder and its pages (after asking); Undo brings both back. */
  async function deleteFolder(f: Folder): Promise<void> {
    flush();
    const pages = entries().filter((e) => e.folder === f.id);
    const yes = await askConfirm({
      title: `Delete “${f.name}”?`,
      body: pages.length ? `Its ${pages.length} ${pages.length === 1 ? 'page goes' : 'pages go'} with it. You can undo this for a few seconds.` : 'The folder is empty.',
      danger: true,
    });
    if (!yes) return;
    const at = folders().indexOf(f);
    journalStore.set(entries().filter((e) => e.folder !== f.id));
    folderStore.set(folders().filter((x) => x.id !== f.id));
    if (openId && pages.some((p) => p.id === openId)) forget();
    fileEverything();
    setTab(folders()[Math.max(0, at - 1)]?.id ?? '');
    open(null);
    tell(`Deleted ${f.name}`, () => {
      // back where it was, with its pages
      const now = folders().filter((x) => x.id !== f.id);
      folderStore.set([...now.slice(0, at), f, ...now.slice(at)]);
      const have = new Set(entries().map((e) => e.id));
      journalStore.set([...pages.filter((p) => !have.has(p.id)), ...entries()]);
      setTab(f.id);
    });
  }
  const folderMenu = (f: Folder, at: HTMLElement | { x: number; y: number }) =>
    showMenu(at, [
      { label: 'Rename', icon: 'pencil', run: () => void renameFolder(f) },
      { label: 'Delete folder', icon: 'trash', danger: true, run: () => void deleteFolder(f) },
    ]);

  function renderFolders(): void {
    const cur = validTab();
    const all = entries();
    const chips = folders().map((f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip j-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(f.id === cur));
      b.innerHTML = '<span class="j-tab-name"></span><span class="j-tab-n"></span>';
      b.firstElementChild!.textContent = f.name;
      b.lastElementChild!.textContent = String(all.filter((e) => e.folder === f.id).length);
      b.title = `${f.name} · drop a page here to move it`;
      b.addEventListener('click', () => setTab(f.id));
      // right-click: rename or delete
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        folderMenu(f, { x: e.clientX, y: e.clientY });
      });
      // a page dragged from the list lands here
      b.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes('text/x-haru-page')) return;
        e.preventDefault();
        b.classList.add('drop');
      });
      b.addEventListener('dragleave', () => b.classList.remove('drop'));
      b.addEventListener('drop', (e) => {
        e.preventDefault();
        b.classList.remove('drop');
        const id = e.dataTransfer?.getData('text/x-haru-page');
        if (id) moveTo([id], f.id);
      });
      return b;
    });
    // the open folder's ⋯ sits at the end of the row, so picking a folder never moves the tabs
    const openFolder = folders().find((x) => x.id === cur);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'chip j-tab-more';
    more.setAttribute('aria-label', `${openFolder?.name ?? 'Folder'} options`);
    more.title = 'Rename or delete this folder';
    more.append(icon('ellipsis'));
    more.hidden = !openFolder;
    more.addEventListener('click', () => openFolder && folderMenu(openFolder, more));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chip j-tab-add';
    add.setAttribute('aria-label', 'New folder');
    add.title = 'New folder';
    add.append(icon('plus'));
    add.addEventListener('click', async () => {
      const name = await askText({ title: 'New folder', label: 'Folder name', placeholder: 'e.g. School, Ideas', ok: 'Create', icon: 'plus', max: 40 });
      if (!name) return;
      const f: Folder = { id: newId(), name, created: Date.now() };
      folderStore.set([...folders(), f]);
      setTab(f.id);
      // a new folder starts on a blank page
      open(null);
    });
    tabsEl.replaceChildren(...chips, add, more);
    // the editor's picker: which folder this page is in
    const e = openId ? entries().find((x) => x.id === openId) : undefined;
    pageFolder = e?.folder && folders().some((x) => x.id === e.folder) ? e.folder : cur;
    folderBtn.querySelector('.j-folder-name')!.textContent = folders().find((x) => x.id === pageFolder)?.name ?? '';
    folderBtn.setAttribute('aria-label', `In ${folderBtn.textContent}. Move to another folder`);
  }
  // moving the page: a menu of the other folders
  folderBtn.addEventListener('click', () => {
    flush();
    const others = folders().filter((f) => f.id !== pageFolder);
    if (!others.length) {
      tell('Make another folder to move pages into');
      return;
    }
    showMenu(folderBtn, others.map((f) => ({
      label: `Move to ${f.name}`,
      icon: 'arrow-right',
      run: () => {
        if (openId) moveTo([openId], f.id, true);
        // a blank page: it will be written into that folder, so its tab opens now
        else setTab(f.id);
      },
    })));
  });
  folderStore.onChange(() => {
    fileEverything();
    renderFolders();
    renderList();
  });

  /** The open page is gone (deleted): drop it from the editor without saving what it showed. */
  function forget(): void {
    clearTimeout(timer);
    openId = null;
    titleIn.value = '';
    text.value = '';
  }

  function open(id: string | null, date = dayKey()): void {
    flush();
    openId = id;
    const e = id ? entries().find((x) => x.id === id) : undefined;
    draftDate = e?.date ?? date;
    dateEl.textContent = new Date(`${draftDate}T00:00`).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    titleIn.value = e?.title ?? '';
    text.value = e?.body ?? '';
    pad.refresh();
    del.hidden = !e;
    renderFoot();
    renderFolders();
    renderList();
  }

  // ---- saving as you type
  let timer = 0;
  function schedule(): void {
    clearTimeout(timer);
    timer = window.setTimeout(flush, 500);
  }
  function flush(): void {
    clearTimeout(timer);
    timer = 0;
    const title = titleIn.value.trim();
    const bodyText = text.value;
    const all = entries();
    const cur = openId ? all.find((x) => x.id === openId) : undefined;
    if (!cur) {
      // nothing written yet: no empty pages
      if (!title && !bodyText.trim()) return;
      const now = Date.now();
      // into the open folder (filed later if the folders haven't loaded yet)
      const folder = pageFolder || validTab() || undefined;
      const e: Entry = { id: newId(), date: draftDate, title, body: bodyText, created: now, updated: now, ...(folder ? { folder } : {}) };
      openId = e.id;
      del.hidden = false;
      journalStore.set([e, ...all]);
    } else {
      if (cur.title === title && cur.body === bodyText) return;
      journalStore.set(all.map((x) => (x.id === cur.id ? { ...x, title, body: bodyText, updated: Date.now() } : x)));
    }
  }
  titleIn.addEventListener('input', () => {
    schedule();
    renderFoot();
  });
  text.addEventListener('input', () => {
    schedule();
    renderFoot();
  });
  // leaving the page or tab never loses the last few keystrokes
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  newBtn.addEventListener('click', () => {
    open(null);
    titleIn.focus();
  });

  /** Deletes a page (asks first); Undo brings it back. */
  async function removePage(id: string): Promise<void> {
    if (id === openId) flush();
    const page = entries().find((x) => x.id === id);
    if (!page || !(await askConfirm({ title: `Delete “${page.title || 'Untitled'}”?`, body: 'You can undo this for a few seconds.', danger: true }))) return;
    journalStore.set(entries().filter((x) => x.id !== id));
    if (id === openId) {
      forget();
      open(null);
    }
    tell('Page deleted', () => {
      if (!entries().some((x) => x.id === page.id)) journalStore.set([page, ...entries()]);
    });
  }
  del.addEventListener('click', () => {
    if (openId) void removePage(openId);
  });

  function renderFoot(): void {
    const n = wordCount(`${titleIn.value} ${text.value}`);
    foot.textContent = n ? `${n} ${n === 1 ? 'word' : 'words'} · ${Math.max(1, Math.round(n / 200))} min read` : 'Saved as you type';
  }


  function renderList(): void {
    const shown = [...entries()]
      .filter(inTab)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'j-empty';
      li.textContent = 'No pages in this folder yet';
      list.replaceChildren(li);
      return;
    }
    const out: HTMLElement[] = [];
    let month = '';
    for (const e of shown) {
      const m = e.date.slice(0, 7);
      if (m !== month) {
        month = m;
        const h = document.createElement('li');
        h.className = 'j-month meta';
        h.textContent = new Date(`${m}-01T00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        out.push(h);
      }
      const li = document.createElement('li');
      li.className = 'j-row';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `j-item${e.id === openId ? ' on' : ''}`;
      b.draggable = true;
      b.innerHTML = '<span class="j-i-top"><span class="j-i-title"></span><span class="meta j-i-date"></span></span><span class="j-i-prev"></span>';
      // the list shows words, not Markdown marks
      const lines = e.body.split(/\r?\n/).map(plain).filter(Boolean);
      b.querySelector('.j-i-title')!.textContent = e.title || lines[0] || 'Untitled';
      b.querySelector('.j-i-date')!.textContent = fmtDay(e.date);
      b.querySelector('.j-i-prev')!.textContent = (e.title ? lines : lines.slice(1)).join(' · ').slice(0, 140);
      b.addEventListener('click', () => open(e.id));
      // drag onto a folder tab to move it there
      b.addEventListener('dragstart', (ev) => {
        if (e.id === openId) flush();
        ev.dataTransfer?.setData('text/x-haru-page', e.id);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        tabsEl.classList.add('dropping');
      });
      b.addEventListener('dragend', () => tabsEl.classList.remove('dropping'));
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tpl-del j-row-del';
      x.setAttribute('aria-label', `Delete ${e.title || 'Untitled'}`);
      x.append(icon('x'));
      x.addEventListener('click', () => void removePage(e.id));
      li.append(b, x);
      out.push(li);
    }
    list.replaceChildren(...out);
  }

  journalStore.onChange(() => {
    fileEverything();
    renderFolders();
    renderList();
  });
  // start on today's page in the open folder, if there is one
  open(entries().find((e) => e.date === dayKey() && inTab(e))?.id ?? null);
  journalStore.onChange(() => {
    // the stored copy arrived late (IndexedDB) while the page still shows a blank: open today's
    if (!openId && !titleIn.value && !text.value) {
      const today = entries().find((e) => e.date === dayKey() && inTab(e));
      if (today) open(today.id);
    }
  });
}
