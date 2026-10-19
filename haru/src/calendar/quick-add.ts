import { DAY, hhmm, mod } from '../timetable/time';
import { type Category, type Draft, CATEGORIES } from '../timetable/model';

/** Category words accepted in a memo line, English or Korean. */
const ALIASES: Record<string, Category> = {
  work: 'work', 업무: 'work', 일: 'work',
  study: 'study', 공부: 'study',
  school: 'school', 학교: 'school', 수업: 'school',
  meeting: 'meeting', 회의: 'meeting', 미팅: 'meeting',
  meal: 'meal', 식사: 'meal', 밥: 'meal',
  health: 'health', 운동: 'health',
  personal: 'personal', 개인: 'personal',
  sleep: 'sleep', 수면: 'sleep', 잠: 'sleep',
  other: 'etc', etc: 'etc', 기타: 'etc',
};

/** Gray hint inside the empty memo: the one piece of syntax worth knowing. */
// short lines broken where the meaning breaks, so the hint never wraps mid-phrase in the panel
const names = Object.values(CATEGORIES).map((c) => c.toLowerCase());
export const QUICK_ADD_HINT = [
  '! 12:00~12:30 work Title',
  '  → moves to Today',
  '',
  'categories',
  `  ${names.slice(0, 3).join(' · ')}`,
  `  ${names.slice(3).join(' · ')}`,
].join('\n');

/**
 * Parses a memo line like `! 12:00~12:12 work 개발하기` into a new task.
 * Returns null if the line isn't a `!` line; an error string if it is but can't be read.
 */
export function parseQuickAdd(line: string, fallback: Category): Draft | string | null {
  const text = line.trim();
  if (!text.startsWith('!')) return null;
  const m = text.match(/^!\s*(\d{1,2}):?(\d{2})\s*[~\-–]\s*(\d{1,2}):?(\d{2})\s*(.*)$/);
  if (!m) return 'Write it as  ! 12:00~12:30 category title';
  const [, h1, m1, h2, m2, rest = ''] = m;
  const start = Number(h1) * 60 + Number(m1);
  const end = Number(h2) * 60 + Number(m2);
  if (Number(h1) > 24 || Number(h2) > 24 || Number(m1) > 59 || Number(m2) > 59) return 'Check the times';
  const dur = mod(end - start);
  if (!dur || dur >= DAY) return 'Start and end are the same';
  const [first = '', ...words] = rest.trim().split(/\s+/);
  const cat = ALIASES[first.toLowerCase()];
  const title = (cat ? words.join(' ') : rest).trim();
  return { id: null, title, cat: cat ?? fallback, start: mod(start), dur, done: false };
}

export const describe = (d: Draft) => `${hhmm(d.start)}–${hhmm(d.start + d.dur)}`;
