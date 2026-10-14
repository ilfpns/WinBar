import { DAY, formatDuration, hhmm, mod, nowMinutes } from './time';
import { CATEGORIES, CATEGORY_KEYS, type Category, contains, labelOf, progressOf, sampleDay } from './model';
import { setState, state, subscribe } from './state';
import { ring } from '../ui/ring';
import type { IconName } from '../ui/icons';

/** Lucide icon for each category (also used by the Now card). */
export const CATEGORY_ICON: Record<Category, IconName> = {
  work: 'briefcase', study: 'book-open', health: 'dumbbell', personal: 'house', sleep: 'moon', etc: 'sparkles',
};

export interface OverviewRefs {
  clock: HTMLElement;
  date: HTMLElement;
  nowCard: HTMLElement;
  dayRings: HTMLElement;
  catRings: HTMLElement;
  search: HTMLInputElement;
  sample: HTMLButtonElement;
  clear: HTMLButtonElement;
}

/** Left drawer: what's on now, and how the day is filled — shown as rings, not numbers. */
export function mountOverview(refs: OverviewRefs): void {
  refs.date.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  refs.search.addEventListener('input', () => setState({ query: refs.search.value }));
  refs.sample.addEventListener('click', () => {
    if (state.blocks.length && !confirm('Replace your day with the sample?')) return;
    setState({ blocks: sampleDay(), draft: null });
  });
  refs.clear.addEventListener('click', () => {
    if (!state.blocks.length || !confirm('Clear every block?')) return;
    setState({ blocks: [], draft: null });
  });

  // each ring is a share of the 24h day
  const day = {
    done: ring('circle-check', 'var(--accent)', 'Done'),
    planned: ring('calendar-clock', 'var(--text)', 'Planned'),
    free: ring('coffee', 'var(--text-muted)', 'Free'),
  };
  refs.dayRings.replaceChildren(day.done.el, day.planned.el, day.free.el);
  const cats = new Map(CATEGORY_KEYS.map((k) => [k, ring(CATEGORY_ICON[k], `var(--cat-${k})`, CATEGORIES[k])] as const));
  refs.catRings.replaceChildren(...[...cats.values()].map((r) => r.el));

  // the "now" card: current task's emoji, its elapsed share as a ring, and its name
  const nowRing = ring('coffee', 'var(--text-muted)');
  const nowText = document.createElement('div');
  nowText.className = 'now-text';
  refs.nowCard.replaceChildren(nowRing.el, nowText);
  let nowIcon: IconName = 'coffee';

  function renderNow(now: number): void {
    const cur = state.blocks.find((b) => contains(b, now));
    const next: IconName = cur ? CATEGORY_ICON[cur.cat] : 'coffee';
    if (next !== nowIcon) {
      nowIcon = next;
      nowRing.setIcon(next);
    }
    nowRing.el.style.setProperty('--rc', cur ? `var(--cat-${cur.cat})` : 'var(--text-muted)');
    const title = document.createElement('div');
    title.className = 'now-title';
    const sub = document.createElement('div');
    sub.className = 'now-sub meta';
    if (cur) {
      const elapsed = mod(now - cur.start);
      nowRing.set(elapsed / cur.dur, `${labelOf(cur)} · ${formatDuration(Math.ceil(cur.dur - elapsed))} left`);
      title.textContent = labelOf(cur);
      sub.textContent = `${formatDuration(Math.ceil(cur.dur - elapsed))} left`;
    } else {
      const next = [...state.blocks].sort((a, b) => mod(a.start - now) - mod(b.start - now))[0];
      nowRing.set(0, 'Free time');
      title.textContent = 'Free time';
      sub.textContent = next ? `next ${hhmm(next.start)}` : '';
    }
    nowText.replaceChildren(title, sub);
  }

  function render(): void {
    const now = nowMinutes();
    refs.clock.textContent = hhmm(now);
    renderNow(now);

    const { done, planned } = progressOf(state.blocks);
    day.done.set(done / DAY, `Done · ${formatDuration(done)}`);
    day.planned.set(planned / DAY, `Planned · ${formatDuration(planned)}`);
    day.free.set((DAY - planned) / DAY, `Free · ${formatDuration(DAY - planned)}`);

    const byCat = new Map<Category, number>();
    for (const b of state.blocks) byCat.set(b.cat, (byCat.get(b.cat) ?? 0) + b.dur);
    for (const [k, r] of cats) {
      const mins = byCat.get(k) ?? 0;
      r.set(mins / DAY, `${CATEGORIES[k]} · ${formatDuration(mins)}`);
    }
  }

  subscribe(render);
  render();
  setInterval(render, 30_000);
}
