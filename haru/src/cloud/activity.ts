import type { Fb } from './firebase';
import { onAdded } from '../timetable/state';
import { onSession, session } from './session';

/**
 * Invited accounts stay only while they use Today: adding a task by hand stamps `profiles/{uid}.lastAdded`, and
 * a member who hasn't added one for IDLE_DAYS is taken off the invitations by the owners' Haru (whenever an owner
 * has it open). Each one taken off is kept in `expired/{email}`, listed in Settings for EXPIRED_VIEWER.
 */
export const IDLE_DAYS = 5;
const IDLE_MS = IDLE_DAYS * 86_400_000;
/** When the rule began: nobody already invited counts as idle from before it (local midnight, 2026-10-25). */
const RULE_START = new Date(2026, 9, 25).getTime();
/** The owners never expire (they aren't on the invitations anyway). */
const OWNERS = ['publicclaude223@gmail.com', 'yeomsh09@gmail.com'];
/** The account whose Settings show the expired members. */
export const EXPIRED_VIEWER = 'yeomsh09@gmail.com';

export interface Expired {
  email: string;
  name: string;
  invited: number;
  lastAdded: number;
  expiredAt: number;
}

// a burst of adds writes once
const STAMP_GAP = 10 * 60_000;
let lastStamp = 0;

/** Stamps the signed-in account's profile whenever Today gets a task by hand. */
export function mountActivity(): void {
  const stamp = () => {
    const s = session();
    if (!s || Date.now() - lastStamp < STAMP_GAP) return;
    lastStamp = Date.now();
    const { fs, db } = s.fb;
    void fs.setDoc(fs.doc(db, 'profiles', s.uid), { lastAdded: lastStamp }, { merge: true }).catch(() => (lastStamp = 0));
  };
  onAdded(stamp);
  onSession((s) => {
    if (!s) lastStamp = 0;
  });
}

/** Since when a member has been idle: their last task, their invitation, or the rule's start, whichever is latest. */
export const activeSince = (invited: number, lastAdded: number): number => Math.max(invited, lastAdded, RULE_START);

/**
 * Owner only: takes off every invited account idle for IDLE_DAYS, recording each in `expired/{email}` in the same
 * write (so no one goes without a record). `members` maps each invitation's email to its invited time.
 */
export async function sweepIdle(
  fb: Fb,
  members: Map<string, number>,
  profiles: Map<string, { name: string; lastAdded: number }>,
): Promise<void> {
  const { fs, db } = fb;
  const now = Date.now();
  const batch = fs.writeBatch(db);
  let n = 0;
  for (const [email, invited] of members) {
    if (OWNERS.includes(email)) continue;
    const p = profiles.get(email);
    const lastAdded = p?.lastAdded ?? 0;
    if (now - activeSince(invited, lastAdded) < IDLE_MS) continue;
    const rec: Expired = { email, name: p?.name ?? '', invited, lastAdded, expiredAt: now };
    batch.set(fs.doc(db, 'expired', email), rec);
    batch.delete(fs.doc(db, 'allow', email));
    n++;
  }
  if (n) await batch.commit().catch(() => {});
}
