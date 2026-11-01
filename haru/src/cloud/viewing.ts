import { avatar, onSession, session, type Profile } from './session';
import { icon } from '../ui/icons';
import { showMenu } from '../ui/modal';
import { onView } from '../ui/router';
import { anyPopOpen } from '../ui/popover';
import { dayOf } from '../timetable/history';
import { type Block, isBlock } from '../timetable/model';

/**
 * Looking at someone else's Today: the people button (top right of Today, signed in only) lists everyone;
 * picking someone lays their Today over yours — read only and live — under a bar saying whose it is. X on
 * the bar, Esc, or leaving Today comes back to your own. Only Today can be looked at; every other page is
 * always your own. Nothing of yours is changed while you look.
 */
let current: Profile | null = null;
const listeners = new Set<(p: Profile | null) => void>();

/** Whose Haru is on screen: null is your own. */
export const viewing = (): Profile | null => current;
/** Everyone invited (their profiles), kept while signed in. */
let members: Profile[] = [];
/** Everyone invited, for naming people with @. */
export const memberList = (): Profile[] => members;
/** The uid `@ALL` carries: a mention of everyone invited. */
export const ALL = 'all';
/** Who `@` offers: ALL first, then everyone invited but `self`. */
export const mentionable = (self?: string): { uid: string; name: string; photo: string | null }[] =>
  [{ uid: ALL, name: 'ALL', photo: null }, ...members.filter((p) => p.uid !== self)];
/** Whether a list of mentioned uids names `uid` (by name, or through ALL). */
export const mentions = (list: string[] | undefined, uid: string): boolean => !!list && (list.includes(uid) || list.includes(ALL));

export function onViewing(fn: (p: Profile | null) => void): void {
  listeners.add(fn);
}

export function view(p: Profile | null): void {
  if (p?.uid === current?.uid) return;
  current = p;
  document.body.classList.toggle('viewing', !!p);
  listeners.forEach((fn) => fn(p));
}

/** A read-only document of the person on screen, live; returns how to stop listening. */
export function watchTheirs<T>(path: string, fn: (data: T | undefined, failed?: boolean) => void): () => void {
  const s = session();
  const p = current;
  if (!s || !p) return () => {};
  const { fs, db } = s.fb;
  return fs.onSnapshot(fs.doc(db, `users/${p.uid}/${path}`), (snap) => fn(snap.data() as T | undefined), () => fn(undefined, true));
}

/**
 * The person on screen's Today, live — once it is today's. Their Today has no date of its own: until their Haru
 * has begun today (its copy of the day, `days/{date}`, is there), what it holds is an earlier day's, and `fn`
 * gets null. Waits for both before the first call, and moves on with the day while you look.
 */
export function watchTheirToday(fn: (blocks: Block[] | null) => void): () => void {
  let blocks: Block[] | undefined;
  let started: boolean | undefined;
  let date = dayOf();
  const send = () => {
    if (blocks !== undefined && started !== undefined) fn(started ? blocks : null);
  };
  const stopState = watchTheirs<{ blocks?: unknown[] }>('state/timetable', (data) => {
    blocks = (data?.blocks ?? []).filter(isBlock).map((b) => ({ ...b, done: b.done === true }));
    send();
  });
  let stopDay = () => {};
  const watchDay = () => {
    stopDay();
    stopDay = watchTheirs('days/' + date, (data) => {
      started = !!data;
      send();
    });
  };
  watchDay();
  const timer = window.setInterval(() => {
    if (dayOf() === date) return;
    date = dayOf();
    started = undefined;
    watchDay();
  }, 30_000);
  return () => {
    stopState();
    stopDay();
    clearInterval(timer);
  };
}

export function mountViewing(): void {
  // only Today can be looked at: any other page is your own
  onView((page) => {
    if (page !== 'today') view(null);
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'peek-btn';
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-label', 'See someone’s Today');
  btn.title = 'See someone’s Today';
  btn.hidden = true;
  document.body.append(btn);

  const bar = document.createElement('div');
  bar.className = 'peek-bar';
  bar.hidden = true;
  document.body.append(bar);

  let stopMembers: (() => void) | null = null;

  btn.addEventListener('click', () => {
    const s = session();
    if (!s) return;
    const others = members.filter((m) => m.uid !== s.uid);
    showMenu(btn, others.length
      ? others.map((m) => ({ label: m.name || m.email, icon: 'eye', run: () => view(m) }))
      : [{ label: 'No one else yet', icon: 'user', run: () => {} }]);
  });

  function paint(): void {
    const s = session();
    btn.hidden = !s || !!current;
    if (s) btn.replaceChildren(avatar({ name: s.name, photo: s.photo }, 'a-avatar'), 'Me', icon('users'));
    bar.hidden = !current;
    if (!current) return;
    const name = document.createElement('span');
    name.className = 'peek-name';
    name.append(avatar(current, 'a-avatar'), current.name);
    const tag = document.createElement('span');
    tag.className = 'meta peek-tag';
    tag.append(icon('eye'), 'Read only');
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'peek-x';
    x.setAttribute('aria-label', 'Back to mine (Esc)');
    x.title = 'Back to mine  Esc';
    x.append(icon('x'));
    x.addEventListener('click', () => view(null));
    bar.replaceChildren(name, tag, x);
  }
  onViewing(paint);

  // Esc comes back to your own (after any menu or dialog has had it)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current && !anyPopOpen() && !document.querySelector('.pop-menu, dialog[open]')) view(null);
  });

  onSession((s) => {
    stopMembers?.();
    stopMembers = null;
    members = [];
    view(null);
    paint();
    if (!s) return;
    const { fs, db } = s.fb;
    stopMembers = fs.onSnapshot(fs.collection(db, 'profiles'), (snap) => {
      members = snap.docs.map((d) => d.data() as Profile).sort((a, b) => a.name.localeCompare(b.name));
    }, () => {});
  });
  paint();
}
