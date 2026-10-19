import {
  ArrowRight, BookOpen, Briefcase, Calendar, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleCheck, CircleDot, Clock, Coffee, Dumbbell, House, Moon, Newspaper, Plus, Search, Sparkles, X, ImagePlus, Image, Flame, ChartColumn, LogOut, ChartPie, Target, TrendingUp, TrendingDown,
  Languages, NotebookPen, Settings, RotateCcw, Shuffle, Volume2, FileDown, Sun, Monitor, PanelLeft,
  Palette, HardDrive, Eraser, Keyboard, Info, User, ChevronUp, Ellipsis, Pencil, Trash2, Share2, Archive, Users, Eye, GraduationCap, Utensils,
  type IconNode, createElement,
} from 'lucide';

/** Every UI icon comes from Lucide; one size and stroke across the app. */
const ICONS: Record<string, IconNode> = {
  'arrow-right': ArrowRight, 'book-open': BookOpen, briefcase: Briefcase, calendar: Calendar,
  'calendar-clock': CalendarClock, check: Check, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight, 'circle-check': CircleCheck, 'circle-dot': CircleDot, clock: Clock,
  coffee: Coffee, dumbbell: Dumbbell, house: House, moon: Moon, newspaper: Newspaper, plus: Plus,
  search: Search, sparkles: Sparkles, x: X, 'image-plus': ImagePlus, image: Image, flame: Flame, 'chart-column': ChartColumn, 'log-out': LogOut, 'chart-pie': ChartPie, target: Target, 'trending-up': TrendingUp, 'trending-down': TrendingDown,
  languages: Languages, 'notebook-pen': NotebookPen, settings: Settings, 'rotate-ccw': RotateCcw, shuffle: Shuffle, 'volume-2': Volume2, 'file-down': FileDown, sun: Sun, monitor: Monitor, 'panel-left': PanelLeft,
  palette: Palette, 'hard-drive': HardDrive, eraser: Eraser, keyboard: Keyboard, info: Info, user: User, 'chevron-up': ChevronUp, ellipsis: Ellipsis, pencil: Pencil, trash: Trash2,
  share: Share2, archive: Archive, users: Users, eye: Eye, 'graduation-cap': GraduationCap, utensils: Utensils,
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = 'ic'): SVGElement {
  const el = createElement(ICONS[name]!, { class: cls, width: 16, height: 16, 'stroke-width': 1.75, 'aria-hidden': 'true' });
  // normalised length lets CSS "draw" every stroke on hover regardless of its real length
  el.querySelectorAll('*').forEach((part, n) => {
    part.setAttribute('pathLength', '1');
    (part as SVGElement).style.setProperty('--n', String(n));
  });
  return el;
}

/** Replaces `<i data-icon="name">` placeholders in static markup. */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('i[data-icon]').forEach((slot) => {
    slot.replaceWith(icon(slot.dataset.icon as IconName, `ic ${slot.className}`.trim()));
  });
}
