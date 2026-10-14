import { createGlobe, type GeoPoint, type Marker } from './globe';
import { currentView, onView } from '../ui/router';
import { toggleDrawer } from '../timetable/state';
import { icon } from '../ui/icons';

/** data/news.json, refreshed every 10 minutes by scripts/fetch-news.mjs (GitHub Actions). */
type Topic = 'ai' | 'agi' | 'robotics' | 'chips' | 'embedded' | 'sw' | 'hw';
interface NewsItem { title: string; source: string; link: string; time: number; topics: Topic[]; place: string; lang: string }
interface Place extends GeoPoint { id: string; name: string }
interface NewsFile { updated: string; places: Place[]; items: NewsItem[] }

const POLL_MS = 60_000;     // look for a fresh file this often while the page is open
const FRESH_MS = 6 * 3600_000;
const LIMIT = 120;
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
  topics: HTMLElement;
  list: HTMLElement;
}

/** News page: the dot globe with a pin per place, and the right drawer listing its latest headlines. */
export function mountNews(refs: NewsRefs): void {
  let data: NewsFile | null = null;
  let picked: string | null = null;
  let topic: Topic | null = null;
  /** Headlines that arrived while the page was open (marked until reload). */
  const fresh = new Set<string>();
  let globe: ReturnType<typeof createGlobe> | null = null;

  // ---------- the drawer
  /** Headlines passing the topic filter (and the picked place). */
  const matching = (withPlace = true) =>
    (data?.items ?? []).filter((i) => (!topic || i.topics.includes(topic)) && (!withPlace || !picked || i.place === picked));

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
    if (!region) {
      const all = document.createElement('span');
      all.className = 'meta';
      all.textContent = 'All places';
      refs.scope.replaceChildren(all);
      return;
    }
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-label', `Show all places (now ${region.name})`);
    chip.append(region.name, icon('x'));
    chip.addEventListener('click', () => choose(null));
    refs.scope.replaceChildren(chip);
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
    return places.map((p, i) => ({ id: p.id, label: p.name, lat: p.lat, lon: p.lon, weight: Math.sqrt(counts[i]! / most) }));
  }

  function apply(next: NewsFile): void {
    const known = new Set(data?.items.map((i) => i.link) ?? []);
    const first = !data;
    data = next;
    if (!first) {
      const arrived = next.items.filter((i) => !known.has(i.link));
      for (const i of arrived) fresh.add(i.link);
      globe?.flash([...new Set(arrived.map((i) => i.place))]);
    }
    globe?.setMarkers(markers());
    renderScope();
    renderList();
    renderUpdated();
  }

  let lastStamp = '';
  async function poll(): Promise<void> {
    try {
      // the site's CDN caches files for a few minutes: ask past it
      const res = await fetch(`${import.meta.env.BASE_URL}data/news.json?t=${Date.now()}`, { cache: 'no-store' });
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
  void poll();
  setInterval(() => {
    if (document.visibilityState === 'visible') void poll();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void poll();
  });
  setInterval(renderUpdated, 30_000);
  renderScope();

  // ---------- the globe
  fetch(`${import.meta.env.BASE_URL}data/globe.json`)
    .then((r) => r.json() as Promise<{ points: [number, number][] }>)
    .then(({ points }) => {
      globe = createGlobe(refs.canvas, points, { lat: 37.57, lon: 126.98 });
      globe.onReadout((p) => {
        refs.readout.textContent = p ? fmt(p) : '';
      });
      globe.onPick((id) => {
        if (id) choose(id);
        else if (picked) choose(null);
      });
      globe.setMarkers(markers());
      if (picked) globe.select(picked);
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
