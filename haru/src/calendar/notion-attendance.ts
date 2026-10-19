import { onSession, session } from '../cloud/session';
import type { ListStore } from '../storage/list-store';

/**
 * Attendance kept in Notion (the "출석 체크" database, one checkbox column per person), both ways:
 *  - in: every 5 minutes GitHub Actions publishes it as data/attendance.json — everyone's days keyed by a hash
 *    of their column name (the public site never names anyone), and when each recent row was last edited;
 *    you tell Haru your name (Settings → Account → Name in Notion) and it looks up your days;
 *  - out: each check-in or undo here is a mark (on/off and when) sent to `notion-checkins/{that hash}` in
 *    Firestore; the same job sets your box in Notion to it, adding the date's row when there is none.
 * Date by date, whichever side changed last wins: a mark newer than the Notion row counts here at once (and
 * reaches Notion within minutes); a row edited in Notion after the mark is what Haru shows.
 * The name and the marks belong to the signed-in account, never to the device: two people sharing a browser
 * each keep their own column. A column stays with the account that linked it first (firestore.rules).
 */
/** Marks older than this have long been settled either side. */
const KEEP_DAYS = 60;
/** How often the published file is read again while Haru is open (it changes at most every 5 minutes). */
const REFRESH_MS = 120_000;

export interface Mark { on: boolean; at: number }

const listeners = new Set<() => void>();
/** Whose name and marks are loaded: the signed-in account's uid ('' running local-only or signed out). */
let owner = '';
let myName = '';
let marks: Record<string, Mark> = {};
/** The name's column is linked to another Haru account (Firestore refused this account's marks). */
let taken = false;
const nameKey = () => `haru:notion-name:${owner || 'local'}`;
const marksKey = () => `haru:checkin-marks:${owner || 'local'}`;
function loadOwn(): void {
  myName = '';
  marks = {};
  taken = false;
  try {
    myName = localStorage.getItem(nameKey()) ?? '';
    marks = JSON.parse(localStorage.getItem(marksKey()) ?? '{}') as Record<string, Mark>;
  } catch {
    // none
  }
}
loadOwn();

/** The column for your name is already linked to another Haru account. */
export const notionTaken = (): boolean => taken;

/** Fires when the Notion data, your name or your marks change. */
export function onNotionAttendance(fn: () => void): void {
  listeners.add(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/** Same key as scripts/fetch-attendance.mjs: the first 16 hex digits of SHA-256 of the trimmed name. */
async function keyOf(name: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name.trim().normalize('NFC')));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Everyone's Notion days by key, and when each recent date's row was last edited (ms). */
let people = new Map<string, Set<string>>();
let edited: Record<string, number> = {};

export interface NotionView {
  /** The name is a column of the Notion table. */
  known: boolean;
  days: Set<string>;
  /** When the date's row was last edited in Notion (0: unknown). */
  editedAt(date: string): number;
}
/** What Notion says for the person with this column name. */
export async function notionView(name: string): Promise<NotionView> {
  const k = name.trim() ? await keyOf(name) : '';
  const days = people.get(k);
  return { known: !!days, days: days ?? new Set(), editedAt: (d) => edited[d] ?? 0 };
}

export const notionName = (): string => myName;
export const checkinMarks = (): Readonly<Record<string, Mark>> => marks;

/** Sets your name in Notion: kept on this device, and on your profile so your other devices know it too. */
export function setNotionName(name: string): void {
  myName = name.trim();
  taken = false;
  pushed = '';
  try {
    localStorage.setItem(nameKey(), myName);
  } catch {
    // for this visit
  }
  const s = session();
  if (s) void s.fb.fs.setDoc(s.fb.fs.doc(s.fb.db, 'profiles', s.uid), { notionName: myName }, { merge: true }).catch(() => {});
  changed();
}

/** A check-in or undo on Haru for `date`: counts here at once, and goes on to Notion. */
export function markCheckin(date: string, on: boolean): void {
  marks[date] = { on, at: Date.now() };
  // only recent marks are kept
  const since = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const d of Object.keys(marks)) if (d < since) delete marks[d];
  try {
    localStorage.setItem(marksKey(), JSON.stringify(marks));
  } catch {
    // for this visit
  }
  changed();
  void pushOut();
}

async function load(): Promise<void> {
  try {
    // a fresh copy each time (GitHub Pages caches files for a few minutes)
    const res = await fetch(`${import.meta.env.BASE_URL}data/attendance.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { people?: Record<string, unknown>; edited?: Record<string, unknown> };
    const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
    people = new Map(Object.entries(data.people ?? {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, new Set((v as unknown[]).filter(isDay))]));
    edited = Object.fromEntries(Object.entries(data.edited ?? {}).filter(([d, t]) => isDay(d) && typeof t === 'number')) as Record<string, number>;
    changed();
  } catch {
    // not published yet, or offline: Haru's own check-ins still count
  }
}

/** Sends your marks on their way to your Notion column (signed in, with a name set). */
let checkins: ListStore<string> | null = null;
let pushed = '';
async function pushOut(): Promise<void> {
  const s = session();
  // only the account whose name and marks are loaded sends them
  if (!s || s.uid !== owner || !myName || !checkins || taken) return;
  const key = await keyOf(myName);
  const days = [...checkins.all()].sort();
  const sig = `${key}:${JSON.stringify(marks)}:${days.join()}`;
  if (sig === pushed) return;
  pushed = sig;
  const { fs, db } = s.fb;
  // merged, so marks made on another device stay
  await fs.setDoc(fs.doc(db, 'notion-checkins', key), { uid: s.uid, days, marks, updated: Date.now() }, { merge: true }).catch((e: { code?: string }) => {
    pushed = '';
    // the column is linked to someone else's account: say so instead of retrying
    if (e?.code === 'permission-denied') {
      taken = true;
      changed();
    }
  });
}

export function mountNotionAttendance(store: ListStore<string>): void {
  checkins = store;
  store.onChange(() => void pushOut());
  onNotionAttendance(() => void pushOut());
  void load();
  // read again every couple of minutes, and whenever Haru comes back to the front
  setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void load();
  });
  // each account brings its own name and marks; its profile (set on any device) has the last word on the name
  onSession((s) => {
    owner = s?.uid ?? '';
    pushed = '';
    loadOwn();
    changed();
    if (!s) return;
    void s.fb.fs.getDoc(s.fb.fs.doc(s.fb.db, 'profiles', s.uid)).then((snap) => {
      if (session()?.uid !== s.uid) return;
      const saved = (snap.data() as { notionName?: string } | undefined)?.notionName?.trim() ?? '';
      if (saved && saved !== myName) {
        myName = saved;
        try {
          localStorage.setItem(nameKey(), myName);
        } catch {
          // ignore
        }
        changed();
      } else if (!saved && myName) setNotionName(myName);
      void pushOut();
    }).catch(() => void pushOut());
  });
}
