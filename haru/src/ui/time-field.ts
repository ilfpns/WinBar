import { DAY, hhmm, minutesOf, mod, nowMinutes } from '../timetable/time';
import { asPopover, hidePop, nativePopover, showPop } from './popover';

/** The wheel's minutes go by this much; a typed time can be any minute. */
const STEP = 5;
/** One row of a wheel, in px (the CSS's --wheel-row). */
const ROW = 34;

export interface TimeField {
  /** Shows `m` (minute of day) without firing onChange. */
  set(m: number): void;
}

interface Owner {
  input: HTMLInputElement;
  value: number;
  pick: (m: number) => void;
}

/**
 * One popover shared by every time field: an hour wheel and a minute wheel (5-minute steps) that scroll and snap,
 * plus Now. The field itself stays where the typing goes — focus never leaves it while the wheels turn — and the
 * popover lives in the top layer (manual, so pressing the field doesn't toggle it away).
 */
class WheelPopover {
  readonly el = document.createElement('div');
  private hours: HTMLElement;
  private mins: HTMLElement;
  private owner: Owner | null = null;
  /** Wheels being moved by code (opening, typing): their scroll doesn't pick a time. */
  private quiet = new Set<HTMLElement>();

  constructor() {
    this.el.className = 'time-pop wheel-pop';
    asPopover(this.el);
    // the field it belongs to is outside it: a press there must not close it (that's what "auto" would do)
    if (nativePopover) this.el.popover = 'manual';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Pick a time');
    this.hours = this.wheel('Hours', 24, 1, (n) => String(n).padStart(2, '0'));
    this.mins = this.wheel('Minutes', 60 / STEP, STEP, (n) => String(n).padStart(2, '0'));
    const wheels = document.createElement('div');
    wheels.className = 'wheels';
    const colon = Object.assign(document.createElement('span'), { className: 'wheel-colon', textContent: ':' });
    wheels.append(this.hours, colon, this.mins);
    const now = document.createElement('button');
    now.type = 'button';
    now.className = 'wheel-now';
    now.textContent = 'Now';
    now.addEventListener('click', () => {
      const m = mod(Math.round(nowMinutes() / STEP) * STEP);
      this.commit(m);
      this.sync(true);
    });
    this.el.append(wheels, now);
    // presses inside never take the focus from the field (the typing goes on there)
    this.el.addEventListener('pointerdown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  private wheel(label: string, count: number, step: number, text: (n: number) => string): HTMLElement {
    const box = document.createElement('div');
    box.className = 'wheel';
    box.setAttribute('aria-label', label);
    for (let i = 0; i < count; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.i = String(i);
      b.textContent = text(i * step);
      b.addEventListener('click', () => box.scrollTo({ top: i * ROW, behavior: 'smooth' }));
      box.append(b);
    }
    let settle = 0;
    box.addEventListener('scroll', () => {
      this.paint(box);
      clearTimeout(settle);
      settle = window.setTimeout(() => this.settle(box), 110);
    }, { passive: true });
    return box;
  }

  private index(box: HTMLElement): number {
    return Math.max(0, Math.min(box.children.length - 1, Math.round(box.scrollTop / ROW)));
  }

  /** The row in the middle stands out. */
  private paint(box: HTMLElement): void {
    const at = this.index(box);
    for (const b of box.children) (b as HTMLElement).classList.toggle('on', Number((b as HTMLElement).dataset.i) === at);
  }

  /** A wheel came to rest: its row is the new hour or minute (the other part of the time stays). */
  private settle(box: HTMLElement): void {
    if (this.quiet.delete(box) || !this.owner) return;
    const i = this.index(box);
    const v = this.owner.value;
    const m = box === this.hours ? i * 60 + (v % 60) : Math.floor(v / 60) * 60 + i * STEP;
    if (m !== v) this.commit(m);
  }

  private commit(m: number): void {
    if (!this.owner) return;
    this.owner.value = m;
    this.owner.input.value = hhmm(m);
    this.owner.pick(m);
    // the field was drawn again meanwhile (a list redrawn by that very change): nothing left to turn
    if (this.owner && !this.owner.input.isConnected) this.close();
  }

  /** Turns both wheels to the owner's time (a minute between steps shows the nearest step). */
  sync(smooth = false): void {
    if (!this.owner) return;
    const v = this.owner.value;
    const at: [HTMLElement, number][] = [[this.hours, Math.floor(v / 60)], [this.mins, Math.round((v % 60) / STEP) % (60 / STEP)]];
    for (const [box, i] of at) {
      if (Math.abs(box.scrollTop - i * ROW) < 1) {
        this.paint(box);
        continue;
      }
      this.quiet.add(box);
      box.scrollTo({ top: i * ROW, behavior: smooth ? 'smooth' : 'instant' });
      this.paint(box);
    }
  }

  open(owner: Owner): void {
    this.owner = owner;
    if (!showPop(this.el, owner.input)) return;
    const r = owner.input.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const top = r.bottom + 6 + h > innerHeight - 8 ? r.top - 6 - h : r.bottom + 6;
    this.el.style.left = `${Math.min(Math.max(8, r.left), innerWidth - w - 8)}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
    this.sync();
    owner.input.setAttribute('aria-expanded', 'true');
  }

  close(): void {
    this.owner?.input.setAttribute('aria-expanded', 'false');
    this.owner = null;
    this.quiet.clear();
    hidePop(this.el);
  }

  isFor(input: HTMLInputElement): boolean {
    return this.owner?.input === input;
  }
}

let shared: WheelPopover | null = null;

/**
 * Turns an `<input>` into a 24h time field: type it (9, 930, 9:30, 21:05), turn the wheels that open under it, or
 * nudge it with ↑ ↓ (5 minutes, Shift: an hour). Enter, Tab or leaving the field takes what was typed; something
 * that isn't a time goes back to the last one. `onChange` hears every new time as it is turned (`live`, the editor:
 * the dial follows), or only once the field is left (`live: false`, forms that read the field on save) — then the
 * field also sends a `change` event, as if typed.
 */
export function timeField(input: HTMLInputElement, onChange: (m: number) => void = () => {}, { live = true } = {}): TimeField {
  shared ??= new WheelPopover();
  const pop = shared;
  const owner: Owner = { input, value: 0, pick: (m) => (live ? change(m) : (owner.value = m)) };
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 5;
  input.classList.add('time-input');
  input.setAttribute('aria-haspopup', 'dialog');
  input.setAttribute('aria-expanded', 'false');

  let committed = minutesOf(input.value) ?? 0;
  const change = (m: number) => {
    owner.value = m;
    if (m === committed) return;
    committed = m;
    onChange(m);
    if (!live) input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const show = (m: number) => {
    owner.value = committed = m;
    if (document.activeElement !== input) input.value = hhmm(m);
    if (pop.isFor(input)) pop.sync();
  };
  /** Takes what was typed; false (and back to the last time) when it isn't one. */
  const take = (): boolean => {
    const m = minutesOf(input.value);
    if (m === null) {
      input.value = hhmm(committed);
      input.classList.remove('bad');
      void input.offsetWidth;
      input.classList.add('bad');
      return false;
    }
    input.value = hhmm(m);
    change(m);
    return true;
  };
  // a form that sets the field itself (input.value = …) counts as its time
  const known = () => {
    const m = minutesOf(input.value);
    if (m !== null && document.activeElement !== input) committed = owner.value = m;
  };

  const open = () => {
    if (input.disabled || pop.isFor(input)) return;
    owner.value = committed;
    pop.open(owner);
  };
  input.addEventListener('pointerdown', known);
  input.addEventListener('focus', () => {
    known();
    input.select();
    open();
  });
  // a press on the field after Esc brings the wheels back
  input.addEventListener('pointerup', open);
  input.addEventListener('blur', () => {
    take();
    if (pop.isFor(input)) pop.close();
  });
  // as it's typed, the wheels follow (the time itself changes on Enter / leaving)
  input.addEventListener('input', () => {
    input.classList.remove('bad');
    const t = input.value.trim();
    const m = minutesOf(t);
    if (m === null || (t.length < 3 && !t.includes(':'))) return;
    owner.value = m;
    if (pop.isFor(input)) pop.sync(true);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // the time first, then whatever Enter does around it (the editor saves, a form submits)
      take();
      pop.close();
    } else if (e.key === 'Escape' && pop.isFor(input)) {
      e.preventDefault();
      e.stopPropagation();
      input.value = hhmm(committed);
      pop.close();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const by = e.shiftKey ? 60 : STEP;
      const base = minutesOf(input.value) ?? committed;
      // off the grid (a typed 9:17): the first step lands on it
      const m = mod(e.key === 'ArrowUp' ? Math.floor(base / by) * by + by : Math.ceil(base / by) * by - by) % DAY;
      input.value = hhmm(m);
      if (live) change(m);
      else owner.value = m;
      if (pop.isFor(input)) pop.sync(true);
      input.select();
    }
  });

  return { set: show };
}
