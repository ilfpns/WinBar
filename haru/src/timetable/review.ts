import { CATEGORIES, CATEGORY_KEYS, type Category } from './model';
import { dayOf } from './history';
import { formatDuration } from './time';
import { streaks, totalsOf } from './streaks';
import { loadDay, weekDates, weekStart } from '../calendar/week';
import { icon } from '../ui/icons';
import { currentView, onView } from '../ui/router';

/**
 * The week in review: a card with a week's planned and done hours, the share done, its best day, what was left
 * undone, each category against the week before, and the streaks going. It comes up by itself once, the first
 * time Haru is opened in a new week (for the week that ended), and opens any time from the Dot board.
 */
const SEEN_KEY = 'haru:review-seen';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (date: string, n: number) => {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const startOf = (date: string) => iso(weekStart(new Date(`${date}T00:00`)));
const short = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

interface Week {
  start: string;
  days: number;
  planned: number;
  done: number;
  best: { date: string; done: number } | null;
  undone: number;
  cats: Record<Category, { planned: number; done: number }>;
}

/** A week (Sunday first) up to today: the days kept and Today as it stands; days ahead don't count yet. */
async function weekOf(start: string): Promise<Week> {
  const today = dayOf();
  const dates = weekDates(new Date(`${start}T00:00`)).filter((d) => d <= today);
  const loaded = await Promise.all(dates.map(loadDay));
  const cats = Object.fromEntries(CATEGORY_KEYS.map((c) => [c, { planned: 0, done: 0 }])) as Week['cats'];
  let planned = 0;
  let done = 0;
  let undone = 0;
  let best: Week['best'] = null;
  let days = 0;
  for (const day of loaded) {
    if (!day.blocks.length || day.kind === 'carried') continue;
    days++;
    const t = totalsOf(day.date, day.blocks);
    let dayDone = 0;
    for (const c of CATEGORY_KEYS) {
      cats[c].planned += t.planned[c];
      cats[c].done += t.done[c];
      planned += t.planned[c];
      dayDone += t.done[c];
    }
    done += dayDone;
    if (day.date < today) undone += day.blocks.filter((b) => !b.done).length;
    if (!best || dayDone > best.done) best = { date: day.date, done: dayDone };
  }
  return { start, days, planned, done, best, undone, cats };
}

let dlg: HTMLDialogElement | null = null;

/** Opens the review of the week holding `date` (default: this week). */
export async function openReview(date = dayOf()): Promise<void> {
  const start = startOf(date);
  const [week, prev] = await Promise.all([weekOf(start), weekOf(shift(start, -7))]);
  dlg?.remove();
  dlg = document.createElement('dialog');
  dlg.className = 'modal review';
  dlg.setAttribute('aria-label', 'Week in review');
  const end = shift(start, 6);
  const thisWeek = start === startOf(dayOf());
  dlg.innerHTML = `
    <div class="modal-card review-card">
      <div class="modal-head">
        <span class="modal-icon"></span>
        <div class="review-title"><h2 class="modal-title"></h2><span class="meta"></span></div>
        <span class="review-nav">
          <button type="button" class="icon-btn" data-go="-7" aria-label="Week before"></button>
          <button type="button" class="icon-btn" data-go="7" aria-label="Week after"></button>
        </span>
      </div>
      <div class="review-tiles"></div>
      <ul class="review-cats"></ul>
      <div class="review-runs"></div>
      <div class="modal-actions"><button type="button" class="btn-sm review-close">Close</button></div>
    </div>`;
  const $ = <E extends Element>(sel: string) => dlg!.querySelector<E>(sel)!;
  $('.modal-icon').append(icon('chart-column'));
  $('.modal-title').textContent = thisWeek ? 'This week so far' : `Week of ${short(start)}`;
  $('.review-title .meta').textContent = `${short(start)} – ${short(end)}${week.days ? ` · ${week.days} ${week.days === 1 ? 'day' : 'days'} kept` : ''}`;
  const [back, fwd] = [...dlg.querySelectorAll<HTMLButtonElement>('[data-go]')];
  back!.append(icon('chevron-left'));
  fwd!.append(icon('chevron-right'));
  fwd!.disabled = thisWeek;
  for (const b of [back!, fwd!]) b.addEventListener('click', () => void openReview(shift(start, Number(b.dataset.go))));

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
  if (!week.days) {
    tiles.replaceChildren(Object.assign(document.createElement('p'), { className: 'review-empty', textContent: 'Nothing kept this week' }));
  } else {
    const delta = week.done - prev.done;
    tiles.replaceChildren(
      tile('Done', formatDuration(week.done), prev.days ? `${delta >= 0 ? '+' : '−'}${formatDuration(Math.abs(delta))} vs week before` : ''),
      tile('Planned', formatDuration(week.planned), week.planned ? `${Math.round((week.done / week.planned) * 100)}% done` : ''),
      tile('Best day', week.best ? new Date(`${week.best.date}T00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : '–', week.best ? `${formatDuration(week.best.done)} done` : ''),
      tile('Left undone', String(week.undone), week.undone === 1 ? 'task' : 'tasks'),
    );
  }
  // each category: planned (faint) and done (solid) on one scale, and how it moved since the week before
  const max = Math.max(1, ...CATEGORY_KEYS.map((c) => week.cats[c].planned));
  $('.review-cats').replaceChildren(...CATEGORY_KEYS.filter((c) => week.cats[c].planned || prev.cats[c].done).map((c) => {
    const li = document.createElement('li');
    li.style.setProperty('--c', `var(--cat-${c})`);
    const { planned, done } = week.cats[c];
    const move = done - prev.cats[c].done;
    li.innerHTML = '<span class="dot"></span><span class="n"></span><span class="review-bar"><span class="plan"></span><span class="done"></span></span><span class="v"></span><span class="d"></span>';
    li.querySelector('.n')!.textContent = CATEGORIES[c];
    (li.querySelector('.plan') as HTMLElement).style.width = `${(planned / max) * 100}%`;
    (li.querySelector('.done') as HTMLElement).style.width = `${(done / max) * 100}%`;
    li.querySelector('.v')!.textContent = `${formatDuration(done)} / ${formatDuration(planned)}`;
    const d = li.querySelector<HTMLElement>('.d')!;
    d.textContent = prev.days && move ? `${move > 0 ? '+' : '−'}${formatDuration(Math.abs(move))}` : '';
    d.classList.toggle('up', move > 0);
    return li;
  }));
  const runs = streaks().filter((s) => s.days >= 2).slice(0, 4);
  const runBox = $<HTMLElement>('.review-runs');
  runBox.hidden = !runs.length || !thisWeek && start !== startOf(shift(dayOf(), -7));
  runBox.replaceChildren(...runs.map((s) => {
    const chip = document.createElement('span');
    chip.className = 'greet-streak';
    chip.style.setProperty('--c', `var(--cat-${s.cat})`);
    chip.append(icon('flame'), `${CATEGORIES[s.cat]} · ${s.days} days in a row`);
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
    if ((await weekOf(last)).days) void openReview(last);
  };
  setTimeout(() => void check(), 2500);
  onView((v) => v === 'today' && void check());
}
