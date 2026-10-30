import { CATEGORIES, CATEGORY_KEYS, type Block, type Category } from './model';
import { allDays, dayOf } from './history';
import { state } from './state';
import { formatDuration } from './time';
import { streaks, totalsOf } from './streaks';
import { loadDay, weekStart } from '../calendar/week';
import { icon } from '../ui/icons';
import { currentView, onView } from '../ui/router';

/**
 * The review: a card with a stretch of days — a week, a month, or all of Haru so far — its done and planned hours,
 * its best day, each category (planned faint, done solid) against the stretch before, and the streaks. The week
 * that ended comes up by itself once, the first time Haru is opened in a new week; any stretch opens from the Dot
 * board (the one picked last).
 */
export type Range = 'week' | 'month' | 'all';
const SEEN_KEY = 'haru:review-seen';
const RANGE_KEY = 'haru:review-range';
const RANGES: [Range, string][] = [['week', 'Week'], ['month', 'Month'], ['all', 'All time']];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (date: string, n: number) => {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const startOf = (date: string) => iso(weekStart(new Date(`${date}T00:00`)));
const monthOf = (date: string) => `${date.slice(0, 7)}-01`;
const shiftMonth = (first: string, n: number) => {
  const d = new Date(`${first}T00:00`);
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1));
};
const short = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthName = (first: string, year = false) => new Date(`${first}T00:00`).toLocaleDateString('en-US', { month: 'long', ...(year ? { year: 'numeric' } : {}) });

/** Hours and minutes, or whole hours from 100h on (where the minutes no longer tell anything). */
const amount = (min: number) => (min >= 6000 ? `${Math.round(min / 60)}h` : formatDuration(min));
const savedRange = (): Range => {
  try {
    const r = localStorage.getItem(RANGE_KEY);
    return r === 'month' || r === 'all' ? r : 'week';
  } catch {
    return 'week';
  }
};

interface Stretch {
  /** First and last day it covers (the last never past today). */
  from: string;
  to: string;
  days: number;
  planned: number;
  done: number;
  best: { date: string; done: number } | null;
  undone: number;
  cats: Record<Category, { planned: number; done: number }>;
}

function tally(from: string, to: string, days: { date: string; blocks: readonly Block[] }[]): Stretch {
  const today = dayOf();
  const cats = Object.fromEntries(CATEGORY_KEYS.map((c) => [c, { planned: 0, done: 0 }])) as Stretch['cats'];
  const s: Stretch = { from, to, days: 0, planned: 0, done: 0, best: null, undone: 0, cats };
  for (const day of days) {
    if (!day.blocks.length) continue;
    s.days++;
    const t = totalsOf(day.date, day.blocks);
    let dayDone = 0;
    for (const c of CATEGORY_KEYS) {
      cats[c].planned += t.planned[c];
      cats[c].done += t.done[c];
      s.planned += t.planned[c];
      dayDone += t.done[c];
    }
    s.done += dayDone;
    if (day.date < today) s.undone += day.blocks.filter((b) => !b.done).length;
    if (!s.best || dayDone > s.best.done) s.best = { date: day.date, done: dayDone };
  }
  return s;
}

/** The days from `from` to `to` (up to today): kept days and Today as it stands; carried-over days don't count. */
async function stretchOf(from: string, to: string): Promise<Stretch> {
  const today = dayOf();
  const end = to < today ? to : today;
  const dates: string[] = [];
  for (let d = from; d <= end; d = shift(d, 1)) dates.push(d);
  const loaded = (await Promise.all(dates.map(loadDay))).filter((d) => d.kind !== 'carried');
  return tally(from, end, loaded);
}

/** Every day kept so far, and Today. */
async function allTime(): Promise<Stretch> {
  const today = dayOf();
  const days = (await allDays()).filter((s) => s.date < today && s.blocks?.length).map((s) => ({ date: s.date, blocks: s.blocks }));
  if (state.blocks.length) days.push({ date: today, blocks: state.blocks });
  days.sort((a, b) => a.date.localeCompare(b.date));
  return tally(days[0]?.date ?? today, today, days);
}

let dlg: HTMLDialogElement | null = null;

/** Opens the review of the stretch holding `date` (default: now), as a week, a month or all time. */
export async function openReview(date = dayOf(), range: Range = savedRange()): Promise<void> {
  try {
    localStorage.setItem(RANGE_KEY, range);
  } catch {
    // for this visit
  }
  const today = dayOf();
  let cur: Stretch;
  let prev: Stretch | null = null;
  let title: string;
  let step = (_n: number) => date;
  let latest = true;
  if (range === 'week') {
    const start = startOf(date);
    [cur, prev] = await Promise.all([stretchOf(start, shift(start, 6)), stretchOf(shift(start, -7), shift(start, -1))]);
    latest = start === startOf(today);
    title = latest ? 'This week so far' : `Week of ${short(start)}`;
    step = (n) => shift(start, 7 * n);
  } else if (range === 'month') {
    const first = monthOf(date);
    const next = shiftMonth(first, 1);
    [cur, prev] = await Promise.all([stretchOf(first, shift(next, -1)), stretchOf(shiftMonth(first, -1), shift(first, -1))]);
    latest = first === monthOf(today);
    title = latest ? `${monthName(first)} so far` : monthName(first, first.slice(0, 4) !== today.slice(0, 4));
    step = (n) => shiftMonth(first, n);
  } else {
    cur = await allTime();
    title = 'All time';
  }
  dlg?.remove();
  dlg = document.createElement('dialog');
  dlg.className = 'modal review';
  dlg.setAttribute('aria-label', 'Review');
  dlg.innerHTML = `
    <div class="modal-card review-card">
      <div class="modal-head">
        <span class="modal-icon"></span>
        <div class="review-title"><h2 class="modal-title"></h2><span class="meta"></span></div>
        <span class="review-nav">
          <button type="button" class="icon-btn" data-go="-1"></button>
          <button type="button" class="icon-btn" data-go="1"></button>
        </span>
      </div>
      <div class="seg review-range" role="group" aria-label="Range"></div>
      <div class="review-tiles"></div>
      <ul class="review-cats"></ul>
      <div class="review-runs"></div>
      <div class="modal-actions"><button type="button" class="btn-sm review-close">Close</button></div>
    </div>`;
  const $ = <E extends Element>(sel: string) => dlg!.querySelector<E>(sel)!;
  $('.modal-icon').append(icon('chart-column'));
  $('.modal-title').textContent = title;
  const kept = cur.days ? ` · ${cur.days} ${cur.days === 1 ? 'day' : 'days'} kept` : '';
  $('.review-title .meta').textContent = range === 'all'
    ? (cur.days ? `Since ${new Date(`${cur.from}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${kept}` : '')
    : `${short(cur.from)} – ${short(range === 'week' ? shift(cur.from, 6) : shift(shiftMonth(cur.from, 1), -1))}${kept}`;
  // Week / Month / All time
  for (const [r, label] of RANGES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(r === range));
    b.addEventListener('click', () => r !== range && void openReview(r === 'all' ? today : date, r));
    $('.review-range').append(b);
  }
  const unit = range === 'month' ? 'month' : 'week';
  const [back, fwd] = [...dlg.querySelectorAll<HTMLButtonElement>('[data-go]')];
  back!.append(icon('chevron-left'));
  fwd!.append(icon('chevron-right'));
  back!.setAttribute('aria-label', `${unit === 'month' ? 'Month' : 'Week'} before`);
  fwd!.setAttribute('aria-label', `${unit === 'month' ? 'Month' : 'Week'} after`);
  fwd!.disabled = latest;
  $<HTMLElement>('.review-nav').hidden = range === 'all';
  for (const b of [back!, fwd!]) b.addEventListener('click', () => void openReview(step(Number(b.dataset.go)), range));

  const before = range === 'week' ? 'vs week before' : 'vs month before';
  const tiles = $<HTMLElement>('.review-tiles');
  const tile = (label: string, value: string, sub = '') => {
    const t = document.createElement('div');
    t.className = 'review-tile';
    t.innerHTML = '<span class="meta"></span><strong></strong><span class="review-sub"></span>';
    t.querySelector('.meta')!.textContent = label;
    t.querySelector('strong')!.textContent = value;
    t.querySelector('.review-sub')!.textContent = sub;
    return t;
  };
  if (!cur.days) {
    tiles.replaceChildren(Object.assign(document.createElement('p'), { className: 'review-empty', textContent: range === 'all' ? 'Nothing kept yet' : `Nothing kept this ${unit}` }));
  } else {
    const delta = prev ? cur.done - prev.done : 0;
    const bestName = cur.best ? (range === 'week' ? new Date(`${cur.best.date}T00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : short(cur.best.date)) : '–';
    tiles.replaceChildren(
      tile('Done', amount(cur.done), prev?.days ? `${delta >= 0 ? '+' : '−'}${amount(Math.abs(delta))} ${before}` : ''),
      tile('Planned', amount(cur.planned), cur.planned ? `${Math.round((cur.done / cur.planned) * 100)}% done` : ''),
      tile('Best day', bestName, cur.best ? `${formatDuration(cur.best.done)} done` : ''),
      range === 'all'
        ? tile('A day', formatDuration(Math.round(cur.done / cur.days)), 'done on average')
        : tile('Left undone', String(cur.undone), cur.undone === 1 ? 'task' : 'tasks'),
    );
  }
  // each category: planned (faint) and done (solid) on one scale, and how it moved since the stretch before
  const max = Math.max(1, ...CATEGORY_KEYS.map((c) => cur.cats[c].planned));
  const shown = CATEGORY_KEYS.filter((c) => cur.cats[c].planned || prev?.cats[c].done).sort((a, b) => cur.cats[b].planned - cur.cats[a].planned);
  $('.review-cats').replaceChildren(...shown.map((c) => {
    const li = document.createElement('li');
    li.style.setProperty('--c', `var(--cat-${c})`);
    const { planned, done } = cur.cats[c];
    const move = prev ? done - prev.cats[c].done : 0;
    li.innerHTML = '<span class="dot"></span><span class="n"></span><span class="review-bar"><span class="plan"></span><span class="done"></span></span><span class="v"><b></b><span></span></span><span class="d"></span>';
    li.querySelector('.n')!.textContent = CATEGORIES[c];
    (li.querySelector('.plan') as HTMLElement).style.width = `${(planned / max) * 100}%`;
    (li.querySelector('.done') as HTMLElement).style.width = `${(done / max) * 100}%`;
    li.querySelector('.v b')!.textContent = amount(done);
    li.querySelector('.v span')!.textContent = ` / ${amount(planned)}`;
    li.title = `${CATEGORIES[c]} · ${formatDuration(done)} done of ${formatDuration(planned)} planned${planned ? ` (${Math.round((done / planned) * 100)}%)` : ''}`;
    const d = li.querySelector<HTMLElement>('.d')!;
    d.textContent = prev?.days && move ? `${move > 0 ? '+' : '−'}${formatDuration(Math.abs(move))}` : '';
    d.classList.toggle('up', move > 0);
    return li;
  }));
  dlg.querySelector('.review-cats')!.classList.toggle('no-delta', !prev);
  // the streaks: going now (this week or month), or the longest ones (all time)
  const runBox = $<HTMLElement>('.review-runs');
  const runs = range === 'all'
    ? [...streaks()].filter((s) => s.best >= 2).sort((a, b) => b.best - a.best).slice(0, 4)
    : streaks().filter((s) => s.days >= 2).slice(0, 4);
  runBox.hidden = !runs.length || (range !== 'all' && !latest && !(range === 'week' && cur.from === startOf(shift(today, -7))));
  runBox.replaceChildren(...runs.map((s) => {
    const chip = document.createElement('span');
    chip.className = 'greet-streak';
    chip.style.setProperty('--c', `var(--cat-${s.cat})`);
    chip.append(icon('flame'), range === 'all' ? `${CATEGORIES[s.cat]} · best ${s.best} days in a row` : `${CATEGORIES[s.cat]} · ${s.days} days in a row`);
    return chip;
  }));

  const close = () => {
    const d = dlg;
    if (!d) return;
    d.classList.add('closing');
    setTimeout(() => {
      d.close();
      d.remove();
      if (dlg === d) dlg = null;
    }, 150);
  };
  $('.review-close').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  document.body.append(dlg);
  dlg.showModal();
  $<HTMLButtonElement>('.review-close').focus();
}

/** The first time Haru is opened in a new week, on Today: the week that ended, once. */
export function mountReview(): void {
  const check = async () => {
    if (currentView() !== 'today' || document.querySelector('dialog[open]')) return;
    const start = startOf(dayOf());
    let seen = '';
    try {
      seen = localStorage.getItem(SEEN_KEY) ?? '';
      // the very first visit only marks the week: there is nothing to look back on yet
      if (!seen) return void localStorage.setItem(SEEN_KEY, start);
    } catch {
      return;
    }
    if (seen >= start) return;
    localStorage.setItem(SEEN_KEY, start);
    const last = shift(start, -7);
    if ((await stretchOf(last, shift(last, 6))).days) void openReview(last, 'week');
  };
  setTimeout(() => void check(), 2500);
  onView((v) => v === 'today' && void check());
}
