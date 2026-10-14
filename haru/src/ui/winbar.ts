import { DAY } from '../timetable/time';
import { progressOf } from '../timetable/model';
import { state, subscribe } from '../timetable/state';

const LINK_KEY = 'haru:winbar';

/**
 * WinBar (Windows menu bar) opens Haru with ?winbar=1. From then on, whenever the done share of
 * the day changes during a user action, Haru calls winbar://progress?v=..&d=.. so the menu-bar
 * emblem fills to match. Browsers only launch app links from a user gesture, which every change
 * here is (checking a task, saving, a batch edit).
 */
export function mountWinBarLink(): void {
  const params = new URLSearchParams(location.search);
  try {
    if (params.get('winbar') === '1') {
      localStorage.setItem(LINK_KEY, '1');
      params.delete('winbar');
      const query = params.toString();
      history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
    }
    if (localStorage.getItem(LINK_KEY) !== '1') return;
  } catch {
    return;
  }

  const value = () => Math.round((progressOf(state.blocks).done / DAY) * 1000) / 1000;
  let sent = value();

  subscribe(() => {
    const v = value();
    if (v === sent || !navigator.userActivation?.isActive) return;
    sent = v;
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    location.href = `winbar://progress?v=${v}&d=${day}`;
  });
}
