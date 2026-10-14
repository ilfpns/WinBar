import { currentView, onView } from '../ui/router';
import { createNotes } from './notes';
import { QUICK_ADD_HINT, describe, parseQuickAdd } from './quick-add';
import { addBlock, state } from '../timetable/state';

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

  // the day panel doubles as a memo pad for that date; memos show up in the grid
  const notes = createNotes(() => renderGrid(0));
  const note = document.createElement('textarea');
  note.className = 'cal-note';
  note.placeholder = QUICK_ADD_HINT;
  note.rows = 5;
  note.spellcheck = false;
  note.setAttribute('aria-label', 'Note for the selected day');
  let noteDate = '';
  const status = document.createElement('p');
  status.className = 'cal-note-status';
  status.setAttribute('role', 'status');
  let statusTimer = 0;
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle('bad', bad);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (status.textContent = ''), bad ? 4000 : 2200);
  };

  /** Moves every valid `! 12:00~12:30 work title` line into Today's timetable; leaves the rest. */
  function moveScheduledLines(): void {
    const lines = note.value.split(/\r?\n/);
    const kept: string[] = [];
    let moved = 0;
    for (const line of lines) {
      const parsed = parseQuickAdd(line, state.lastCat);
      if (parsed === null) { kept.push(line); continue; }
      const err = typeof parsed === 'string' ? parsed : addBlock(parsed);
      if (err) { kept.push(line); say(err, true); continue; }
      moved++;
      if (typeof parsed !== 'string') say(`Added to Today  ${describe(parsed)}`);
    }
    if (!moved) return;
    note.value = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
    notes.set(noteDate, note.value);
  }

  note.addEventListener('input', () => notes.set(noteDate, note.value));
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') note.blur();
    // Enter on a `!` line schedules just that line; the caret stays where the line was
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || note.selectionStart !== note.selectionEnd) return;
    const value = note.value;
    const caret = note.selectionStart;
    const start = value.lastIndexOf('\n', caret - 1) + 1;
    const newline = value.indexOf('\n', caret);
    const end = newline === -1 ? value.length : newline;
    const parsed = parseQuickAdd(value.slice(start, end), state.lastCat);
    if (parsed === null) return;
    e.preventDefault();
    const err = typeof parsed === 'string' ? parsed : addBlock(parsed);
    if (err) {
      say(err, true);
      return;
    }
    if (typeof parsed !== 'string') say(`Added to Today  ${describe(parsed)}`);
    note.value = value.slice(0, start) + value.slice(newline === -1 ? end : end + 1);
    note.setSelectionRange(start, start);
    notes.set(noteDate, note.value);
  });
  note.addEventListener('blur', moveScheduledLines);
  // memos load asynchronously (IndexedDB): fill the open day's pad once they arrive, unless already typing
  void notes.ready.then(() => {
    if (document.activeElement !== note) note.value = notes.get(noteDate);
  });
  const firstLine = (text: string) => text.trim().split(/\r?\n/)[0]!.trim();

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
    // keep the textarea itself (and the caret) — only swap its contents when the day changes
    if (noteDate !== selected) {
      noteDate = selected;
      note.value = notes.get(selected);
    }
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
    refs.day.replaceChildren(head, note, status, list);
  }

  function render(direction: number): void {
    renderGrid(direction);
    renderDay();
  }

  function renderGrid(direction: number): void {
    refs.month.textContent = month.toLocaleDateString('en-US', { month: 'long' });
    refs.year.textContent = String(month.getFullYear());
    const today = iso(new Date());
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
    const cells: HTMLElement[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const date = iso(d);
      const list = eventsOn(date);
      const memo = firstLine(notes.get(date));
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
      if (memo) {
        const li = document.createElement('li');
        li.dataset.kind = 'note';
        li.textContent = memo;
        ul.append(li);
      }
      const room = memo ? MAX_IN_CELL - 1 : MAX_IN_CELL;
      for (const ev of list.slice(0, room)) {
        const li = document.createElement('li');
        li.dataset.kind = ev.kind;
        li.textContent = ev.title;
        ul.append(li);
      }
      if (list.length > room) {
        const more = document.createElement('li');
        more.className = 'more';
        more.textContent = `+${list.length - room}`;
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
