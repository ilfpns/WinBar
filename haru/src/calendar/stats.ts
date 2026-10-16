import { allDays, dayKey, type DaySnapshot } from '../timetable/history';
import { CATEGORIES, CATEGORY_KEYS, type Category, progressOf } from '../timetable/model';
import { state } from '../timetable/state';
import { DAY, formatDuration, mod } from '../timetable/time';
import { icon } from '../ui/icons';

/**
 * Progress dashboard from the day history (every day Today was saved): headline numbers against the
 * previous period, how much got done day by day against the plan, when in the week the work happens,
 * and where the time went by category. A dialog opened from the calendar header.
 */
type Range = 'month' | 'all';

const NS = 'http://www.w3.org/2000/svg';
const pctOf = (blocks: DaySnapshot['blocks']) => Math.round((progressOf(blocks).done / DAY) * 100);
const planPctOf = (blocks: DaySnapshot['blocks']) => Math.round((progressOf(blocks).planned / DAY) * 100);
const short = (date: string) => date.slice(5).replace('-', '/');

interface Totals { days: number; avg: number; done: number; planned: number; hit: number }
function totalsOf(days: DaySnapshot[]): Totals {
  const done = days.reduce((m, d) => m + progressOf(d.blocks).done, 0);
  const planned = days.reduce((m, d) => m + progressOf(d.blocks).planned, 0);
  const avg = days.length ? Math.round(days.reduce((m, d) => m + pctOf(d.blocks), 0) / days.length) : 0;
  return { days: days.length, avg, done, planned, hit: planned ? Math.round((done / planned) * 100) : 0 };
}

export function mountStats(trigger: HTMLButtonElement, monthOf: () => Date): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'stats';
  dialog.setAttribute('aria-label', 'Statistics');
  document.body.append(dialog);
  let range: Range = 'month';

  // click on the dimmed backdrop closes; Esc closes natively
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  function close(): void {
    dialog.classList.add('closing');
    setTimeout(() => {
      dialog.classList.remove('closing');
      dialog.close();
    }, 200);
  }

  trigger.addEventListener('click', async () => {
    await render();
    dialog.showModal();
  });

  async function render(): Promise<void> {
    // the saved days, with today live
    const saved = await allDays().catch(() => [] as DaySnapshot[]);
    const byDate = new Map(saved.map((d) => [d.date, d]));
    byDate.set(dayKey(), { date: dayKey(), blocks: state.blocks, saved: Date.now() });
    const month = monthOf();
    const monthPrefix = (m: Date) => `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    const prefix = monthPrefix(month);
    const prevPrefix = monthPrefix(new Date(month.getFullYear(), month.getMonth() - 1, 1));
    const past = [...byDate.values()].filter((d) => d.date <= dayKey()).sort((a, b) => a.date.localeCompare(b.date));
    const days = range === 'all' ? past : past.filter((d) => d.date.startsWith(prefix));
    // the period before, for the change on each card (none for all time); a month still running is
    // compared with the same days of the month before, so half a month never reads as a drop
    const cutoff = prefix === dayKey().slice(0, 7) ? dayKey().slice(8) : '31';
    const before = range === 'all' ? null : past.filter((d) => d.date.startsWith(prevPrefix) && d.date.slice(8) <= cutoff);

    const head = document.createElement('header');
    head.className = 'stats-head';
    const title = document.createElement('h2');
    title.textContent = range === 'month' ? month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'All time';
    const tabs = document.createElement('div');
    tabs.className = 'stats-tabs';
    for (const [id, label] of [['month', 'Month'], ['all', 'All']] as [Range, string][]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(range === id));
      b.addEventListener('click', () => {
        range = id;
        void render();
      });
      tabs.append(b);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.setAttribute('aria-label', 'Close');
    x.append(icon('x'));
    x.addEventListener('click', close);
    head.append(title, tabs, x);

    if (!days.length) {
      const empty = document.createElement('p');
      empty.className = 'stats-empty';
      empty.textContent = 'No days recorded yet';
      dialog.replaceChildren(head, empty);
      return;
    }

    // ---- headline cards, each with its change from the previous month
    const now = totalsOf(days);
    const prev = before?.length ? totalsOf(before) : null;
    const span = `${short(days[0]!.date)} – ${short(days[days.length - 1]!.date)}`;
    const cards: { label: string; value: string; delta: number | null; unit: string }[] = [
      { label: 'Attendance', value: `${now.days}`, delta: prev && now.days - prev.days, unit: 'd' },
      { label: 'Avg. done', value: `${now.avg}%`, delta: prev && now.avg - prev.avg, unit: 'pt' },
      { label: 'Focus time', value: formatDuration(now.done), delta: prev && prev.done ? Math.round(((now.done - prev.done) / prev.done) * 100) : null, unit: '%' },
      { label: 'Plan hit', value: `${now.hit}%`, delta: prev && now.hit - prev.hit, unit: 'pt' },
    ];
    const summary = document.createElement('div');
    summary.className = 'stats-cards';
    summary.append(...cards.map((card, i) => {
      const c = document.createElement('div');
      c.className = 'stats-card';
      c.style.setProperty('--i', String(i));
      c.innerHTML = '<div class="stats-card-top"><span class="label"></span></div><strong></strong><span class="sub meta"></span>';
      c.querySelector('.label')!.textContent = card.label;
      c.querySelector('strong')!.textContent = card.value;
      c.querySelector('.sub')!.textContent = span;
      if (card.delta !== null) {
        const d = document.createElement('span');
        d.className = `stats-delta${card.delta < 0 ? ' down' : ''}`;
        d.append(icon(card.delta < 0 ? 'trending-down' : 'trending-up'), `${card.delta > 0 ? '+' : ''}${card.delta}${card.unit}`);
        d.title = 'vs. previous month';
        c.querySelector('.stats-card-top')!.append(d);
      }
      return c;
    }));

    const row = document.createElement('div');
    row.className = 'stats-row';
    row.append(heatmap(days), lineChart(days));
    dialog.replaceChildren(head, summary, row, categories(days));
  }
}

/** When the work gets done: done time per weekday and 4-hour slot, in four shades. */
function heatmap(days: DaySnapshot[]): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'stats-box';
  sec.innerHTML = '<div class="stats-label"><span>Done by time</span></div><div class="stats-heat"></div>';
  const grid = sec.querySelector('.stats-heat')!;
  const SLOTS = 6;
  const cells = Array.from({ length: SLOTS * 7 }, () => 0); // [slot * 7 + weekday(Mon=0)]
  for (const d of days) {
    const wd = (new Date(`${d.date}T00:00`).getDay() + 6) % 7;
    for (const b of d.blocks) {
      if (!b.done) continue;
      for (let t = 0; t < b.dur; t += 15) cells[Math.floor(mod(b.start + t) / 240) * 7 + wd]! += Math.min(15, b.dur - t);
    }
  }
  const top = Math.max(1, ...cells);
  const frag: Element[] = [];
  for (let s = 0; s < SLOTS; s++) {
    const label = document.createElement('span');
    label.className = 'meta';
    label.textContent = `${String(s * 4).padStart(2, '0')}h`;
    frag.push(label);
    for (let wd = 0; wd < 7; wd++) {
      const v = cells[s * 7 + wd]!;
      const c = document.createElement('i');
      c.className = 'att-cell';
      c.dataset.l = v ? String(Math.min(4, 1 + Math.floor((v / top) * 4))) : '0';
      c.title = `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][wd]} ${s * 4}–${s * 4 + 4}h · ${formatDuration(v)}`;
      frag.push(c);
    }
  }
  frag.push(document.createElement('span'));
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    const l = document.createElement('span');
    l.className = 'meta';
    l.textContent = d;
    frag.push(l);
  }
  grid.append(...frag);
  return sec;
}

/** Done % per day as a smooth line, the planned % behind it; hover shows a day's numbers. */
function lineChart(days: DaySnapshot[]): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'stats-box stats-line';
  sec.innerHTML = `<div class="stats-label"><span>Done per day</span>
    <span class="stats-key"><span><i style="--c: var(--accent)"></i>Done</span><span><i style="--c: var(--text-muted)"></i>Planned</span></span></div>`;
  const shown = days.slice(-62);
  const W = 520;
  const H = 200;
  const L = 34;
  const B = 22;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'stats-svg');
  const x = (i: number) => L + (shown.length < 2 ? (W - L) / 2 : (i / (shown.length - 1)) * (W - L - 8));
  const y = (p: number) => 8 + (1 - p / 100) * (H - B - 8);
  let markup = '';
  for (const p of [0, 25, 50, 75, 100]) {
    markup += `<line class="grid" x1="${L}" x2="${W}" y1="${y(p)}" y2="${y(p)}"/><text class="axis" x="${L - 8}" y="${y(p) + 4}" text-anchor="end">${p}</text>`;
  }
  // date labels: first, middle, last
  for (const i of [...new Set([0, Math.floor((shown.length - 1) / 2), shown.length - 1])]) {
    markup += `<text class="axis" x="${x(i)}" y="${H - 4}" text-anchor="middle">${short(shown[i]!.date)}</text>`;
  }
  const done = shown.map((d, i) => [x(i), y(pctOf(d.blocks))] as const);
  const plan = shown.map((d, i) => [x(i), y(planPctOf(d.blocks))] as const);
  markup += `<path class="area" d="${smooth(done)} L ${done[done.length - 1]![0]} ${y(0)} L ${done[0]![0]} ${y(0)} Z"/>`;
  markup += `<path class="plan" d="${smooth(plan)}"/><path class="done" d="${smooth(done)}"/>`;
  markup += `<line class="cursor" y1="8" y2="${y(0)}" visibility="hidden"/><circle class="dot-plan" r="4" visibility="hidden"/><circle class="dot-done" r="4" visibility="hidden"/>`;
  markup += '<defs><linearGradient id="stats-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>';
  svg.innerHTML = markup;

  const tip = document.createElement('div');
  tip.className = 'stats-tip';
  tip.hidden = true;
  const wrap = document.createElement('div');
  wrap.className = 'stats-plot';
  wrap.append(svg, tip);
  sec.append(wrap);

  const cursor = svg.querySelector('.cursor')!;
  const dotD = svg.querySelector('.dot-done')!;
  const dotP = svg.querySelector('.dot-plan')!;
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    let i = 0;
    for (let k = 1; k < shown.length; k++) if (Math.abs(x(k) - vx) < Math.abs(x(i) - vx)) i = k;
    const d = shown[i]!;
    for (const el of [cursor, dotD, dotP]) el.setAttribute('visibility', 'visible');
    cursor.setAttribute('x1', String(x(i)));
    cursor.setAttribute('x2', String(x(i)));
    dotD.setAttribute('cx', String(done[i]![0]));
    dotD.setAttribute('cy', String(done[i]![1]));
    dotP.setAttribute('cx', String(plan[i]![0]));
    dotP.setAttribute('cy', String(plan[i]![1]));
    tip.innerHTML = '<span class="meta"></span><span><i style="--c: var(--accent)"></i>Done<b></b></span><span><i style="--c: var(--text-muted)"></i>Planned<b></b></span>';
    tip.querySelector('.meta')!.textContent = new Date(`${d.date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const [b1, b2] = tip.querySelectorAll('b');
    b1!.textContent = `${pctOf(d.blocks)}%`;
    b2!.textContent = `${planPctOf(d.blocks)}%`;
    tip.hidden = false;
    const px = (x(i) / W) * box.width;
    tip.style.left = `${px + (px > box.width * 0.6 ? -12 : 12)}px`;
    tip.classList.toggle('flip', px > box.width * 0.6);
  });
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    for (const el of [cursor, dotD, dotP]) el.setAttribute('visibility', 'hidden');
  });
  return sec;
}

/** A smooth curve through the points (Catmull-Rom as cubic Béziers), flattened so it never overshoots far. */
function smooth(pts: readonly (readonly [number, number])[]): string {
  if (pts.length === 1) return `M ${pts[0]![0] - 4} ${pts[0]![1]} L ${pts[0]![0] + 4} ${pts[0]![1]}`;
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const k = 0.16;
    d += ` C ${p1[0] + (p2[0] - p0[0]) * k} ${p1[1] + (p2[1] - p0[1]) * k}, ${p2[0] - (p3[0] - p1[0]) * k} ${p2[1] - (p3[1] - p1[1]) * k}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** Where the time went: planned vs done hours per category. */
function categories(days: DaySnapshot[]): HTMLElement {
  const cats = document.createElement('section');
  cats.className = 'stats-box';
  cats.innerHTML = '<div class="stats-label"><span>By category</span><span class="meta">done / planned</span></div>';
  const totals = new Map<Category, { plan: number; done: number }>();
  for (const d of days) for (const b of d.blocks) {
    const t = totals.get(b.cat) ?? { plan: 0, done: 0 };
    t.plan += b.dur;
    if (b.done) t.done += b.dur;
    totals.set(b.cat, t);
  }
  const most = Math.max(1, ...[...totals.values()].map((t) => t.plan));
  const rows = document.createElement('ul');
  rows.className = 'stats-cats';
  rows.append(...CATEGORY_KEYS.filter((k) => totals.has(k)).sort((a, b) => totals.get(b)!.plan - totals.get(a)!.plan).map((k, i) => {
    const t = totals.get(k)!;
    const li = document.createElement('li');
    li.style.setProperty('--c', `var(--cat-${k})`);
    li.style.setProperty('--i', String(i));
    li.innerHTML = '<span class="name"></span><span class="track"><i class="plan"></i><i class="done"></i></span><span class="val meta"></span>';
    li.querySelector('.name')!.textContent = CATEGORIES[k];
    (li.querySelector('.plan') as HTMLElement).style.width = `${(t.plan / most) * 100}%`;
    (li.querySelector('.done') as HTMLElement).style.width = `${(t.done / most) * 100}%`;
    li.querySelector('.val')!.textContent = `${formatDuration(t.done)} / ${formatDuration(t.plan)}`;
    return li;
  }));
  if (!totals.size) {
    const empty = document.createElement('p');
    empty.className = 'stats-empty';
    empty.textContent = 'Nothing planned yet';
    cats.append(empty);
  } else cats.append(rows);
  return cats;
}
