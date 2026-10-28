import { CATEGORIES, CATEGORY_KEYS, type Block, type Category } from '../timetable/model';
import { allDays, dayOf, onDaySaved } from '../timetable/history';
import { state, subscribe } from '../timetable/state';
import { svgEl } from '../timetable/svg';
import { formatDuration } from '../timetable/time';
import { currentView, onView } from '../ui/router';
import { icon } from '../ui/icons';
import { lessMotion } from '../ui/motion';

/**
 * Dot board: every day you keep, as hexagon cells. Each of the nine categories starts as one seed on a ring
 * around the middle; every day adds one cell to each category's patch, on its edge nearest the seed (a cell taken
 * by another patch is passed over, so the patches press into one another as the days pile up). A cell's shade is
 * how much of that day went to the category, against the category's own fullest day: blank (none) to full colour.
 * Built again from the day history each time, so it is always what the calendar holds; Today counts as it stands.
 */

interface Day { date: string; mins: Record<Category, number>; done: Record<Category, number> }
interface Cell { q: number; r: number; cat: Category; day: number; level: number }

const zero = () => Object.fromEntries(CATEGORY_KEYS.map((c) => [c, 0])) as Record<Category, number>;

function summarize(date: string, blocks: readonly Block[]): Day {
  const mins = zero();
  const done = zero();
  for (const b of blocks) {
    mins[b.cat] += b.dur;
    if (b.done) done[b.cat] += b.dur;
  }
  return { date, mins, done };
}

/** The days to grow from: each kept day with tasks, Today as it stands, oldest first. */
async function loadDays(): Promise<Day[]> {
  const today = dayOf();
  const kept = (await allDays()).filter((s) => s.date !== today && s.blocks?.length);
  const days = kept.map((s) => summarize(s.date, s.blocks));
  if (state.blocks.length) days.push(summarize(today, state.blocks));
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- the hex grid (pointy-top, axial coordinates)

const NEIGHBOURS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (q: number, r: number) => `${q},${r}`;
const SQ3 = Math.sqrt(3);
const toXY = (q: number, r: number): [number, number] => [SQ3 * (q + r / 2), 1.5 * r];
function fromXY(x: number, y: number): [number, number] {
  const q = (SQ3 / 3) * x - y / 3;
  const r = (2 / 3) * y;
  // cube rounding
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}
/** A steady 0..1 per cell and patch, so the patches' edges come out ragged the same way every time. */
const jitter = (q: number, r: number, i: number) => {
  const x = Math.sin(q * 127.1 + r * 311.7 + i * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Lays out the board: one cell per category per day. */
function grow(days: readonly Day[]): Cell[] {
  const n = days.length;
  // the seeds on a ring wide enough that nine patches of n cells only meet as they fill out
  const ring = Math.max(2.5, 2.7 * Math.sqrt(n / 3) + 1);
  const seeds = CATEGORY_KEYS.map((_, i) => {
    const a = (i / CATEGORY_KEYS.length) * Math.PI * 2 - Math.PI / 2;
    return { x: ring * SQ3 * Math.cos(a), y: ring * SQ3 * Math.sin(a) };
  });
  const taken = new Map<string, Cell>();
  const edges = CATEGORY_KEYS.map(() => new Set<string>());
  const score = (i: number, q: number, r: number) => {
    const [x, y] = toXY(q, r);
    return Math.hypot(x - seeds[i]!.x, y - seeds[i]!.y) + jitter(q, r, i) * 0.9;
  };
  const place = (i: number, q: number, r: number, cell: Cell) => {
    const k = key(q, r);
    taken.set(k, cell);
    for (const e of edges) e.delete(k);
    for (const [dq, dr] of NEIGHBOURS) {
      const nk = key(q + dq, r + dr);
      if (!taken.has(nk)) edges[i]!.add(nk);
    }
  };
  /** The free cell nearest the seed, for a patch hemmed in on every side. */
  const nearestFree = (i: number): [number, number] => {
    const [sq, sr] = fromXY(seeds[i]!.x, seeds[i]!.y);
    const seen = new Set([key(sq, sr)]);
    const queue: [number, number][] = [[sq, sr]];
    for (let h = 0; h < queue.length; h++) {
      const [q, r] = queue[h]!;
      if (!taken.has(key(q, r))) return [q, r];
      for (const [dq, dr] of NEIGHBOURS) {
        const nk = key(q + dq, r + dr);
        if (!seen.has(nk)) {
          seen.add(nk);
          queue.push([q + dq, r + dr]);
        }
      }
    }
    return [sq, sr];
  };
  const maxMins = Object.fromEntries(CATEGORY_KEYS.map((c) => [c, Math.max(1, ...days.map((d) => d.mins[c]))])) as Record<Category, number>;
  for (const [d, day] of days.entries()) {
    // who grows first turns with the days, so no patch always gets the first pick
    for (let j = 0; j < CATEGORY_KEYS.length; j++) {
      const i = (j + d) % CATEGORY_KEYS.length;
      const cat = CATEGORY_KEYS[i]!;
      const m = day.mins[cat];
      const level = m ? Math.min(5, 1 + Math.floor((4 * m) / maxMins[cat])) : 0;
      let best: [number, number] | null = null;
      let bestScore = Infinity;
      if (d === 0) best = nearestFree(i);
      else {
        for (const k of edges[i]!) {
          const [q, r] = k.split(',').map(Number) as [number, number];
          const s = score(i, q, r);
          if (s < bestScore) {
            bestScore = s;
            best = [q, r];
          }
        }
        best ??= nearestFree(i);
      }
      place(i, best[0], best[1], { q: best[0], r: best[1], cat, day: d, level });
    }
  }
  return [...taken.values()];
}

// ---------- the page

const hexPoints = (cx: number, cy: number, s: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30);
    return `${(cx + s * Math.cos(a)).toFixed(2)},${(cy + s * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
const fmtDate = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function mountBoard(body: HTMLElement, sum: HTMLElement): void {
  body.innerHTML = `
    <section class="bd-map glass-card" aria-label="Board">
      <div class="bd-bar">
        <span class="meta bd-range"></span>
        <button type="button" class="btn-text bd-replay"></button>
      </div>
      <div class="bd-stage"></div>
      <div class="bd-tip" role="status" hidden></div>
    </section>
    <aside class="bd-side glass-card" aria-label="Categories">
      <div class="meta">Categories</div>
      <ul class="bd-legend"></ul>
      <div class="bd-scale" aria-label="Shade: the share of that category's fullest day">
        <span class="meta">None</span><span class="bd-swatches"></span><span class="meta">Fullest day</span>
      </div>
    </aside>`;
  const stage = body.querySelector<HTMLElement>('.bd-stage')!;
  const tip = body.querySelector<HTMLElement>('.bd-tip')!;
  const legend = body.querySelector<HTMLElement>('.bd-legend')!;
  const replay = body.querySelector<HTMLButtonElement>('.bd-replay')!;
  replay.append(icon('rotate-ccw'), 'Replay');
  const swatches = body.querySelector<HTMLElement>('.bd-swatches')!;
  for (let l = 0; l <= 5; l++) swatches.append(Object.assign(document.createElement('span'), { className: `bd-sw l${l}` }));

  let days: Day[] = [];
  let focus: Category | null = null;
  let drawn = '';

  function paintFocus(): void {
    stage.querySelector('svg')?.classList.toggle('focused', !!focus);
    stage.querySelectorAll<SVGElement>('.bd-cell').forEach((el) => el.classList.toggle('on', el.dataset.cat === focus));
    legend.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === focus)));
  }

  function draw(animate: boolean): void {
    const cells = grow(days);
    const today = dayOf();
    sum.textContent = days.length ? `${days.length} ${days.length === 1 ? 'day' : 'days'} · since ${fmtDate(days[0]!.date)}` : '';
    body.querySelector('.bd-range')!.textContent = days.length ? `${fmtDate(days[0]!.date)} – ${fmtDate(days.at(-1)!.date)}` : '';
    replay.hidden = days.length < 2;
    if (!cells.length) {
      stage.replaceChildren(Object.assign(document.createElement('p'), { className: 'bd-empty', textContent: 'The board starts with the first day you plan on Today' }));
    } else {
      const S = 10;
      const pts = cells.map((c) => toXY(c.q, c.r).map((v) => v * S) as [number, number]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const pad = S * 2;
      const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
      const svg = svgEl('svg', { class: 'bd-svg', viewBox: `${x0} ${y0} ${x1 - x0} ${y1 - y0}`, role: 'img', 'aria-label': `${days.length} days on the board` });
      // a replay grows it day by day in about three seconds
      const step = animate && !lessMotion() ? Math.min(60, 3000 / Math.max(1, days.length)) : 0;
      for (const [i, c] of cells.entries()) {
        const [x, y] = pts[i]!;
        const day = days[c.day]!;
        svg.append(svgEl('polygon', {
          class: `bd-cell l${c.level}${day.date === today ? ' today' : ''}${step ? ' grow' : ''}`,
          points: hexPoints(x, y, S * 0.93),
          style: `--c:var(--cat-${c.cat})${step ? `;--d:${Math.round(c.day * step)}ms` : ''}`,
          'data-cat': c.cat,
          'data-day': c.day,
        }));
      }
      stage.replaceChildren(svg);
    }
    // the legend: each category's days with time in it and its hours in all
    legend.replaceChildren(...CATEGORY_KEYS.map((cat) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.cat = cat;
      b.style.setProperty('--c', `var(--cat-${cat})`);
      const used = days.filter((d) => d.mins[cat]).length;
      const total = days.reduce((m, d) => m + d.mins[cat], 0);
      b.innerHTML = '<span class="dot"></span><span class="n"></span><span class="meta"></span>';
      b.querySelector('.n')!.textContent = CATEGORIES[cat];
      b.querySelector('.meta')!.textContent = used ? `${used}d · ${formatDuration(total)}` : '–';
      b.addEventListener('click', () => {
        focus = focus === cat ? null : cat;
        paintFocus();
      });
      li.append(b);
      return li;
    }));
    paintFocus();
  }

  // a cell's day and time, near the pointer
  stage.addEventListener('pointerover', (e) => {
    const cell = (e.target as Element).closest<SVGElement>('.bd-cell');
    if (!cell) return;
    const day = days[Number(cell.dataset.day)];
    const cat = cell.dataset.cat as Category;
    if (!day) return;
    const m = day.mins[cat];
    tip.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: fmtDate(day.date) }),
      Object.assign(document.createElement('span'), { className: 'bd-tip-row', textContent: `${CATEGORIES[cat]} · ${m ? formatDuration(m) : 'none'}${m && day.done[cat] ? ` · ${formatDuration(day.done[cat])} done` : ''}` }),
    );
    tip.style.setProperty('--c', `var(--cat-${cat})`);
    const box = stage.parentElement!.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    tip.style.left = `${r.left + r.width / 2 - box.left}px`;
    tip.style.top = `${r.top - box.top}px`;
    tip.hidden = false;
  });
  stage.addEventListener('pointerleave', () => (tip.hidden = true));
  replay.addEventListener('click', () => draw(true));

  // built when the page is opened, and again when the days change while it is open
  async function refresh(animate: boolean): Promise<void> {
    days = await loadDays();
    const sig = JSON.stringify(days);
    if (sig === drawn && !animate) return;
    drawn = sig;
    draw(animate);
  }
  let first = true;
  onView((v) => {
    if (v !== 'board') return;
    void refresh(first);
    first = false;
  });
  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => currentView() === 'board' && void refresh(false), 400);
  };
  onDaySaved(later);
  let blocks = state.blocks;
  subscribe(() => {
    if (state.blocks === blocks) return;
    blocks = state.blocks;
    later();
  });
  if (currentView() === 'board') {
    void refresh(true);
    first = false;
  }
}
