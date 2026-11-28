import { contains, labelOf } from '../timetable/model';
import { state } from '../timetable/state';
import { formatDuration, hhmm, mod, nowMinutes } from '../timetable/time';

/**
 * Power saver: Haru left open and not used (no pointer, key, wheel or touch for a while) goes dark — a black
 * screen with the clock and the task going on now — and stops what moves underneath: the dial's dots, the globe,
 * every CSS animation (body.saver). Any input brings it back at once; that first press only wakes it. A hidden tab
 * counts as not used right away (the browser slows it too), and comes back as it was when shown again.
 * Settings → Appearance → Power saver: Off, or after 2, 5 (default) or 15 minutes. Remembered per browser.
 */
export const SAVER_DELAYS = [0, 2, 5, 15] as const;
export type SaverDelay = (typeof SAVER_DELAYS)[number];
const KEY = 'haru:saver';

export function savedSaver(): SaverDelay {
  try {
    const v = Number(localStorage.getItem(KEY) ?? 5);
    return (SAVER_DELAYS as readonly number[]).includes(v) ? (v as SaverDelay) : 5;
  } catch {
    return 5;
  }
}

let delay: SaverDelay = savedSaver();
let on = false;
let lastActive = Date.now();
const listeners = new Set<(on: boolean) => void>();

/** Whether Haru is resting now. */
export const saving = (): boolean => on;
export function onSaver(fn: (on: boolean) => void): void {
  listeners.add(fn);
}

export function setSaver(d: SaverDelay): void {
  delay = d;
  lastActive = Date.now();
  try {
    localStorage.setItem(KEY, String(d));
  } catch {
    // for this visit
  }
}

let veil: HTMLElement | null = null;
let clockTimer = 0;

/** The clock and the task now, on the black screen; again at each new minute. */
function paintVeil(): void {
  if (!veil) return;
  const now = nowMinutes();
  veil.querySelector('.saver-clock')!.textContent = hhmm(Math.floor(now));
  const task = state.blocks.find((b) => !b.done && contains(b, now));
  const line = veil.querySelector<HTMLElement>('.saver-task')!;
  line.hidden = !task;
  if (task) {
    line.querySelector('.saver-name')!.textContent = labelOf(task);
    line.querySelector('.saver-left')!.textContent = `${formatDuration(Math.max(1, Math.round(task.dur - mod(now - task.start))))} left`;
    line.style.setProperty('--c', `var(--cat-${task.cat})`);
  }
  clearTimeout(clockTimer);
  clockTimer = window.setTimeout(paintVeil, (60 - new Date().getSeconds()) * 1000 + 50);
}

function rest(withVeil: boolean): void {
  if (on) return;
  on = true;
  document.body.classList.add('saver');
  if (withVeil && veil) {
    paintVeil();
    veil.hidden = false;
    requestAnimationFrame(() => veil?.classList.add('on'));
  }
  listeners.forEach((fn) => fn(true));
}

function wake(): void {
  lastActive = Date.now();
  if (!on) return;
  on = false;
  clearTimeout(clockTimer);
  document.body.classList.remove('saver');
  if (veil) {
    veil.classList.remove('on');
    veil.hidden = true;
  }
  listeners.forEach((fn) => fn(false));
}

export function mountSaver(): void {
  veil = document.createElement('div');
  veil.className = 'saver-veil';
  veil.hidden = true;
  veil.setAttribute('aria-hidden', 'true');
  veil.innerHTML = '<p class="saver-clock"></p><p class="saver-task"><span class="dot"></span><span class="saver-name"></span><span class="saver-left"></span></p>';
  document.body.append(veil);

  // the press, key or touch that wakes it does only that (nothing underneath gets clicked or typed into)
  const swallow = (e: Event) => {
    if (!on) return;
    e.preventDefault();
    e.stopPropagation();
    wake();
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart']) addEventListener(type, swallow, { capture: true });
  addEventListener('click', (e) => {
    if (e.target === veil) e.stopPropagation();
  }, { capture: true });
  // movement and the wheel wake it and count as use
  const active = () => {
    if (on) wake();
    else lastActive = Date.now();
  };
  for (const type of ['pointermove', 'wheel', 'pointerdown', 'keydown', 'touchstart', 'focusin']) addEventListener(type, active, { capture: true, passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) rest(false);
    else wake();
  });
  // a cheap look every 15 s: long enough without input → rest
  setInterval(() => {
    if (on || !delay || document.hidden) return;
    // not while something is open to answer (a dialog) or being typed into
    if (document.querySelector('dialog[open]') || document.activeElement?.matches('input, textarea, [contenteditable="true"], md-editor')) return;
    if (Date.now() - lastActive >= delay * 60_000) rest(true);
  }, 15_000);
}
