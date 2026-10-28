import { onSession, session } from '../cloud/session';
import { icon } from './icons';
import { onStreaks, todayRun } from '../timetable/streaks';
import { mountPlanAhead } from '../timetable/plan-ahead';

/**
 * Today's greeting, top left: one line for the time of day with your name in it ("Good morning, Public"),
 * picked at random from twenty per part of the day (a new one when the part of the day changes). The name is the one set in
 * Settings → Account, or your account's first name; without either the line simply has none. Under it, how many
 * days running Today has been kept (timetable/streaks.ts), from two on, and the chip that plans tomorrow and the
 * days after (timetable/plan-ahead.ts).
 */
const NAME_KEY = 'haru:greet-name';
type Part = 'owl' | 'morning' | 'afternoon' | 'evening' | 'night';

/** `{n}` is the name; with no name the ", {n}" goes. */
const LINES: Record<Part, string[]> = {
  owl: [
    'Good morning, night owl {n}', 'Still up, {n}?', 'The quiet hours are yours, {n}', 'Burning the midnight oil, {n}?',
    'Hello from the small hours, {n}', 'The world is asleep, {n}', 'Late night or early start, {n}?', 'Moon’s still out, {n}',
    'Easy does it, {n}', 'Night shift, {n}?', 'Couldn’t sleep, {n}?', 'A calm night to you, {n}',
    'Rest counts too, {n}', 'Hey there, night owl {n}', 'Before the birds, {n}', 'One more thing, {n}?',
    'Stars are out, {n}', 'Quiet hours, clear head, {n}', 'Don’t stay up too long, {n}', 'Hello, stargazer {n}',
  ],
  morning: [
    'Good morning, {n}', 'Rise and shine, {n}', 'Morning, {n}', 'A fresh start, {n}',
    'Coffee first, {n}?', 'Let’s make it a good one, {n}', 'Top of the morning, {n}', 'Bright and early, {n}',
    'Hello, sunshine {n}', 'New day, new pages, {n}', 'Ready when you are, {n}', 'Up and at it, {n}',
    'One step at a time today, {n}', 'The day is all yours, {n}', 'Slow mornings are fine too, {n}', 'Hello, early bird {n}',
    'Good to see you, {n}', 'Let’s plan a good day, {n}', 'Morning light suits you, {n}', 'Off to a good start, {n}',
  ],
  afternoon: [
    'Good afternoon, {n}', 'Halfway there, {n}', 'Hello again, {n}', 'Keep it going, {n}',
    'Afternoon, {n}', 'Lunch done, {n}?', 'Steady does it, {n}', 'How’s the day going, {n}?',
    'Second wind, {n}', 'Nice pace, {n}', 'Take a breath, {n}', 'Still plenty of day left, {n}',
    'Back at it, {n}', 'Stretch a little, {n}', 'You’ve got this, {n}', 'Tea break, {n}?',
    'Keep the momentum, {n}', 'Sunny side up, {n}', 'Small wins add up, {n}', 'Good to have you back, {n}',
  ],
  evening: [
    'Good evening, {n}', 'Evening, {n}', 'Winding down, {n}?', 'How did today go, {n}?',
    'Nice work today, {n}', 'Golden hour, {n}', 'Time to slow down, {n}', 'Hello, evening {n}',
    'Dinner plans, {n}?', 'The day is nearly done, {n}', 'A few more ticks, {n}?', 'Sunset mode, {n}',
    'Take it easy now, {n}', 'Proud of today, {n}?', 'Welcome back, {n}', 'Last stretch, {n}',
    'Kick back a little, {n}', 'Evening calm, {n}', 'Wrap it up nicely, {n}', 'You made it, {n}',
  ],
  night: [
    'Good night, {n}', 'Almost bedtime, {n}', 'Time to rest, {n}', 'Sleep well soon, {n}',
    'Tomorrow can wait, {n}', 'Wind down, {n}', 'Late again, {n}?', 'Rest up, {n}',
    'One last look, {n}?', 'Plan tomorrow, then sleep, {n}', 'Lights down, {n}', 'Sweet dreams soon, {n}',
    'Night, {n}', 'The day is done, {n}', 'Thanks for today, {n}', 'Recharge time, {n}',
    'Off to bed soon, {n}?', 'A quiet night, {n}', 'You did enough today, {n}', 'Good evening, night owl {n}',
  ],
};

const partOf = (h: number): Part => (h < 5 ? 'owl' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night');

const read = (): string => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};
const listeners = new Set<() => void>();
/** The name set for the greeting ('' when none). */
export const greetName = (): string => read();
export function setGreetName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim().slice(0, 30));
    else localStorage.removeItem(NAME_KEY);
  } catch {
    // for this visit only
  }
  listeners.forEach((fn) => fn());
}

/** The name in the line: the one set, or the account's first name. */
const nameNow = (): string => read() || (session()?.name ?? '').trim().split(/\s+/)[0] || '';

export function mountGreeting(stage: HTMLElement): void {
  const el = document.createElement('p');
  el.className = 'greeting';
  el.dataset.noI18n = '';
  const text = document.createElement('span');
  const runs = document.createElement('span');
  runs.className = 'greet-streaks';
  el.append(icon('asterisk', 'ic greeting-mark'), text, runs);
  stage.append(el);
  // one chip: how many days running Today has been kept
  const chip = document.createElement('span');
  chip.className = 'greet-streak';
  chip.style.setProperty('--c', 'var(--accent)');
  runs.append(chip);
  mountPlanAhead(runs);
  const paintRuns = () => {
    const { days, best } = todayRun();
    chip.hidden = days < 2;
    chip.title = `Today kept ${days} days in a row (longest ${best})`;
    chip.replaceChildren(icon('flame'), `Today · ${days} days in a row`);
  };
  paintRuns();
  onStreaks(paintRuns);

  let part: Part | null = null;
  let line = '';
  const paint = () => {
    const n = nameNow();
    text.textContent = n ? line.replace('{n}', n) : line.replace(/,? \{n\}/, '');
  };
  /** A new line for this part of the day (never the same one twice in a row). */
  const pick = () => {
    const list = LINES[part!];
    let next = line;
    while (next === line) next = list[Math.floor(Math.random() * list.length)]!;
    line = next;
    paint();
  };
  const tick = () => {
    const p = partOf(new Date().getHours());
    if (p === part) return;
    part = p;
    pick();
  };
  // the room it takes at the top of Today, so the dial and its labels stay below it at any window size
  const room = () => stage.style.setProperty('--greet-room', `${Math.ceil(el.offsetTop + el.offsetHeight + 14)}px`);
  new ResizeObserver(room).observe(el);
  addEventListener('resize', room);
  listeners.add(paint);
  onSession(paint);
  tick();
  setInterval(tick, 60_000);
}
