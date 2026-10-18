import type { Fb } from './firebase';

/**
 * Who is signed in (an invited account), for the parts that reach other people: the shared Archive, a
 * journal page's Share, and looking at someone else's Today. Null while signed out or running local-only.
 */
export interface Session {
  fb: Fb;
  uid: string;
  email: string;
  name: string;
  photo: string | null;
  /** May manage invitations. */
  owner: boolean;
}

/** A member as the others see them (`profiles/{uid}`). */
export interface Profile {
  uid: string;
  name: string;
  email: string;
  photo: string | null;
  /** Their column in the Notion attendance database (Settings → Account), if they set one. */
  notionName?: string;
}

let current: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();

export const session = (): Session | null => current;

/** Fires when someone signs in or out. */
export function onSession(fn: (s: Session | null) => void): void {
  listeners.add(fn);
}

export function setSession(s: Session | null): void {
  current = s;
  listeners.forEach((fn) => fn(s));
}

/** A round avatar: the account photo, or its initial. */
export function avatar(p: { name: string; photo: string | null }, cls = 'acct-avatar'): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  if (p.photo) {
    const img = document.createElement('img');
    img.src = p.photo;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    el.append(img);
  } else el.textContent = (p.name.trim()[0] ?? '?').toUpperCase();
  return el;
}
