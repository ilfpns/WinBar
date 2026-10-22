import { SNAP, hhmm, mod, nowMinutes } from '../timetable/time';
import { icon } from './icons';
import { asPopover, hidePop, onPopToggle, showPop } from './popover';

const MINUTES = [0, 15, 30, 45];

export interface TimeField {
  /** Shows `m` (minute of day) without firing onChange. */
  set(m: number): void;
}

/**
 * One popover shared by every time field: a 6×4 hour grid plus a quarter-hour row.
 * Lives in the top layer (popover API) so the scrolling panel never clips it.
 */
class TimePopover {
  readonly el = document.createElement('div');
  private hours = document.createElement('div');
  private mins = document.createElement('div');
  private owner: { trigger: HTMLButtonElement; value: number; pick: (m: number) => void } | null = null;

  constructor() {
    this.el.className = 'time-pop';
    asPopover(this.el);
    this.el.setAttribute('role', 'dialog');
    this.hours.className = 'time-hours';
    this.mins.className = 'time-mins';
    for (let h = 0; h < 24; h++) this.hours.append(this.cell(String(h).padStart(2, '0'), 'h', h));
    for (const m of MINUTES) this.mins.append(this.cell(`:${String(m).padStart(2, '0')}`, 'm', m));
    const label = (text: string) => Object.assign(document.createElement('div'), { className: 'meta time-label', textContent: text });
    this.el.append(label('Hour'), this.hours, label('Minute'), this.mins);
    document.body.append(this.el);

    this.el.addEventListener('click', (e) => {
      const cell = (e.target as Element).closest<HTMLButtonElement>('button[data-kind]');
      if (!cell || !this.owner) return;
      const n = Number(cell.dataset.n);
      const v = this.owner.value;
      if (cell.dataset.kind === 'h') {
        // picking the hour keeps the popover open for the minutes
        this.commit(n * 60 + (v % 60));
      } else {
        this.commit(Math.floor(v / 60) * 60 + n);
        hidePop(this.el);
      }
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') hidePop(this.el);
    });
    onPopToggle(this.el, (open) => {
      this.owner?.trigger.setAttribute('aria-expanded', String(open));
      if (!open) {
        this.owner?.trigger.focus();
        this.owner = null;
      }
    });
  }

  private cell(text: string, kind: 'h' | 'm', n: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.dataset.kind = kind;
    b.dataset.n = String(n);
    return b;
  }

  private commit(m: number): void {
    if (!this.owner) return;
    this.owner.value = m;
    this.owner.pick(m);
    this.mark();
  }

  private mark(): void {
    const v = this.owner?.value ?? 0;
    const nowHour = Math.floor(nowMinutes() / 60);
    this.hours.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const h = Number(b.dataset.n);
      b.setAttribute('aria-pressed', String(h === Math.floor(v / 60)));
      b.classList.toggle('now', h === nowHour);
    });
    this.mins.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === v % 60)));
  }

  open(trigger: HTMLButtonElement, value: number, pick: (m: number) => void): void {
    this.owner = { trigger, value, pick };
    this.mark();
    // a modal dialog makes everything outside it inert, so a picker opened from one has to live inside it
    if (!showPop(this.el, trigger)) {
      // that press closed it
      this.owner = null;
      return;
    }
    // place under the trigger, flipping above / nudging inward near the viewport edges
    const r = trigger.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    const top = r.bottom + 6 + h > innerHeight - 8 ? r.top - 6 - h : r.bottom + 6;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
    this.el.querySelector<HTMLButtonElement>('.time-hours [aria-pressed="true"]')?.focus();
  }

  isOpenFor(trigger: HTMLButtonElement): boolean {
    return this.owner?.trigger === trigger;
  }
}

let shared: TimePopover | null = null;

/** Turns a `<button class="time-field">` into a 24h, 15-minute time picker. */
export function timeField(trigger: HTMLButtonElement, onChange: (m: number) => void): TimeField {
  shared ??= new TimePopover();
  const pop = shared;
  let value = 0;
  const text = document.createElement('span');
  text.className = 'time-text';
  trigger.replaceChildren(text, icon('chevron-down'));
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');

  const show = (m: number) => {
    value = m;
    text.textContent = hhmm(m);
  };
  const change = (m: number) => {
    show(m);
    onChange(m);
  };

  trigger.addEventListener('click', () => {
    if (pop.isOpenFor(trigger)) hidePop(pop.el);
    else pop.open(trigger, value, change);
  });
  // arrow keys nudge by a quarter hour without opening the popover
  trigger.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    change(mod(value + (e.key === 'ArrowUp' ? SNAP : -SNAP)));
  });

  return { set: show };
}
