import { currentView, onView } from '../ui/router';

/** One entry from public/data/calendar.json (built by scripts/fetch-calendar.mjs). */
interface CalEvent {
  date: string; // YYYY-MM-DD
  title: string;
  kind: Kind;
  /** School day off (휴업일). */
  off?: boolean;
}
type Kind = 'holiday' | 'observance' | 'school';

const KINDS: Record<Kind, string> = { holiday: 'Holidays', observance: 'Observances', school: 'School' };
const KIND_LABEL: Record<Kind, string> = { holiday: 'Holiday', observance: 'Observance', school: 'School' };
const MAX_IN_CELL = 3;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

export interface CalendarRefs {
  month: HTMLElement;
  year: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  today: HTMLButtonElement;
  filters: HTMLElement;
  week: HTMLElement;
  grid: HTMLElement;
  day: HTMLElement;
}

export function mountCalendar(refs: CalendarRefs): void {
  let events: CalEvent[] = [];
  const byDate = new Map<string, CalEvent[]>();
  let month = firstOfMonth(new Date());
  let selected = iso(new Date());
  const shown = new Set<Kind>(['holiday', 'observance', 'school']);

  // weekday header: Sunday first, as Korean calendars are read
  refs.week.replaceChildren(...['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
    const el = document.createElement('div');
    el.textContent = d;
    if (i === 0) el.className = 'sun';
    if (i === 6) el.className = 'sat';
    return el;
  }));

  refs.filters.replaceChildren(...(Object.keys(KINDS) as Kind[]).map((kind) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.kind = kind;
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<span class="dot"></span>${KINDS[kind]}`;
    b.addEventListener('click', () => {
      if (shown.has(kind)) shown.delete(kind);
      else shown.add(kind);
      b.setAttribute('aria-pressed', String(shown.has(kind)));
      render(0);
    });
    return b;
  }));

  const eventsOn = (date: string) => (byDate.get(date) ?? []).filter((e) => shown.has(e.kind));

  function go(delta: number): void {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    render(delta);
  }
  refs.prev.addEventListener('click', () => go(-1));
  refs.next.addEventListener('click', () => go(1));
  refs.today.addEventListener('click', () => {
    const now = new Date();
    const delta = (now.getFullYear() - month.getFullYear()) * 12 + now.getMonth() - month.getMonth();
    month = firstOfMonth(now);
    selected = iso(now);
    render(Math.sign(delta));
  });

  document.addEventListener('keydown', (e) => {
    if (currentView() !== 'calendar' || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as Element).closest('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 't') refs.today.click();
  });

  refs.grid.addEventListener('click', (e) => {
    const cell = (e.target as Element).closest<HTMLElement>('.cal-cell');
    if (!cell?.dataset.date) return;
    selected = cell.dataset.date;
    const d = new Date(`${selected}T00:00`);
    // picking a day from the neighbouring month turns the page to it
    if (d.getMonth() !== month.getMonth()) {
      const delta = d < month ? -1 : 1;
      month = firstOfMonth(d);
      render(delta);
    } else {
      render(0);
    }
  });

  function renderDay(): void {
    const d = new Date(`${selected}T00:00`);
    const head = document.createElement('div');
    head.className = 'cal-day-head';
    head.innerHTML = `<span class="cal-day-num"></span><span class="meta"></span>`;
    head.querySelector('.cal-day-num')!.textContent = String(d.getDate());
    head.querySelector('.meta')!.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const list = document.createElement('ul');
    list.className = 'cal-day-list';
    for (const ev of eventsOn(selected)) {
      const li = document.createElement('li');
      li.dataset.kind = ev.kind;
      li.innerHTML = `<span class="dot"></span><span class="t"></span><span class="meta"></span>`;
      li.querySelector('.t')!.textContent = ev.title;
      li.querySelector('.meta')!.textContent = ev.off ? 'Day off' : KIND_LABEL[ev.kind];
      list.append(li);
    }
    refs.day.replaceChildren(head, list);
  }

  function render(direction: number): void {
    refs.month.textContent = month.toLocaleDateString('en-US', { month: 'long' });
    refs.year.textContent = String(month.getFullYear());
    const today = iso(new Date());
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
    const cells: HTMLElement[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const date = iso(d);
      const list = eventsOn(date);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      cell.dataset.date = date;
      cell.classList.toggle('out', d.getMonth() !== month.getMonth());
      cell.classList.toggle('is-today', date === today);
      cell.classList.toggle('sel', date === selected);
      cell.classList.toggle('sun', d.getDay() === 0);
      cell.classList.toggle('sat', d.getDay() === 6);
      cell.classList.toggle('red', list.some((e) => e.kind === 'holiday'));
      cell.classList.toggle('off', list.some((e) => e.off));
      const label = list.map((e) => e.title).join(', ');
      cell.setAttribute('aria-label', `${d.toDateString()}${label ? `: ${label}` : ''}`);
      const num = document.createElement('span');
      num.className = 'cal-num';
      num.textContent = String(d.getDate());
      const ul = document.createElement('ul');
      ul.className = 'cal-evs';
      for (const ev of list.slice(0, MAX_IN_CELL)) {
        const li = document.createElement('li');
        li.dataset.kind = ev.kind;
        li.textContent = ev.title;
        ul.append(li);
      }
      if (list.length > MAX_IN_CELL) {
        const more = document.createElement('li');
        more.className = 'more';
        more.textContent = `+${list.length - MAX_IN_CELL}`;
        ul.append(more);
      }
      cell.append(num, ul);
      cells.push(cell);
    }
    refs.grid.replaceChildren(...cells);
    if (direction) {
      // the new month slides in from the side it came from
      refs.grid.animate(
        [{ opacity: 0, transform: `translate3d(${direction * 24}px, 0, 0)` }, { opacity: 1, transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      );
    }
    renderDay();
  }

  render(0);
  // data is a static snapshot shipped with the site; refreshed on every deploy
  fetch(`${import.meta.env.BASE_URL}data/calendar.json`)
    .then((r) => r.json() as Promise<{ events: CalEvent[] }>)
    .then((data) => {
      events = data.events ?? [];
      byDate.clear();
      for (const ev of events) byDate.set(ev.date, [...(byDate.get(ev.date) ?? []), ev]);
      render(0);
    })
    .catch(() => {});

  onView((view) => {
    if (view === 'calendar') render(0);
  });
}
