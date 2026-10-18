import './styles/tokens.css';

const byIdEarly = (id: string): HTMLElement => document.getElementById(id)!;
import './styles/app.css';
import { mountBulk } from './timetable/bulk';
import { mountDial } from './timetable/dial';
import { mountEditor } from './timetable/editor';
import { mountOverview } from './timetable/overview';
import { mountSchedule } from './timetable/schedule';
import { clearSelection, closeDraft, deleteDraftBlock, deleteSelected, select, setState, state, toggleDrawer } from './timetable/state';
import { mountDrawers } from './ui/drawers';
import { hydrateIcons } from './ui/icons';
import { mountRouter } from './ui/router';
import { mountViewSwipe } from './ui/view-swipe';
import { mountCalendar } from './calendar/calendar';
import { mountNews } from './news/news';
import { mountBackup } from './storage/backup';
import { mountWinBarLink } from './ui/winbar';
import { mountTemplates } from './timetable/templates-ui';
import { trackHistory } from './timetable/history';
import { mountTodayViews } from './timetable/today-views';
import { mountAccount } from './cloud/account';
import { mountWords } from './words/words';
import { mountJournal } from './journal/journal';
import { mountSettings } from './ui/settings';
import { mountI18n } from './ui/i18n';
import { featureOn, mountFeatures } from './ui/features';
import { mountAttendance } from './calendar/attendance';
import { mountArchive } from './archive/archive';
import { mountPeek } from './timetable/peek';
import { mountWordsPeek } from './words/peek-words';
import { mountJournalPeek } from './journal/peek-journal';
import { mountCalendarPeek } from './calendar/peek-calendar';
import { mountViewing, viewing } from './cloud/viewing';
import { mountNotionAttendance } from './calendar/notion-attendance';

hydrateIcons();
// Korean labels (if picked) go on before the pages render, and follow everything they render later
mountI18n();
mountViewSwipe({ today: byIdEarly('stage'), calendar: byIdEarly('calendar'), news: byIdEarly('news'), words: byIdEarly('words'), journal: byIdEarly('journal'), archive: byIdEarly('archive') });
mountRouter();
mountFeatures();

// labels, icons and links are not draggable content
document.addEventListener('dragstart', (e) => {
  if (!(e.target instanceof Element && e.target.closest('input, textarea, md-editor, [draggable="true"]'))) e.preventDefault();
});

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} not found`);
  return node as T;
};

const search = byId<HTMLInputElement>('search');

const dial = mountDial(document.querySelector<SVGSVGElement>('#dial')!);
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
trackHistory();
mountTodayViews(document.querySelector<HTMLElement>('.dial-wrap')!, byId('stage'), dial);
mountTemplates({ list: byId('tpl-list'), form: byId<HTMLFormElement>('tpl-save'), status: byId('tpl-status') });
mountDrawers(document.querySelector<HTMLElement>('.dial-wrap')!);
mountSettings();
mountWords(byId('words-body'), byId('words-sum'));
mountJournal(byId('journal-body'));
mountArchive(byId('archive-body'), byId('archive-sum'));
// someone else's Haru, read only, on every page
mountViewing();
mountPeek(byId('stage'));
mountWordsPeek(byId('words'));
mountJournalPeek(byId('journal'));
mountCalendarPeek(byId('calendar'));
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
mountAttendance(byId('news'));
mountNotionAttendance();
mountCalendar({
  month: byId('cal-month'),
  year: byId('cal-year'),
  prev: byId('cal-prev'),
  next: byId('cal-next'),
  today: byId('cal-today'),
  stats: byId('cal-stats'),
  filters: byId('cal-filters'),
  week: byId('cal-week'),
  grid: byId('cal-grid'),
  day: byId('cal-day'),
});

document.addEventListener('keydown', (e) => {
  const typing = (e.target as Element).closest('input, select, textarea, md-editor');
  // Esc inside an open time picker or dialog (stats, image) only closes that
  if (e.key === 'Escape' && document.querySelector(':popover-open, dialog[open]')) return;
  if (e.key === 'Escape') {
    // Esc peels one layer at a time: editor / selection first, then the drawers
    if (state.draft) closeDraft();
    else if (state.selected.length) clearSelection();
    else if (state.drawers.left || state.drawers.right) setState({ drawers: { left: false, right: false } });
  }
  // while someone else's Haru is on screen, keys never reach your own tasks
  if (typing || viewing()) return;
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
  if (e.key === '/' && featureOn('search')) {
    e.preventDefault();
    // the search lives in the overview panel: bring it out of the rail first
    toggleDrawer('left', true);
    search.focus({ preventScroll: true });
  }
});

// sign-in and cloud sync start once the local stores exist (memos and images are created by the calendar)
mountAccount({ section: byId('account') });
