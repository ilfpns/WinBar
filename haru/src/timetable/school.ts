import { session } from '../cloud/session';
import { dayKey } from './history';
import { type Block, newId, overlaps } from './model';
import { automatically, setState, state } from './state';

/**
 * The school timetable: pick your school and class in Settings → Today, and Apply lays today's lessons onto
 * Today as School tasks at their periods' hours — one task per subject run (the same subject in a row is one
 * task). Tasks in their way are replaced; everything else on Today stays.
 * Where the lessons come from:
 *  - 컴시간알리미, for the school published by scripts/fetch-school-timetable.mjs (data/school-timetable.json):
 *    lessons and the school's own period start times;
 *  - NEIS (open.neis.go.kr, readable from the browser) for any other school: schools, classes and the day's
 *    lessons; NEIS has no bell times, so periods follow a usual day for the school's level.
 */
interface Lesson { period: number; subject: string }
interface Week { start: string; periods: string[]; classes: Record<string, Record<string, Lesson[]>> }
interface Timetable { school: string; weeks: Week[] }

/** A school as NEIS knows it. */
export interface School {
  name: string;
  /** 시도교육청 code and school code (NEIS). */
  office: string;
  code: string;
  /** 초등학교 / 중학교 / 고등학교 … */
  kind: string;
  region: string;
}

/** The school Haru starts with (the one 컴시간알리미 data is published for). */
export const DEFAULT_SCHOOL: School = { name: '대덕소프트웨어마이스터고등학교', office: 'G10', code: '7430310', kind: '고등학교', region: '대전광역시' };

const SCHOOL_KEY = 'haru:school';
const CLASS_KEY = 'haru:school-class';
const NEIS = 'https://open.neis.go.kr/hub';

let comci: Timetable | null = null;
let loading: Promise<Timetable | null> | null = null;

/** The published 컴시간알리미 timetable (read once). */
export function comciTimetable(): Promise<Timetable | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/school-timetable.json?t=${Math.floor(Date.now() / 3_600_000)}`)
    .then((r) => (r.ok ? (r.json() as Promise<Timetable>) : null))
    .then((t) => (comci = t))
    .catch(() => null);
  return loading;
}

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // for this visit
  }
};

export const mySchool = (): School => read(SCHOOL_KEY, DEFAULT_SCHOOL);
export function setMySchool(s: School): void {
  write(SCHOOL_KEY, s);
  write(CLASS_KEY, '');
}
export function myClass(): string {
  try {
    const raw = localStorage.getItem(CLASS_KEY) ?? '';
    // (stored plain before schools could be picked)
    return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
  } catch {
    return '';
  }
}
export const setMyClass = (cls: string): void => write(CLASS_KEY, cls);

/** Is this the school the 컴시간알리미 data covers? */
export const isComci = (s: School) => !!comci && comci.school === s.name;

/**
 * The NEIS key, if the owners stored one (Firestore `config/neis`, readable by invited accounts only — never in
 * the site's code). Without it NEIS answers only its first 5 rows, whatever page is asked for.
 */
let neisKey: Promise<string> | null = null;
function keyOfNeis(): Promise<string> {
  const s = session();
  if (!s) return Promise.resolve('');
  neisKey ??= s.fb.fs.getDoc(s.fb.fs.doc(s.fb.db, 'config', 'neis'))
    .then((snap) => String((snap.data() as { key?: string } | undefined)?.key ?? ''))
    .catch(() => '');
  return neisKey;
}
/** NEIS can't give every row right now (no key): at most this many. */
export const NEIS_KEYLESS_ROWS = 5;
export const hasNeisKey = async (): Promise<boolean> => !!(await keyOfNeis());

async function neis<T>(service: string, params: Record<string, string>, maxRows = 100): Promise<T[]> {
  const key = await keyOfNeis();
  const q = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: String(key ? maxRows : NEIS_KEYLESS_ROWS), ...(key ? { KEY: key } : {}), ...params });
  const res = await fetch(`${NEIS}/${service}?${q}`);
  if (!res.ok) throw new Error(`NEIS ${service}: ${res.status}`);
  const data = (await res.json()) as Record<string, [unknown, { row?: T[] }] | undefined>;
  return data[service]?.[1]?.row ?? [];
}

/** Schools whose name contains `query`. */
export async function searchSchools(query: string): Promise<School[]> {
  // the first 20 matches are plenty to pick from (a longer name narrows it)
  const rows = await neis<Record<string, string>>('schoolInfo', { SCHUL_NM: query.trim() }, 20);
  return rows.map((r) => ({ name: r.SCHUL_NM!, office: r.ATPT_OFCDC_SC_CODE!, code: r.SD_SCHUL_CODE!, kind: r.SCHUL_KND_SC_NM ?? '', region: r.LCTN_SC_NM ?? '' }));
}

/** The school's classes, as "grade-class": 컴시간알리미's own list, otherwise every grade × class 1–15 to pick from. */
export async function classesOf(s: School): Promise<string[]> {
  await comciTimetable();
  if (isComci(s)) return Object.keys(comci!.weeks[0]?.classes ?? {});
  const grades = s.kind.startsWith('초') ? 6 : 3;
  const out: string[] = [];
  for (let g = 1; g <= grades; g++) for (let c = 1; c <= 15; c++) out.push(`${g}-${c}`);
  return out;
}

/** A usual school day when the school's own bell times aren't known: period start times and lesson length. */
function usualDay(kind: string): { periods: string[]; lesson: number } {
  if (kind.startsWith('초')) return { periods: ['09:00', '09:50', '10:40', '11:30', '13:10', '14:00'], lesson: 40 };
  if (kind.startsWith('중')) return { periods: ['09:00', '09:55', '10:50', '11:45', '13:30', '14:25', '15:20'], lesson: 45 };
  return { periods: ['08:40', '09:40', '10:40', '11:40', '13:30', '14:30', '15:30', '16:30'], lesson: 50 };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Lessons at their periods as tasks; a subject run (across a break of up to 10 minutes) is one task. */
function toBlocks(lessons: Lesson[], periods: string[], lesson: number): Block[] {
  const blocks: Block[] = [];
  for (const l of [...lessons].sort((a, b) => a.period - b.period)) {
    const at = periods[l.period - 1];
    if (!at) continue;
    const start = toMin(at);
    const next = periods[l.period];
    const dur = next ? Math.min(lesson, toMin(next) - start) : lesson;
    const prev = blocks.at(-1);
    if (prev && prev.title === l.subject && start - (prev.start + prev.dur) <= 10) prev.dur = start + dur - prev.start;
    else blocks.push({ id: newId(), title: l.subject, cat: 'school', start, dur, done: false });
  }
  return blocks;
}

/** Today's lessons for a class of a school as tasks, or why there are none. */
export async function lessonsToday(s: School, cls: string, now = new Date()): Promise<Block[] | string> {
  const day = now.getDay();
  if (day === 0 || day === 6) return 'No classes today';
  await comciTimetable();
  if (isComci(s)) {
    const today = dayKey(now);
    const week = comci!.weeks.find((w) => {
      const end = new Date(`${w.start}T00:00`);
      end.setDate(end.getDate() + 7);
      return w.start <= today && today < dayKey(end);
    });
    if (!week) return 'No timetable for this week yet';
    const lessons = week.classes[cls]?.[String(day)] ?? [];
    return lessons.length ? toBlocks(lessons, week.periods, 50) : 'No classes today';
  }
  const [grade, num] = cls.split('-');
  const service = s.kind.startsWith('초') ? 'elsTimetable' : s.kind.startsWith('중') ? 'misTimetable' : 'hisTimetable';
  const ymd = dayKey(now).replaceAll('-', '');
  let rows: Record<string, string>[];
  try {
    rows = await neis(service, { ATPT_OFCDC_SC_CODE: s.office, SD_SCHUL_CODE: s.code, ALL_TI_YMD: ymd, GRADE: grade ?? '', CLASS_NM: num ?? '' });
  } catch {
    return 'The school timetable isn’t available right now';
  }
  const lessons = rows.map((r) => ({ period: Number(r.PERIO), subject: (r.ITRT_CNTNT ?? '').replace(/^-/, '').trim() })).filter((l) => l.period > 0 && l.subject);
  if (!lessons.length) return 'No classes today';
  const { periods, lesson } = usualDay(s.kind);
  return toBlocks(lessons, periods, lesson);
}

/** Puts the lessons on Today: tasks they would overlap are taken off. Returns what was replaced. */
export function applyLessons(lessons: Block[]): Block[] {
  const kept = state.blocks.filter((b) => !lessons.some((l) => overlaps([l], { ...b, id: null })));
  const replaced = state.blocks.filter((b) => !kept.includes(b));
  setState({ blocks: [...kept, ...lessons], draft: null, selected: [] });
  return replaced;
}

// ---------- school meals (NEIS 급식식단정보): breakfast, lunch and dinner as Meal tasks, the menu in the note

export interface Meal {
  kind: 'breakfast' | 'lunch' | 'dinner';
  /** 조식 / 중식 / 석식 */
  name: string;
  /** Dishes, without their allergy numbers. */
  menu: string[];
  kcal: string;
}
const MEAL_KIND: Record<string, Meal['kind']> = { 1: 'breakfast', 2: 'lunch', 3: 'dinner' };

/** The day's meals at the school, or why there are none. */
export async function mealsToday(s: School, now = new Date()): Promise<Meal[] | string> {
  const ymd = dayKey(now).replaceAll('-', '');
  let rows: Record<string, string>[];
  try {
    rows = await neis('mealServiceDietInfo', { ATPT_OFCDC_SC_CODE: s.office, SD_SCHUL_CODE: s.code, MLSV_YMD: ymd }, 10);
  } catch {
    return 'School meals aren’t available right now';
  }
  const meals = rows.map((r) => ({
    kind: MEAL_KIND[String(r.MMEAL_SC_CODE)] ?? 'lunch',
    name: r.MMEAL_SC_NM ?? '급식',
    menu: (r.DDISH_NM ?? '').split(/<br\s*\/?>/i).map((d) => d.replace(/\s*\([\d.\s]*\)\s*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    kcal: (r.CAL_INFO ?? '').trim(),
  }));
  return meals.length ? meals.sort((a, b) => ['breakfast', 'lunch', 'dinner'].indexOf(a.kind) - ['breakfast', 'lunch', 'dinner'].indexOf(b.kind)) : 'No school meals today';
}

/** When each meal is eaten: lunch in the school's own lunch break when its bell times are known, else a usual day. */
async function mealTimes(s: School, now: Date): Promise<Record<Meal['kind'], { start: number; dur: number }>> {
  const times = { breakfast: { start: 7 * 60 + 30, dur: 40 }, lunch: { start: 12 * 60 + 30, dur: 50 }, dinner: { start: 17 * 60 + 50, dur: 50 } };
  await comciTimetable();
  if (isComci(s)) {
    const today = dayKey(now);
    const week = comci!.weeks.find((w) => {
      const end = new Date(`${w.start}T00:00`);
      end.setDate(end.getDate() + 7);
      return w.start <= today && today < dayKey(end);
    }) ?? comci!.weeks[0];
    // the longest gap between lessons around noon is the lunch break
    const starts = (week?.periods ?? []).map(toMin);
    let best: { start: number; dur: number } | null = null;
    for (let i = 0; i + 1 < starts.length; i++) {
      const end = starts[i]! + 50;
      const gap = starts[i + 1]! - end;
      if (end >= 11 * 60 && end <= 14 * 60 && gap >= 30 && (!best || gap > best.dur)) best = { start: end, dur: gap };
    }
    if (best) times.lunch = best;
  }
  return times;
}

/** The meals as Meal tasks at their times; the dishes go in the note. */
export async function mealBlocks(s: School, meals: Meal[], now = new Date()): Promise<Block[]> {
  const times = await mealTimes(s, now);
  return meals.map((m) => ({
    id: newId(), title: m.name, cat: 'meal' as const, done: false, ...times[m.kind],
    note: [...m.menu, m.kcal].filter(Boolean).join('\n'),
  }));
}

/**
 * Puts tasks on Today without touching what is there: anything that would overlap an existing task is left
 * out (used by the daily automatic fill, which asks nobody). Returns what was added.
 */
export function addAround(blocks: Block[]): Block[] {
  const added = blocks.filter((b) => !overlaps(state.blocks, { ...b, id: null }));
  if (added.length) automatically(() => setState({ blocks: [...state.blocks, ...added] }));
  return added;
}
