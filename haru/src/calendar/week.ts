import { sectorPath } from '../timetable/geometry';
import { type Block, progressOf } from '../timetable/model';
import { centeredText, svgEl } from '../timetable/svg';
import { DAY, formatDuration } from '../timetable/time';
import { state } from '../timetable/state';
import { dayOf, timetableOn } from '../timetable/history';
import { planOn } from '../timetable/plans';
import { type IconName, icon } from '../ui/icons';
import { asPopover, hidePop, isPopOpen, showPop } from '../ui/popover';

/**
 * Calendar → Week: the seven days of a week side by side, each as a small dial — what a past day kept, Today
 * live, and the days ahead as planned (Plans). A day ahead is planned from the day panel or, for the whole
 * week at once, from the header.
 */
/** Ring of the small dial, in its 120-unit box. */
const R_IN = 32;
const R_OUT = 58;

export type DayKind = 'past' | 'carried' | 'today' | 'plan' | 'none';
export interface WeekDay { date: string; kind: DayKind; blocks: Block[]; from: string }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The Sunday a week starts on (weeks run Sunday first, as the month grid does). */
export const weekStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
export const weekDates = (start: Date): string[] =>
  Array.from({ length: 7 }, (_, i) => iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
/** Whether `date` is still ahead of the day Today is on (only those can be planned). */
export const isAhead = (date: string): boolean => date > dayOf();

/** What a day shows: a past day as it was kept, Today live, a day ahead as planned. */
export async function loadDay(date: string): Promise<WeekDay> {
  const today = dayOf();
  if (date === today) return { date, kind: 'today', blocks: state.blocks, from: '' };
  if (date > today) {
    const p = planOn(date);
    return p
      ? { date, kind: 'plan', blocks: p.blocks.map((b, i) => ({ ...b, id: `plan-${i}`, done: false })), from: p.from }
      : { date, kind: 'none', blocks: [], from: '' };
  }
  const found = await timetableOn(date);
  if (!found?.snap.blocks.length) return { date, kind: 'none', blocks: [], from: '' };
  return { date, kind: found.carried ? 'carried' : 'past', blocks: found.snap.blocks, from: found.carried ? found.snap.date : '' };
}

/** A small dial of the day: the day's tasks around 24 h (done ones solid), the done share or planned hours inside. */
export function miniDial(day: WeekDay): SVGSVGElement {
  const svg = svgEl('svg', { class: 'wk-dial', viewBox: '-60 -60 120 120', 'aria-hidden': 'true' }) as SVGSVGElement;
  svg.append(svgEl('path', { class: 'wk-bg', d: sectorPath(0, DAY, R_IN, R_OUT) }));
  for (const [i, b] of [...day.blocks].sort((x, y) => x.start - y.start).entries()) {
    const slice = svgEl('path', { class: `wk-slice${b.done ? ' done' : ''}`, d: sectorPath(b.start, Math.max(b.dur, 2), R_IN, R_OUT), style: `--c:var(--cat-${b.cat});--i:${i}` });
    svg.append(slice);
  }
  const { done, planned } = progressOf(day.blocks);
  const text = !day.blocks.length ? '' : day.kind === 'plan' ? formatDuration(planned) : `${Math.round((done / DAY) * 100)}%`;
  if (text) svg.append(centeredText('wk-pct', 0, 1, text, `font-size:${text.length > 4 ? 15 : 19}px`));
  return svg;
}

/** One line under the dial. */
export function dayLine(day: WeekDay): string {
  const { done, planned } = progressOf(day.blocks);
  // the dashed slices already say "planned": the line names where the plan came from
  if (day.kind === 'plan') return day.from || 'Planned';
  if (day.kind === 'none') return isAhead(day.date) ? 'Not planned yet' : '';
  if (!day.blocks.length) return '';
  return `${formatDuration(done)} of ${formatDuration(planned)}`;
}

// ---------- the plan menu: one picker shared by the day panel and the week header

export interface MenuItem { label: string; icon: IconName; run: () => void; danger?: boolean; disabled?: boolean }

const menu = document.createElement('div');
menu.className = 'plan-pop';
menu.setAttribute('role', 'menu');
asPopover(menu);
document.body.append(menu);

/** Opens the plan menu under `from` (a second press on the same button closes it). */
export function openPlanMenu(from: HTMLElement, head: string, items: MenuItem[], empty = ''): void {
  if (isPopOpen(menu)) {
    hidePop(menu);
    return;
  }
  const title = document.createElement('p');
  title.className = 'meta plan-pop-head';
  title.textContent = head;
  const rows = items.map((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = it.danger ? 'danger' : '';
    b.disabled = !!it.disabled;
    const label = document.createElement('span');
    label.textContent = it.label;
    b.append(icon(it.icon), label);
    b.addEventListener('click', () => {
      hidePop(menu);
      it.run();
    });
    return b;
  });
  const parts: HTMLElement[] = [title, ...rows];
  if (empty) {
    const hint = document.createElement('p');
    hint.className = 'meta plan-pop-hint';
    hint.textContent = empty;
    parts.splice(1, 0, hint);
  }
  menu.replaceChildren(...parts);
  if (!showPop(menu, from)) return;
  const r = from.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  menu.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
