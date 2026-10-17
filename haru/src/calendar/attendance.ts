import { allDays, dayKey, onDaySaved, type DaySnapshot } from '../timetable/history';
import { progressOf } from '../timetable/model';
import { state } from '../timetable/state';
import { listStore } from '../storage/list-store';
import { icon } from '../ui/icons';

/**
 * Attendance, on the News (globe) page: a Check in button for today and the recent weeks as a grass grid
 * (weeks across, Mon–Sun down). A day counts once you checked in; its shade is how much of that day's plan
 * got done. Before check-ins existed, opening Haru counted as attending: those days (a saved snapshot
 * before CHECKIN_SINCE) still count, so no old grass disappears.
 */
const WEEKS = 53;
const LEVELS = ['Low', 'Medium', 'High', 'Best'] as const;
const CHECKIN_SINCE = '2026-10-16';

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** The days you checked in on (YYYY-MM-DD). Backups carry it as `checkins`. */
export const checkinStore = listStore<string>('checkins', isDate);

/** 1–4 from the share of the plan that was done; a day with nothing planned still counts as attended. */
function levelOf(blocks: DaySnapshot['blocks'] | undefined): number {
  if (!blocks) return 1;
  const { done, planned } = progressOf(blocks);
  const r = planned ? done / planned : 0;
  return r >= 0.85 ? 4 : r >= 0.5 ? 3 : r > 0 ? 2 : 1;
}

export interface Attendance {
  el: HTMLElement;
}

export function createAttendance(): Attendance {
  const root = document.createElement('section');
  root.className = 'attend glass-card';
  root.setAttribute('aria-label', 'Attendance');
  root.innerHTML = `
    <div class="att-head"><span class="att-title">Attendance</span><span class="meta att-sum"></span></div>
    <button type="button" class="att-check" aria-pressed="false"><span class="att-box"></span><span class="att-check-text"></span></button>
    <div class="att-day"><i class="att-sw"></i><span class="att-day-text"></span></div>
    <div class="att-cal"><div class="att-months" aria-hidden="true"></div><div class="att-grid" role="img"></div></div>
    <div class="att-legend">${LEVELS.map((l, i) => `<span><i class="att-sw" data-l="${i + 1}"></i>${l}</span>`).join('')}</div>`;
  const grid = root.querySelector<HTMLElement>('.att-grid')!;
  const sum = root.querySelector<HTMLElement>('.att-sum')!;
  const months = root.querySelector<HTMLElement>('.att-months')!;
  const cal = root.querySelector<HTMLElement>('.att-cal')!;
  const check = root.querySelector<HTMLButtonElement>('.att-check')!;
  const checkText = root.querySelector<HTMLElement>('.att-check-text')!;
  const daySw = root.querySelector<HTMLElement>('.att-day .att-sw')!;
  const dayText = root.querySelector<HTMLElement>('.att-day-text')!;
  root.querySelector('.att-box')!.append(icon('check'));

  // the cells never change, only their level: built once
  const cells: HTMLElement[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const c = document.createElement('i');
    c.className = 'att-cell';
    cells.push(c);
  }
  grid.replaceChildren(...cells);

  let byDate = new Map<string, DaySnapshot['blocks']>();
  let selected = dayKey();

  const checkedIn = (key: string) => checkinStore.all().includes(key);
  const attended = (key: string) => checkedIn(key) || (key < CHECKIN_SINCE && byDate.has(key));
  const blocksOn = (key: string) => (key === dayKey() ? state.blocks : byDate.get(key));

  function showDay(): void {
    const today = dayKey();
    const l = selected <= today && attended(selected) ? levelOf(blocksOn(selected)) : 0;
    daySw.dataset.l = String(l);
    const when = selected === today ? 'Today' : new Date(`${selected}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (selected > today) dayText.textContent = `${when} · ahead`;
    else if (!l) dayText.textContent = selected === today ? 'Today · not checked in yet' : `${when} · missed`;
    else {
      const { done, planned } = progressOf(blocksOn(selected) ?? []);
      dayText.textContent = `${when} · ${LEVELS[l - 1]} · ${planned ? Math.round((done / planned) * 100) : 0}% of plan`;
    }
    for (const c of cells) c.classList.toggle('sel', c.dataset.date === selected);
  }

  function paint(): void {
    const today = dayKey();
    const done = checkedIn(today);
    check.setAttribute('aria-pressed', String(done));
    checkText.textContent = done ? 'Checked in today' : 'Check in';
    check.title = done ? 'Click to undo today’s check-in' : 'Mark today as attended';

    // the grid ends with this week's Sunday; its first column starts on a Monday
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
    const d = new Date(end);
    d.setDate(end.getDate() - (WEEKS * 7 - 1));

    // month names over the weeks they start in
    const labels: HTMLElement[] = [];
    for (let w = 0; w < WEEKS; w++) {
      const mon = new Date(d);
      mon.setDate(d.getDate() + w * 7);
      if (mon.getDate() <= 7) {
        const l = document.createElement('span');
        l.style.gridColumn = String(w + 1);
        l.textContent = mon.toLocaleDateString('en-US', { month: 'short' });
        labels.push(l);
      }
    }
    months.replaceChildren(...labels);

    let count = 0;
    for (const c of cells) {
      const key = dayKey(d);
      const future = key > today;
      const on = !future && attended(key);
      const l = on ? levelOf(blocksOn(key)) : 0;
      c.dataset.l = String(l);
      c.dataset.date = key;
      c.classList.toggle('future', future);
      c.classList.toggle('today', key === today);
      c.title = future ? '' : on ? `${key} · ${LEVELS[l - 1]}` : `${key} · missed`;
      if (on) count++;
      d.setDate(d.getDate() + 1);
    }
    // streak: consecutive attended days up to today (or up to yesterday, until today's check-in)
    let streak = 0;
    const back = new Date();
    if (!done) back.setDate(back.getDate() - 1);
    while (attended(dayKey(back))) {
      streak++;
      back.setDate(back.getDate() - 1);
    }
    sum.textContent = `${streak}-day streak`;
    grid.setAttribute('aria-label', `Attendance: ${count} days in the last ${WEEKS} weeks, current streak ${streak} days`);
    showDay();
    // narrow screens scroll the year sideways: start at this week
    cal.scrollLeft = cal.scrollWidth;
  }

  async function load(): Promise<void> {
    const saved = await allDays().catch(() => [] as DaySnapshot[]);
    byDate = new Map(saved.map((d) => [d.date, d.blocks]));
    paint();
  }

  check.addEventListener('click', () => {
    const today = dayKey();
    const list = checkinStore.all();
    if (list.includes(today)) checkinStore.set(list.filter((k) => k !== today));
    else {
      checkinStore.set([...list, today]);
      check.classList.remove('pop');
      void check.offsetWidth;
      check.classList.add('pop');
    }
    selected = today;
  });
  grid.addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('.att-cell[data-date]');
    if (!c || c.classList.contains('future')) return;
    selected = c.dataset.date!;
    showDay();
  });

  let pending = 0;
  // today's snapshot is rewritten after every timetable change
  onDaySaved(() => {
    clearTimeout(pending);
    pending = window.setTimeout(() => void load(), 500);
  });
  checkinStore.onChange(paint);
  // whenever the bar changes width (window, drawers) the year scrolls back to this week
  new ResizeObserver(() => (cal.scrollLeft = cal.scrollWidth)).observe(cal);
  void load();
  return { el: root };
}

/** Puts the attendance card on the News page. */
export function mountAttendance(host: HTMLElement): void {
  host.append(createAttendance().el);
}
