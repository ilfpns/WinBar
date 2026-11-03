import { onSession, session, type Profile } from './session';
import { dayKey, dayOf } from '../timetable/history';
import { icon } from '../ui/icons';
import { lang } from '../ui/i18n';

/**
 * Cheers: a heart on someone else's task (or on their whole day), sent while looking at their Today. Each one is a
 * document of its own in `cheers/{date}_{from}_{to}_{key}`, written by the sender as themselves — nothing of the
 * other person's is ever written. The receiver reads the ones sent to them (a heart on the task in their list, a
 * note as one arrives, the morning brief) and clears the old ones; the sender can take a heart back.
 * `key` is the task's id, or DAY for the whole day.
 */
export interface Cheer {
  id: string;
  from: string;
  fromName: string;
  fromPhoto: string | null;
  to: string;
  date: string;
  key: string;
  title: string;
  at: number;
}
export const DAY = 'day';
/** Cheers older than this are cleared by the one who got them. */
const KEEP_DAYS = 14;

const ko = () => lang() === 'ko';
const idOf = (date: string, from: string, to: string, key: string) => `${date}_${from}_${to}_${key}`;

let received: Cheer[] = [];
let sent = new Set<string>();
/** The rules for `cheers` aren't published yet (or reading failed): sending says so instead of failing quietly. */
let blocked = false;
const listeners = new Set<() => void>();
export const onCheers = (fn: () => void): void => void listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

/** The cheers this account got for `date` (newest first). */
export const cheersOn = (date: string): Cheer[] => received.filter((c) => c.date === date).sort((a, b) => b.at - a.at);
/** The cheers on one of this account's tasks today. */
export const cheersFor = (key: string, date = dayOf()): Cheer[] => cheersOn(date).filter((c) => c.key === key);
/** Whether this account has cheered `to`'s `key` on `date`. */
export const cheered = (to: string, date: string, key: string): boolean => {
  const s = session();
  return !!s && sent.has(idOf(date, s.uid, to, key));
};

function asCheer(id: string, v: Record<string, unknown>): Cheer | null {
  if (typeof v.from !== 'string' || typeof v.to !== 'string' || typeof v.date !== 'string' || typeof v.key !== 'string') return null;
  return {
    id, from: v.from, to: v.to, date: v.date, key: v.key,
    fromName: typeof v.fromName === 'string' ? v.fromName : '',
    fromPhoto: typeof v.fromPhoto === 'string' ? v.fromPhoto : null,
    title: typeof v.title === 'string' ? v.title : '',
    at: Number(v.at) || 0,
  };
}

/** Sends (or, `on` false, takes back) a heart on `to`'s task `key` today. Resolves to an error message, or null. */
export async function setCheer(to: Profile, key: string, title: string, on: boolean, date = dayOf()): Promise<string | null> {
  const s = session();
  if (!s || to.uid === s.uid) return null;
  const { fs, db } = s.fb;
  const id = idOf(date, s.uid, to.uid, key);
  // shown at once, put back if the write fails
  if (on) sent.add(id);
  else sent.delete(id);
  changed();
  try {
    if (on) {
      await fs.setDoc(fs.doc(db, 'cheers', id), {
        from: s.uid, fromName: s.name.slice(0, 60), fromPhoto: s.photo && s.photo.length <= 1000 ? s.photo : null, to: to.uid, date, key: key.slice(0, 40), title: title.slice(0, 80), at: Date.now(),
      });
    } else await fs.deleteDoc(fs.doc(db, 'cheers', id));
    return null;
  } catch (e) {
    if (on) sent.delete(id);
    else sent.add(id);
    changed();
    const denied = (e as { code?: string })?.code === 'permission-denied';
    if (denied || blocked) return ko() ? '아직 응원을 보낼 수 없어요: Firestore 규칙을 다시 게시해야 해요' : 'Cheers aren’t allowed yet: the Firestore rules need publishing again';
    return ko() ? '응원을 보내지 못했어요. 연결을 확인하세요.' : 'Couldn’t send the cheer. Check your connection.';
  }
}

/** A note at the bottom of the screen as a cheer comes in (not for the ones already there when Haru opened). */
function announce(c: Cheer): void {
  const note = document.createElement('div');
  note.className = 'cheer-toast';
  note.setAttribute('role', 'status');
  const heart = icon('heart', 'ic cheer-toast-heart');
  const text = document.createElement('span');
  const who = c.fromName || (ko() ? '누군가' : 'Someone');
  const what = c.key === DAY ? (ko() ? '오늘 하루' : 'your day') : c.title || (ko() ? '할 일' : 'a task');
  text.textContent = ko() ? `${who}님이 ${what}에 응원을 보냈어요` : `${who} cheered ${what}`;
  note.append(heart, text);
  document.body.append(note);
  setTimeout(() => note.classList.add('out'), 4200);
  setTimeout(() => note.remove(), 4600);
}

export function mountCheers(): void {
  let stops: (() => void)[] = [];
  onSession((s) => {
    stops.forEach((f) => f());
    stops = [];
    received = [];
    sent = new Set();
    blocked = false;
    changed();
    if (!s) return;
    const { fs, db } = s.fb;
    let first = true;
    stops.push(fs.onSnapshot(fs.query(fs.collection(db, 'cheers'), fs.where('to', '==', s.uid)), (snap) => {
      const list: Cheer[] = [];
      snap.docs.forEach((d) => {
        const c = asCheer(d.id, d.data() as Record<string, unknown>);
        if (c) list.push(c);
      });
      const before = new Set(received.map((c) => c.id));
      received = list;
      blocked = false;
      if (!first) for (const c of list) if (!before.has(c.id) && c.date === dayOf() && Date.now() - c.at < 10 * 60_000) announce(c);
      if (first) {
        // the old ones go (the receiver may clear them; nothing is kept that long)
        const cut = new Date();
        cut.setDate(cut.getDate() - KEEP_DAYS);
        const old = dayKey(cut);
        for (const c of list) if (c.date < old) void fs.deleteDoc(fs.doc(db, 'cheers', c.id)).catch(() => {});
      }
      first = false;
      changed();
    }, () => {
      blocked = true;
      changed();
    }));
    stops.push(fs.onSnapshot(fs.query(fs.collection(db, 'cheers'), fs.where('from', '==', s.uid)), (snap) => {
      sent = new Set(snap.docs.map((d) => d.id));
      changed();
    }, () => {
      blocked = true;
    }));
  });
}
