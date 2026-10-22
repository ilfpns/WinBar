import { contains, labelOf, progressOf } from '../timetable/model';
import { state, subscribe } from '../timetable/state';
import { formatDuration, hhmm, mod, nowMinutes } from '../timetable/time';
import { goTo } from './router';

/**
 * The window's title bar, when Haru is installed on a computer (Chrome, Edge) with the title bar given to the
 * page (Window Controls Overlay, manifest display_override): the logo, the pages to switch between at once,
 * and how the day is going (what's on now and its time left, the share of the planned day done, the time).
 * It takes the rail's place; the window's own buttons stay at its right. Anywhere else it isn't there.
 */
interface Overlay extends EventTarget {
  visible: boolean;
}

export function mountTitlebar(): void {
  const overlay = (navigator as Navigator & { windowControlsOverlay?: Overlay }).windowControlsOverlay;
  const progress = document.getElementById('tb-progress')!;
  const clock = document.getElementById('tb-clock')!;
  const on = () => document.body.classList.contains('wco');

  const nowBtn = document.createElement('button');
  nowBtn.type = 'button';
  nowBtn.className = 'tb-now';
  nowBtn.addEventListener('click', () => goTo('today'));
  const day = document.createElement('span');
  day.className = 'tb-day';
  progress.append(nowBtn, day);

  /** A thin bar filled to `p` (0–1) in `color`. */
  const bar = (p: number, color: string) => {
    const b = document.createElement('span');
    b.className = 'tb-bar';
    b.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
    b.style.setProperty('--c', color);
    b.append(document.createElement('i'));
    return b;
  };
  const text = (cls: string, s: string) => Object.assign(document.createElement('span'), { className: cls, textContent: s });

  function render(): void {
    if (!on()) return;
    const now = nowMinutes();
    clock.textContent = hhmm(now);
    // what's on now: its colour, name, how much of it has gone, the time left
    const cur = state.blocks.find((b) => contains(b, now));
    if (cur) {
      const elapsed = mod(now - cur.start);
      const color = `var(--cat-${cur.cat})`;
      nowBtn.replaceChildren(text('tb-name', labelOf(cur)), bar(elapsed / cur.dur, color), text('tb-left', `${formatDuration(Math.ceil(cur.dur - elapsed))} left`));
      nowBtn.style.setProperty('--c', color);
    } else {
      const next = [...state.blocks].sort((a, b) => mod(a.start - now) - mod(b.start - now))[0];
      nowBtn.replaceChildren(text('tb-name', 'Free time'), ...(next ? [text('tb-left', `next ${hhmm(next.start)}`)] : []));
      nowBtn.style.setProperty('--c', 'var(--text-subtle)');
    }
    nowBtn.title = 'Today';
    // the day: how much of what's planned is done
    const { done, planned } = progressOf(state.blocks);
    day.hidden = !planned;
    if (planned) {
      day.replaceChildren(bar(done / planned, 'var(--accent)'), text('tb-pct', `${Math.round((done / planned) * 100)}%`));
      day.title = `Done ${formatDuration(done)} of ${formatDuration(planned)}`;
    }
  }

  const apply = () => {
    document.body.classList.toggle('wco', !!overlay?.visible);
    render();
  };
  // the title bar comes and goes with the window's own toggle (the chevron by its buttons)
  overlay?.addEventListener('geometrychange', apply);
  apply();
  subscribe(render);
  setInterval(render, 30_000);
}
