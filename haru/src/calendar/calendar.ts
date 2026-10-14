import { currentView, onView } from '../ui/router';
import { createNotes } from './notes';
import { createImages } from './images';
import { icon } from '../ui/icons';
import { QUICK_ADD_HINT, describe, parseQuickAdd } from './quick-add';
import { addBlock, setState, state, subscribe } from '../timetable/state';
import { dayKey, timetableOn } from '../timetable/history';
import { sectorPath } from '../timetable/geometry';
import { svgEl, centeredText } from '../timetable/svg';
import { CATEGORIES, labelOf, progressOf } from '../timetable/model';
import { DAY, formatDuration, hhmm } from '../timetable/time';

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
  const images = createImages(() => {
    renderGrid(0);
    renderImages();
  });
  const note = document.createElement('textarea');
  note.className = 'cal-note';
  note.placeholder = 'Note';
  // the syntax hint stays visible under the pad (a placeholder would vanish as soon as you type)
  const hint = document.createElement('pre');
  hint.className = 'cal-note-hint';
  hint.textContent = QUICK_ADD_HINT;
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

  // ---------- images on the memo: paste, drop, or pick files
  const gallery = document.createElement('div');
  gallery.className = 'cal-images';
  // ---------- that day's timetable (Today as it was on the selected date)
  const ttBtn = document.createElement('button');
  ttBtn.type = 'button';
  ttBtn.className = 'icon-btn cal-tt-btn';
  ttBtn.setAttribute('aria-label', 'Timetable of this day');
  ttBtn.title = 'Timetable of this day';
  ttBtn.setAttribute('aria-pressed', 'false');
  ttBtn.append(icon('clock'));
  const ttView = document.createElement('div');
  ttView.className = 'cal-tt';
  ttView.hidden = true;
  let ttOpen = false;
  ttBtn.addEventListener('click', () => {
    ttOpen = !ttOpen;
    ttBtn.setAttribute('aria-pressed', String(ttOpen));
    void renderTimetable();
  });
  let ttFor = '';
  async function renderTimetable(): Promise<void> {
    ttView.hidden = !ttOpen;
    if (!ttOpen) return;
    const date = selected;
    ttFor = date;
    const isToday = date === dayKey();
    const found = isToday ? { snap: { date, blocks: state.blocks, saved: Date.now() }, carried: false } : date > dayKey() ? null : await timetableOn(date);
    if (ttFor !== date) return; // another day was picked meanwhile
    const blocks = found?.snap.blocks ?? [];
    if (!blocks.length) {
      const empty = document.createElement('p');
      empty.className = 'cal-tt-empty';
      empty.textContent = date > dayKey() ? 'Not planned yet' : 'No timetable saved for this day';
      ttView.replaceChildren(empty);
      return;
    }
    // a small read-only dial: the day's tasks around 24 h, done ones solid
    const svg = svgEl('svg', { class: 'cal-tt-dial', viewBox: '-110 -110 220 220', role: 'img', 'aria-label': 'Timetable' }) as SVGSVGElement;
    svg.append(svgEl('path', { class: 'tt-bg', d: sectorPath(0, DAY, 58, 100) }));
    // each slice sweeps in clockwise, one after another (--i orders them around the clock)
    [...blocks].sort((x, y) => x.start - y.start).forEach((b, i) => {
      svg.append(svgEl('path', { class: `tt-block${b.done ? ' done' : ''}`, d: sectorPath(b.start, b.dur, 58, 100), style: `--c:var(--cat-${b.cat});--cf:var(--cat-${b.cat}-fill);--i:${i}` }));
    });
    const { done } = progressOf(blocks);
    const pct = Math.round((done / DAY) * 100);
    const pctText = centeredText('tt-pct', 0, 1, '0%');
    svg.append(pctText);
    // the percentage counts up while the slices come in
    const t0 = performance.now();
    const count = (now: number) => {
      const t = Math.min(1, (now - t0) / 700);
      pctText.textContent = `${Math.round(pct * (1 - (1 - t) ** 3))}%`;
      if (t < 1 && pctText.isConnected) requestAnimationFrame(count);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) pctText.textContent = `${pct}%`;
    else requestAnimationFrame(count);
    const list = document.createElement('ul');
    list.className = 'cal-tt-list';
    for (const [i, b] of [...blocks].sort((x, y) => x.start - y.start).entries()) {
      const li = document.createElement('li');
      li.style.setProperty('--i', String(i));
      li.classList.toggle('done', b.done);
      li.style.setProperty('--c', `var(--cat-${b.cat})`);
      li.innerHTML = '<span class="t"></span><span class="dot"></span><span class="n"></span><span class="d"></span>';
      li.querySelector('.t')!.textContent = `${hhmm(b.start)}–${hhmm(b.start + b.dur)}`;
      li.querySelector('.n')!.textContent = labelOf(b);
      li.querySelector('.n')!.setAttribute('title', CATEGORIES[b.cat]);
      li.querySelector('.d')!.textContent = formatDuration(b.dur);
      list.append(li);
    }
    const foot = document.createElement('div');
    foot.className = 'cal-tt-foot';
    const note = document.createElement('span');
    note.className = 'meta';
    note.textContent = found?.carried ? `Carried over from ${found.snap.date.slice(5).replace('-', '/')}` : isToday ? 'Today, live' : 'Saved that day';
    foot.append(note);
    if (!isToday) {
      // bring that day back as Today (done marks start over); undo from the memo status line
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn-text';
      use.textContent = 'Use for Today';
      use.addEventListener('click', () => {
        const before = state.blocks;
        setState({ blocks: blocks.map((b) => ({ ...b, done: false })), draft: null, selected: [] });
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'btn-text cal-undo';
        undo.textContent = 'Undo';
        undo.addEventListener('click', () => {
          setState({ blocks: before, draft: null, selected: [] });
          say('Restored');
        });
        say('Today set from this day');
        status.append(undo);
      });
      foot.append(use);
    }
    ttView.replaceChildren(svg, list, foot);
  }
  // Today changes show up live while today's timetable is open
  subscribe(() => {
    if (ttOpen && selected === dayKey()) void renderTimetable();
  });
  async function attach(files: Blob[]): Promise<void> {
    const n = await images.add(noteDate, files);
    if (n) say(`${n} image${n === 1 ? '' : 's'} added`);
  }
  // an image on the clipboard goes in as a picture; plain text pastes as usual
  note.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  });
  refs.day.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) return;
    e.preventDefault();
    refs.day.classList.add('drop');
  });
  refs.day.addEventListener('dragleave', (e) => {
    if (!refs.day.contains(e.relatedTarget as Node)) refs.day.classList.remove('drop');
  });
  refs.day.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    refs.day.classList.remove('drop');
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  });

  // full-size view: a modal dialog; any click or Esc closes it
  const viewer = document.createElement('dialog');
  viewer.className = 'img-view';
  const big = document.createElement('img');
  big.alt = '';
  viewer.append(big);
  viewer.addEventListener('click', () => viewer.close());
  document.body.append(viewer);

  function renderImages(): void {
    const list = images.get(noteDate);
    gallery.hidden = !list.length;
    gallery.replaceChildren(...list.map((rec, k) => {
      const item = document.createElement('div');
      item.className = 'cal-img';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'cal-img-open';
      open.setAttribute('aria-label', `Open image ${k + 1}`);
      const img = document.createElement('img');
      img.src = images.url(rec);
      img.alt = '';
      img.loading = 'lazy';
      open.append(img);
      open.addEventListener('click', () => {
        big.src = images.url(rec);
        viewer.showModal();
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cal-img-del';
      del.setAttribute('aria-label', `Remove image ${k + 1}`);
      del.append(icon('x'));
      del.addEventListener('click', () => {
        images.remove(rec.id);
      });
      item.append(open, del);
      return item;
    }));
  }
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') note.blur();
  });
  // Enter on a `!` line schedules just that line; the caret stays where the line was.
  // Handled as the line break is about to be inserted, i.e. after any IME composition (Korean) has committed.
  /** The `!` line under the caret, if any: its bounds and what it parses to. */
  const caretLine = () => {
    const value = note.value;
    const caret = note.selectionStart;
    const start = value.lastIndexOf('\n', caret - 1) + 1;
    const newline = value.indexOf('\n', caret);
    const end = newline === -1 ? value.length : newline;
    return { value, start, end, newline, parsed: parseQuickAdd(value.slice(start, end), state.lastCat) };
  };

  /** Schedules the `!` line under the caret; the caret stays where the line was. */
  function scheduleCaretLine(): void {
    const { value, start, end, newline, parsed } = caretLine();
    if (parsed === null) return;
    const err = typeof parsed === 'string' ? parsed : addBlock(parsed);
    if (err) {
      // the line stays as written, and Enter still breaks it — a line that can't be scheduled mustn't trap the caret
      say(err, true);
      note.setRangeText('\n', note.selectionStart, note.selectionEnd, 'end');
      notes.set(noteDate, note.value);
      return;
    }
    if (typeof parsed !== 'string') say(`Added to Today  ${describe(parsed)}`);
    note.value = value.slice(0, start) + value.slice(newline === -1 ? end : end + 1);
    note.setSelectionRange(start, start);
    notes.set(noteDate, note.value);
  }

  // Enter on a `!` line schedules it instead of breaking the line. With a Korean IME the Enter can arrive
  // while the last syllable is still being composed: the break is cancelled right away (so the syllable
  // isn't pushed onto a new line) and the line is scheduled once the composition has committed.
  let afterComposition = false;
  note.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
    if (note.selectionStart !== note.selectionEnd || caretLine().parsed === null) return;
    e.preventDefault();
    if (e.isComposing) afterComposition = true;
    else scheduleCaretLine();
  });
  note.addEventListener('compositionend', () => {
    if (!afterComposition) return;
    afterComposition = false;
    setTimeout(scheduleCaretLine, 0);
  });
  // some IMEs commit first and send the Enter as a plain keydown afterwards
  note.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    if (note.selectionStart === note.selectionEnd && caretLine().parsed !== null) {
      e.preventDefault();
      scheduleCaretLine();
    }
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
    head.append(ttBtn);
    head.querySelector('.cal-day-num')!.textContent = String(d.getDate());
    head.querySelector('.meta')!.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    // keep the textarea itself (and the caret) — only swap its contents when the day changes
    if (noteDate !== selected) {
      noteDate = selected;
      note.value = notes.get(selected);
    }
    renderImages();
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
    // events first, then the memo pad, which takes the rest of the panel
    refs.day.replaceChildren(head, ttView, list, note, gallery, status, hint);
    void renderTimetable();
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
      const pics = images.get(date).length;
      // a day with only pictures still shows that something is there
      const memo = firstLine(notes.get(date)) || (pics ? `${pics} image${pics === 1 ? '' : 's'}` : '');
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
  fetch(`${import.meta.env.BASE_URL}data/calendar.json?v=${__BUILD_ID__}`)
    .then((r) => r.json() as Promise<{ events: CalEvent[] }>)
    .then((data) => {
      events = data.events ?? [];
      byDate.clear();
      for (const ev of events) byDate.set(ev.date, [...(byDate.get(ev.date) ?? []), ev]);
      render(0);
    })
    .catch(() => {});

  // arriving on the page only needs a redraw when the date moved on (e.g. past midnight)
  let shownOn = iso(new Date());
  onView((view) => {
    if (view !== 'calendar' || iso(new Date()) === shownOn) return;
    shownOn = iso(new Date());
    render(0);
  });
}
