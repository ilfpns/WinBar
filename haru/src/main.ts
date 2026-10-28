import './ui/motion';
import './styles/tokens.css';

const byIdEarly = (id: string): HTMLElement => document.getElementById(id)!;
import './styles/app.css';
import { mountBulk } from './timetable/bulk';
import { mountDial } from './timetable/dial';
import { mountEditor } from './timetable/editor';
import { mountOverview } from './timetable/overview';
import { mountSchedule } from './timetable/schedule';
import { clearSelection, closeDraft, deleteDraftBlock, deleteSelected, select, setState, state, undo, redo } from './timetable/state';
import { mountDrawers } from './ui/drawers';
import { hydrateIcons } from './ui/icons';
import { currentView, mountRouter } from './ui/router';
import { mountViewSwipe } from './ui/view-swipe';
import { mountCalendar } from './calendar/calendar';
import { mountNews } from './news/news';
import { mountBackup } from './storage/backup';
import { mountWinBarLink } from './ui/winbar';
import { mountTemplates } from './timetable/templates-ui';
import { trackHistory } from './timetable/history';
import { mountSchoolAuto } from './timetable/school-auto';
import { mountTodayViews } from './timetable/today-views';
import { mountReminders } from './timetable/reminders';
import { mountAccount } from './cloud/account';
import { mountActivity } from './cloud/activity';
import { mountWords } from './words/words';
import { mountJournal } from './journal/journal';
import { mountSettings } from './ui/settings';
import { mountGreeting } from './ui/greeting';
import { mountPwa } from './ui/pwa';
import { mountTitlebar } from './ui/titlebar';
import { mountChangelog } from './ui/changelog';
import { mountI18n } from './ui/i18n';
import { mountFeatures } from './ui/features';
import { mountPageOrder } from './ui/page-order';
import { makeSortable } from './ui/page-drag';
import { mountAttendance } from './calendar/attendance';
import { mountArchive } from './archive/archive';
import { mountInsights } from './journal/insights';
import { addSplit } from './ui/splitter';
import { mountPeek } from './timetable/peek';
import { mountProfileCard } from './timetable/profile-card';
import { mountViewing, viewing } from './cloud/viewing';
import { anyPopOpen } from './ui/popover';

hydrateIcons();
// Korean labels (if picked) go on before the pages render, and follow everything they render later
mountI18n();
mountViewSwipe({ today: byIdEarly('stage'), calendar: byIdEarly('calendar'), news: byIdEarly('news'), words: byIdEarly('words'), journal: byIdEarly('journal'), archive: byIdEarly('archive') });
mountRouter();
mountFeatures();
// the pages in your order (the rail's rule splits off the ones that turn by swipe); drag to rearrange
mountPageOrder();
makeSortable(byIdEarly('rail'));
makeSortable(document.querySelector<HTMLElement>('.panel-left .nav')!);

// labels, icons and links are not draggable content
document.addEventListener('dragstart', (e) => {
  if (!(e.target instanceof Element && e.target.closest('input, textarea, md-editor, [draggable="true"]'))) e.preventDefault();
});

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} not found`);
  return node as T;
};

const dial = mountDial(document.querySelector<SVGSVGElement>('#dial')!);
mountEditor(byId<HTMLFormElement>('editor'));
mountOverview({
  clock: byId('clock'),
  date: byId('date'),
  nowCard: byId('now-card'),
  dayRings: byId('day-rings'),
  catRings: byId('cat-rings'),
  clear: byId('clear'),
});
mountSchedule({ list: byId('list'), count: byId('count'), add: byId('new') });
mountBulk(byId('bulk'));
trackHistory();
// the school's lessons and meals, every day by themselves when switched on (Settings → Today)
mountSchoolAuto();
mountTodayViews(document.querySelector<HTMLElement>('.dial-wrap')!, byId('stage'), dial);
mountReminders();
mountGreeting(byId('stage'));
mountTemplates({ list: byId('tpl-list'), form: byId<HTMLFormElement>('tpl-save'), status: byId('tpl-status') });
mountTitlebar();
mountDrawers(document.querySelector<HTMLElement>('.dial-wrap')!);
mountPwa();
mountSettings();
mountChangelog();
mountWords(byId('words-body'), byId('words-sum'));
mountJournal(byId('journal-body'));
mountInsights(byId('journal'));
mountArchive(byId('archive-body'), byId('archive-sum'));
// someone else's Today, read only
mountViewing();
mountPeek(byId('stage'));
mountProfileCard(byId('stage'));
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
mountCalendar({
  month: byId('cal-month'),
  year: byId('cal-year'),
  prev: byId('cal-prev'),
  next: byId('cal-next'),
  today: byId('cal-today'),
  stats: byId('cal-stats'),
  mode: byId('cal-mode'),
  plan: byId('cal-plan'),
  filters: byId('cal-filters'),
  week: byId('cal-week'),
  grid: byId('cal-grid'),
  day: byId('cal-day'),
});

// seams between the panels: drag to give one more room (kept per page; double-click resets)
{
  const side = (host: HTMLElement, key: string, pane: HTMLElement, after: boolean, min: number, keep: number) =>
    addSplit(host, { key, axis: 'x', pane, after, prop: '--side-w', min, max: () => host.getBoundingClientRect().width - keep });
  const jb = byId('journal-body');
  side(jb, 'journal', jb.querySelector<HTMLElement>('.j-side')!, false, 220, 420);
  const ab = byId('archive-body');
  side(ab, 'archive', ab.querySelector<HTMLElement>('.j-side')!, false, 220, 420);
  const wb = byId('words-body');
  side(wb, 'words', wb.lastElementChild as HTMLElement, true, 260, 420);
  const cb = document.querySelector<HTMLElement>('.cal-body')!;
  side(cb, 'calendar', cb.lastElementChild as HTMLElement, true, 220, 480);
  // Journal's Your days: its height (it scrolls inside when made shorter than its contents)
  const jv = byId('journal');
  const card = jv.querySelector<HTMLElement>('.insights')!;
  // only while it is opened: closed, it is just its numbers
  addSplit(jv, { key: 'journal-top', axis: 'y', pane: card, target: card, prop: '--top-h', min: 120, max: () => card.scrollHeight, enabled: () => card.classList.contains('open') });
}

/** Says so, briefly, when Ctrl+Z (or its redo) has nothing to take back. */
function flashNothing(again: boolean): void {
  let t = document.querySelector<HTMLElement>('.undo-tip');
  if (!t) {
    t = document.createElement('div');
    t.className = 'undo-tip';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = again ? 'Nothing to redo' : 'Nothing to undo';
  t.classList.remove('on');
  void t.offsetWidth;
  t.classList.add('on');
}

document.addEventListener('keydown', (e) => {
  const typing = (e.target as Element).closest('input, select, textarea, md-editor');
  // Esc inside an open time picker or dialog (stats, image) only closes that
  if (e.key === 'Escape' && (anyPopOpen() || document.querySelector('dialog[open]'))) return;
  if (e.key === 'Escape') {
    // Esc peels one layer at a time: editor / selection first, then the drawers
    if (state.draft) closeDraft();
    else if (state.selected.length) clearSelection();
    else if (state.drawers.left || state.drawers.right) setState({ drawers: { left: false, right: false } });
  }
  // Ctrl+Z right after a slip on the dial: a drag that opened a new task (its fields still empty — the title
  // field has the focus by then) closes it; a drag that picked tasks lets them go. Only then does Ctrl+Z take back
  // changes to the tasks (below).
  const undoKey = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z';
  if (undoKey && !viewing() && currentView() === 'today') {
    const d = state.draft;
    const untouched = d && d.id === null && !d.title.trim() && !(d.note ?? '').trim();
    if (untouched && (!typing || (e.target as Element).closest('.drawer-right'))) {
      e.preventDefault();
      closeDraft();
      return;
    }
    if (!typing && state.selected.length) {
      e.preventDefault();
      clearSelection();
      return;
    }
  }
  // while someone else's Haru is on screen, keys never reach your own tasks; and Today's keys (select all,
  // delete) belong to Today only: elsewhere Ctrl+A, Delete and the rest keep their usual meaning
  if (typing || viewing() || currentView() !== 'today') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    select(state.blocks.map((b) => b.id));
    return;
  }
  // Ctrl+Z takes back the last change to the tasks; Ctrl+Shift+Z (or Ctrl+Y) brings it back
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    const again = e.key.toLowerCase() === 'y' || e.shiftKey;
    if (!(again ? redo() : undo())) flashNothing(again);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const n = state.selected.length;
    if (n) deleteSelected();
    else if (state.draft?.id) deleteDraftBlock();
  }
});

// sign-in and cloud sync start once the local stores exist (memos and images are created by the calendar)
mountAccount({ section: byId('account') });
mountActivity();
