import { avatar, onSession, session, type Profile } from './session';
import { icon } from '../ui/icons';
import { showMenu } from '../ui/modal';

/**
 * Looking at someone else's Haru, on every page at once: the people button (top right, signed in only)
 * lists everyone; picking someone makes each page show that person's data instead of yours — read only
 * and live — under a bar saying whose it is. X on the bar (or Esc) comes back to your own. Pages follow
 * through `onViewing`; nothing of yours is changed while you look.
 */
let current: Profile | null = null;
const listeners = new Set<(p: Profile | null) => void>();

/** Whose Haru is on screen: null is your own. */
export const viewing = (): Profile | null => current;

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

/** A read-only collection of the person on screen (every document's data), live. */
export function watchTheirList<T>(path: string, fn: (docs: T[] | null) => void): () => void {
  const s = session();
  const p = current;
  if (!s || !p) return () => {};
  const { fs, db } = s.fb;
  return fs.onSnapshot(fs.collection(db, `users/${p.uid}/${path}`), (snap) => fn(snap.docs.map((d) => d.data() as T)), () => fn(null));
}

export function mountViewing(): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'peek-btn';
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-label', 'See someone’s Haru');
  btn.title = 'See someone’s Haru';
  btn.hidden = true;
  document.body.append(btn);

  const bar = document.createElement('div');
  bar.className = 'peek-bar';
  bar.hidden = true;
  document.body.append(bar);

  let members: Profile[] = [];
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
    if (e.key === 'Escape' && current && !document.querySelector('.pop-menu, dialog[open], :popover-open')) view(null);
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
