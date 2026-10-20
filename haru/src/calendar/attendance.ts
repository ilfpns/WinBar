import { allDays, dayKey } from '../timetable/history';
import { listStore } from '../storage/list-store';
import { icon } from '../ui/icons';
import { type NotionView, checkinMarks, markCheckin, notionName, notionView, onNotionAttendance } from './notion-attendance';
import { lessMotion } from '../ui/motion';
import { currentView, onView } from '../ui/router';

/**
 * Attendance, on the News (globe) page: a Check in button for today and the recent weeks as a grass grid
 * (weeks across, Mon–Sun down). A day you checked in is filled; nothing else counts. Above it, the streak
 * now and the longest one. Before check-ins existed, opening Haru counted as attending: those days (a saved
 * snapshot before CHECKIN_SINCE) still count, so no old grass disappears.
 */
const WEEKS = 53;
const CHECKIN_SINCE = '2026-10-16';

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** The days you checked in on (YYYY-MM-DD). Backups carry it as `checkins`. */
export const checkinStore = listStore<string>('checkins', isDate);

/** The day after `key` (YYYY-MM-DD). */
function nextDay(key: string): string {
  const d = new Date(`${key}T00:00`);
  d.setDate(d.getDate() + 1);
  return dayKey(d);
}

/** The longest run of consecutive days in `days`. */
function longestRun(days: Set<string>): number {
  let best = 0;
  for (const key of days) {
    // only count from the first day of a run
    const prev = new Date(`${key}T00:00`);
    prev.setDate(prev.getDate() - 1);
    if (days.has(dayKey(prev))) continue;
    let n = 1;
    for (let k = nextDay(key); days.has(k); k = nextDay(k)) n++;
    best = Math.max(best, n);
  }
  return best;
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
    <p class="att-best"></p>
    <div class="att-cal"><div class="att-months" aria-hidden="true"></div><div class="att-grid" role="img"></div></div>`;
  const grid = root.querySelector<HTMLElement>('.att-grid')!;
  const sum = root.querySelector<HTMLElement>('.att-sum')!;
  const months = root.querySelector<HTMLElement>('.att-months')!;
  const cal = root.querySelector<HTMLElement>('.att-cal')!;
  const check = root.querySelector<HTMLButtonElement>('.att-check')!;
  const checkText = root.querySelector<HTMLElement>('.att-check-text')!;
  const bestEl = root.querySelector<HTMLElement>('.att-best')!;
  root.querySelector('.att-box')!.append(icon('check'));

  // the cells never change, only whether they are filled: built once
  const cells: HTMLElement[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const c = document.createElement('i');
    c.className = 'att-cell';
    cells.push(c);
  }
  grid.replaceChildren(...cells);

  /** Days with a saved timetable from before check-ins existed. */
  let opened = new Set<string>();
  // the frame a repaint is waiting for (see paintSoon)
  let painting = 0;

  /** What Notion says for your column (see notion-attendance). */
  let notion: NotionView | null = null;
  const refreshNotion = async () => {
    notion = notionName() ? await notionView(notionName()) : null;
    paintSoon();
  };
  onNotionAttendance(() => void refreshNotion());
  void refreshNotion();

  /**
   * Every attended day: Haru's check-ins and Notion's, plus the days Haru was opened before check-ins existed.
   * A check-in or undo made here counts over Notion for that date until the Notion row is edited after it.
   */
  function attendedDays(): Set<string> {
    const days = new Set([...checkinStore.all(), ...[...opened].filter((k) => k < CHECKIN_SINCE), ...(notion?.days ?? [])]);
    for (const [date, m] of Object.entries(checkinMarks())) {
      if (notion && m.at <= notion.editedAt(date)) continue;
      if (m.on) days.add(date);
      else days.delete(date);
    }
    return days;
  }

  /** Repaints at the next frame: the several reasons arriving together at startup make one paint, not three. */
  function paintSoon(): void {
    if (!painting) painting = requestAnimationFrame(() => {
      painting = 0;
      paint();
    });
  }
  function paint(): void {
    const today = dayKey();
    const days = attendedDays();
    const done = days.has(today);
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
      const on = !future && days.has(key);
      // attended is simply filled (the brightest shade)
      c.dataset.l = on ? '4' : '0';
      c.dataset.date = key;
      c.classList.toggle('future', future);
      c.classList.toggle('today', key === today);
      c.title = future ? '' : on ? `${key} · attended` : `${key} · missed`;
      if (on) count++;
      d.setDate(d.getDate() + 1);
    }
    // streak: consecutive attended days up to today (or up to yesterday, until today's check-in)
    let streak = 0;
    const back = new Date();
    if (!done) back.setDate(back.getDate() - 1);
    while (days.has(dayKey(back))) {
      streak++;
      back.setDate(back.getDate() - 1);
    }
    const best = Math.max(streak, longestRun(days));
    sum.textContent = `${streak}-day streak`;
    bestEl.replaceChildren(icon('flame'), `Best streak · ${best} ${best === 1 ? 'day' : 'days'}`);
    grid.setAttribute('aria-label', `Attendance: ${count} days in the last ${WEEKS} weeks, current streak ${streak} days, best ${best} days`);
    // narrow screens scroll the year sideways: start at this week
    toThisWeek();
  }
  /** Scrolls the year to this week, only while the bar can be seen (anywhere else it would lay out a hidden page). */
  function toThisWeek(): void {
    if (currentView() !== 'news') return;
    cal.scrollLeft = cal.scrollWidth;
  }
  onView((v) => {
    // after the page turn (a scroll position needs a layout, which would stall the slide's first frame)
    if (v === 'news') setTimeout(toThisWeek, 340);
  });

  async function load(): Promise<void> {
    const saved = await allDays().catch(() => []);
    opened = new Set(saved.map((s) => s.date));
    paintSoon();
  }

  // check in, or undo today's — wherever it was ticked (here or in Notion), it goes both ways
  check.addEventListener('click', () => {
    const today = dayKey();
    const on = !attendedDays().has(today);
    const list = checkinStore.all().filter((k) => k !== today);
    markCheckin(today, on);
    checkinStore.set(on ? [...list, today] : list);
    if (on) {
      check.classList.remove('pop');
      void check.offsetWidth;
      check.classList.add('pop');
    }
  });

  checkinStore.onChange(paintSoon);
  // past midnight: a new day to check in on
  let shown = dayKey();
  setInterval(() => {
    if (dayKey() === shown) return;
    shown = dayKey();
    paintSoon();
  }, 60_000);
  // whenever the bar changes width (window, drawers) the year scrolls back to this week
  new ResizeObserver(toThisWeek).observe(cal);
  // narrowed past 700px (drawers open on both sides) the bar stacks: its height glides to the new one and the
  // contents fade back in, instead of the whole bar jumping to its other shape
  const STACK = 700;
  const isStacked = () => {
    const cs = getComputedStyle(root);
    return root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) <= STACK;
  };
  let stacked = isStacked();
  let lastH = root.offsetHeight;
  new ResizeObserver(() => {
    const now = isStacked();
    const h = root.offsetHeight;
    if (now !== stacked && lastH && !lessMotion()) {
      const ease = 'cubic-bezier(.22, 1, .36, 1)';
      root.classList.add('reflowing');
      root.animate([{ height: `${lastH}px` }, { height: `${h}px` }], { duration: 420, easing: ease })
        .finished.finally(() => root.classList.remove('reflowing'));
      for (const el of root.children) (el as HTMLElement).animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 80, easing: ease, fill: 'backwards' });
    }
    stacked = now;
    lastH = h;
  }).observe(root);
  void load();
  return { el: root };
}

/** Puts the attendance card on the News page. */
export function mountAttendance(host: HTMLElement): void {
  host.append(createAttendance().el);
}
