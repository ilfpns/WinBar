import { CATEGORIES, CATEGORY_KEYS, type Block, type Category, labelOf } from '../timetable/model';
import { allDays, dayOf, onDaySaved } from '../timetable/history';
import { state, subscribe } from '../timetable/state';
import { formatDuration } from '../timetable/time';
import { icon } from '../ui/icons';

/**
 * Your days, over the top of Journal: everything Today has held so far (every day's snapshot, today live),
 * as four numbers — days tracked, planned a day, share done, sleep a night — and, opened, where the time
 * went: by category, the tasks that took the most, and how full each weekday runs. Bars are one colour
 * (it is magnitude, not identity); each row is named, and hovering a bar gives its exact value.
 */
const OPEN_KEY = 'haru:insights-open';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Stats {
  days: number;
  first: string;
  planned: number;
  done: number;
  sleep: number;
  byCat: Map<Category, number>;
  tasks: { name: string; min: number; days: number }[];
  /** Average planned minutes for each weekday (Sun..Sat), and how many of that weekday were tracked. */
  weekdays: { avg: number; n: number }[];
}

function compute(daysMap: Map<string, Block[]>): Stats {
  const filled = [...daysMap].filter(([, b]) => b.length).sort(([a], [b]) => a.localeCompare(b));
  const byCat = new Map<Category, number>();
  const tasks = new Map<string, { name: string; min: number; days: Set<string> }>();
  const wd = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  let planned = 0;
  let done = 0;
  let sleep = 0;
  for (const [date, blocks] of filled) {
    let dayPlanned = 0;
    for (const b of blocks) {
      planned += b.dur;
      dayPlanned += b.dur;
      if (b.done) done += b.dur;
      if (b.cat === 'sleep') sleep += b.dur;
      byCat.set(b.cat, (byCat.get(b.cat) ?? 0) + b.dur);
      const name = labelOf(b).trim();
      const key = name.toLowerCase();
      const t = tasks.get(key) ?? { name, min: 0, days: new Set<string>() };
      t.min += b.dur;
      t.days.add(date);
      tasks.set(key, t);
    }
    const w = wd[new Date(`${date}T00:00`).getDay()]!;
    w.sum += dayPlanned;
    w.n++;
  }
  return {
    days: filled.length,
    first: filled[0]?.[0] ?? '',
    planned,
    done,
    sleep,
    byCat,
    tasks: [...tasks.values()].sort((a, b) => b.min - a.min).slice(0, 5).map((t) => ({ name: t.name, min: t.min, days: t.days.size })),
    weekdays: wd.map((w) => ({ avg: w.n ? w.sum / w.n : 0, n: w.n })),
  };
}

const hours = (min: number) => formatDuration(Math.round(min));

/** One named bar: label (with an optional category dot), the bar against the largest, the value. */
function barRow(label: string, value: number, max: number, text: string, tip: string, cat?: Category): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ins-row';
  const name = document.createElement('span');
  name.className = 'ins-name';
  if (cat) {
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.setProperty('--c', `var(--cat-${cat})`);
    name.append(dot);
  }
  name.append(label);
  const track = document.createElement('span');
  track.className = 'ins-track';
  const bar = document.createElement('i');
  bar.className = 'ins-bar';
  bar.style.width = `${max ? Math.max(2, (value / max) * 100) : 0}%`;
  track.append(bar);
  // the hover target is the whole row, bigger than the bar
  row.dataset.tip = tip;
  row.setAttribute('aria-label', tip);
  const val = document.createElement('span');
  val.className = 'ins-val';
  val.textContent = text;
  row.append(name, track, val);
  return row;
}

function tile(label: string, value: string, sub: string): HTMLElement {
  const t = document.createElement('div');
  t.className = 'ins-tile';
  t.innerHTML = '<span class="meta ins-label"></span><strong class="ins-num"></strong><span class="ins-sub"></span>';
  t.querySelector('.ins-label')!.textContent = label;
  t.querySelector('.ins-num')!.textContent = value;
  t.querySelector('.ins-sub')!.textContent = sub;
  return t;
}

function group(title: string, rows: HTMLElement[], empty: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'ins-group';
  const h = document.createElement('span');
  h.className = 'card-title';
  h.textContent = title;
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'meta ins-empty';
    p.textContent = empty;
    g.append(h, p);
  } else g.append(h, ...rows);
  return g;
}

/** Puts the card on the Journal page, between its title and the pages. */
export function mountInsights(page: HTMLElement): void {
  const card = document.createElement('section');
  card.className = 'insights glass-card';
  card.setAttribute('aria-label', 'Your days');
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'ins-head';
  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = 'Your days';
  const since = document.createElement('span');
  since.className = 'meta ins-since';
  const chev = icon('chevron-down');
  head.append(title, since, chev);
  const tiles = document.createElement('div');
  tiles.className = 'ins-tiles';
  const more = document.createElement('div');
  more.className = 'ins-more';
  card.append(head, tiles, more);
  page.insertBefore(card, page.querySelector('.pg-body'));

  let open = false;
  try {
    open = localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    // closed
  }
  const paintOpen = () => {
    more.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    card.classList.toggle('open', open);
  };
  head.addEventListener('click', () => {
    open = !open;
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      // for this visit
    }
    paintOpen();
  });
  paintOpen();

  let saved = new Map<string, Block[]>();
  function render(): void {
    // the day on now counts as it is right now
    const days = new Map(saved);
    days.set(dayOf(), state.blocks);
    const s = compute(days);
    since.textContent = s.days ? `since ${new Date(`${s.first}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
    const per = (min: number) => (s.days ? hours(min / s.days) : '0m');
    tiles.replaceChildren(
      tile('Days tracked', String(s.days), s.days ? `${hours(s.planned)} planned in all` : 'Plan a day on Today'),
      tile('Planned a day', per(s.planned), 'on average'),
      tile('Done', `${s.planned ? Math.round((s.done / s.planned) * 100) : 0}%`, `${hours(s.done)} of the plan`),
      tile('Sleep a night', per(s.sleep), 'on average'),
    );

    const cats = CATEGORY_KEYS.filter((k) => s.byCat.get(k)).sort((a, b) => s.byCat.get(b)! - s.byCat.get(a)!);
    const catMax = Math.max(0, ...cats.map((k) => s.byCat.get(k)!));
    const catRows = cats.map((k) => {
      const min = s.byCat.get(k)!;
      const pct = s.planned ? Math.round((min / s.planned) * 100) : 0;
      return barRow(CATEGORIES[k], min, catMax, hours(min), `${CATEGORIES[k]} · ${hours(min)} · ${pct}% of planned time`, k);
    });
    const taskMax = s.tasks[0]?.min ?? 0;
    const taskRows = s.tasks.map((t) => barRow(t.name, t.min, taskMax, hours(t.min), `${t.name} · ${hours(t.min)} over ${t.days} ${t.days === 1 ? 'day' : 'days'}`));
    // Monday first
    const order = [1, 2, 3, 4, 5, 6, 0];
    const wdMax = Math.max(0, ...s.weekdays.map((w) => w.avg));
    const wdRows = order.filter((d) => s.weekdays[d]!.n).map((d) => {
      const w = s.weekdays[d]!;
      return barRow(WEEKDAYS[d]!, w.avg, wdMax, hours(w.avg), `${WEEKDAYS[d]} · ${hours(w.avg)} planned on average (${w.n} ${w.n === 1 ? 'day' : 'days'})`);
    });
    more.replaceChildren(
      group('By category', catRows, 'Nothing planned yet'),
      group('Most time on', taskRows, 'Nothing planned yet'),
      group('By weekday', wdRows, 'Nothing planned yet'),
    );
  }

  async function load(): Promise<void> {
    const snaps = await allDays().catch(() => []);
    saved = new Map(snaps.map((d) => [d.date, d.blocks]));
    render();
  }
  // a day's snapshot is rewritten after every change on Today
  let pending = 0;
  onDaySaved(() => {
    clearTimeout(pending);
    pending = window.setTimeout(() => void load(), 600);
  });
  // Today's own edits show at once (only when its tasks change, not on every drag frame)
  let last = state.blocks;
  subscribe(() => {
    if (state.blocks === last) return;
    last = state.blocks;
    render();
  });
  void load();
}
