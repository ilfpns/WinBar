import { currentView, onView } from '../ui/router';
import { createNotes } from './notes';
import { createImages } from './images';
import { mountStats } from './stats';
import { mdPad } from '../ui/md-pad';
import '../ui/md-editor';
import { printPdf } from '../ui/print';
import { ringsChart, slicesChart } from './day-charts';
import { icon } from '../ui/icons';
import { QUICK_ADD_HINT, describe, parseQuickAdd } from './quick-add';
import { addBlock, setState, state, subscribe } from '../timetable/state';
import { dayOf, timetableOn } from '../timetable/history';
import { CATEGORIES, type Block, labelOf } from '../timetable/model';
import { allTemplates } from '../timetable/templates';
import { clearPlan, onPlans, planOn, setPlan, setPlanNote } from '../timetable/plans';
import { type MenuItem, dayLine, isAhead, loadDay, miniDial, openPlanMenu, weekDates, weekStart } from './week';
import { formatDuration, hhmm } from '../timetable/time';
import { lessMotion } from '../ui/motion';

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
  stats: HTMLButtonElement;
  /** Month / Week switch, and the week's "plan the weekdays" button. */
  mode: HTMLElement;
  plan: HTMLButtonElement;
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
  // the month grid, or one week as seven small dials (remembered)
  const MODE_KEY = 'haru:cal-mode';
  let mode: 'month' | 'week' = 'month';
  try {
    if (localStorage.getItem(MODE_KEY) === 'week') mode = 'week';
  } catch {
    // the month
  }
  let weekOf = weekStart(new Date());

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
  const note = document.createElement('md-editor');
  note.className = 'cal-note';
  note.placeholder = 'Note';
  // the syntax hint stays visible under the pad (a placeholder would vanish as soon as you type)
  const hint = document.createElement('pre');
  hint.className = 'cal-note-hint';
  hint.textContent = QUICK_ADD_HINT;
  note.spellcheck = false;
  note.setAttribute('aria-label', 'Note for the selected day (Markdown)');
  // Markdown that formats itself as you type (/ for blocks, Tab to indent)
  const pad = mdPad(note, 'cal-pad');
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
  // the week is about planning: there the day's timetable (or plan) starts open
  let ttOpen = mode === 'week';
  ttBtn.setAttribute('aria-pressed', String(ttOpen));
  ttBtn.addEventListener('click', () => {
    ttOpen = !ttOpen;
    ttBtn.setAttribute('aria-pressed', String(ttOpen));
    void renderTimetable();
  });
  let ttFor = '';
  const TT_CHART_KEY = 'haru:tt-chart';
  let ttChart: 'slices' | 'rings' = 'slices';
  try {
    if (localStorage.getItem(TT_CHART_KEY) === 'rings') ttChart = 'rings';
  } catch {
    // default view
  }
  /** The card's height glides between sizes (open, close, a longer or shorter day), so the memo below moves with it. */
  let ttAnim: Animation | null = null;
  const GAP = 14; // the panel's flex gap, folded away while the card is closed
  const ease = 'cubic-bezier(.22, 1, .36, 1)';
  const reduced = lessMotion;
  function resizeFrom(from: number): void {
    ttAnim?.cancel();
    ttView.hidden = false;
    // layout height (offsetHeight): the card's own fade-in scales it, which a bounding box would include
    const to = ttView.offsetHeight;
    if (Math.abs(to - from) < 1 || reduced()) return;
    const start: Keyframe = from ? { height: `${from}px` } : { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: `-${GAP}px`, borderWidth: '0px' };
    ttAnim = ttView.animate([start, { height: `${to}px` }], { duration: 420, easing: ease });
  }
  function closeTimetable(): void {
    ttAnim?.cancel();
    if (ttView.hidden) return;
    const from = ttView.offsetHeight;
    if (reduced()) {
      ttView.hidden = true;
      return;
    }
    ttAnim = ttView.animate(
      [{ height: `${from}px`, opacity: 1 }, { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: `-${GAP}px`, borderWidth: '0px', opacity: 0 }],
      { duration: 320, easing: ease },
    );
    ttAnim.onfinish = () => {
      ttView.hidden = true;
      ttAnim = null;
    };
  }

  async function renderTimetable(): Promise<void> {
    if (!ttOpen) {
      closeTimetable();
      return;
    }
    const from = ttView.hidden ? 0 : ttView.offsetHeight;
    const date = selected;
    ttFor = date;
    // Today follows the New day time (at 2 a.m. with a 4 a.m. reset it is still yesterday); later days show their plan
    const isToday = date === dayOf();
    const ahead = isAhead(date);
    const plan = ahead ? planOn(date) : undefined;
    const found = isToday
      ? { snap: { date, blocks: state.blocks, saved: Date.now() }, carried: false }
      : ahead
        ? plan ? { snap: { date, blocks: plan.blocks.map((b, i): Block => ({ ...b, id: `plan-${i}`, done: false })), saved: plan.saved }, carried: false } : null
        : await timetableOn(date);
    if (ttFor !== date) return; // another day was picked meanwhile
    const blocks = found?.snap.blocks ?? [];
    const planBtn = (label: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-text';
      b.textContent = label;
      b.addEventListener('click', () => void planMenu([date], b));
      return b;
    };
    if (!blocks.length) {
      const empty = document.createElement('p');
      empty.className = 'cal-tt-empty';
      empty.textContent = ahead ? 'Not planned yet' : 'No timetable saved for this day';
      if (ahead) {
        const row = document.createElement('div');
        row.className = 'cal-tt-plan';
        row.append(empty, planBtn('Plan this day'));
        ttView.replaceChildren(row);
      } else {
        ttView.replaceChildren(empty);
      }
      resizeFrom(from);
      return;
    }
    // the day as a chart: slices with named callouts, or one ring per category (switchable, remembered)
    const views = document.createElement('div');
    views.className = 'cal-tt-views';
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'Chart');
    for (const [id, label, ic] of [['slices', 'Slices', 'chart-pie'], ['rings', 'By category', 'target']] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-tt-view';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.setAttribute('aria-pressed', String(ttChart === id));
      b.append(icon(ic));
      b.addEventListener('click', () => {
        if (ttChart === id) return;
        ttChart = id;
        try {
          localStorage.setItem(TT_CHART_KEY, id);
        } catch {
          // remembered for this visit only
        }
        void renderTimetable();
      });
      views.append(b);
    }
    const svg = ttChart === 'rings' ? ringsChart(blocks) : slicesChart(blocks);
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
      // the task's note on a line of its own under the name; one that doesn't fit folds (see foldNotes)
      const text = b.note?.trim();
      if (text) {
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.innerHTML = '<span class="mark"></span><span class="sub-text"></span>';
        sub.querySelector('.sub-text')!.textContent = text;
        li.append(sub);
      }
      if (plan) noteEditable(li, date, b.start, b.note ?? '', labelOf(b));
      list.append(li);
    }
    const foot = document.createElement('div');
    foot.className = 'cal-tt-foot';
    const note = document.createElement('span');
    note.className = 'meta';
    note.textContent = plan
      ? plan.from ? `Planned · ${plan.from}` : 'Planned'
      : found?.carried ? `Carried over from ${found.snap.date.slice(5).replace('-', '/')}` : isToday ? 'Today, live' : 'Saved that day';
    foot.append(note);
    if (plan) {
      // a day ahead: change its plan or drop it; it becomes Today when that day begins
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'btn-text danger';
      clear.textContent = 'Clear plan';
      clear.addEventListener('click', () => {
        clearPlan(date);
        say('Plan cleared');
      });
      const tools = document.createElement('div');
      tools.className = 'cal-tt-foot-tools';
      tools.append(planBtn('Change'), clear);
      foot.append(tools);
    } else if (!isToday) {
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
    // the switch gets its own row above the chart, so it never sits on a callout
    const top = document.createElement('div');
    top.className = 'cal-tt-top';
    const title = document.createElement('span');
    title.className = 'meta';
    title.textContent = plan ? 'Plan' : 'Timetable';
    top.append(title, views);
    ttView.replaceChildren(top, svg, list, foot);
    resizeFrom(from);
    foldNotes(list);
  }
  /** A planned task takes a note: its row opens a box under it, saved on leaving it (Esc: as it was). */
  function noteEditable(li: HTMLElement, date: string, start: number, note: string, label: string): void {
    li.classList.add('editable');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `Note for ${label}`);
    const open = () => {
      if (li.querySelector('.sub-edit')) return;
      const box = document.createElement('textarea');
      box.className = 'sub-edit';
      box.rows = 1;
      box.placeholder = 'Note';
      box.value = note;
      const fit = () => {
        box.style.height = 'auto';
        box.style.height = `${box.scrollHeight}px`;
      };
      li.querySelector<HTMLElement>('.sub')?.setAttribute('hidden', '');
      li.append(box);
      fit();
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
      let cancelled = false;
      box.addEventListener('input', fit);
      box.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          cancelled = true;
          box.blur();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) box.blur();
      });
      box.addEventListener('blur', () => {
        const value = box.value.trim() ? box.value.replace(/\s+$/, '') : '';
        if (!cancelled && value !== note) {
          // the plan list changes and the panel draws again with the note in place
          setPlanNote(date, start, value);
          say(value ? 'Note saved' : 'Note removed');
          return;
        }
        box.remove();
        li.querySelector<HTMLElement>('.sub')?.removeAttribute('hidden');
        li.focus();
      });
    };
    li.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('.sub.long, .sub-edit')) open();
    });
    li.addEventListener('keydown', (e) => {
      if (e.target !== li || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      open();
    });
  }
  /** A note longer than its one line (or of several lines) shows its first line behind a chevron that opens it. */
  function foldNotes(list: HTMLElement): void {
    for (const sub of list.querySelectorAll<HTMLElement>('.sub')) {
      const body = sub.querySelector<HTMLElement>('.sub-text')!;
      if (!body.textContent!.includes('\n') && body.scrollWidth <= body.clientWidth + 1) continue;
      sub.classList.add('long');
      sub.querySelector('.mark')!.append(icon('chevron-right'));
      sub.tabIndex = 0;
      sub.setAttribute('role', 'button');
      sub.setAttribute('aria-expanded', 'false');
      const toggle = () => {
        const from = body.offsetHeight;
        const open = sub.classList.toggle('open');
        sub.setAttribute('aria-expanded', String(open));
        const to = body.offsetHeight;
        if (!reduced() && from !== to) body.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 260, easing: ease });
      };
      sub.addEventListener('click', toggle);
      sub.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggle();
      });
    }
  }
  // Today changes show up live while today's timetable is open (and in the week, on Today's dial)
  subscribe(() => {
    if (ttOpen && selected === dayOf()) void renderTimetable();
    // off the page the week waits: arriving on it redraws (see onView below)
    if (mode === 'week' && currentView() === 'calendar' && weekDates(weekOf).includes(dayOf())) renderGrid(0);
  });

  // ---------- planning days ahead (Plans): from the day panel, or the week's weekdays at once
  const short = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  async function planMenu(dates: string[], from: HTMLElement): Promise<void> {
    const ahead = dates.filter(isAhead);
    if (!ahead.length) return;
    const one = ahead.length === 1 ? ahead[0]! : null;
    const done = (n: number, name: string) => say(n === 1 ? `Planned with ${name}` : `Planned ${n} days with ${name}`);
    const items: MenuItem[] = allTemplates().filter((t) => t.blocks.length).map((t) => ({
      label: t.name,
      icon: 'file-text',
      run: () => {
        for (const d of ahead) setPlan(d, t.blocks, t.name);
        done(ahead.length, t.name);
      },
    }));
    if (one) {
      // the same weekday a week earlier (as kept, live, or planned), and Today as it is now
      const before = new Date(`${one}T00:00`);
      before.setDate(before.getDate() - 7);
      const prev = await loadDay(iso(before));
      if (prev.blocks.length) {
        const name = short(prev.date);
        items.push({ label: `Same as ${name}`, icon: 'copy', run: () => { setPlan(one, prev.blocks, name); done(1, name); } });
      }
      if (state.blocks.length) items.push({ label: 'Copy Today', icon: 'copy', run: () => { setPlan(one, state.blocks, 'Today'); done(1, 'Today'); } });
    }
    if (ahead.some((d) => planOn(d))) {
      items.push({
        label: one ? 'Clear plan' : 'Clear these plans',
        icon: 'eraser',
        danger: true,
        run: () => {
          ahead.forEach(clearPlan);
          say(one ? 'Plan cleared' : 'Plans cleared');
        },
      });
    }
    const head = one ? short(one) : `${short(ahead[0]!)} – ${short(ahead[ahead.length - 1]!)}`;
    openPlanMenu(from, head, items, allTemplates().some((t) => t.blocks.length) ? '' : 'Save a template on Today to plan with it');
  }
  /** The weekdays (Mon–Fri) of the shown week that are still ahead. */
  const weekdaysAhead = () => weekDates(weekOf).slice(1, 6).filter(isAhead);
  refs.plan.addEventListener('click', () => void planMenu(weekdaysAhead(), refs.plan));
  onPlans(() => {
    if (mode === 'week') renderGrid(0);
    if (ttOpen && isAhead(selected)) void renderTimetable();
  });
  async function attach(files: Blob[]): Promise<void> {
    const n = (await images.add(noteDate, files)).length;
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
    if (document.activeElement !== note) {
      note.value = notes.get(noteDate);
      pad.refresh();
    }
  });
  /** The memo's first line as plain text for the month grid (Markdown marks dropped). */
  const firstLine = (text: string) =>
    (text.trim().split(/\r?\n/)[0] ?? '')
      .replace(/^\s*\|(.*)\|\s*$/, (_, cells: string) => cells.split('|').map((x) => x.trim()).filter(Boolean).join(' · '))
      .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
      .replace(/\*\*|__|~~|`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();

  function go(delta: number): void {
    if (mode === 'week') {
      // a week at a time; the picked day moves along to the same weekday
      weekOf = new Date(weekOf.getFullYear(), weekOf.getMonth(), weekOf.getDate() + 7 * delta);
      const d = new Date(`${selected}T00:00`);
      selected = iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * delta));
      month = firstOfMonth(new Date(`${selected}T00:00`));
    } else {
      month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    }
    render(delta);
  }
  refs.prev.addEventListener('click', () => go(-1));
  mountStats(refs.stats, () => month);
  refs.next.addEventListener('click', () => go(1));
  refs.today.addEventListener('click', () => {
    const now = new Date();
    const delta = mode === 'week'
      ? Math.sign(weekStart(now).getTime() - weekOf.getTime())
      : (now.getFullYear() - month.getFullYear()) * 12 + now.getMonth() - month.getMonth();
    month = firstOfMonth(now);
    weekOf = weekStart(now);
    selected = iso(now);
    render(Math.sign(delta));
  });

  // Month / Week
  const modeBtns = [...refs.mode.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  function paintMode(): void {
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    refs.grid.classList.toggle('week', mode === 'week');
    refs.grid.classList.remove('enter');
    refs.plan.hidden = mode !== 'week';
    refs.prev.setAttribute('aria-label', mode === 'week' ? 'Previous week' : 'Previous month');
    refs.next.setAttribute('aria-label', mode === 'week' ? 'Next week' : 'Next month');
  }
  for (const b of modeBtns) {
    b.addEventListener('click', () => {
      const next = b.dataset.mode === 'week' ? 'week' : 'month';
      if (next === mode) return;
      mode = next;
      try {
        localStorage.setItem(MODE_KEY, mode);
      } catch {
        // remembered for this visit only
      }
      // both views open on the picked day
      const d = new Date(`${selected}T00:00`);
      weekOf = weekStart(d);
      month = firstOfMonth(d);
      if (mode === 'week' && !ttOpen) {
        ttOpen = true;
        ttBtn.setAttribute('aria-pressed', 'true');
      }
      drawnWeek = ''; // the week sweeps in when it opens
      paintMode();
      render(0);
    });
  }
  paintMode();

  document.addEventListener('keydown', (e) => {
    if (currentView() !== 'calendar' || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if ((e.target as Element).closest('input, select, textarea, md-editor')) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 't') refs.today.click();
  });

  refs.grid.addEventListener('click', (e) => {
    const cell = (e.target as Element).closest<HTMLElement>('.cal-cell');
    if (cell?.dataset.date) pickDate(cell.dataset.date);
  });

  function pickDate(date: string): void {
    selected = date;
    const d = new Date(`${selected}T00:00`);
    if (mode === 'week') {
      month = firstOfMonth(d);
      render(0);
      return;
    }
    // picking a day from the neighbouring month turns the page to it
    if (d.getMonth() !== month.getMonth()) {
      const delta = d < month ? -1 : 1;
      month = firstOfMonth(d);
      render(delta);
    } else {
      render(0);
    }
  }

  // PDF of the selected day (its events and memo), from the memo's corner
  const pdfBtn = document.createElement('button');
  pdfBtn.type = 'button';
  pdfBtn.className = 'pad-pdf';
  pdfBtn.setAttribute('aria-label', 'Export this day as PDF');
  pdfBtn.title = 'Export this day as PDF';
  pdfBtn.append(icon('file-down'), 'PDF');
  pad.el.append(pdfBtn);
  pdfBtn.addEventListener('click', () => {
    const d = new Date(`${selected}T00:00`);
    const events = eventsOn(selected).map((ev) => `- **${ev.title}** · ${ev.off ? 'Day off' : KIND_LABEL[ev.kind]}`);
    const body = [events.length ? `## Events\n\n${events.join('\n')}` : '', notes.get(selected).trim() ? `## Note\n\n${notes.get(selected)}` : '']
      .filter(Boolean).join('\n\n') || '_Nothing written for this day._';
    printPdf(`Haru ${selected}`, 'Calendar', [{ title: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), body }]);
  });
  const tools = document.createElement('div');
  tools.className = 'cal-day-tools';
  tools.append(ttBtn);

  function renderDay(): void {
    const d = new Date(`${selected}T00:00`);
    const head = document.createElement('div');
    head.className = 'cal-day-head';
    head.innerHTML = `<span class="cal-day-num"></span><span class="meta"></span>`;
    head.append(tools);
    head.querySelector('.cal-day-num')!.textContent = String(d.getDate());
    head.querySelector('.meta')!.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    // keep the textarea itself (and the caret) — only swap its contents when the day changes
    if (noteDate !== selected) {
      noteDate = selected;
      note.value = notes.get(selected);
      pad.refresh();
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
    refs.day.replaceChildren(head, ttView, list, pad.el, gallery, status, hint);
    void renderTimetable();
  }

  function render(direction: number): void {
    renderGrid(direction);
    renderDay();
  }

  /** Bumped on every week drawn: days that load after the week moved on are dropped. */
  let weekToken = 0;
  /** The week last drawn: only a different one sweeps its dials in. */
  let drawnWeek = '';
  function renderWeek(direction: number): void {
    const dates = weekDates(weekOf);
    const at = (date: string) => new Date(`${date}T00:00`);
    const mid = at(dates[3]!);
    const span = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    refs.month.textContent = mid.toLocaleDateString('en-US', { month: 'long' });
    refs.year.textContent = `${mid.getFullYear()} · ${span(at(dates[0]!))} – ${span(at(dates[6]!))}`;
    refs.plan.disabled = !weekdaysAhead().length;
    const today = iso(new Date());
    const token = ++weekToken;
    const cells = dates.map((date) => {
      const d = at(date);
      const list = eventsOn(date);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell wk-cell';
      cell.dataset.date = date;
      cell.classList.toggle('is-today', date === today);
      cell.classList.toggle('sel', date === selected);
      cell.classList.toggle('sun', d.getDay() === 0);
      cell.classList.toggle('sat', d.getDay() === 6);
      cell.classList.toggle('red', list.some((e) => e.kind === 'holiday'));
      cell.classList.toggle('off', list.some((e) => e.off));
      cell.classList.toggle('ahead', isAhead(date));
      const num = document.createElement('span');
      num.className = 'cal-num';
      num.textContent = String(d.getDate());
      const slot = document.createElement('div');
      slot.className = 'wk-slot';
      const line = document.createElement('span');
      line.className = 'wk-line meta';
      const ul = document.createElement('ul');
      ul.className = 'cal-evs';
      for (const ev of list.slice(0, 2)) {
        const li = document.createElement('li');
        li.dataset.kind = ev.kind;
        li.textContent = ev.title;
        ul.append(li);
      }
      cell.append(num, slot, line, ul);
      cell.setAttribute('aria-label', d.toDateString());
      return cell;
    });
    refs.grid.replaceChildren(...cells);
    const fresh = drawnWeek !== dates[0];
    drawnWeek = dates[0]!;
    void Promise.all(dates.map(loadDay)).then((days) => {
      if (token !== weekToken) return;
      refs.grid.classList.toggle('enter', fresh);
      days.forEach((day, i) => {
        const cell = cells[i]!;
        cell.classList.add(`wk-${day.kind}`);
        cell.querySelector('.wk-slot')!.replaceChildren(miniDial(day));
        const text = dayLine(day);
        cell.querySelector('.wk-line')!.textContent = text;
        const events = eventsOn(day.date).map((e) => e.title).join(', ');
        cell.setAttribute('aria-label', [at(day.date).toDateString(), text, events].filter(Boolean).join(': '));
      });
    });
    if (direction) {
      refs.grid.animate(
        [{ opacity: 0, transform: `translate3d(${direction * 24}px, 0, 0)` }, { opacity: 1, transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      );
    }
  }

  function renderGrid(direction: number): void {
    if (mode === 'week') {
      renderWeek(direction);
      return;
    }
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
    if (view !== 'calendar') return;
    // the week shows Today live, so it is redrawn on every visit
    if (mode === 'week' && iso(new Date()) === shownOn) {
      renderGrid(0);
      return;
    }
    if (iso(new Date()) === shownOn) return;
    shownOn = iso(new Date());
    render(0);
  });
}
