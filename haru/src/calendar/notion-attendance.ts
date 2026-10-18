import { onSession, session } from '../cloud/session';

/**
 * Attendance kept in Notion (the "출석 체크" database, one checkbox column per person), brought in every
 * 10 minutes by GitHub Actions as data/attendance.json. People are keyed there by a hash of their column
 * name, so the public site never names anyone; you tell Haru your name (Settings → Account → Notion name)
 * and it looks up your days. Read only: checking in on Haru does not write to Notion.
 */
const NAME_KEY = 'haru:notion-name';
const listeners = new Set<() => void>();
let people: Record<string, string[]> = {};
let myName = '';
try {
  myName = localStorage.getItem(NAME_KEY) ?? '';
} catch {
  // none
}

/** Fires when the Notion data or your Notion name changes. */
export function onNotionAttendance(fn: () => void): void {
  listeners.add(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/** Same key as scripts/fetch-attendance.mjs: the first 16 hex digits of SHA-256 of the trimmed name. */
async function keyOf(name: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name.trim().normalize('NFC')));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** The Notion days of the person with this column name (empty when unknown). */
const cache = new Map<string, Set<string>>();
export async function notionDays(name: string | undefined): Promise<Set<string>> {
  if (!name?.trim()) return new Set();
  const k = await keyOf(name);
  return cache.get(k) ?? new Set();
}

export const notionName = (): string => myName;

/** Sets your Notion name: kept on this device, and on your profile so others viewing you see your days too. */
export function setNotionName(name: string): void {
  myName = name.trim();
  try {
    localStorage.setItem(NAME_KEY, myName);
  } catch {
    // for this visit
  }
  const s = session();
  if (s) void s.fb.fs.setDoc(s.fb.fs.doc(s.fb.db, 'profiles', s.uid), { notionName: myName }, { merge: true }).catch(() => {});
  changed();
}

async function load(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/attendance.json?t=${Math.floor(Date.now() / 600_000)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { people?: Record<string, unknown> };
    people = {};
    for (const [k, v] of Object.entries(data.people ?? {})) {
      if (Array.isArray(v)) people[k] = v.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
    }
    cache.clear();
    for (const [k, v] of Object.entries(people)) cache.set(k, new Set(v));
    changed();
  } catch {
    // not published yet, or offline: Haru's own check-ins still count
  }
}

export function mountNotionAttendance(): void {
  void load();
  // the file is refreshed every 10 minutes
  setInterval(() => void load(), 600_000);
  // a name set on another device comes with the profile
  onSession((s) => {
    if (!s) return;
    void s.fb.fs.getDoc(s.fb.fs.doc(s.fb.db, 'profiles', s.uid)).then((snap) => {
      const theirs = (snap.data() as { notionName?: string } | undefined)?.notionName;
      if (theirs && !myName) {
        myName = theirs;
        try {
          localStorage.setItem(NAME_KEY, myName);
        } catch {
          // ignore
        }
        changed();
      } else if (myName && theirs !== myName) setNotionName(myName);
    }).catch(() => {});
  });
}
