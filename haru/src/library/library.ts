import { icon, type IconName } from '../ui/icons';
import { renderMarkdown } from '../ui/markdown';
import { askConfirm, askForm, askText, showMenu } from '../ui/modal';
import { currentView, onView } from '../ui/router';
import { GitHubError, githubDriver } from './github';
import { WIKI, picturesIn, splitFrontMatter, wikiToMarkdown } from './note-text';
import { noteOpened, openedIn, openedKey } from './opened';
import { type MemoConf, memoConf, memoPath, memoToken, readMemo, saveMemoConf, writeMemo } from './memo';
import { NotionError, notionDriver } from './notion';
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
  notion: { label: 'Notion workspace', icon: 'book-text', hint: 'Pages shared with an integration; edits sync' },
};
const CURRENT = 'haru:library-current';
/** Cards drawn either side of the one in the middle (the rest are off the fan). */
const REACH = 14;
/** Wait after the last keystroke before saving: a file is cheap, a commit is not. */
const SAVE_AFTER: Record<SourceKind, number> = { obsidian: 900, github: 4000, notion: 2500 };

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


/** The token was refused: expired, revoked, or never right (a 401 from GitHub or Notion). */
const tokenRefused = (e: unknown): boolean => (e instanceof GitHubError || e instanceof NotionError) && e.status === 401;
/** Where a new token is made. */
const NEW_TOKEN: Partial<Record<SourceKind, { url: string; label: string; steps: string }>> = {
  github: { url: 'https://github.com/settings/personal-access-tokens/new', label: 'Make a new GitHub token',
    steps: 'Fine-grained token → this repository only → Repository permissions: Contents, Read and write. Copy it, then Update token.' },
  notion: { url: 'https://www.notion.so/profile/integrations', label: 'Open Notion integrations',
    steps: 'Open your integration → Internal integration secret → Show / refresh, copy it, then Update token. Pages must still be shared with it.' },
};

export function mountLibrary(body: HTMLElement, sum: HTMLElement): void {
  const drivers = new Map<string, Driver>();
  const loaded = new Map<string, Loaded>();
  const failed = new Map<string, { message: string; access: boolean; auth: boolean }>();
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
  /** What the fan shows (source, folder, filter, search): a change deals the cards in afresh. */
  let fanKey = '';
  /** The memo on the open note (see memo.ts): shown under it, committed a few seconds after typing stops. */
  let memo: { id: string; text: string; sha: string | null; status: string; ready: boolean; dirty: boolean } | null = null;
  let memoShown = false;
  let memoTimer = 0;
  /** A note picked on the home page, opened once its source has loaded. */
  let pendingOpen: { source: string; id: string } | null = null;

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
      const want = pendingOpen?.source === s.id ? loaded.get(s.id)!.byId.get(pendingOpen.id) : undefined;
      pendingOpen = null;
      if (want && current === s.id) queueMicrotask(() => void openNote(want, true));
    } catch (e) {
      failed.set(s.id, { message: e instanceof NeedsAccess ? 'Allow Haru to open the vault again' : e instanceof Error ? e.message : 'Could not load', access: e instanceof NeedsAccess, auth: tokenRefused(e) });
    } finally {
      loading.delete(s.id);
      paint();
    }
  }
  /** What to do when a token is refused: why, where to get a new one, and a button to put it in. */
  function tokenHelp(s: SourceConf): HTMLElement[] {
    const how = NEW_TOKEN[s.kind];
    const title = el('p', 'lib-empty-title', s.kind === 'github' ? 'The GitHub token has expired or was revoked' : 'The Notion secret was refused');
    const sub = el('p', 'lib-empty-sub', how?.steps ?? '');
    const row = el('div', 'lib-token-row');
    if (how) {
      const link = el('a', 'btn-sm lib-token-link');
      link.href = how.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(document.createTextNode(how.label), icon('arrow-up-right'));
      row.append(link);
    }
    const upd = el('button', 'btn-accent lib-again', 'Update token');
    upd.type = 'button';
    upd.addEventListener('click', () => void updateToken(s));
    row.append(upd);
    return [title, sub, row];
  }
  async function updateToken(s: SourceConf): Promise<void> {
    if (s.kind === 'obsidian') return;
    const got = await sourceForm(s.kind, s);
    if (!got) return;
    saveSource({ ...s, ...got.conf }, got.token);
    drivers.delete(s.id);
    void load(sources().find((x) => x.id === s.id) ?? s);
  }

  function select(id: string | null): void {
    flushSave();
    flushMemo();
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
    // at the top of a source, back goes out to the Library's home (the sources and what was read lately)
    back.setAttribute('aria-label', chain.length && !query ? 'Up a folder' : 'All sources');
    back.title = back.getAttribute('aria-label')!;
    back.addEventListener('click', () => (chain.length && !query ? goInto(chain.at(-2)?.id ?? null, chain.at(-1)?.id) : select(null)));
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

  /** A card for `item` at place `k` in the list (where it stands is set by `place`). */
  function card(item: Item, k: number, data: Loaded): HTMLElement {
    const c = el('button', `lib-card ${item.kind}`);
    c.type = 'button';
    c.dataset.id = item.id;
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
        if (!open) paintReader();
        return;
      }
      activate(item);
    });
    return c;
  }

  /** Where a card stands, `d` places from the middle: upright there, the rest leaning away, closer the farther. */
  function stand(c: HTMLElement, d: number, item: Item): void {
    const side = Math.sign(d);
    const a = Math.abs(d);
    const x = d === 0 ? 0 : side * (150 + (a - 1) * 46);
    c.style.transform = `translate(-50%, -50%) translateX(${x}px) translateZ(${-a * 34 - (a ? 90 : 0)}px) rotateY(${d === 0 ? 0 : -side * 62}deg)`;
    c.style.zIndex = String(100 - a);
    c.style.opacity = String(a > REACH - 2 ? 0 : 1);
    c.style.setProperty('--a', String(a));
    c.classList.toggle('on', d === 0);
    c.classList.toggle('reading', open?.id === item.id);
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
    empty.replaceChildren();
    empty.hidden = true;
    empty.classList.remove('welcome');
    arc.hidden = list.length < 2;
    const clear = () => {
      fan.replaceChildren();
      fanKey = '';
    };
    if (!s) {
      clear();
      return paintWelcome();
    }
    const fail = failed.get(s.id);
    if (fail || !data) {
      clear();
      empty.hidden = false;
      if (fail?.auth) {
        empty.append(...tokenHelp(s));
      } else if (fail) {
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
      clear();
      empty.hidden = false;
      empty.append(el('p', 'lib-empty-title', query ? 'Nothing matches' : 'This folder is empty'));
      return;
    }
    // the same cards move (so they glide) while the list stays the same; a new list deals its cards in
    const key = `${s.id}|${p.folder}|${filter}|${query}|${list.length}`;
    const fresh = key !== fanKey;
    fanKey = key;
    const have = new Map<string, HTMLElement>();
    if (!fresh) fan.querySelectorAll<HTMLElement>('.lib-card').forEach((c) => have.set(c.dataset.id!, c));
    else fan.replaceChildren();
    const keep = new Set<string>();
    for (let k = Math.max(0, p.focus - REACH); k <= Math.min(list.length - 1, p.focus + REACH); k++) {
      const item = list[k]!;
      let c = have.get(item.id);
      const isNew = !c;
      if (!c) {
        c = card(item, k, data);
        if (fresh) {
          c.classList.add('deal');
          c.style.animationDelay = `${Math.min(Math.abs(k - p.focus), 8) * 35}ms`;
          c.addEventListener('animationend', () => c!.classList.remove('deal'), { once: true });
        } else c.classList.add('arrive');
        fan.append(c);
      }
      stand(c, k - p.focus, item);
      // a card coming in from the edge fades in where it lands
      if (isNew && !fresh) requestAnimationFrame(() => c!.classList.remove('arrive'));
      keep.add(item.id);
    }
    for (const [id, c] of have) if (!keep.has(id)) c.remove();
    // the dot rides the arc: it moves along the track's own curve (offset-path), so even a fast run stays on it
    const u = list.length > 1 ? p.focus / (list.length - 1) : 0.5;
    arcDot.style.offsetDistance = `${u * 100}%`;
    prev.disabled = p.focus === 0;
    next.disabled = p.focus >= list.length - 1;
  }

  /** The Library's home: the sources connected here, the kinds to add, and (below) the notes read lately. */
  function paintWelcome(): void {
    empty.hidden = false;
    empty.classList.add('welcome');
    const list = sources();
    if (list.length) {
      empty.append(el('p', 'lib-empty-title', 'Your sources'));
      const mine = el('div', 'lib-kinds lib-mine');
      for (const src of list) {
        const b = el('button', 'lib-kind-tile lib-src-tile');
        b.type = 'button';
        const data = loaded.get(src.id);
        b.append(icon(KIND[src.kind].icon), el('strong', '', src.name), el('span', '', data ? `${KIND[src.kind].label} · ${plural(data.items.filter((i) => i.kind === 'note').length, 'note')}` : KIND[src.kind].label));
        b.addEventListener('click', () => select(src.id));
        mine.append(b);
      }
      empty.append(mine, el('p', 'lib-empty-sub lib-add-title', 'Add another'));
    } else {
      empty.append(el('p', 'lib-empty-title', 'Bring your notes in'), el('p', 'lib-empty-sub', 'Look through a vault, a repo or a workspace as cards. Nothing here is synced by Haru.'));
    }
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

  /** Home: the notes read lately, from every source. */
  function paintVisited(): void {
    const list = sources();
    const rows = list.flatMap((src) => openedIn(src.id).filter((o) => o.name).map((o) => ({ src, o }))).sort((a, b) => b.o.at - a.o.at).slice(0, 10);
    recent.hidden = !rows.length;
    if (!rows.length) return;
    recent.replaceChildren();
    const head = el('div', 'lib-sec-head');
    head.append(el('span', 'card-title', 'Recently visited'), el('span', 'meta', 'Every source'));
    const table = el('div', 'lib-table');
    const th = el('div', 'lib-row lib-th');
    th.append(el('span', '', 'When'), el('span', '', 'Note'), el('span', '', 'Source'));
    table.append(th);
    for (const { src, o } of rows) {
      const r = el('button', 'lib-row');
      r.type = 'button';
      r.title = o.path ?? '';
      r.append(el('span', 'lib-date', ago(o.at)), el('span', 'lib-name', o.name!), el('span', 'lib-folder', src.name));
      r.addEventListener('click', () => {
        const data = loaded.get(src.id);
        const hit = data?.byId.get(o.id);
        select(src.id);
        if (hit) void openNote(hit, true);
        else pendingOpen = { source: src.id, id: o.id };
      });
      table.append(r);
    }
    recent.append(head, table);
  }

  function paintRecent(): void {
    const s = conf();
    const data = s ? loaded.get(s.id) : undefined;
    if (!s) return paintVisited();
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
    if (d.write) {
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
    if (d.addImage) {
      const pic = iconBtn('image-plus', 'Add a picture');
      pic.addEventListener('click', () => pickPicture(s));
      actions.append(pic);
    }
    if (d.remove) {
      const del = iconBtn('trash', s.kind === 'notion' ? 'Move to Notion’s trash' : 'Delete note');
      del.addEventListener('click', () => void deleteNote(s));
      actions.append(del);
    }
    const memoBtn = iconBtn('message', memoShown ? 'Hide memo' : 'Memo');
    memoBtn.classList.toggle('has', !!memo?.text.trim());
    memoBtn.setAttribute('aria-pressed', String(memoShown));
    memoBtn.addEventListener('click', () => {
      memoShown = !memoShown;
      paintReader();
      if (memoShown) reader.querySelector<HTMLTextAreaElement>('.lib-memo textarea')?.focus();
    });
    actions.append(memoBtn);
    const grow = iconBtn(expanded ? 'chevron-down' : 'chevron-up', expanded ? 'Smaller' : 'Larger');
    grow.addEventListener('click', () => {
      expanded = !expanded;
      paintReader();
    });
    const close = iconBtn('x', 'Close');
    close.addEventListener('click', () => {
      flushSave();
      flushMemo();
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
      if (memoShown) reader.append(memoPane(s));
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
    // pictures: shown from where the source keeps them (fetched once, then drawn again), each with its own delete
    const { md: withPics, pics } = picturesIn(md);
    const missing = pics.filter((p) => !picCache.has(`${s.id}|${p.ref}`));
    if (missing.length && d.imageUrl) {
      const item = open;
      void Promise.all(missing.map(async (p) => picCache.set(`${s.id}|${p.ref}`, await d.imageUrl!(item, p.ref).catch(() => null)))).then(() => {
        if (open === item && !editing) paintReader();
      });
    }
    const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    doc.innerHTML = renderMarkdown(wikiToMarkdown(withPics), (k) => picCache.get(`${s.id}|${pics[Number(k.slice(1))]?.ref}`) ?? BLANK) || '<p class="lib-none">Empty note</p>';
    doc.querySelectorAll<HTMLElement>('figure.md-img').forEach((fig, k) => {
      const p = pics[k];
      if (!p) return;
      const img = fig.querySelector('img')!;
      img.alt = p.ref;
      if (img.src === BLANK) fig.classList.add('loading');
      if (!d.removeImage) return;
      const x = iconBtn('x', 'Delete this picture', 'lib-pic-del');
      x.addEventListener('click', () => void deletePicture(s, p));
      fig.append(x);
    });
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
    if (memoShown) reader.append(memoPane(s));
  }

  // ---------- pictures and deleting
  const picCache = new Map<string, string | null>();
  function pickPicture(s: SourceConf): void {
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      const item = open;
      const d = driverOf(s);
      if (!file || !item || !d.addImage) return;
      flushSave();
      status = 'Adding the picture…';
      setStatus();
      try {
        const r = await d.addImage(item, file, text);
        if (open !== item) return;
        text = r.text;
        status = r.saved ? 'Picture added' : '';
        if (!r.saved) {
          unsaved = { item, text };
          await save();
        }
      } catch (e) {
        status = tokenRefused(e) ? 'The token has expired — Settings on the source to update it' : e instanceof Error ? `Picture failed: ${e.message}` : 'Picture failed';
      }
      paintReader();
    });
    input.click();
  }
  async function deletePicture(s: SourceConf, p: { ref: string; line: string }): Promise<void> {
    const d = driverOf(s);
    const item = open;
    if (!item || !d.removeImage) return;
    if (!(await askConfirm({ title: 'Delete this picture?', body: s.kind === 'notion' ? 'It is deleted from the Notion page.' : 'Its file is deleted too.', danger: true, ok: 'Delete' }))) return;
    flushSave();
    try {
      const r = await d.removeImage(item, p.ref, text);
      if (open !== item) return;
      // the line goes whichever way the picture was written
      text = (r.text.includes(`${p.line}\n`) ? r.text.replace(`${p.line}\n`, '') : r.text.replace(p.line, '')).replace(/\n{3,}/g, '\n\n');
      picCache.delete(`${s.id}|${p.ref}`);
      if (!r.saved) {
        unsaved = { item, text };
        await save();
      } else status = 'Picture deleted';
    } catch (e) {
      status = tokenRefused(e) ? 'The token has expired — Settings on the source to update it' : e instanceof Error ? `Delete failed: ${e.message}` : 'Delete failed';
    }
    paintReader();
  }
  async function deleteNote(s: SourceConf): Promise<void> {
    const d = driverOf(s);
    const item = open;
    if (!item || !d.remove) return;
    const body = s.kind === 'notion' ? 'The page goes to Notion’s trash (it can be restored there for 30 days).'
      : s.kind === 'github' ? 'The file is deleted with a commit (it stays in the repo’s history).'
        : 'The file is deleted from your computer.';
    if (!(await askConfirm({ title: `Delete ${item.name}?`, body, danger: true, ok: 'Delete' }))) return;
    unsaved = null;
    clearTimeout(saveTimer);
    try {
      const said = await d.remove(item);
      const data = loaded.get(s.id);
      if (data) loaded.set(s.id, index(data.items.filter((i) => i.id !== item.id && i.id !== item.id.replace('#page', ''))));
      open = null;
      editing = false;
      expanded = false;
      status = '';
      paint();
      flashStatus(said);
    } catch (e) {
      status = tokenRefused(e) ? 'The token has expired — Settings on the source to update it' : e instanceof Error ? `Delete failed: ${e.message}` : 'Delete failed';
      paintReader();
    }
  }
  /** A short line over the cards after something with no note left open to say it (a delete). */
  function flashStatus(msg: string): void {
    const f = el('div', 'lib-flash', msg);
    stage.append(f);
    setTimeout(() => f.remove(), 3200);
  }

  // ---------- memos
  function memoPane(s: SourceConf): HTMLElement {
    const pane = el('section', 'lib-memo');
    const head = el('div', 'lib-memo-head');
    head.append(icon('message'), el('strong', '', 'Memo'));
    const c = memoConf();
    if (!c) {
      pane.append(head, el('p', 'lib-memo-note', 'Memos are kept as Markdown in a GitHub repo of yours, one file per note, committed as you write — like an Obsidian vault.'));
      const set = el('button', 'btn-accent lib-memo-set', 'Choose the memo repo');
      set.type = 'button';
      set.addEventListener('click', () => void memoSettings());
      pane.append(set);
      return pane;
    }
    const where = el('span', 'lib-memo-where', `${c.repo} / ${memoPath(c, s, open!)}`);
    where.title = where.textContent!;
    head.append(where);
    if (memo?.status) head.append(el('span', `lib-status${/fail|expired|refused|Changed/.test(memo.status) ? ' bad' : ''}`, memo.status));
    pane.append(head);
    if (memo && /expired/.test(memo.status)) {
      const fix = el('button', 'btn-sm lib-memo-fix', 'Update the memo token');
      fix.type = 'button';
      fix.addEventListener('click', () => void memoSettings());
      pane.append(fix);
    }
    const area = el('textarea', 'lib-memo-text');
    area.placeholder = memo?.ready === false ? 'Loading…' : 'Write a memo on this note';
    area.disabled = !memo?.ready;
    area.value = memo?.text ?? '';
    area.spellcheck = false;
    area.addEventListener('input', () => {
      if (!memo) return;
      memo.text = area.value;
      memo.dirty = true;
      memo.status = 'Edited';
      setMemoStatus();
      clearTimeout(memoTimer);
      memoTimer = window.setTimeout(() => void saveMemo(), 4000);
    });
    pane.append(area);
    return pane;
  }
  function setMemoStatus(): void {
    const head = reader.querySelector('.lib-memo-head');
    if (!head || !memo) return;
    head.querySelector('.lib-status')?.remove();
    if (memo.status) head.append(el('span', `lib-status${/fail|expired|refused|Changed/.test(memo.status) ? ' bad' : ''}`, memo.status));
    reader.querySelector('.lib-r-actions [aria-label="Memo"], .lib-r-actions [aria-label="Hide memo"]')?.classList.toggle('has', !!memo.text.trim());
  }
  async function loadMemo(s: SourceConf, item: Item): Promise<void> {
    if (!memoConf()) {
      memo = null;
      return;
    }
    memo = { id: item.id, text: '', sha: null, status: 'Loading…', ready: false, dirty: false };
    try {
      const m = await readMemo(s, item);
      if (memo?.id !== item.id || open !== item) return;
      memo = { id: item.id, text: m.text, sha: m.sha, status: m.sha ? '' : '', ready: true, dirty: false };
      // a note that has a memo shows it
      if (m.text.trim()) memoShown = true;
    } catch (e) {
      if (memo?.id !== item.id) return;
      memo.ready = true;
      memo.status = tokenRefused(e) ? 'The memo token has expired or was revoked' : e instanceof Error ? `Memo: ${e.message}` : 'Memo could not load';
    }
    if (open === item) paintReader();
  }
  async function saveMemo(): Promise<void> {
    const s = conf();
    const m = memo;
    const item = open;
    if (!s || !m || !item || !m.dirty || m.id !== item.id) return;
    clearTimeout(memoTimer);
    m.dirty = false;
    m.status = 'Committing…';
    setMemoStatus();
    try {
      m.sha = await writeMemo(s, item, m.text, m.sha);
      m.status = `Committed · ${ago(Date.now())}`;
    } catch (e) {
      m.dirty = true;
      m.status = tokenRefused(e) ? 'The memo token has expired or was revoked'
        : e instanceof GitHubError && e.status === 409 ? 'Save failed: changed on GitHub — reopen the note'
        : e instanceof Error ? `Save failed: ${e.message}` : 'Save failed';
      if (/expired/.test(m.status)) return paintReader();
    }
    setMemoStatus();
  }
  function flushMemo(): void {
    if (memo?.dirty) void saveMemo();
  }
  async function memoSettings(): Promise<void> {
    const was = memoConf();
    // a GitHub source on the same repo lends its token as a start
    const lend = (repo: string) => sources().find((x) => x.kind === 'github' && x.repo === repo);
    const v = await askForm({
      title: 'Memo repo', icon: 'git-branch', ok: 'Save',
      body: 'Memos on any note — vault, GitHub or Notion — are committed here as Markdown, one file per note.',
      fields: [
        { key: 'repo', label: 'Repository', value: was?.repo, placeholder: 'owner/name', required: true },
        { key: 'path', label: 'Path', value: was?.path ?? 'haru-memos', placeholder: 'haru-memos' },
        { key: 'branch', label: 'Branch', value: was?.branch, placeholder: 'empty: the default branch' },
        { key: 'token', label: 'Token', value: memoToken() || (was ? tokenOf(lend(was.repo)?.id ?? '') : ''), placeholder: 'github_pat_…', secret: true, hint: 'Fine-grained, Contents read and write on this repo. Kept in this browser only. Empty: uses a GitHub source’s token for the same repo.' },
      ],
    });
    if (!v) return;
    const repo = v.repo!.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    const c: MemoConf = { repo, path: (v.path ?? '').replace(/^\/+|\/+$/g, ''), branch: v.branch ?? '' };
    saveMemoConf(c, v.token || tokenOf(lend(repo)?.id ?? ''));
    const s = conf();
    if (s && open) {
      memoShown = true;
      await loadMemo(s, open);
    }
    paintReader();
  }

  function paint(): void {
    // home (no source open): every part takes the height it needs
    body.classList.toggle('home', !conf());
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
    flushMemo();
    open = item;
    memo = null;
    memoShown = false;
    noteOpened(s.id, item);
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
      void loadMemo(s, item);
    } catch (e) {
      if (open !== item) return;
      status = tokenRefused(e) ? 'The token has expired — Settings on the source to update it' : e instanceof Error ? e.message : 'Could not read';
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
      status = tokenRefused(e) ? 'Save failed: the token has expired — Settings on the source to update it' : e instanceof Error ? `Save failed: ${e.message}` : 'Save failed';
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
  addEventListener('pagehide', () => {
    flushSave();
    flushMemo();
  });

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
        { key: 'token', label: 'Integration secret', value: was ? tokenOf(was.id) : '', placeholder: 'ntn_…', secret: true, required: true, hint: 'Kept in this browser only. Give the integration Read, Update and Insert content: edits, new pages and pictures made in Haru go to Notion.' },
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
      { label: memoConf() ? `Memo repo · ${memoConf()!.repo}` : 'Memo repo…', icon: 'message' as IconName, run: () => void memoSettings() },
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
  // Esc peels one layer: out of the editor's text, then the larger reader back to its place, then the note closed
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || currentView() !== 'library' || !open) return;
    if (document.querySelector('dialog[open], .pop-menu, .tour')) return;
    const t = e.target as Element;
    if (t.closest('textarea, input')) {
      (t as HTMLElement).blur();
      flushSave();
      flushMemo();
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (expanded) {
      expanded = false;
      paintReader();
      return;
    }
    flushSave();
    flushMemo();
    open = null;
    editing = false;
    paint();
  });
  // a source not loaded yet loads when the Library is opened; one loaded refreshes after a while away
  const seenAt = new Map<string, number>();
  onView((v) => {
    if (v !== 'library') {
      flushSave();
      flushMemo();
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
