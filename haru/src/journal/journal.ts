import { listStore } from '../storage/list-store';
import { dayKey, timetableOn } from '../timetable/history';
import { progressOf } from '../timetable/model';
import { icon } from '../ui/icons';
import { mdPad } from '../ui/md-pad';
import { printPdf } from '../ui/print';

/**
 * Journal: pages written in your own words — a summary of the day, a thought, a plan — always filed in a
 * folder (tabs over the list). The list keeps a folder's pages by date; the editor saves as you type. Next
 * to the date, how that day's timetable went. Pages move between folders (the picker, or drag one onto a
 * folder tab); deleting a page or a folder asks first and can be undone for a few seconds.
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
const fmtDay = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function mountJournal(body: HTMLElement, sum: HTMLElement): void {
  body.innerHTML = `
    <aside class="j-side glass-card" aria-label="Pages">
      <div class="j-side-head">
        <span class="card-title">Folders</span>
        <button type="button" class="btn-sm j-new"></button>
      </div>
      <div class="j-folders" role="tablist" aria-label="Folders"></div>
      <div class="j-folder-bar">
        <input class="j-folder-name" maxlength="40" aria-label="Folder name">
        <button type="button" class="btn-text danger j-folder-del">Delete folder</button>
      </div>
      <p class="meta j-status" aria-live="polite"></p>
      <input type="search" class="j-search" placeholder="Search this folder" aria-label="Search this folder">
      <ul class="j-list"></ul>
    </aside>
    <article class="j-editor glass-card">
      <div class="j-ed-head">
        <input type="date" class="j-date" aria-label="Date">
        <select class="j-folder" aria-label="Move to folder" title="Move to folder"></select>
        <span class="meta j-day"></span>
        <span class="meta j-saved" aria-live="polite"></span>
        <button type="button" class="icon-btn j-pdf" aria-label="Export this page as PDF" title="Export as PDF"></button>
        <button type="button" class="icon-btn j-del" aria-label="Delete page" title="Delete page"></button>
      </div>
      <input class="j-title" placeholder="Title" maxlength="120" aria-label="Title">
      <textarea class="j-text" placeholder="Write about your day…  (Markdown: # heading, **bold**, - list, - [ ] to-do)" aria-label="Page (Markdown)"></textarea>
      <div class="j-foot meta"></div>
    </article>`;
  const $ = <T extends Element>(sel: string) => body.querySelector<T>(sel)!;
  const newBtn = $<HTMLButtonElement>('.j-new');
  newBtn.append(icon('plus'), 'New page');
  const del = $<HTMLButtonElement>('.j-del');
  del.append(icon('x'));
  const list = $<HTMLUListElement>('.j-list');
  const search = $<HTMLInputElement>('.j-search');
  const dateIn = $<HTMLInputElement>('.j-date');
  const titleIn = $<HTMLInputElement>('.j-title');
  const text = $<HTMLTextAreaElement>('.j-text');
  const dayInfo = $<HTMLElement>('.j-day');
  const saved = $<HTMLElement>('.j-saved');
  const foot = $<HTMLElement>('.j-foot');
  const status = $<HTMLElement>('.j-status');
  // Markdown: plain text while writing, the rendered page once you click away
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
    const date = dateIn.value || draftDate;
    printPdf(`Haru Journal ${date}`, 'Journal', [asSection({ date, title: titleIn.value.trim(), body: text.value })]);
  });
  const entries = () => journalStore.all();
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
        status.replaceChildren('Restored');
      });
      status.append(b);
    }
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => status.replaceChildren(), undo ? 10000 : 3000);
  }

  // ---- folders: every page lives in one; the open folder is the tab
  const tabsEl = $<HTMLElement>('.j-folders');
  const barName = $<HTMLInputElement>('.j-folder-name');
  const folderSel = $<HTMLSelectElement>('.j-folder');
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
    search.value = '';
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

  /** Moves pages to a folder (the picker, or a drop on a folder tab). */
  function moveTo(ids: string[], folder: string): void {
    const f = folders().find((x) => x.id === folder);
    if (!f) return;
    const before = entries();
    const moving = before.filter((e) => ids.includes(e.id) && e.folder !== folder);
    if (!moving.length) return;
    journalStore.set(before.map((e) => (moving.includes(e) ? { ...e, folder, updated: Date.now() } : e)));
    tell(`Moved to ${f.name}`, () => {
      const back = new Map(moving.map((e) => [e.id, e.folder]));
      journalStore.set(entries().map((e) => (back.has(e.id) ? { ...e, folder: back.get(e.id) } : e)));
    });
  }

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
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chip j-tab-add';
    add.setAttribute('aria-label', 'New folder');
    add.title = 'New folder';
    add.append(icon('plus'));
    add.addEventListener('click', () => {
      const name = prompt('Folder name')?.trim();
      if (!name) return;
      const f: Folder = { id: newId(), name: name.slice(0, 40), created: Date.now() };
      folderStore.set([...folders(), f]);
      setTab(f.id);
      // a new folder starts on a blank page
      open(null);
    });
    tabsEl.replaceChildren(...chips, add);
    // the open folder can be renamed or deleted
    const f = folders().find((x) => x.id === cur);
    if (f && document.activeElement !== barName) barName.value = f.name;
    barName.disabled = !f;
    $<HTMLButtonElement>('.j-folder-del').disabled = !f;
    // the editor's picker: which folder this page is in
    folderSel.replaceChildren(...folders().map((x) => new Option(x.name, x.id)));
    const e = openId ? entries().find((x) => x.id === openId) : undefined;
    folderSel.value = e?.folder && folders().some((x) => x.id === e.folder) ? e.folder : cur;
  }
  barName.addEventListener('change', () => {
    const name = barName.value.trim();
    if (!name) return renderFolders();
    const id = validTab();
    folderStore.set(folders().map((f) => (f.id === id ? { ...f, name: name.slice(0, 40) } : f)));
  });
  $<HTMLButtonElement>('.j-folder-del').addEventListener('click', () => {
    const f = folders().find((x) => x.id === validTab());
    if (!f) return;
    flush();
    const pages = entries().filter((e) => e.folder === f.id);
    if (!confirm(pages.length
      ? `Delete the folder “${f.name}” and its ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}?`
      : `Delete the folder “${f.name}”?`)) return;
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
  });
  folderSel.addEventListener('change', () => {
    flush();
    if (openId) moveTo([openId], folderSel.value);
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
    dateIn.value = draftDate;
    titleIn.value = e?.title ?? '';
    text.value = e?.body ?? '';
    pad.refresh();
    del.hidden = !e;
    saved.textContent = '';
    renderFoot();
    renderFolders();
    renderList();
    void renderDay();
  }

  // ---- saving as you type
  let timer = 0;
  function schedule(): void {
    clearTimeout(timer);
    saved.textContent = 'Editing…';
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
      const folder = validTab() || undefined;
      const e: Entry = { id: newId(), date: dateIn.value || draftDate, title, body: bodyText, created: now, updated: now, ...(folder ? { folder } : {}) };
      openId = e.id;
      del.hidden = false;
      journalStore.set([e, ...all]);
    } else {
      if (cur.title === title && cur.body === bodyText && cur.date === (dateIn.value || cur.date)) return;
      journalStore.set(all.map((x) => (x.id === cur.id ? { ...x, title, body: bodyText, date: dateIn.value || x.date, updated: Date.now() } : x)));
    }
    saved.textContent = `Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }
  titleIn.addEventListener('input', () => {
    schedule();
    renderFoot();
  });
  text.addEventListener('input', () => {
    schedule();
    renderFoot();
  });
  dateIn.addEventListener('change', () => {
    if (!dateIn.value) dateIn.value = draftDate;
    draftDate = dateIn.value;
    flush();
    void renderDay();
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
  function removePage(id: string): void {
    if (id === openId) flush();
    const page = entries().find((x) => x.id === id);
    if (!page || !confirm(`Delete the page “${page.title || 'Untitled'}”?`)) return;
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
    if (openId) removePage(openId);
  });
  search.addEventListener('input', renderList);

  function renderFoot(): void {
    const n = wordCount(`${titleIn.value} ${text.value}`);
    foot.textContent = n ? `${n} ${n === 1 ? 'word' : 'words'} · ${Math.max(1, Math.round(n / 200))} min read` : 'Saved as you type';
  }

  /** How the page's day went on the timetable (only for days Haru has a record of). */
  async function renderDay(): Promise<void> {
    const date = dateIn.value || draftDate;
    dayInfo.textContent = fmtDay(date);
    const t = await timetableOn(date).catch(() => null);
    if ((dateIn.value || draftDate) !== date) return;
    if (t && !t.carried && t.snap.blocks.length) {
      const { done, planned } = progressOf(t.snap.blocks);
      dayInfo.textContent = `${fmtDay(date)} · ${planned ? Math.round((done / planned) * 100) : 0}% of plan done`;
    }
  }

  function renderList(): void {
    const q = search.value.trim().toLowerCase();
    const shown = [...entries()]
      .filter((e) => inTab(e) && (!q || e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'j-empty';
      li.textContent = q ? 'No match' : 'No pages in this folder yet';
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
      const firstLine = e.body.trim().split(/\r?\n/)[0] ?? '';
      b.querySelector('.j-i-title')!.textContent = e.title || firstLine || 'Untitled';
      b.querySelector('.j-i-date')!.textContent = fmtDay(e.date);
      b.querySelector('.j-i-prev')!.textContent = (e.title ? e.body : e.body.trim().split(/\r?\n/).slice(1).join(' ')).trim().slice(0, 140);
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
      x.addEventListener('click', () => removePage(e.id));
      li.append(b, x);
      out.push(li);
    }
    list.replaceChildren(...out);
  }

  function renderSum(): void {
    const all = entries();
    const words = all.reduce((n, e) => n + wordCount(`${e.title} ${e.body}`), 0);
    sum.textContent = all.length ? `${folders().length} ${folders().length === 1 ? 'folder' : 'folders'} · ${all.length} ${all.length === 1 ? 'page' : 'pages'} · ${words} words` : '';
  }

  journalStore.onChange(() => {
    fileEverything();
    renderFolders();
    renderList();
    renderSum();
  });
  folderStore.onChange(renderSum);
  // start on today's page in the open folder, if there is one
  open(entries().find((e) => e.date === dayKey() && inTab(e))?.id ?? null);
  renderSum();
  journalStore.onChange(() => {
    // the stored copy arrived late (IndexedDB) while the page still shows a blank: open today's
    if (!openId && !titleIn.value && !text.value) {
      const today = entries().find((e) => e.date === dayKey() && inTab(e));
      if (today) open(today.id);
    }
  });
}
