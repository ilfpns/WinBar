import { allDays, dayKey, onDaySaved, type DaySnapshot } from '../timetable/history';
import { progressOf } from '../timetable/model';
import { state } from '../timetable/state';

/**
 * Attendance: a year of days as a grass grid (weeks across, Mon–Sun down). A day counts once Haru was
 * opened on it (Today saves a snapshot on start); its shade is how much of that day's plan got done.
 */
const WEEKS = 53;
const LEVELS = ['Low', 'Medium', 'High', 'Best'] as const;

/** 1–4 from the share of the plan that was done; a day with nothing planned still counts as attended. */
function levelOf(blocks: DaySnapshot['blocks']): number {
  const { done, planned } = progressOf(blocks);
  const r = planned ? done / planned : 0;
  return r >= 0.85 ? 4 : r >= 0.5 ? 3 : r > 0 ? 2 : 1;
}

export function mountAttendance(root: HTMLElement): void {
  root.innerHTML = `
    <div class="att-head">
      <span class="att-title">Attendance</span>
      <span class="meta att-sum"></span>
      <span class="att-legend">${LEVELS.map((l, i) => `<span><i class="att-sw" data-l="${i + 1}"></i>${l}</span>`).join('')}</span>
    </div>
    <div class="att-grid" role="img"></div>`;
  const grid = root.querySelector<HTMLElement>('.att-grid')!;
  const sum = root.querySelector<HTMLElement>('.att-sum')!;

  // the cells never change, only their level: built once
  const cells: HTMLElement[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const c = document.createElement('i');
    c.className = 'att-cell';
    cells.push(c);
  }
  grid.replaceChildren(...cells);

  let pending = 0;
  async function render(): Promise<void> {
    const saved = await allDays().catch(() => [] as DaySnapshot[]);
    const byDate = new Map(saved.map((d) => [d.date, d.blocks]));
    const today = dayKey();
    byDate.set(today, state.blocks);

    // the grid ends with this week's Sunday; its first column starts on a Monday
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
    const start = new Date(end);
    start.setDate(end.getDate() - (WEEKS * 7 - 1));

    let attended = 0;
    const d = new Date(start);
    for (const c of cells) {
      const key = dayKey(d);
      const blocks = byDate.get(key);
      const future = key > today;
      c.dataset.l = blocks && !future ? String(levelOf(blocks)) : '0';
      c.classList.toggle('future', future);
      c.classList.toggle('today', key === today);
      c.title = future ? '' : blocks ? `${key} · ${LEVELS[levelOf(blocks) - 1]}` : `${key} · missed`;
      if (blocks && !future) attended++;
      d.setDate(d.getDate() + 1);
    }

    // streak: consecutive attended days ending today
    let streak = 0;
    const back = new Date();
    while (byDate.has(dayKey(back))) {
      streak++;
      back.setDate(back.getDate() - 1);
    }
    sum.textContent = `${streak}-day streak · ${attended} ${attended === 1 ? 'day' : 'days'}`;
    grid.setAttribute('aria-label', `Attendance: ${attended} days in the last year, current streak ${streak} days`);
  }
  const later = () => {
    clearTimeout(pending);
    pending = window.setTimeout(() => void render(), 500);
  };
  // today's snapshot is rewritten after every timetable change
  onDaySaved(later);
  void render();
}
