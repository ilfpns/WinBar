import './styles/tokens.css';

const byIdEarly = (id: string): HTMLElement => document.getElementById(id)!;
import './styles/app.css';
import { mountBulk } from './timetable/bulk';
import { mountDial } from './timetable/dial';
import { mountEditor } from './timetable/editor';
import { mountOverview } from './timetable/overview';
import { mountSchedule } from './timetable/schedule';
import { clearSelection, closeDraft, deleteDraftBlock, deleteSelected, select, setState, state } from './timetable/state';
import { mountDrawers } from './ui/drawers';
import { hydrateIcons } from './ui/icons';
import { mountRouter } from './ui/router';
import { mountViewSwipe } from './ui/view-swipe';
import { mountCalendar } from './calendar/calendar';
import { mountNews } from './news/news';
import { mountBackup } from './storage/backup';
import { mountWinBarLink } from './ui/winbar';
import { mountTemplates } from './timetable/templates-ui';

hydrateIcons();
mountViewSwipe({ today: byIdEarly('stage'), calendar: byIdEarly('calendar'), news: byIdEarly('news') });
mountRouter();

// labels, icons and links are not draggable content
document.addEventListener('dragstart', (e) => {
  if (!(e.target instanceof Element && e.target.closest('input, textarea'))) e.preventDefault();
});

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} not found`);
  return node as T;
};

const search = byId<HTMLInputElement>('search');

mountDial(document.querySelector<SVGSVGElement>('#dial')!);
mountEditor(byId<HTMLFormElement>('editor'));
mountOverview({
  clock: byId('clock'),
  date: byId('date'),
  nowCard: byId('now-card'),
  dayRings: byId('day-rings'),
  catRings: byId('cat-rings'),
  search,
  clear: byId('clear'),
});
mountSchedule({ list: byId('list'), count: byId('count'), add: byId('new') });
mountBulk(byId('bulk'));
mountTemplates({ list: byId('tpl-list'), form: byId<HTMLFormElement>('tpl-save'), status: byId('tpl-status') });
mountDrawers(document.querySelector<HTMLElement>('.dial-wrap')!);
mountWinBarLink();
mountBackup({
  status: byId('backup-status'),
  auto: byId('backup-auto'),
  exportBtn: byId('backup-export'),
  importBtn: byId('backup-import'),
  file: byId('backup-file'),
});
mountNews({
  canvas: byId<HTMLCanvasElement>('globe'),
  readout: byId('globe-readout'),
  updated: byId('news-updated'),
  live: byId('news-live'),
  scope: byId('news-scope'),
  week: byId('news-week'),
  topics: byId('news-topics'),
  list: byId('news-list'),
});
mountCalendar({
  month: byId('cal-month'),
  year: byId('cal-year'),
  prev: byId('cal-prev'),
  next: byId('cal-next'),
  today: byId('cal-today'),
  filters: byId('cal-filters'),
  week: byId('cal-week'),
  grid: byId('cal-grid'),
  day: byId('cal-day'),
});

document.addEventListener('keydown', (e) => {
  const typing = (e.target as Element).closest('input, select, textarea');
  // Esc inside an open time picker only closes the picker
  if (e.key === 'Escape' && document.querySelector(':popover-open')) return;
  if (e.key === 'Escape') {
    // Esc peels one layer at a time: editor / selection first, then the drawers
    if (state.draft) closeDraft();
    else if (state.selected.length) clearSelection();
    else if (state.drawers.left || state.drawers.right) setState({ drawers: { left: false, right: false } });
  }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    select(state.blocks.map((b) => b.id));
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const n = state.selected.length;
    if (n) deleteSelected();
    else if (state.draft?.id) deleteDraftBlock();
  }
  if (e.key === '/') {
    e.preventDefault();
    search.focus();
  }
});
