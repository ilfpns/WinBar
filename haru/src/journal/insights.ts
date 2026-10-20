import { CATEGORIES, CATEGORY_KEYS, type Block, type Category, labelOf } from '../timetable/model';
import { allDays, dayOf, onDaySaved } from '../timetable/history';
import { state, subscribe } from '../timetable/state';
import { formatDuration } from '../timetable/time';
import { icon, type IconName } from '../ui/icons';
import { lang } from '../ui/i18n';

/**
 * Your days, over the top of Journal: everything Today has held so far (every day's snapshot, today live).
 * Four numbers, each with what it means on hover; the last two weeks as columns (planned, and the part of it
 * done); and, opened, where the time went — by category, the tasks that took the most, and each weekday.
 *
 * Every bar shows planned time faint and the done part of it solid in the one chart colour (magnitude, not
 * identity: rows are named, categories carry their dot). Numbers count up and bars grow when the card comes
 * into view or is opened; edits on Today after that just update the values.
 */
const OPEN_KEY = 'haru:insights-open';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RECENT = 14;

interface Tally {
  planned: number;
  done: number;
}
interface Stats extends Tally {
  days: number;
  first: string;
  sleep: number;
  byCat: Map<Category, Tally>;
  tasks: (Tally & { name: string; days: number })[];
  /** Per weekday (Sun..Sat): average planned and done minutes, and how many of that weekday were tracked. */
  weekdays: (Tally & { n: number })[];
  /** Each of the last RECENT days, oldest first (zeros where nothing was planned). */
  recent: (Tally & { date: string })[];
}

const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function compute(daysMap: Map<string, Block[]>, today: string): Stats {
  const filled = [...daysMap].filter(([, b]) => b.length).sort(([a], [b]) => a.localeCompare(b));
  const byCat = new Map<Category, Tally>();
  const tasks = new Map<string, Tally & { name: string; dates: Set<string> }>();
  const wd = Array.from({ length: 7 }, () => ({ planned: 0, done: 0, n: 0 }));
  const perDay = new Map<string, Tally>();
  let planned = 0;
  let done = 0;
  let sleep = 0;
  for (const [date, blocks] of filled) {
    const day = { planned: 0, done: 0 };
    for (const b of blocks) {
      const d = b.done ? b.dur : 0;
      planned += b.dur;
      done += d;
      day.planned += b.dur;
      day.done += d;
      if (b.cat === 'sleep') sleep += b.dur;
      const c = byCat.get(b.cat) ?? { planned: 0, done: 0 };
      c.planned += b.dur;
      c.done += d;
      byCat.set(b.cat, c);
      const name = labelOf(b).trim();
      const key = name.toLowerCase();
      const t = tasks.get(key) ?? { name, planned: 0, done: 0, dates: new Set<string>() };
      t.planned += b.dur;
      t.done += d;
      t.dates.add(date);
      tasks.set(key, t);
    }
    perDay.set(date, day);
    const w = wd[new Date(`${date}T00:00`).getDay()]!;
    w.planned += day.planned;
    w.done += day.done;
    w.n++;
  }
  const recent: Stats['recent'] = [];
  const end = new Date(`${today}T00:00`);
  for (let k = RECENT - 1; k >= 0; k--) {
    const d = new Date(end);
    d.setDate(end.getDate() - k);
    const key = keyOf(d);
    recent.push({ date: key, ...(perDay.get(key) ?? { planned: 0, done: 0 }) });
  }
  return {
    days: filled.length,
    first: filled[0]?.[0] ?? '',
    planned,
    done,
    sleep,
    byCat,
    tasks: [...tasks.values()].sort((a, b) => b.planned - a.planned).slice(0, 5).map((t) => ({ name: t.name, planned: t.planned, done: t.done, days: t.dates.size })),
    weekdays: wd.map((w) => ({ planned: w.n ? w.planned / w.n : 0, done: w.n ? w.done / w.n : 0, n: w.n })),
    recent,
  };
}

const hours = (min: number) => formatDuration(Math.round(min));
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const ko = () => lang() === 'ko';
const fmtDate = (key: string, withWeekday = false) => {
  const d = new Date(`${key}T00:00`);
  return ko()
    ? `${d.getMonth() + 1}월 ${d.getDate()}일${withWeekday ? ` (${'일월화수목금토'[d.getDay()]})` : ''}`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withWeekday ? { weekday: 'short' } : {}) });
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts a tile's number up from zero (the text it ends on is exactly `final`). */
function countUp(el: HTMLElement, to: number, format: (n: number) => string, final: string): void {
  if (reduced() || !to) {
    el.textContent = final;
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  const step = (t: number) => {
    const k = Math.min(1, Math.max(0, (t - t0) / dur));
    const eased = 1 - (1 - k) ** 3;
    el.textContent = k < 1 ? format(to * eased) : final;
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A hover explanation: a small (i) whose label is what the number or chart means. */
function info(text: string): HTMLElement {
  const i = document.createElement('span');
  i.className = 'ins-info';
  i.tabIndex = 0;
  i.dataset.tip = text;
  i.setAttribute('aria-label', text);
  i.append(icon('info'));
  return i;
}

/** Sets a style at once, or from nothing on the next frames so its transition plays. */
function grow(el: HTMLElement | SVGElement, prop: 'width' | 'height' | 'strokeDashoffset', value: string, animate: boolean, from = '0'): void {
  el.dataset.grow = `${prop}|${from}|${value}`;
  if (!animate || reduced()) {
    el.style[prop] = value;
    return;
  }
  el.style[prop] = from;
  requestAnimationFrame(() => requestAnimationFrame(() => (el.style[prop] = value)));
}

interface TileSpec {
  icon: IconName;
  label: string;
  explain: string;
  to: number;
  format: (n: number) => string;
  sub: string;
  /** 0..1: a ring around the icon fills to this (the done share). */
  ring?: number;
}
function tile(spec: TileSpec, animate: boolean, k: number): HTMLElement {
  const t = document.createElement('div');
  t.className = `ins-tile${animate ? ' rise' : ''}`;
  t.style.setProperty('--i', String(k));
  const ic = document.createElement('span');
  ic.className = 'ins-ic';
  if (spec.ring !== undefined) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.classList.add('ins-ring');
    const track = document.createElementNS(ns, 'circle');
    const arc = document.createElementNS(ns, 'circle');
    for (const c of [track, arc]) {
      c.setAttribute('cx', '18');
      c.setAttribute('cy', '18');
      c.setAttribute('r', '16');
      c.setAttribute('pathLength', '100');
    }
    track.classList.add('ins-ring-track');
    arc.classList.add('ins-ring-arc');
    grow(arc, 'strokeDashoffset', String(100 - Math.max(0, Math.min(1, spec.ring)) * 100), animate, '100');
    svg.append(track, arc);
    ic.append(svg);
  }
  ic.append(icon(spec.icon));
  const label = document.createElement('span');
  label.className = 'meta ins-label';
  label.append(spec.label, info(spec.explain));
  const num = document.createElement('strong');
  num.className = 'ins-num';
  const final = spec.format(spec.to);
  if (animate) countUp(num, spec.to, spec.format, final);
  else num.textContent = final;
  const sub = document.createElement('span');
  sub.className = 'ins-sub';
  sub.textContent = spec.sub;
  const text = document.createElement('div');
  text.className = 'ins-tile-text';
  text.append(label, num, sub);
  t.append(ic, text);
  return t;
}

/** Grows every bar under `root` again from nothing (no rebuild: what was drawn just replays its growth). */
function regrow(root: Element): void {
  if (reduced()) return;
  const els = [...root.querySelectorAll<HTMLElement | SVGElement>('[data-grow]')];
  for (const el of els) {
    const [prop, from] = el.dataset.grow!.split('|') as ['width' | 'height' | 'strokeDashoffset', string];
    el.style.transition = 'none';
    el.style[prop] = from;
  }
  // one forced layout for all of them, then their transitions run to where they were
  void (root as HTMLElement).offsetHeight;
  for (const el of els) {
    const [prop, , value] = el.dataset.grow!.split('|') as ['width' | 'height' | 'strokeDashoffset', string, string];
    el.style.transition = '';
    el.style[prop] = value;
  }
}

/** One named row: label (with an optional category dot), planned faint with its done part solid, the value. */
function barRow(label: string, t: Tally, max: number, text: string, tip: string, animate: boolean, k: number, cat?: Category): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ins-row';
  row.style.setProperty('--i', String(k));
  const name = document.createElement('span');
  name.className = 'ins-name';
  if (cat) {
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.setProperty('--c', `var(--cat-${cat})`);
    name.append(dot);
  }
  const nameText = document.createElement('span');
  nameText.className = 'ins-name-text';
  nameText.textContent = label;
  name.append(nameText);
  const track = document.createElement('span');
  track.className = 'ins-track';
  const plan = document.createElement('i');
  plan.className = 'ins-bar plan';
  const done = document.createElement('i');
  done.className = 'ins-bar done';
  grow(plan, 'width', `${max ? Math.max(2, (t.planned / max) * 100) : 0}%`, animate);
  grow(done, 'width', `${max ? (t.done / max) * 100 : 0}%`, animate);
  track.append(plan, done);
  // the hover target is the whole row, bigger than the bar
  row.dataset.tip = tip;
  row.setAttribute('aria-label', tip);
  const val = document.createElement('span');
  val.className = 'ins-val';
  val.textContent = text;
  row.append(name, track, val);
  return row;
}

function group(title: string, explain: string, rows: HTMLElement[], empty: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'ins-group';
  const h = document.createElement('span');
  h.className = 'card-title ins-group-title';
  h.append(title, info(explain));
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'meta ins-empty';
    p.textContent = empty;
    g.append(h, p);
  } else g.append(h, ...rows);
  return g;
}

function legend(): HTMLElement {
  const l = document.createElement('span');
  l.className = 'ins-legend';
  l.innerHTML = '<span><i class="sw done"></i><span>Done</span></span><span><i class="sw plan"></i><span>Planned</span></span>';
  return l;
}

/** The last two weeks as columns: planned faint, done solid, today marked; hover names the day. */
function recentChart(s: Stats, today: string, animate: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ins-recent';
  const head = document.createElement('div');
  head.className = 'ins-recent-head';
  const title = document.createElement('span');
  title.className = 'card-title ins-group-title';
  title.append('Last 14 days', info('Each column is a day: its height is the time planned on Today, the solid part what was done'));
  head.append(title, legend());
  const cols = document.createElement('div');
  cols.className = 'ins-cols';
  const max = Math.max(60, ...s.recent.map((d) => d.planned));
  s.recent.forEach((d, k) => {
    const col = document.createElement('div');
    col.className = `ins-col${d.date === today ? ' today' : ''}${d.planned ? '' : ' none'}`;
    col.style.setProperty('--i', String(k));
    const tip = d.planned
      ? `${fmtDate(d.date, true)} · ${hours(d.planned)} planned · ${hours(d.done)} done (${pct(d.done, d.planned)}%)`
      : `${fmtDate(d.date, true)} · nothing planned`;
    col.dataset.tip = tip;
    col.setAttribute('aria-label', tip);
    const bar = document.createElement('span');
    bar.className = 'ins-col-bar';
    const plan = document.createElement('i');
    plan.className = 'ins-col-fill plan';
    const done = document.createElement('i');
    done.className = 'ins-col-fill done';
    grow(plan, 'height', `${(d.planned / max) * 100}%`, animate);
    grow(done, 'height', `${(d.done / max) * 100}%`, animate);
    bar.append(plan, done);
    const lab = document.createElement('span');
    lab.className = 'ins-col-label';
    lab.textContent = d.date === today ? (ko() ? '오늘' : 'Today') : String(new Date(`${d.date}T00:00`).getDate());
    col.append(bar, lab);
    cols.append(col);
  });
  wrap.append(head, cols);
  return wrap;
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
  const toggle = document.createElement('span');
  toggle.className = 'meta ins-toggle';
  head.append(title, since, toggle, icon('chevron-down'));
  const tiles = document.createElement('div');
  tiles.className = 'ins-tiles';
  const more = document.createElement('div');
  more.className = 'ins-more';
  // the charts fold down and up (grid rows 0fr <-> 1fr) instead of appearing at once
  const fold = document.createElement('div');
  fold.className = 'ins-fold';
  fold.append(more);
  card.append(head, tiles, fold);
  // tooltips may rise past the fold's edge once it has settled open
  fold.addEventListener('transitionend', (e) => {
    if (e.target === fold && e.propertyName === 'grid-template-rows') fold.classList.toggle('settled', open);
  });
  page.insertBefore(card, page.querySelector('.pg-body'));

  let open = false;
  try {
    open = localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    // closed
  }
  // the next paint animates: when the card comes into view, and after opening it
  let animateTiles = false;
  let animateMore = false;
  const paintOpen = () => {
    fold.inert = !open;
    fold.classList.remove('settled');
    head.setAttribute('aria-expanded', String(open));
    card.classList.toggle('open', open);
    toggle.textContent = open ? 'Less' : 'More';
  };
  head.addEventListener('click', () => {
    open = !open;
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      // for this visit
    }
    paintOpen();
    if (!open) return;
    if (chartsFresh) requestAnimationFrame(() => regrow(more));
    else requestAnimationFrame(() => {
      if (stats) drawCharts(stats, true);
    });
  });
  paintOpen();

  let saved = new Map<string, Block[]>();
  let loaded = false;
  let stats: { s: Stats; today: string } | null = null;
  /** Whether the charts under the fold show the latest numbers (drawn while closed, in idle time). */
  let chartsFresh = false;
  let idle = 0;
  const hasIdle = typeof requestIdleCallback === 'function';
  const later = (fn: () => void): number => (hasIdle ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  const cancelLater = (id: number) => (hasIdle ? cancelIdleCallback(id) : clearTimeout(id));
  function render(): void {
    // the day on now counts as it is right now
    const today = dayOf();
    const days = new Map(saved);
    days.set(today, state.blocks);
    const s = compute(days, today);
    stats = { s, today };
    since.textContent = s.days ? `since ${fmtDate(s.first)}` : '';
    const a = animateTiles && loaded;
    const per = (min: number) => (s.days ? min / s.days : 0);
    tiles.replaceChildren(
      tile({ icon: 'calendar', label: 'Days tracked', explain: 'Days with at least one task planned on Today', to: s.days, format: (n) => String(Math.round(n)), sub: s.days ? `${hours(s.planned)} planned in all` : 'Plan a day on Today' }, a, 0),
      tile({ icon: 'clock', label: 'Planned a day', explain: 'Time planned on Today, averaged over the days tracked (24h is a full day)', to: per(s.planned), format: hours, sub: 'on average' }, a, 1),
      tile({ icon: 'circle-check', label: 'Done', explain: 'How much of all the planned time was checked off as done', to: pct(s.done, s.planned), format: (n) => `${Math.round(n)}%`, sub: `${hours(s.done)} of ${hours(s.planned)}`, ring: s.planned ? s.done / s.planned : 0 }, a, 2),
      tile({ icon: 'moon', label: 'Sleep a night', explain: 'Time in the Sleep category, averaged over the days tracked', to: per(s.sleep), format: hours, sub: 'on average' }, a, 3),
    );
    if (a) animateTiles = false;

    // the charts: now when opened; while closed, when the browser has a moment, so opening has nothing to build
    chartsFresh = false;
    cancelLater(idle);
    if (open) drawCharts(stats, animateMore && loaded);
    else idle = later(() => stats && drawCharts(stats, false));
  }

  function drawCharts({ s, today }: { s: Stats; today: string }, m: boolean): void {
    const cats = CATEGORY_KEYS.filter((k) => s.byCat.get(k)?.planned).sort((x, y) => s.byCat.get(y)!.planned - s.byCat.get(x)!.planned);
    const catMax = Math.max(0, ...cats.map((k) => s.byCat.get(k)!.planned));
    const catRows = cats.map((k, i) => {
      const t = s.byCat.get(k)!;
      return barRow(CATEGORIES[k], t, catMax, `${hours(t.planned)} · ${pct(t.planned, s.planned)}%`,
        `${CATEGORIES[k]} · ${hours(t.planned)} planned (${pct(t.planned, s.planned)}% of all) · ${pct(t.done, t.planned)}% done`, m, i, k);
    });
    const taskMax = s.tasks[0]?.planned ?? 0;
    const taskRows = s.tasks.map((t, i) => barRow(t.name, t, taskMax, hours(t.planned),
      `${t.name} · ${hours(t.planned)} over ${t.days} ${t.days === 1 ? 'day' : 'days'} · ${pct(t.done, t.planned)}% done`, m, i));
    // Monday first
    const order = [1, 2, 3, 4, 5, 6, 0];
    const wdMax = Math.max(0, ...s.weekdays.map((w) => w.planned));
    const wdRows = order.filter((d) => s.weekdays[d]!.n).map((d, i) => {
      const w = s.weekdays[d]!;
      return barRow(WEEKDAYS[d]!, w, wdMax, `${hours(w.planned)} · ${pct(w.done, w.planned)}%`,
        `${WEEKDAYS[d]} · ${hours(w.planned)} planned on average, ${pct(w.done, w.planned)}% done (${w.n} ${w.n === 1 ? 'day' : 'days'})`, m, i);
    });
    const groups = document.createElement('div');
    groups.className = 'ins-groups';
    groups.append(
      group('By category', 'All the planned time, split by category; the solid part was done', catRows, 'Nothing planned yet'),
      group('Most time on', 'The five tasks (by name) that took the most planned time', taskRows, 'Nothing planned yet'),
      group('By weekday', 'An average day of each weekday: time planned, and how much of it was done', wdRows, 'Nothing planned yet'),
    );
    more.replaceChildren(recentChart(s, today, m), groups);
    if (m) animateMore = false;
    chartsFresh = true;
  }

  async function load(): Promise<void> {
    const snaps = await allDays().catch(() => []);
    saved = new Map(snaps.map((d) => [d.date, d.blocks]));
    loaded = true;
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
  // the numbers count up and the bars grow each time the card comes into view (turning to Journal)
  new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting) || !loaded) return;
    animateTiles = true;
    requestAnimationFrame(() => {
      render();
      if (open && chartsFresh) regrow(more);
    });
  }).observe(card);
  void load();
}
