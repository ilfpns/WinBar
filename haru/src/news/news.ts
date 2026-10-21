import { createGlobe, type GeoPoint, type LandDot, type Marker } from './globe';
import { currentView, onView } from '../ui/router';
import { toggleDrawer } from '../timetable/state';
import { icon } from '../ui/icons';

/** data/news.json, refreshed every 10 minutes by scripts/fetch-news.mjs (GitHub Actions). */
type Topic = 'ai' | 'agi' | 'robotics' | 'chips' | 'embedded' | 'sw' | 'hw';
interface NewsItem { title: string; source: string; link: string; time: number; topics: Topic[]; place: string; lang: string; kw?: string[] }
interface Place extends GeoPoint { id: string; name: string; iso?: string[] }
interface Story { title: string; link: string; source: string; time: number; outlets: number }
interface Week { from: string; to: string; hot: [string, number][]; top: Story | null }
interface NewsFile { updated: string; places: Place[]; week?: Week; items: NewsItem[] }

const POLL_MS = 60_000;     // look for a fresh file this often while the page is open
const FRESH_MS = 6 * 3600_000;
const LIMIT = 150;
/** Topic filters, in the order shown. */
const TOPICS: [Topic, string][] = [
  ['ai', 'AI'], ['agi', 'AGI'], ['robotics', 'Robotics'], ['chips', 'Chips'], ['embedded', 'Embedded'], ['sw', 'Software'], ['hw', 'Hardware'],
];
const TOPIC_LABEL = Object.fromEntries(TOPICS) as Record<Topic, string>;

const fmt = (p: GeoPoint) =>
  `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'}  ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`;

/** "now", "12m", "3h", "2d" */
function ago(t: number): string {
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export interface NewsRefs {
  canvas: HTMLCanvasElement;
  readout: HTMLElement;
  updated: HTMLElement;
  live: HTMLElement;
  scope: HTMLElement;
  week: HTMLElement;
  topics: HTMLElement;
  list: HTMLElement;
}

/** News page: the dot globe with a pin per place, and the right drawer listing its latest headlines. */
export function mountNews(refs: NewsRefs): void {
  let data: NewsFile | null = null;
  let picked: string | null = null;
  let topic: Topic | null = null;
  /** A hot keyword picked in "This week": the list shows only headlines about it. */
  let keyword: string | null = null;
  /** Headlines that arrived while the page was open (marked until reload). */
  const fresh = new Set<string>();
  let globe: ReturnType<typeof createGlobe> | null = null;

  // ---------- the drawer
  /** Headlines passing the topic filter (and the picked place). */
  const matching = (withPlace = true) =>
    (data?.items ?? []).filter((i) => (!topic || i.topics.includes(topic)) && (!keyword || i.kw?.includes(keyword)) && (!withPlace || !picked || i.place === picked));

  /** "This week" (shown while no country is picked): the hottest keywords and the story most outlets ran. */
  function renderWeek(): void {
    const week = data?.week;
    refs.week.hidden = !!picked || !week || (!week.hot.length && !week.top);
    if (refs.week.hidden || !week) return;
    const fmtDay = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const head = document.createElement('div');
    head.className = 'news-week-head';
    head.innerHTML = '<span>This week</span><span class="meta"></span>';
    head.querySelector('.meta')!.textContent = `${fmtDay(week.from)} – ${fmtDay(week.to)}`;
    const parts: HTMLElement[] = [head];

    const [first, ...rest] = week.hot;
    if (first) {
      const hot = document.createElement('div');
      hot.className = 'news-hot';
      const lead = document.createElement('button');
      lead.type = 'button';
      lead.className = 'news-hot-lead';
      lead.setAttribute('aria-pressed', String(keyword === first[0]));
      lead.innerHTML = '<span class="meta">Hottest keyword</span><span class="kw"></span><span class="n meta"></span>';
      lead.querySelector('.kw')!.textContent = first[0];
      lead.querySelector('.n')!.textContent = `${first[1]} stories`;
      lead.addEventListener('click', () => pickKeyword(first[0]));
      const chips = document.createElement('div');
      chips.className = 'news-hot-rest';
      chips.append(...rest.slice(0, 7).map(([k, n]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.setAttribute('aria-pressed', String(keyword === k));
        b.innerHTML = '<span></span><span class="n"></span>';
        b.firstElementChild!.textContent = k;
        b.lastElementChild!.textContent = String(n);
        b.addEventListener('click', () => pickKeyword(k));
        return b;
      }));
      hot.append(lead, chips);
      parts.push(hot);
    }
    if (week.top) {
      const a = document.createElement('a');
      a.className = 'news-top';
      a.href = week.top.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = '<span class="meta">Most covered</span><span class="news-title"></span><span class="news-meta meta"><span class="src"></span><span class="ago"></span></span>';
      a.querySelector('.news-title')!.textContent = week.top.title;
      a.querySelector('.src')!.textContent = week.top.source;
      a.querySelector('.ago')!.textContent = `${week.top.outlets} outlets`;
      parts.push(a);
    }
    refs.week.replaceChildren(...parts);
  }

  function pickKeyword(k: string): void {
    keyword = keyword === k ? null : k;
    renderWeek();
    renderScope();
    renderList();
    globe?.setMarkers(markers());
    refs.list.scrollTop = 0;
  }

  // topic chips: one active at a time; clicking the active one shows everything again
  const topicChips = new Map<Topic | null, HTMLButtonElement>();
  for (const [id, label] of [[null, 'All'], ...TOPICS] as [Topic | null, string][]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.addEventListener('click', () => {
      topic = topic === id ? null : id;
      renderTopics();
      renderList();
      globe?.setMarkers(markers());
      refs.list.scrollTop = 0;
    });
    topicChips.set(id, b);
  }
  refs.topics.replaceChildren(...topicChips.values());
  function renderTopics(): void {
    for (const [id, b] of topicChips) b.setAttribute('aria-pressed', String(id === topic));
  }
  renderTopics();

  function renderScope(): void {
    const region = data?.places.find((r) => r.id === picked);
    // an active keyword shows as a chip too, so it's clear why the list is short
    const kwChip = (): HTMLElement[] => {
      if (!keyword) return [];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-label', `Clear keyword ${keyword}`);
      b.append(keyword, icon('x'));
      b.addEventListener('click', () => pickKeyword(keyword!));
      return [b];
    };
    if (!region) {
      const all = document.createElement('span');
      all.className = 'meta';
      all.textContent = 'All countries';
      refs.scope.replaceChildren(all, ...kwChip());
      return;
    }
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-label', `Show all countries (now ${region.name})`);
    chip.append(region.name, icon('x'));
    chip.addEventListener('click', () => choose(null));
    refs.scope.replaceChildren(chip, ...kwChip());
  }

  function renderList(): void {
    if (!data) return;
    const names = new Map(data.places.map((p) => [p.id, p.name]));
    const shown = matching().slice(0, LIMIT);
    if (!shown.length) {
      const empty = document.createElement('li');
      empty.className = 'news-empty';
      empty.textContent = 'No headlines right now';
      refs.list.replaceChildren(empty);
      return;
    }
    refs.list.replaceChildren(...shown.map((item) => {
      const li = document.createElement('li');
      li.classList.toggle('fresh', fresh.has(item.link));
      const a = document.createElement('a');
      a.href = item.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const meta = document.createElement('span');
      meta.className = 'news-meta meta';
      // what it's about, and where (unless a place is already picked)
      const tag = document.createElement('span');
      tag.className = 'news-place';
      tag.textContent = [TOPIC_LABEL[item.topics[0]!], picked ? '' : names.get(item.place) ?? ''].filter(Boolean).join(' · ');
      meta.append(tag);
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = item.source;
      const when = document.createElement('span');
      when.className = 'ago';
      when.dataset.time = String(item.time);
      when.textContent = ago(item.time);
      meta.append(src, when);
      const title = document.createElement('span');
      title.className = 'news-title';
      title.textContent = item.title;
      title.lang = item.lang;
      a.append(meta, title);
      li.append(a);
      return li;
    }));
  }

  function renderUpdated(): void {
    refs.updated.textContent = data ? `Updated ${ago(Date.parse(data.updated))}` : '';
    refs.list.querySelectorAll<HTMLElement>('.ago[data-time]').forEach((el) => (el.textContent = ago(Number(el.dataset.time))));
  }

  function choose(id: string | null): void {
    picked = id;
    globe?.select(id);
    renderWeek();
    renderScope();
    renderList();
    refs.list.scrollTop = 0;
    // picking a place opens the headlines; clearing it leaves the drawer as it is
    if (id && currentView() === 'news') toggleDrawer('right', true);
  }

  // ---------- data: load, then keep polling for a newer file
  /** A pin per place that has headlines (for the current topic); size follows the last few hours' share. */
  function markers(): Marker[] {
    if (!data) return [];
    const now = Date.now();
    const items = matching(false);
    const count = (id: string) => items.filter((i) => i.place === id && now - i.time < FRESH_MS).length;
    const places = data.places.filter((p) => items.some((i) => i.place === p.id) || p.id === picked);
    const counts = places.map((p) => count(p.id));
    const most = Math.max(1, ...counts);
    // heatmap: each country's share of all the (filtered) headlines, on a soft curve so mid-sized ones still show
    const totals = places.map((p) => items.filter((i) => i.place === p.id).length);
    const top = Math.max(1, ...totals);
    return places.map((p, i) => ({
      id: p.id, label: p.name, lat: p.lat, lon: p.lon, iso: p.iso ?? [],
      weight: Math.sqrt(counts[i]! / most),
      heat: totals[i]! ? Math.max(0.05, Math.sqrt(totals[i]! / top)) : 0,
    }));
  }

  function apply(next: NewsFile): void {
    const known = new Set(data?.items.map((i) => i.link) ?? []);
    const first = !data;
    data = next;
    if (!first) {
      const arrived = next.items.filter((i) => !known.has(i.link));
      for (const i of arrived) fresh.add(i.link);
      globe?.flash([...new Set(arrived.map((i) => i.place))]);
      announce(arrived);
    }
    globe?.setMarkers(markers());
    renderWeek();
    renderScope();
    renderList();
    renderUpdated();
  }

  // fresh headlines float over the globe one after another (the newest few, while the News page is open)
  const queue: NewsItem[] = [];
  let announcing = 0;
  function announce(arrived: NewsItem[]): void {
    if (currentView() !== 'news') return;
    queue.push(...[...arrived].sort((a, b) => b.time - a.time).slice(0, 5));
    queue.splice(8);
    if (!announcing) next();
    function next(): void {
      const it = queue.shift();
      if (!it) {
        announcing = 0;
        return;
      }
      globe?.announce(it.place, it.title);
      announcing = window.setTimeout(next, 1700);
    }
  }

  let lastStamp = '';
  async function poll(): Promise<void> {
    try {
      // revalidate every time: unchanged → a tiny 304, changed → the new file (publishing purges the site's CDN)
      const res = await fetch(`${import.meta.env.BASE_URL}data/news.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as NewsFile;
      refs.live.classList.add('on');
      if (next.updated === lastStamp) return;
      lastStamp = next.updated;
      apply(next);
    } catch {
      refs.live.classList.remove('on');
    }
  }
  // the headlines and the globe's land (a few hundred KB) wait until News is opened or Haru has nothing else to
  // do, so the first screen never waits on them
  let started = false;
  function start(): void {
    if (started) return;
    // never in the middle of a page turn (the idle moment can fall right on one): just after it
    if (document.body.classList.contains('switching')) {
      setTimeout(start, 350);
      return;
    }
    started = true;
    void poll();
    void loadGlobe();
  }
  // (after this setup has run: the globe's loader is defined further down)
  if (currentView() === 'news') queueMicrotask(start);
  // opened before the idle moment came: the loading waits for the page turn to finish, so the slide stays smooth
  onView((v) => {
    if (v === 'news' && !started) setTimeout(start, 340);
  });
  const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(start, { timeout: 6000 });
  else setTimeout(start, 3000);
  setInterval(() => {
    if (started && document.visibilityState === 'visible') void poll();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (started && document.visibilityState === 'visible') void poll();
  });
  setInterval(renderUpdated, 30_000);
  renderScope();

  // ---------- the globe
  const loadGlobe = () => fetch(`${import.meta.env.BASE_URL}data/globe.json?v=${__BUILD_ID__}`)
    .then((r) => r.json() as Promise<{ points: LandDot[]; extra?: LandDot[] }>)
    .then(({ points, extra }) => {
      globe = createGlobe(refs.canvas, points, extra ?? [], { lat: 37.57, lon: 126.98 });
      globe.onReadout((p) => {
        refs.readout.textContent = p ? fmt(p) : '';
      });
      globe.onPick((id) => {
        if (id) choose(id);
        else if (picked) choose(null);
      });
      globe.setMarkers(markers());
      if (picked) globe.select(picked);
      // heatmap toggle (remembered per browser)
      const HEAT_KEY = 'haru:news-heat';
      const heatBtn = document.createElement('button');
      heatBtn.type = 'button';
      heatBtn.className = 'icon-btn globe-heat';
      heatBtn.setAttribute('aria-label', 'Heatmap');
      heatBtn.title = 'Heatmap: countries by amount of news';
      heatBtn.append(icon('flame'));
      const setHeat = (on: boolean) => {
        globe!.setHeat(on);
        heatBtn.setAttribute('aria-pressed', String(on));
        try {
          localStorage.setItem(HEAT_KEY, on ? '1' : '0');
        } catch {
          // storage unavailable: the choice lasts for this visit
        }
      };
      heatBtn.addEventListener('click', () => setHeat(heatBtn.getAttribute('aria-pressed') !== 'true'));
      // it lives in the attendance bar under the globe (beside the streak); the globe's box if that is missing
      (document.querySelector('.attend .att-head') ?? refs.canvas.parentElement!).append(heatBtn);
      let heatSaved = false;
      try {
        heatSaved = localStorage.getItem(HEAT_KEY) === '1';
      } catch {
        // default off
      }
      setHeat(heatSaved);
      globe.warm();
      // spin only while the page is on screen — including while it slides in or out
      const sync = () => globe!.setActive(currentView() === 'news');
      onView((view, prev) => {
        if (view !== 'news' && prev !== 'news') return;
        globe!.setActive(true);
        setTimeout(sync, 450);
      });
      sync();
    })
    .catch(() => {});
}
