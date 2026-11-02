import { icon, type IconName } from '../ui/icons';
import { renderMarkdown } from '../ui/markdown';
import { askConfirm, askText, showMenu } from '../ui/modal';
import { onView } from '../ui/router';
import { githubDriver } from './github';
import { notionDriver } from './notion';
import { allowVault, canPickFolder, forgetVault, obsidianDriver, pickVault } from './obsidian';
import { type Driver, type Item, NeedsAccess, type SourceConf, type SourceKind, newSourceId, onSources, removeSource, saveSource, sources, tokenOf } from './sources';

/**
 * Library: notes kept elsewhere — an Obsidian vault, a folder of a GitHub repo, a Notion workspace — looked through
 * in Haru. One folder at a time is fanned out as cards (folders stacked like files in a drawer, notes as single
 * sheets); the one in the middle is upright and lit, the rest lean away to each side. Opening a folder steps into
 * it — the path above the fan steps back out — and opening a note reads it in the panel below, where vault and
 * GitHub notes can be changed too: saved to the file, or committed to the repo, a moment after typing stops.
 * Recent lists the notes changed last, from every folder. Separate from Journal: nothing here is synced by Haru.
 */
const KIND: Record<SourceKind, { label: string; icon: IconName; hint: string }> = {
  obsidian: { label: 'Obsidian vault', icon: 'gem', hint: 'A folder on this computer' },
  github: { label: 'GitHub folder', icon: 'git-branch', hint: 'A repo and a path; saving commits' },
  notion: { label: 'Notion workspace', icon: 'book-text', hint: 'Pages shared with an integration' },
};
const CURRENT = 'haru:library-current';
/** Cards drawn either side of the one in the middle (the rest are off the fan). */
const REACH = 14;
/** Wait after the last keystroke before saving: a file is cheap, a commit is not. */
const SAVE_AFTER: Record<SourceKind, number> = { obsidian: 900, github: 4000, notion: 0 };
const WIKI = 'https://wiki.haru.invalid/';

type Filter = 'all' | 'folder' | 'note';

interface Loaded {
  items: Item[];
  byId: Map<string, Item>;
  kids: Map<string | null, Item[]>;
}

const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const yearFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });
const when = (ms?: number) => (!ms ? '' : new Date(ms).getFullYear() === new Date().getFullYear() ? dateFmt.format(ms) : yearFmt.format(ms));
const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86_400 ? `${Math.round(s / 3600)}h ago` : when(ms);
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function iconBtn(name: IconName, label: string, cls = 'lib-ibtn'): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(icon(name));
  return b;
}

/** Front matter (`---` lines at the top) apart from the text, as key–value pairs. */
function splitFrontMatter(src: string): { meta: [string, string][]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: [], body: src };
  const meta = m[1]!.split(/\r?\n/).flatMap((l) => {
    const kv = /^([\w-]+):\s*(.*)$/.exec(l);
    return kv && kv[2]!.trim() ? [[kv[1]!, kv[2]!.replace(/^\[|\]$/g, '').trim()] as [string, string]] : [];
  });
  return { meta, body: src.slice(m[0].length) };
}

/** Obsidian's links in plain Markdown: `[[Note|label]]` a link Haru catches, `![[file]]` its name. */
const wikiToMarkdown = (src: string) => src
  .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, f: string) => `\`${f}\``)
  .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, t: string, label?: string) => `[${label ?? t}](${WIKI}${encodeURIComponent(t.trim())})`);

/** A small form in Haru's dialog: the fields' values, or null when cancelled. */
function askForm(opts: { title: string; icon: IconName; body?: string; ok: string; fields: { key: string; label: string; value?: string; placeholder?: string; secret?: boolean; required?: boolean; hint?: string }[] }): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const dlg = el('dialog', 'modal');
    const form = el('form', 'modal-card lib-form');
    form.method = 'dialog';
    const head = el('div', 'modal-head');
    const ic = el('span', 'modal-icon');
    ic.append(icon(opts.icon));
    head.append(ic, el('h2', 'modal-title', opts.title));
    form.append(head);
    if (opts.body) form.append(el('p', 'modal-body', opts.body));
    const inputs = opts.fields.map((f) => {
      const label = el('label', 'modal-field');
      const input = el('input', 'modal-input');
      input.name = f.key;
      input.value = f.value ?? '';
      input.placeholder = f.placeholder ?? '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      if (f.secret) input.type = 'password';
      label.append(el('span', 'modal-label', f.label), input);
      if (f.hint) label.append(el('span', 'lib-hint', f.hint));
      form.append(label);
      return { f, input };
    });
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn-sm modal-cancel', 'Cancel');
    cancel.type = 'button';
    const ok = el('button', 'modal-ok btn-accent', opts.ok);
    ok.type = 'submit';
    actions.append(cancel, ok);
    form.append(actions);
    dlg.append(form);
    const sync = () => (ok.disabled = inputs.some(({ f, input }) => f.required && !input.value.trim()));
    form.addEventListener('input', sync);
    sync();
    let result: Record<string, string> | null = null;
    const finish = () => {
      dlg.classList.add('closing');
      setTimeout(() => {
        dlg.close();
        dlg.remove();
        resolve(result);
      }, 150);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      result = Object.fromEntries(inputs.map(({ f, input }) => [f.key, input.value.trim()]));
      finish();
    });
    cancel.addEventListener('click', finish);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish();
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) finish();
    });
    document.body.append(dlg);
    dlg.showModal();
    inputs[0]?.input.focus();
  });
}

/** Notes opened last, per source (most recent first): Recent for a source that has no dates. */
const openedKey = (id: string) => `haru:library-opened:${id}`;
function openedIn(source: string): { id: string; at: number }[] {
  try {
    const v = JSON.parse(localStorage.getItem(openedKey(source)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((o): o is { id: string; at: number } => typeof o?.id === 'string' && typeof o?.at === 'number') : [];
  } catch {
    return [];
  }
}
function noteOpened(source: string, id: string): void {
  try {
    localStorage.setItem(openedKey(source), JSON.stringify([{ id, at: Date.now() }, ...openedIn(source).filter((o) => o.id !== id)].slice(0, 20)));
  } catch {
    // not remembered
  }
}

export function mountLibrary(body: HTMLElement, sum: HTMLElement): void {
  const drivers = new Map<string, Driver>();
  const loaded = new Map<string, Loaded>();
  const failed = new Map<string, { message: string; access: boolean }>();
  const loading = new Set<string>();

  let current: string | null = null;
  try {
    current = localStorage.getItem(CURRENT);
  } catch {
    // the first source
  }
  /** Per source: the folder open (null: the top) and the card in the middle. */
  const place = new Map<string, { folder: string | null; focus: number }>();
  let filter: Filter = 'all';
  let query = '';
  let open: Item | null = null;
  let text = '';
  let editing = false;
  let expanded = false;
  let saveTimer = 0;
  let unsaved: { item: Item; text: string } | null = null;
  let status = '';

  // ---------- frame
  const bar = el('div', 'lib-bar');
  const pills = el('div', 'lib-sources');
  pills.setAttribute('role', 'tablist');
  const add = iconBtn('plus', 'Add a source', 'lib-add');
  const tools = el('div', 'lib-tools');
  const search = el('label', 'lib-search');
  const searchInput = el('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search';
  searchInput.setAttribute('aria-label', 'Search notes');
  search.append(icon('search'), searchInput);
  const chips = el('div', 'lib-chips');
  const chipBtns = (['all', 'folder', 'note'] as Filter[]).map((f) => {
    const b = el('button', 'lib-chip', f === 'all' ? 'All' : f === 'folder' ? 'Folders' : 'Notes');
    b.type = 'button';
    b.addEventListener('click', () => {
      filter = f;
      at().focus = 0;
      paint();
    });
    chips.append(b);
    return { f, b };
  });
  tools.append(search, chips);
  bar.append(pills, add, tools);

  const crumbs = el('nav', 'lib-crumbs');
  crumbs.setAttribute('aria-label', 'Folder path');

  const stage = el('div', 'lib-stage');
  stage.tabIndex = 0;
  stage.setAttribute('aria-label', 'Cards; arrow keys move, Enter opens');
  const arc = el('div', 'lib-arc');
  const prev = iconBtn('chevron-left', 'Previous', 'lib-step');
  const next = iconBtn('chevron-right', 'Next', 'lib-step');
  const arcTrack = el('div', 'lib-arc-track');
  const arcDot = el('span', 'lib-arc-dot');
  arcTrack.append(arcDot);
  arc.append(prev, arcTrack, next);
  const fan = el('div', 'lib-fan');
  const empty = el('div', 'lib-empty');
  stage.append(arc, fan, empty);

  const lower = el('div', 'lib-lower');
  const recent = el('section', 'lib-recent glass-card');
  const reader = el('section', 'lib-reader');
  lower.append(recent, reader);

  body.append(bar, crumbs, stage, lower);

  // ---------- data
  const conf = () => sources().find((s) => s.id === current) ?? null;
  const at = () => {
    const id = current ?? '';
    let p = place.get(id);
    if (!p) place.set(id, (p = { folder: null, focus: 0 }));
    return p;
  };
  function driverOf(s: SourceConf): Driver {
    let d = drivers.get(s.id);
    if (!d) drivers.set(s.id, (d = s.kind === 'obsidian' ? obsidianDriver(s) : s.kind === 'github' ? githubDriver(s) : notionDriver(s)));
    return d;
  }
  const order = (a: Item, b: Item) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'folder' ? -1 : 1);
  function index(items: Item[]): Loaded {
    const byId = new Map(items.map((i) => [i.id, i]));
    const kids = new Map<string | null, Item[]>();
    for (const i of items) {
      const p = i.parent !== null && byId.has(i.parent) ? i.parent : null;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p)!.push(i);
    }
    for (const list of kids.values()) list.sort(order);
    return { items, byId, kids };
  }
  async function load(s: SourceConf): Promise<void> {
    if (loading.has(s.id)) return;
    loading.add(s.id);
    failed.delete(s.id);
    paint();
    try {
      loaded.set(s.id, index(await driverOf(s).load()));
    } catch (e) {
      failed.set(s.id, { message: e instanceof NeedsAccess ? 'Allow Haru to open the vault again' : e instanceof Error ? e.message : 'Could not load', access: e instanceof NeedsAccess });
    } finally {
      loading.delete(s.id);
      paint();
    }
  }
  function select(id: string | null): void {
    flushSave();
    current = id;
    open = null;
    editing = false;
    filter = 'all';
    query = '';
    searchInput.value = '';
    try {
      if (id) localStorage.setItem(CURRENT, id);
      else localStorage.removeItem(CURRENT);
    } catch {
      // for this visit
    }
    const s = conf();
    if (s && !loaded.has(s.id) && !failed.has(s.id)) void load(s);
    paint();
  }

  /** What the fan shows: the open folder's contents, or every match when searching. */
  function shown(): Item[] {
    const data = current ? loaded.get(current) : undefined;
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const list = q ? data.items.filter((i) => i.name.toLowerCase().includes(q)).sort(order) : (data.kids.get(at().folder) ?? []);
    return filter === 'all' ? list : list.filter((i) => i.kind === filter);
  }
  const countIn = (data: Loaded, id: string) => {
    const list = data.kids.get(id) ?? [];
    return { folders: list.filter((i) => i.kind === 'folder').length, notes: list.filter((i) => i.kind === 'note').length };
  };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // ---------- painting
  function paintSources(): void {
    const list = sources();
    if (current && !list.some((s) => s.id === current)) current = null;
    if (!current && list[0]) select(list[0].id);
    pills.replaceChildren(...list.map((s) => {
      const b = el('button', 'lib-source');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s.id === current));
      const data = loaded.get(s.id);
      b.append(icon(KIND[s.kind].icon), el('span', '', s.name));
      if (data) b.append(el('span', 'lib-count', String(data.items.filter((i) => i.kind === 'note').length)));
      if (loading.has(s.id)) b.append(icon('loader-circle', 'ic lib-spin'));
      b.addEventListener('click', () => (s.id === current ? sourceMenu(b, s) : select(s.id)));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        sourceMenu({ x: e.clientX, y: e.clientY }, s);
      });
      return b;
    }));
    const s = conf();
    sum.textContent = !s ? '' : loaded.has(s.id) ? `${KIND[s.kind].label} · ${plural(loaded.get(s.id)!.items.filter((i) => i.kind === 'note').length, 'note')}` : KIND[s.kind].label;
    chipBtns.forEach(({ f, b }) => b.setAttribute('aria-pressed', String(f === filter)));
    bar.classList.toggle('bare', !list.length);
  }

  function paintCrumbs(): void {
    const s = conf();
    const data = s ? loaded.get(s.id) : undefined;
    crumbs.replaceChildren();
    crumbs.hidden = !s || !data;
    if (!s || !data) return;
    const chain: Item[] = [];
    for (let id = at().folder; id; id = data.byId.get(id)?.parent ?? null) {
      const f = data.byId.get(id);
      if (!f) break;
      chain.unshift(f);
    }
    const back = iconBtn('chevron-left', 'Up a folder');
    back.disabled = !chain.length || !!query;
    back.addEventListener('click', () => goInto(chain.at(-2)?.id ?? null, chain.at(-1)?.id));
    crumbs.append(back);
    const step = (label: string, id: string | null, last: boolean, ic?: IconName) => {
      const b = el('button', `lib-crumb${last ? ' here' : ''}`);
      b.type = 'button';
      if (ic) b.append(icon(ic));
      b.append(el('span', '', label));
      b.addEventListener('click', () => goInto(id));
      if (last) b.setAttribute('aria-current', 'location');
      crumbs.append(b);
    };
    if (query) {
      step(s.name, null, false, KIND[s.kind].icon);
      crumbs.append(el('span', 'lib-crumb here', `“${query}” · ${plural(shown().length, 'match')}`));
      return;
    }
    step(s.name, null, !chain.length, KIND[s.kind].icon);
    chain.forEach((f, k) => {
      crumbs.append(el('span', 'lib-sep', '/'));
      step(f.name, f.id, k === chain.length - 1);
    });
    // a new note in the open folder, where the source can make one
    const d = driverOf(s);
    if (d.create) {
      const neu = el('button', 'lib-new');
      neu.type = 'button';
      neu.append(icon('plus'), el('span', '', 'New note'));
      neu.addEventListener('click', async () => {
        const name = await askText({ title: 'New note', label: 'Name', placeholder: 'Untitled', icon: 'file-text', ok: 'Create' });
        if (!name) return;
        try {
          const folder = chain.at(-1) ?? null;
          const item = await d.create!(folder, name);
          const data = loaded.get(s.id);
          if (data) loaded.set(s.id, index([...data.items.filter((i) => i.id !== item.id), item]));
          await openNote(item, true);
          editing = true;
          paintReader();
          reader.querySelector<HTMLTextAreaElement>('textarea')?.focus();
        } catch (e) {
          status = e instanceof Error ? `Could not create: ${e.message}` : 'Could not create';
          paintReader();
        }
      });
      crumbs.append(neu);
    }
  }

  /** Steps into `folder`; coming back out of `from` keeps its card in the middle. */
  function goInto(folder: string | null, from?: string): void {
    const p = at();
    p.folder = folder;
    query = '';
    searchInput.value = '';
    const list = shown();
    p.focus = Math.max(0, from ? list.findIndex((i) => i.id === from) : 0);
    paint();
  }

  function card(item: Item, k: number, focus: number, data: Loaded): HTMLElement {
    const d = k - focus;
    const c = el('button', `lib-card ${item.kind}${d === 0 ? ' on' : ''}${open?.id === item.id ? ' reading' : ''}`);
    c.type = 'button';
    c.dataset.k = String(k);
    const side = Math.sign(d);
    const a = Math.abs(d);
    // the middle card upright; the rest lean away and close up, the farther the tighter
    const x = d === 0 ? 0 : side * (150 + (a - 1) * 46);
    c.style.transform = `translate(-50%, -50%) translateX(${x}px) translateZ(${-a * 34 - (a ? 90 : 0)}px) rotateY(${d === 0 ? 0 : -side * 62}deg)`;
    c.style.zIndex = String(100 - a);
    c.style.opacity = String(a > REACH - 2 ? 0 : 1);
    const face = el('span', 'lib-face');
    face.append(icon(item.kind === 'folder' ? 'folder' : 'file-text', 'ic lib-kind'));
    const title = el('span', 'lib-title', item.name);
    face.append(title);
    if (item.kind === 'folder') {
      const n = countIn(data, item.id);
      face.append(el('span', 'lib-meta', [n.folders ? plural(n.folders, 'folder') : '', n.notes ? plural(n.notes, 'note') : ''].filter(Boolean).join(' · ') || 'Empty'));
    } else {
      const lines = el('span', 'lib-lines');
      for (let i = 0; i < 6; i++) lines.append(el('i'));
      face.append(lines, el('span', 'lib-meta', when(item.modified)));
    }
    if (query && item.path.includes('/')) face.append(el('span', 'lib-path', item.path.split('/').slice(0, -1).join(' / ')));
    c.append(face);
    c.setAttribute('aria-label', `${item.kind === 'folder' ? 'Folder' : 'Note'} ${item.name}`);
    c.addEventListener('click', () => {
      if (k !== at().focus) {
        at().focus = k;
        paintFan();
        return;
      }
      activate(item);
    });
    return c;
  }

  function activate(item: Item): void {
    if (item.kind === 'folder') goInto(item.id);
    else void openNote(item);
  }

  function paintFan(): void {
    const s = conf();
    const data = s ? loaded.get(s.id) : undefined;
    const list = shown();
    const p = at();
    p.focus = Math.min(Math.max(0, p.focus), Math.max(0, list.length - 1));
    fan.replaceChildren();
    empty.replaceChildren();
    empty.hidden = true;
    empty.classList.remove('welcome');
    arc.hidden = list.length < 2;
    if (!s) return paintWelcome();
    const fail = failed.get(s.id);
    if (fail || !data) {
      empty.hidden = false;
      if (fail) {
        empty.append(el('p', 'lib-empty-title', fail.message));
        const again = el('button', 'btn-accent lib-again', fail.access ? 'Open the vault' : 'Try again');
        again.type = 'button';
        again.addEventListener('click', async () => {
          if (fail.access && !(await allowVault(s.id))) return;
          void load(s);
        });
        empty.append(again);
      } else empty.append(el('p', 'lib-empty-title', 'Loading…'));
      return;
    }
    if (!list.length) {
      empty.hidden = false;
      empty.append(el('p', 'lib-empty-title', query ? 'Nothing matches' : 'This folder is empty'));
      return;
    }
    for (let k = Math.max(0, p.focus - REACH); k <= Math.min(list.length - 1, p.focus + REACH); k++) fan.append(card(list[k]!, k, p.focus, data));
    // the dot rides the arc (the track's top edge is half an ellipse, 22px tall)
    const u = list.length > 1 ? p.focus / (list.length - 1) : 0.5;
    arcDot.style.left = `${u * 100}%`;
    arcDot.style.top = `${22 * (1 - Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2))) - 4}px`;
    prev.disabled = p.focus === 0;
    next.disabled = p.focus >= list.length - 1;
  }

  function paintWelcome(): void {
    empty.hidden = false;
    empty.classList.add('welcome');
    empty.append(el('p', 'lib-empty-title', 'Bring your notes in'), el('p', 'lib-empty-sub', 'Look through a vault, a repo or a workspace as cards. Nothing here is synced by Haru.'));
    const row = el('div', 'lib-kinds');
    (Object.keys(KIND) as SourceKind[]).forEach((k) => {
      const b = el('button', 'lib-kind-tile');
      b.type = 'button';
      b.append(icon(KIND[k].icon), el('strong', '', KIND[k].label), el('span', '', KIND[k].hint));
      b.addEventListener('click', () => void addSource(k));
      row.append(b);
    });
    empty.append(row);
  }

  function paintRecent(): void {
    const s = conf();
    const data = s ? loaded.get(s.id) : undefined;
    recent.hidden = !data;
    if (!data) return;
    recent.replaceChildren();
    const head = el('div', 'lib-sec-head');
    // changed last where the source tells when; opened last here where it doesn't (GitHub's tree has no dates)
    const dated = data.items.filter((i) => i.kind === 'note' && i.modified).sort((a, b) => b.modified! - a.modified!).slice(0, 8);
    const seen = dated.length ? [] : openedIn(s!.id).flatMap((o) => {
      const n = data.byId.get(o.id);
      return n ? [{ ...n, modified: o.at }] : [];
    }).slice(0, 8);
    const notes = dated.length ? dated : seen;
    head.append(el('span', 'card-title', 'Recent'), el('span', 'meta', dated.length ? 'Changed last, every folder' : 'Opened last'));
    const table = el('div', 'lib-table');
    const th = el('div', 'lib-row lib-th');
    th.append(el('span', '', 'Date'), el('span', '', 'Note'), el('span', '', 'Folder'));
    table.append(th);
    for (const n of notes) {
      const r = el('button', `lib-row${open?.id === n.id ? ' on' : ''}`);
      r.type = 'button';
      const folder = n.parent ? data.byId.get(n.parent)?.name ?? '' : s!.name;
      r.append(el('span', 'lib-date', ago(n.modified!)), el('span', 'lib-name', n.name), el('span', 'lib-folder', folder));
      r.addEventListener('click', () => void openNote(data.byId.get(n.id) ?? n, true));
      table.append(r);
    }
    if (!notes.length) table.append(el('p', 'lib-none', 'Notes you open show up here.'));
    recent.append(head, table);
  }

  function paintReader(): void {
    const s = conf();
    reader.replaceChildren();
    reader.classList.toggle('expanded', expanded && !!open);
    const data = s ? loaded.get(s.id) : undefined;
    reader.hidden = !data;
    if (!s || !data) return;
    const focusItem = shown()[at().focus];
    if (!open) {
      // nothing open: what the middle card holds
      reader.classList.add('idle');
      const head = el('div', 'lib-sec-head');
      head.append(el('span', 'card-title', focusItem?.kind === 'folder' ? 'Folder' : 'Note'));
      reader.append(head);
      if (focusItem) {
        reader.append(el('h3', 'lib-r-title', focusItem.name));
        if (focusItem.kind === 'folder') {
          const n = countIn(data, focusItem.id);
          reader.append(el('p', 'lib-r-sub', `${plural(n.folders, 'folder')} · ${plural(n.notes, 'note')}`));
        } else if (focusItem.modified) reader.append(el('p', 'lib-r-sub', `Changed ${ago(focusItem.modified)}`));
        const go = el('button', 'lib-open');
        go.type = 'button';
        go.append(el('span', '', focusItem.kind === 'folder' ? 'Open folder' : 'Read'), icon('arrow-up-right'));
        go.addEventListener('click', () => activate(focusItem));
        reader.append(go);
      }
      return;
    }
    reader.classList.remove('idle');
    const d = driverOf(s);
    const head = el('div', 'lib-r-head');
    const titles = el('div', 'lib-r-titles');
    titles.append(el('h3', 'lib-r-title', open.name), el('p', 'lib-r-sub', open.path));
    const actions = el('div', 'lib-r-actions');
    if (status) actions.append(el('span', `lib-status${/fail|Changed|refused|No access|Not found/.test(status) ? ' bad' : ''}`, status));
    if (d.write && s.kind !== 'notion') {
      const edit = iconBtn(editing ? 'eye' : 'pencil', editing ? 'Read' : 'Edit');
      edit.addEventListener('click', () => {
        flushSave();
        editing = !editing;
        paintReader();
        if (editing) reader.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      });
      actions.append(edit);
    }
    if (open.url) {
      const out = el('a', 'lib-ibtn');
      out.href = open.url;
      out.target = '_blank';
      out.rel = 'noopener noreferrer';
      out.setAttribute('aria-label', 'Open in Notion');
      out.title = 'Open in Notion';
      out.append(icon('arrow-up-right'));
      actions.append(out);
    }
    const grow = iconBtn(expanded ? 'chevron-down' : 'chevron-up', expanded ? 'Smaller' : 'Larger');
    grow.addEventListener('click', () => {
      expanded = !expanded;
      paintReader();
    });
    const close = iconBtn('x', 'Close');
    close.addEventListener('click', () => {
      flushSave();
      open = null;
      editing = false;
      expanded = false;
      paint();
    });
    actions.append(grow, close);
    head.append(titles, actions);
    reader.append(head);

    const { meta, body: md } = splitFrontMatter(text);
    if (editing) {
      const area = el('textarea', 'lib-edit');
      area.value = text;
      area.spellcheck = false;
      area.addEventListener('input', () => {
        text = area.value;
        queueSave(open!, text);
      });
      reader.append(area);
      return;
    }
    if (meta.length) {
      const tags = el('div', 'lib-meta-row');
      for (const [k, v] of meta.slice(0, 8)) {
        const t = el('span', 'lib-tag');
        t.append(el('b', '', k), document.createTextNode(` ${v}`));
        tags.append(t);
      }
      reader.append(tags);
    }
    const doc = el('div', 'md-view lib-doc');
    doc.innerHTML = renderMarkdown(wikiToMarkdown(md)) || '<p class="lib-none">Empty note</p>';
    doc.querySelectorAll<HTMLAnchorElement>(`a[href^="${WIKI}"]`).forEach((a) => {
      const target = decodeURIComponent(a.href.slice(WIKI.length)).toLowerCase();
      a.removeAttribute('target');
      a.classList.add('lib-wiki');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const hit = data.items.find((i) => i.kind === 'note' && (i.name.toLowerCase() === target || i.path.toLowerCase().replace(/\.md$/, '') === target));
        if (hit) void openNote(hit, true);
      });
    });
    reader.append(doc);
  }

  function paint(): void {
    paintSources();
    paintCrumbs();
    paintFan();
    paintRecent();
    paintReader();
  }

  // ---------- notes
  async function openNote(item: Item, reveal = false): Promise<void> {
    const s = conf();
    if (!s) return;
    flushSave();
    open = item;
    noteOpened(s.id, item.id);
    editing = false;
    status = '';
    text = '';
    if (reveal && !query) {
      // show where it lives: its folder in the fan, it in the middle
      const p = at();
      p.folder = loaded.get(s.id)?.byId.has(item.parent ?? '') ? item.parent : null;
      p.focus = Math.max(0, shown().findIndex((i) => i.id === item.id));
    }
    status = 'Loading…';
    paint();
    try {
      const t = await driverOf(s).read(item);
      if (open !== item) return;
      text = t;
      status = '';
    } catch (e) {
      if (open !== item) return;
      status = e instanceof Error ? e.message : 'Could not read';
    }
    paintReader();
  }

  function queueSave(item: Item, value: string): void {
    const s = conf();
    if (!s) return;
    unsaved = { item, text: value };
    clearTimeout(saveTimer);
    status = 'Edited';
    setStatus();
    saveTimer = window.setTimeout(() => void save(), SAVE_AFTER[s.kind]);
  }
  function flushSave(): void {
    if (!unsaved) return;
    clearTimeout(saveTimer);
    void save();
  }
  async function save(): Promise<void> {
    const s = conf();
    const job = unsaved;
    if (!s || !job) return;
    unsaved = null;
    const d = driverOf(s);
    if (!d.write) return;
    status = s.kind === 'github' ? 'Committing…' : 'Saving…';
    setStatus();
    try {
      const said = await d.write(job.item, job.text);
      job.item.modified = Date.now();
      status = `${said} · ${ago(Date.now())}`;
    } catch (e) {
      status = e instanceof Error ? `Save failed: ${e.message}` : 'Save failed';
      // kept, to try again with the next keystroke
      if (!unsaved) unsaved = job;
    }
    setStatus();
  }
  /** Updates the status line alone, so the editor keeps its caret. */
  function setStatus(): void {
    const actions = reader.querySelector('.lib-r-actions');
    if (!actions) return;
    actions.querySelector('.lib-status')?.remove();
    if (status) actions.prepend(el('span', `lib-status${/fail|Changed|refused/.test(status) ? ' bad' : ''}`, status));
  }
  addEventListener('pagehide', flushSave);

  // ---------- sources
  async function addSource(kind: SourceKind): Promise<void> {
    const id = newSourceId();
    if (kind === 'obsidian') {
      const name = await pickVault(id);
      if (!name) return;
      saveSource({ id, kind, name });
      select(id);
      return;
    }
    const got = await sourceForm(kind);
    if (!got) return;
    saveSource({ id, kind, ...got.conf }, got.token);
    select(id);
  }

  async function sourceForm(kind: 'github' | 'notion', was?: SourceConf): Promise<{ conf: Omit<SourceConf, 'id' | 'kind'>; token: string } | null> {
    if (kind === 'github') {
      const v = await askForm({
        title: was ? 'GitHub folder' : 'Add a GitHub folder', icon: 'git-branch', ok: was ? 'Save' : 'Add',
        body: 'Notes are the .md files under the path. Saving a note commits it to the branch.',
        fields: [
          { key: 'repo', label: 'Repository', value: was?.repo, placeholder: 'owner/name', required: true },
          { key: 'path', label: 'Path', value: was?.path, placeholder: 'notes (empty: the whole repo)' },
          { key: 'branch', label: 'Branch', value: was?.branch, placeholder: 'empty: the default branch' },
          { key: 'token', label: 'Token', value: was ? tokenOf(was.id) : '', placeholder: 'github_pat_…', secret: true, hint: 'Fine-grained, Contents read and write on this repo. Kept in this browser only; empty reads a public repo.' },
        ],
      });
      if (!v) return null;
      const repo = v.repo!.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
      return { conf: { name: v.path ? `${repo.split('/')[1]}/${v.path.replace(/^\/+|\/+$/g, '')}` : repo.split('/')[1] ?? repo, repo, path: v.path, branch: v.branch }, token: v.token ?? '' };
    }
    const v = await askForm({
      title: was ? 'Notion workspace' : 'Add a Notion workspace', icon: 'book-text', ok: was ? 'Save' : 'Add',
      body: 'Make an internal integration at notion.so/profile/integrations, then share pages with it (a page’s ••• → Connections).',
      fields: [
        { key: 'name', label: 'Name', value: was?.name ?? 'Notion', required: true },
        { key: 'token', label: 'Integration secret', value: was ? tokenOf(was.id) : '', placeholder: 'ntn_…', secret: true, required: true, hint: 'Kept in this browser only. Read only.' },
      ],
    });
    return v ? { conf: { name: v.name! }, token: v.token! } : null;
  }

  function sourceMenu(anchor: HTMLElement | { x: number; y: number }, s: SourceConf): void {
    const items: { label: string; icon: IconName; danger?: boolean; run: () => void }[] = [
      { label: 'Refresh', icon: 'refresh', run: () => { drivers.delete(s.id); void load(s); } },
    ];
    if (s.kind !== 'obsidian') {
      items.push({ label: 'Settings', icon: 'settings', run: async () => {
        const got = await sourceForm(s.kind as 'github' | 'notion', s);
        if (!got) return;
        saveSource({ ...s, ...got.conf }, got.token);
        drivers.delete(s.id);
        loaded.delete(s.id);
        place.delete(s.id);
        void load(sources().find((x) => x.id === s.id)!);
      } });
    } else if (canPickFolder) {
      items.push({ label: 'Choose the folder again', icon: 'folder-open', run: async () => {
        const name = await pickVault(s.id);
        if (!name) return;
        saveSource({ ...s, name });
        drivers.delete(s.id);
        place.delete(s.id);
        void load({ ...s, name });
      } });
    }
    items.push({ label: 'Remove', icon: 'trash', danger: true, run: async () => {
      if (!(await askConfirm({ title: `Remove ${s.name}?`, body: 'Only Haru forgets it: the notes stay where they are.', danger: true, ok: 'Remove' }))) return;
      if (s.kind === 'obsidian') void forgetVault(s.id);
      drivers.delete(s.id);
      loaded.delete(s.id);
      failed.delete(s.id);
      try {
        localStorage.removeItem(openedKey(s.id));
      } catch {
        // nothing kept
      }
      removeSource(s.id);
    } });
    showMenu(anchor, items);
  }

  add.addEventListener('click', () => {
    showMenu(add, [
      ...(Object.keys(KIND) as SourceKind[]).map((k) => ({ label: KIND[k].label, icon: KIND[k].icon, run: () => void addSource(k) })),
    ]);
  });

  // ---------- moving through the fan
  const move = (by: number) => {
    const list = shown();
    const p = at();
    const to = Math.min(Math.max(0, p.focus + by), list.length - 1);
    if (to === p.focus || to < 0) return;
    p.focus = to;
    paintFan();
    if (!open) paintReader();
  };
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'Enter') {
      const it = shown()[at().focus];
      if (it) activate(it);
    } else if (e.key === 'Backspace' && !query) {
      const data = current ? loaded.get(current) : undefined;
      const folder = at().folder;
      if (data && folder) goInto(data.byId.get(folder)?.parent ?? null, folder);
    } else return;
    e.preventDefault();
  });
  // the wheel turns the fan one card per notch (a trackpad's run is gathered first)
  let wheel = 0;
  let wheelAt = 0;
  stage.addEventListener('wheel', (e) => {
    if (!shown().length) return;
    e.preventDefault();
    e.stopPropagation();
    const now = performance.now();
    if (now - wheelAt > 250) wheel = 0;
    wheelAt = now;
    wheel += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    while (Math.abs(wheel) >= 60) {
      move(Math.sign(wheel));
      wheel -= Math.sign(wheel) * 60;
    }
  }, { passive: false });
  // dragging sideways moves it too
  let drag: { x: number; moved: number; id: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('.lib-arc, .lib-empty')) return;
    drag = { x: e.clientX, moved: 0, id: e.pointerId };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) >= 48) {
      move(-Math.sign(dx));
      drag.x = e.clientX;
      drag.moved++;
    }
  });
  const endDrag = () => {
    if (drag?.moved) {
      // a drag is not a click on the card it ends on
      stage.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
    }
    drag = null;
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', () => (drag = null));

  let searchTimer = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      query = searchInput.value;
      at().focus = 0;
      paint();
    }, 120);
  });

  onSources(paint);
  // a source not loaded yet loads when the Library is opened; one loaded refreshes after a while away
  const seenAt = new Map<string, number>();
  onView((v) => {
    if (v !== 'library') {
      flushSave();
      return;
    }
    const s = conf();
    if (!s) return paint();
    const last = seenAt.get(s.id) ?? 0;
    if (!loaded.has(s.id) || Date.now() - last > 5 * 60_000) {
      seenAt.set(s.id, Date.now());
      void load(s);
    } else paint();
  });
  paint();
}
