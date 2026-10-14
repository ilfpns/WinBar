import { allDays, dayKey, type DaySnapshot } from '../timetable/history';
import { CATEGORIES, CATEGORY_KEYS, type Category, progressOf } from '../timetable/model';
import { state } from '../timetable/state';
import { DAY, formatDuration } from '../timetable/time';
import { icon } from '../ui/icons';

/**
 * Overall stats from the day history (every day Today was saved): how full and how finished the days were,
 * where the time went by category, and streaks. A dialog opened from the calendar header.
 */
type Range = 'month' | 'all';

const pctOf = (blocks: DaySnapshot['blocks']) => Math.round((progressOf(blocks).done / DAY) * 100);

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
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const days = [...byDate.values()]
      .filter((d) => d.date <= dayKey() && (range === 'all' || d.date.startsWith(prefix)))
      .sort((a, b) => a.date.localeCompare(b.date));

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

    // ---- summary
    const pcts = days.map((d) => pctOf(d.blocks));
    const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    const doneMin = days.reduce((m, d) => m + progressOf(d.blocks).done, 0);
    const planMin = days.reduce((m, d) => m + progressOf(d.blocks).planned, 0);
    const best = days[pcts.indexOf(Math.max(...pcts))]!;
    // streak: consecutive recorded days (up to today) with at least half of what was planned done
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const { done, planned } = progressOf(days[i]!.blocks);
      if (planned && done / planned >= 0.5) streak++;
      else break;
    }
    const cards: [string, string, string][] = [
      ['Days', String(days.length), 'recorded'],
      ['Average', `${avg}%`, 'of each day done'],
      ['Done', formatDuration(doneMin), `of ${formatDuration(planMin)} planned`],
      ['Streak', `${streak}`, streak === 1 ? 'day ≥ half done' : 'days ≥ half done'],
    ];
    const summary = document.createElement('div');
    summary.className = 'stats-cards';
    summary.append(...cards.map(([label, value, sub], i) => {
      const c = document.createElement('div');
      c.className = 'stats-card';
      c.style.setProperty('--i', String(i));
      c.innerHTML = '<span class="meta"></span><strong></strong><span class="sub"></span>';
      c.querySelector('.meta')!.textContent = label;
      c.querySelector('strong')!.textContent = value;
      c.querySelector('.sub')!.textContent = sub;
      return c;
    }));

    // ---- done % per day (bars; the best day in the accent)
    const chart = document.createElement('section');
    chart.className = 'stats-section';
    chart.innerHTML = '<div class="stats-label"><span>Done per day</span><span class="meta"></span></div><div class="stats-bars"></div>';
    chart.querySelector('.meta')!.textContent = `best ${best.date.slice(5).replace('-', '/')} · ${Math.max(...pcts)}%`;
    const bars = chart.querySelector('.stats-bars')!;
    const shown = days.slice(-62);
    bars.append(...shown.map((d, i) => {
      const p = pctOf(d.blocks);
      const bar = document.createElement('div');
      bar.className = `stats-bar${d === best ? ' best' : ''}`;
      bar.style.setProperty('--h', `${Math.max(2, p)}%`);
      bar.style.setProperty('--i', String(i));
      bar.title = `${d.date} · ${p}% done`;
      return bar;
    }));

    // ---- where the time went: planned vs done hours per category
    const cats = document.createElement('section');
    cats.className = 'stats-section';
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
    cats.append(rows);

    dialog.replaceChildren(head, summary, chart, cats);
  }
}
