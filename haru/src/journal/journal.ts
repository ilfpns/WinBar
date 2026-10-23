import { dayKey } from '../timetable/history';
import { icon } from '../ui/icons';
import { mdPad } from '../ui/md-pad';
import { type MdEditor } from '../ui/md-editor';
import { printPdf } from '../ui/print';
import { IMG_LINE } from '../ui/markdown';
import { askConfirm, askText, showMenu } from '../ui/modal';
import { onSession, session } from '../cloud/session';
import { mentionable } from '../cloud/viewing';
import { sharePage, unsharePage } from '../archive/archive';
import { type Entry, type Folder, ROOT, folderStore, journalStore, newId, wordCount } from './journal-store';
import { mountPhotos } from './journal-photos';
import { mountTree } from './journal-tree';

export { type Entry, type Folder, folderStore, journalStore } from './journal-store';

/** Which folder was open (per browser). */
const TAB_KEY = 'haru:journal-folder';

/**
 * Journal: pages written in your own words — a summary of the day, a thought, a plan — always filed in a
 * folder (tabs over the list). The list keeps a folder's pages by date; the editor saves as you type. Next
 * to the date, how that day's timetable went. Pages move between folders (the picker, or drag one onto a
 * folder tab; a folder's ⋯ or right-click renames or deletes it); deleting asks first and can be undone for a few seconds.
 */
export function mountJournal(body: HTMLElement): void {
  body.innerHTML = `
    <aside class="j-side tree glass-card" aria-label="Pages">
      <div class="j-side-head">
        <span class="card-title">Folders</span>
        <button type="button" class="icon-btn j-new-folder" aria-label="New folder" title="New folder"></button>
        <button type="button" class="btn-sm j-new"></button>
      </div>
      <p class="meta j-status" aria-live="polite"></p>
      <ul class="j-list"></ul>
    </aside>
    <article class="j-editor glass-card">
      <div class="j-ed-head">
        <span class="j-date"></span>
        <button type="button" class="j-folder" aria-haspopup="menu" title="Move to another folder"><span class="j-folder-name"></span></button>
        <span class="j-head-fill"></span>
        <button type="button" class="icon-btn j-pin" aria-pressed="false" aria-label="Pin to top" title="Pin to top"></button>
        <button type="button" class="icon-btn j-add-img" aria-label="Add photos" title="Add photos (or paste with Ctrl+V)"></button>
        <input type="file" class="j-img-file" accept="image/*" multiple hidden>
        <button type="button" class="icon-btn j-share" aria-label="Share to Archive" title="Share to Archive" hidden></button>
        <button type="button" class="icon-btn j-pdf" aria-label="Export this page as PDF" title="Export as PDF"></button>
        <button type="button" class="icon-btn j-del" aria-label="Delete page" title="Delete page"></button>
      </div>
      <input class="j-title" placeholder="Title" maxlength="120" aria-label="Title">
      <md-editor class="j-text" aria-label="Page (Markdown)"></md-editor>
      <div class="cal-images j-images" hidden></div>
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
    imageUrl: photoUrl,
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
  const isFolder = (id: string | undefined) => !!id && folders().some((f) => f.id === id);
  const validTab = () => (tab === ROOT || isFolder(tab) ? tab : folders()[0]?.id ?? ROOT);
  /** Where a page sits: its folder, or the root. */
  const folderOf = (e: Entry) => (isFolder(e.folder) ? e.folder! : ROOT);
  const inTab = (e: Entry) => folderOf(e) === validTab();
  const placeName = (id: string) => (id === ROOT ? 'Root' : folders().find((f) => f.id === id)?.name ?? '');
  /** A page put in `folder` (the root: no folder at all). */
  const filedIn = (e: Entry, folder: string | undefined): Entry => {
    const { folder: _, ...rest } = e;
    return folder && folder !== ROOT ? { ...rest, folder } : rest;
  };
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

  void Promise.all([journalStore.ready, folderStore.ready]).then(() => {
    renderFolders();
    renderList();
  });

  /**
   * Moves pages to a folder (the picker, or a drop on a folder tab). `follow` opens the destination tab too,
   * so the open page stays in the list beside it instead of vanishing from the old folder's.
   */
  function moveTo(ids: string[], folder: string, follow = false): void {
    if (folder !== ROOT && !isFolder(folder)) return;
    const before = entries();
    const moving = before.filter((e) => ids.includes(e.id) && folderOf(e) !== folder);
    if (!moving.length) return;
    const from = validTab();
    journalStore.set(before.map((e) => (moving.includes(e) ? { ...filedIn(e, folder), updated: Date.now() } : e)));
    if (follow) setTab(folder);
    tell(`Moved to ${placeName(folder)}`, () => {
      const back = new Map(moving.map((e) => [e.id, e.folder]));
      journalStore.set(entries().map((e) => (back.has(e.id) ? filedIn(e, back.get(e.id)) : e)));
      if (follow) setTab(from);
    });
  }

  /** Whether another folder already carries `name` (case and surrounding spaces aside). */
  const folderNamed = (name: string, except?: string) => folders().some((x) => x.id !== except && x.name.trim().toLowerCase() === name.trim().toLowerCase());
  /** Renames a folder (a dialog asks for the name). */
  async function renameFolder(f: Folder): Promise<void> {
    const name = await askText({ title: 'Rename folder', label: 'Folder name', value: f.name, ok: 'Rename', icon: 'pencil', max: 40 });
    if (!name || name === f.name) return;
    if (folderNamed(name, f.id)) return tell('A folder with that name already exists');
    folderStore.set(folders().map((x) => (x.id === f.id ? { ...x, name } : x)));
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
    setTab(folders()[Math.max(0, at - 1)]?.id ?? ROOT);
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

  /** A new folder (a dialog asks for its name); it opens on a blank page. */
  async function newFolder(): Promise<void> {
    const name = await askText({ title: 'New folder', label: 'Folder name', placeholder: 'e.g. School, Ideas', ok: 'Create', icon: 'plus', max: 40 });
    if (!name) return;
    if (folderNamed(name)) return tell('A folder with that name already exists');
    const f: Folder = { id: newId(), name, created: Date.now() };
    folderStore.set([...folders(), f]);
    setTab(f.id);
    open(null);
  }
  const newFolderBtn = $<HTMLButtonElement>('.j-new-folder');
  newFolderBtn.append(icon('folder-plus'));
  newFolderBtn.addEventListener('click', () => void newFolder());

  /** The editor's folder picker: which folder (or the root) the page is in. */
  function renderFolders(): void {
    const cur = validTab();
    // the editor's picker: which folder this page is in
    const e = openId ? entries().find((x) => x.id === openId) : undefined;
    pageFolder = e ? folderOf(e) : cur;
    folderBtn.querySelector('.j-folder-name')!.textContent = placeName(pageFolder);
    folderBtn.setAttribute('aria-label', `In ${folderBtn.textContent}. Move to another folder`);
  }
  // moving the page: a menu of the other folders
  folderBtn.addEventListener('click', () => {
    flush();
    const places = [ROOT, ...folders().map((f) => f.id)].filter((id) => id !== pageFolder);
    if (!places.length) {
      tell('Make another folder to move pages into');
      return;
    }
    showMenu(folderBtn, places.map((id) => ({
      label: `Move to ${placeName(id)}`,
      icon: id === ROOT ? 'folder-tree' : 'arrow-right',
      run: () => {
        if (openId) moveTo([openId], id, true);
        // a blank page: it will be written there, so its tab opens now
        else setTab(id);
      },
    })));
  });
  folderStore.onChange(() => {
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
    renderPhotos();
    paintPin();
    renderFolders();
    renderList();
  }

  // ---- saving as you type
  let timer = 0;
  function schedule(): void {
    clearTimeout(timer);
    timer = window.setTimeout(flush, 500);
  }
  /** Saves the page. `create`: make the page even with nothing written (a photo added to a blank page). */
  function flush(create = false): void {
    clearTimeout(timer);
    timer = 0;
    const title = titleIn.value.trim();
    const bodyText = text.value;
    const all = entries();
    const cur = openId ? all.find((x) => x.id === openId) : undefined;
    if (!cur) {
      // nothing written yet: no empty pages
      if (!create && !title && !bodyText.trim()) return;
      const now = Date.now();
      // into the open folder (filed later if the folders haven't loaded yet)
      const place = pageFolder || validTab();
      const folder = place && place !== ROOT ? place : undefined;
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
    renderPhotos();
  });
  // leaving the page or tab never loses the last few keystrokes
  addEventListener('pagehide', () => flush());
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

  // ---- pinning: a pinned page stays at the top of its folder's list
  const pinBtn = $<HTMLButtonElement>('.j-pin');
  pinBtn.append(icon('pin'));
  function togglePin(id: string): void {
    if (id === openId) flush();
    const page = entries().find((e) => e.id === id);
    if (!page) return;
    // unpinned pages carry no flag at all (no empty field in the store)
    const { pinned, ...rest } = page;
    journalStore.set(entries().map((e) => (e.id === id ? (pinned ? rest : { ...rest, pinned: true }) : e)));
    tell(pinned ? 'Unpinned' : 'Pinned to the top');
  }
  function paintPin(): void {
    const page = openId ? entries().find((e) => e.id === openId) : undefined;
    pinBtn.hidden = !page;
    const on = !!page?.pinned;
    pinBtn.setAttribute('aria-pressed', String(on));
    pinBtn.setAttribute('aria-label', on ? 'Unpin' : 'Pin to top');
    pinBtn.title = on ? 'Unpin' : 'Pin to top';
  }
  pinBtn.addEventListener('click', () => {
    if (openId) togglePin(openId);
  });
  journalStore.onChange(paintPin);

  // ---- photos: in the text where the caret is, or under it (journal-photos.ts)
  const { photoUrl, renderPhotos } = mountPhotos({ body, text, titleIn, openId: () => openId, flush, tell });
  // @ names someone invited (yourself aside); shared to Archive, they see a dot until they read it
  text.people = () => mentionable(session()?.uid);

  function renderFoot(): void {
    const n = wordCount(`${titleIn.value} ${text.value.split('\n').filter((l) => !IMG_LINE.test(l)).join('\n')}`);
    foot.textContent = n ? `${n} ${n === 1 ? 'word' : 'words'} · ${Math.max(1, Math.round(n / 200))} min read` : 'Saved as you type';
  }


  // ---- the pages as a tree (journal-tree.ts)
  const renderTree = mountTree({
    list, entries, folders, openId: () => openId, validTab, folderOf, placeName, setTab, open, flush, togglePin, moveTo, removePage, folderMenu,
  });

  const renderList = () => renderTree();

  journalStore.onChange(() => {
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
