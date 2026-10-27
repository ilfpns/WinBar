import { dayOf } from './history';
import { addAround, lessonsToday, mealBlocks, mealsToday, myClass, mySchool } from './school';
import { onAutoLost } from './state';

/**
 * Every day, by itself (Settings → Today → the "Every day" switches): the class's lessons and the school's meals
 * go on Today once per day — on opening Haru, and again after a new day begins. Nothing already on Today is
 * touched: whatever would overlap one of your tasks is left out. A day whose fetch failed (offline) is tried
 * again later.
 */
type Kind = 'lessons' | 'meals';
const ON_KEY: Record<Kind, string> = { lessons: 'haru:school-auto', meals: 'haru:meals-auto' };
const DONE_KEY: Record<Kind, string> = { lessons: 'haru:school-auto-day', meals: 'haru:meals-auto-day' };

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null): void => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // for this visit
  }
};

export const autoOn = (k: Kind): boolean => read(ON_KEY[k]) === '1';
export function setAuto(k: Kind, on: boolean): void {
  write(ON_KEY[k], on ? '1' : null);
  // switched on: today counts too (it is filled at once)
  if (on) {
    write(DONE_KEY[k], null);
    void runAuto();
  }
}

/** The date of the day Today is on (it follows the New day time: at 1 a.m. with a 4 a.m. reset, still yesterday), at noon. */
export const dayDate = (): Date => new Date(`${dayOf()}T12:00`);

let running = false;
/** Fills today once for each switch that is on. Returns what it put on Today, per kind. */
export async function runAuto(): Promise<Partial<Record<Kind, number>>> {
  if (running) return {};
  running = true;
  const out: Partial<Record<Kind, number>> = {};
  try {
    const day = dayOf();
    const when = dayDate();
    if (autoOn('lessons') && read(DONE_KEY.lessons) !== day && myClass()) {
      const lessons = await lessonsToday(mySchool(), myClass(), when);
      // a weekday with lessons, or a day that has none: either way this day is settled (a failure is tried again)
      if (typeof lessons !== 'string') out.lessons = addAround(lessons).length;
      if (typeof lessons !== 'string' || lessons === 'No classes today') write(DONE_KEY.lessons, day);
    }
    if (autoOn('meals') && read(DONE_KEY.meals) !== day) {
      const meals = await mealsToday(mySchool(), when);
      if (typeof meals !== 'string') out.meals = addAround(await mealBlocks(mySchool(), meals, when)).length;
      if (typeof meals !== 'string' || meals === 'No school meals today') write(DONE_KEY.meals, day);
    }
  } finally {
    running = false;
  }
  return out;
}

/** Runs now (after the day's history has rolled over), then whenever a new day may have begun. */
export function mountSchoolAuto(): void {
  void runAuto();
  setInterval(() => void runAuto(), 5 * 60_000);
  // another device's newer Today won over today's fill: fill again on top of it
  onAutoLost(() => {
    write(DONE_KEY.lessons, null);
    write(DONE_KEY.meals, null);
    setTimeout(() => void runAuto(), 1500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runAuto();
  });
}
