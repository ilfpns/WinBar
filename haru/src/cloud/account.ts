import { cloudConfigured, loadFirebase, type Fb } from './firebase';
import { startSync, type SyncStatus } from './sync';
import { setSession } from './session';
import { icon } from '../ui/icons';
import { askConfirm } from '../ui/modal';
import { switchAccountData } from '../storage/backup';
import { EXPIRED_VIEWER, IDLE_DAYS, OWNERS, sweepIdle, type Expired } from './activity';

/**
 * Sign-in with Google, invite-only. Who may use Haru is the `allow/{email}` collection (the owners manage it;
 * Firestore rules enforce it). Until a signed-in, invited account is confirmed, a gate covers the app.
 * Everyone's planner is their own: on a shared device, another account signing in puts the previous one's
 * data aside first. Without a Firebase config the app stays local and none of this appears.
 */
const INVITED_KEY = 'haru:invited';
/** Every account confirmed invited on this device (uids). Kept through Sign out, so signing back in while the
 *  server can't be reached isn't taken for "not invited"; an account drops off only when the server says so. */
const CONFIRMED_KEY = 'haru:invited-uids';
const confirmedHere = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(CONFIRMED_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const setConfirmed = (uid: string, yes: boolean) => {
  try {
    const rest = confirmedHere().filter((x) => x !== uid);
    localStorage.setItem(CONFIRMED_KEY, JSON.stringify(yes ? [...rest, uid] : rest));
  } catch {
    // ignore
  }
};
/** Whose data this device holds (a uid); the first account to sign in takes over what was here. */
const DATA_OWNER_KEY = 'haru:data-owner';

export interface AccountRefs {
  section: HTMLElement;
}

export function mountAccount(refs: AccountRefs): void {
  if (!cloudConfigured) {
    // sign-in is switched off (development): say so where the account would be
    const note = document.createElement('p');
    note.className = 'set-note';
    note.textContent = 'Sign-in is off for now. Everything stays on this device; use Backup to keep a copy.';
    refs.section.append(note);
    return;
  }

  // ---------- the gate
  const gate = document.createElement('div');
  gate.className = 'gate';
  gate.innerHTML = `
    <div class="gate-card">
      <div class="brand"><span class="gate-mark"></span><span class="brand-name">Haru</span></div>
      <p class="gate-msg"></p>
      <button type="button" class="btn-solid gate-google">Sign in with Google</button>
      <button type="button" class="btn-solid gate-google gate-retry" hidden>Try again</button>
      <button type="button" class="btn-text gate-out" hidden>Use another account</button>
    </div>`;
  gate.querySelector('.gate-mark')!.append(icon('circle-dot'));
  document.body.append(gate);
  const msg = gate.querySelector<HTMLElement>('.gate-msg')!;
  const signInBtn = gate.querySelector<HTMLButtonElement>('.gate-google')!;
  const otherBtn = gate.querySelector<HTMLButtonElement>('.gate-out')!;
  const retryBtn = gate.querySelector<HTMLButtonElement>('.gate-retry')!;
  // reconnecting a known session (a reload): its own quiet screen, not the sign-in card
  const connect = document.createElement('div');
  connect.className = 'connect';
  connect.setAttribute('role', 'status');
  connect.innerHTML = '<span class="connect-mark"></span><p class="connect-msg"></p>';
  connect.querySelector('.connect-mark')!.append(icon('circle-dot'));
  connect.hidden = true;
  document.body.append(connect);
  const connectMsg = connect.querySelector<HTMLElement>('.connect-msg')!;

  let retry: (() => void) | null = null;
  // the connecting screen never stays for good: past STALL_MS it turns into the sign-in card with Try again
  const STALL_MS = 15_000;
  let stallTimer = 0;
  let onStall: () => void = () => showGate('This is taking longer than usual.', false, false, () => location.reload());
  const showGate = (text: string, canSignIn: boolean, canSwitch = false, onRetry: (() => void) | null = null) => {
    clearTimeout(stallTimer);
    connect.hidden = true;
    gate.hidden = false;
    document.body.classList.add('gated');
    msg.textContent = text;
    signInBtn.hidden = !canSignIn;
    otherBtn.hidden = !canSwitch;
    retry = onRetry;
    retryBtn.hidden = !onRetry;
  };
  retryBtn.addEventListener('click', () => retry?.());
  const showConnecting = (text = 'Connecting…') => {
    clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => onStall(), STALL_MS);
    gate.hidden = true;
    connect.hidden = false;
    document.body.classList.add('gated');
    connectMsg.textContent = text;
  };
  const hideGate = () => {
    clearTimeout(stallTimer);
    document.body.classList.remove('gated');
    for (const el of [gate, connect]) {
      if (el.hidden) continue;
      el.classList.add('leaving');
      setTimeout(() => {
        el.hidden = true;
        el.classList.remove('leaving');
      }, 350);
    }
  };
  // signed in before on this device: most likely still is, so start on the connecting screen
  let known = false;
  try {
    known = !!localStorage.getItem(INVITED_KEY);
  } catch {
    // unknown: the sign-in card
  }
  // Google refuses to sign in inside apps' own browsers (KakaoTalk, Instagram, …): say so before anyone tries
  const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|DaumApps|everytimeApp|; wv\)/i.test(navigator.userAgent);
  const inAppNote = 'Google sign-in doesn’t work in this app’s browser. Open Haru in Chrome or Safari.';
  if (known) showConnecting();
  else showGate(inApp ? inAppNote : '', false);

  // ---------- the section in Settings
  const who = document.createElement('div');
  who.className = 'acct-who';
  const status = document.createElement('span');
  status.className = 'meta acct-sync';
  refs.section.querySelector('.section-head')!.append(status);
  // Sign out sits at the end of the section
  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.className = 'btn-text acct-foot';
  signOut.append(icon('log-out'), 'Sign out');
  signOut.hidden = true;
  const invites = document.createElement('div');
  invites.className = 'acct-invites';
  invites.hidden = true;
  refs.section.append(who, invites, signOut);

  const labels: Record<SyncStatus, string> = { syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', error: 'Sync error' };
  let stopSync: (() => void) | null = null;
  let fbRef: Fb | null = null;

  void loadFirebase().then((fb) => {
    fbRef = fb;
    const { auth, authMod, fs, db } = fb;
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const SIGN_IN_ERRORS: Record<string, string> = {
      'auth/popup-blocked': 'The sign-in window was blocked. Allow pop-ups for this site and try again.',
      'auth/network-request-failed': 'No connection. Check the connection and try again.',
      'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
      'auth/web-storage-unsupported': 'This browser blocks the storage sign-in needs. Allow site data or use another browser.',
      'auth/operation-not-supported-in-this-environment': inAppNote,
      'auth/internal-error': 'Sign-in failed. Reload the page and try again.',
    };
    const signIn = () => {
      if (signInBtn.disabled) return;
      signInBtn.disabled = true;
      authMod.signInWithPopup(auth, provider).catch((e: { code?: string }) => {
        const code = e?.code ?? '';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return;
        showGate(SIGN_IN_ERRORS[code] ?? (inApp ? inAppNote : `Sign-in failed (${code || 'unknown'}). Try again.`), true, !!auth.currentUser);
      }).finally(() => (signInBtn.disabled = false));
    };
    signInBtn.addEventListener('click', signIn);
    // loaded, but the account isn't answering: offer signing in again (or a reload)
    onStall = () => showGate('This is taking longer than usual.', true, false, () => location.reload());
    otherBtn.addEventListener('click', () => void authMod.signOut(auth));
    signOut.addEventListener('click', () => void authMod.signOut(auth));

    /**
     * Is `email` invited? Asked of the server itself (a cached answer can be old, or missing for an account new to
     * this device), a few times over a few seconds; 'unknown' when the server can't be reached at all.
     */
    const askInvited = async (email: string): Promise<'yes' | 'no' | 'unknown'> => {
      for (let i = 0; i < 3; i++) {
        try {
          const ask = fs.getDocFromServer(fs.doc(db, 'allow', email));
          const late = new Promise<never>((_, no) => setTimeout(() => no(new Error('slow')), 4000));
          return (await Promise.race([ask, late])).exists() ? 'yes' : 'no';
        } catch (e) {
          // refused (signed in, but not invited): the rules deny reading no entry but one's own
          if ((e as { code?: string })?.code === 'permission-denied') return 'no';
          await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        }
      }
      try {
        return (await fs.getDocFromCache(fs.doc(db, 'allow', email))).exists() ? 'yes' : 'unknown';
      } catch {
        return 'unknown';
      }
    };

    let checking = 0;
    const onUser = async (user: import('firebase/auth').User | null) => {
      const run = checking + 1;
      onStall = () => {
        if (run === checking) showGate('This is taking longer than usual.', true, !!user, () => void onUser(auth.currentUser));
      };
      try {
        await checkUser(user);
      } catch (e) {
        if (run !== checking) return;
        console.error('Haru sign-in', e);
        if (document.body.classList.contains('gated')) {
          showGate(`Something went wrong while signing in (${(e as { code?: string; message?: string })?.code ?? (e as Error)?.message ?? 'unknown'}). Try again.`, true, !!user, () => void onUser(auth.currentUser));
        }
      }
    };
    const checkUser = async (user: import('firebase/auth').User | null) => {
      const run = ++checking;
      stopSync?.();
      stopSync = null;
      invites.hidden = true;
      setSession(null);
      if (!user) {
        signOut.hidden = true;
        who.replaceChildren();
        status.textContent = '';
        // signed out: the next visit starts on the sign-in card, not the connecting screen
        try {
          localStorage.removeItem(INVITED_KEY);
        } catch {
          // ignore
        }
        showGate(inApp ? inAppNote : 'Sign in with an invited Google account.', true);
        return;
      }
      const email = (user.email ?? '').trim().toLowerCase();
      if (!email) {
        showGate('This Google account has no email address Haru can check. Use another account.', false, true);
        return;
      }
      // invited? (the owners always are, by the rules; reading one's own allow entry is permitted to everyone)
      showConnecting(known ? 'Connecting…' : 'Checking access…');
      const owner = OWNERS.includes(email);
      const answer = owner ? 'yes' : await askInvited(email);
      if (run !== checking) return;
      // the server can't be reached: an account confirmed on this device before goes on (offline), any other waits
      let before = confirmedHere().includes(user.uid);
      try {
        before ||= localStorage.getItem(INVITED_KEY) === user.uid;
      } catch {
        // ignore
      }
      const allowed = answer === 'yes' || (answer === 'unknown' && before);
      if (!allowed) {
        try {
          localStorage.removeItem(INVITED_KEY);
        } catch {
          // ignore
        }
        if (answer === 'no') {
          setConfirmed(user.uid, false);
          showGate(`${user.email} isn't invited to Haru yet.`, false, true);
        } else showGate("Couldn't reach Haru to check your invitation. Check the connection and try again.", false, true, () => void onUser(user));
        return;
      }
      setConfirmed(user.uid, true);
      try {
        localStorage.setItem(INVITED_KEY, user.uid);
      } catch {
        // ignore
      }
      // someone else's data is on this device: put it aside and bring this account's in
      let dataOwner: string | null = null;
      try {
        dataOwner = localStorage.getItem(DATA_OWNER_KEY);
      } catch {
        // ignore
      }
      if (dataOwner && dataOwner !== user.uid) {
        showConnecting('Getting your Haru ready…');
        try {
          await switchAccountData(dataOwner, user.uid);
        } catch (e) {
          // nothing is lost: the other account's data was put aside first (or not touched), and this one's is in the cloud
          console.error('Haru account switch', e);
          if (run === checking) showGate("Couldn't get this account's Haru ready on this device. Try again.", false, true, () => void onUser(user));
          return;
        }
        if (run !== checking) return;
      }
      try {
        localStorage.setItem(DATA_OWNER_KEY, user.uid);
      } catch {
        // ignore
      }
      hideGate();
      // taken off the invitations while signed in: locked out right away (the rules already refuse its data)
      if (!owner) {
        // only the server's word counts: this device's copy of the entry can be old (or never fetched)
        const stopWatch = fs.onSnapshot(fs.doc(db, 'allow', email), { includeMetadataChanges: true }, (snap) => {
          if (snap.exists() || snap.metadata.fromCache) return;
          setConfirmed(user.uid, false);
          stopWatch();
          stopSync?.();
          stopSync = null;
          setSession(null);
          try {
            localStorage.removeItem(INVITED_KEY);
          } catch {
            // ignore
          }
          showGate(`${user.email} was removed from Haru.`, false, true);
        }, () => {});
        const offWatch = authMod.onAuthStateChanged(auth, (u) => {
          if (u?.uid === user.uid) return;
          stopWatch();
          offWatch();
        });
      }
      const name = user.displayName ?? email;
      renderWho(name, email, user.photoURL);
      try {
        stopSync = startSync(fb, user.uid, (s) => (status.textContent = labels[s]));
      } catch (e) {
        // signed in all the same: the planner keeps working on this device
        console.error('Haru sync', e);
        status.textContent = labels.error;
      }
      if (owner) mountInvites(fb, email);
      // how the others see this account (the Today switcher, the Archive)
      // (merged, so anything else the profile holds stays)
      void fs.setDoc(fs.doc(db, 'profiles', user.uid), { uid: user.uid, name, email, photo: user.photoURL ?? null, updated: Date.now() }, { merge: true }).catch(() => {});
      setSession({ fb, uid: user.uid, email, name, photo: user.photoURL ?? null, owner });
    };
    authMod.onAuthStateChanged(auth, (user) => void onUser(user));
  }).catch((e) => {
    console.error('Haru sign-in load', e);
    // offline: keep working locally (what's on this device stays usable)
    if (!navigator.onLine) {
      hideGate();
      refs.section.hidden = true;
      return;
    }
    // online, yet sign-in couldn't load (most often an open page from before a new version): reload, never go on
    // quietly without the account
    showGate("Sign-in couldn't load. Reload Haru to continue.", false, false, () => location.reload());
    retryBtn.textContent = 'Reload';
  });

  function renderWho(name: string, email: string, photo: string | null): void {
    const avatar = document.createElement('span');
    avatar.className = 'acct-avatar';
    if (photo) {
      const img = document.createElement('img');
      img.src = photo;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      avatar.append(img);
    } else avatar.textContent = (name[0] ?? '?').toUpperCase();
    const text = document.createElement('span');
    text.className = 'acct-text';
    text.innerHTML = '<span class="acct-name"></span><span class="acct-mail meta"></span>';
    text.querySelector('.acct-name')!.textContent = name;
    text.querySelector('.acct-mail')!.textContent = email;
    who.replaceChildren(avatar, text);
    signOut.hidden = false;
  }

  /**
   * Owner only: the members (invited accounts) with their names; invite by email, and Kick one (asked first).
   * Members idle on Today for IDLE_DAYS are taken off by themselves (checked now and every hour while open);
   * EXPIRED_VIEWER also sees them under Expired, and can invite one again.
   */
  function mountInvites(fb: Fb, ownerEmail: string): void {
    const { fs, db } = fb;
    invites.hidden = false;
    const form = document.createElement('form');
    form.className = 'tpl-save';
    form.innerHTML = '<input type="email" placeholder="Invite by Google email" aria-label="Email to invite" required><button type="submit" class="icon-btn" aria-label="Invite" title="Invite"></button>';
    form.querySelector('button')!.append(icon('plus'));
    const input = form.querySelector('input')!;
    const list = document.createElement('ul');
    list.className = 'acct-list';
    // open from the start: who is in Haru, at a glance
    const more = document.createElement('details');
    more.className = 'acct-more';
    more.open = true;
    const summary = document.createElement('summary');
    const count = document.createElement('span');
    count.className = 'meta';
    summary.append(icon('chevron-right'), 'Members', count);
    more.append(summary, form, list);
    invites.replaceChildren(more);
    // names and last task added, from the profiles of those who have signed in
    let profiles = new Map<string, { name: string; lastAdded: number }>();
    let names = new Map<string, string>();
    let rows: string[] = [];
    let invitedAt = new Map<string, number>();
    // both lists loaded at least once: only then can anyone be judged idle
    let gotProfiles = false;
    let gotAllow = false;
    const sweep = () => {
      if (gotProfiles && gotAllow) void sweepIdle(fb, invitedAt, profiles);
    };
    const unsubNames = fs.onSnapshot(fs.collection(db, 'profiles'), (snap) => {
      profiles = new Map(snap.docs.map((d) => {
        const p = d.data() as { email?: string; name?: string; lastAdded?: number };
        return [String(p.email ?? '').toLowerCase(), { name: String(p.name ?? ''), lastAdded: Number(p.lastAdded) || 0 }] as const;
      }));
      names = new Map([...profiles].map(([e, p]) => [e, p.name]));
      const first = !gotProfiles;
      gotProfiles = true;
      paintRows();
      if (first) sweep();
    }, () => {});
    const timer = setInterval(sweep, 60 * 60_000);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!email || email === ownerEmail) return;
      input.value = '';
      invite(email);
    });
    // invited (again): a fresh start, and off the expired list
    function invite(email: string): void {
      const entry = { email, invited: Date.now(), by: ownerEmail };
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, 'allow', email), entry);
      batch.delete(fs.doc(db, 'expired', email));
      // the rules for `expired` not published yet: the invitation alone
      void batch.commit().catch(() => fs.setDoc(fs.doc(db, 'allow', email), entry));
    }
    const unsub = fs.onSnapshot(fs.collection(db, 'allow'), (snap) => {
      rows = snap.docs.map((d) => d.id).sort();
      invitedAt = new Map(snap.docs.map((d) => [d.id, Number((d.data() as { invited?: number }).invited) || 0]));
      const first = !gotAllow;
      gotAllow = true;
      paintRows();
      if (first) sweep();
    });
    const unsubExpired = ownerEmail === EXPIRED_VIEWER ? mountExpired() : () => {};
    function paintRows(): void {
      count.textContent = String(rows.length);
      if (!rows.length) {
        const li = document.createElement('li');
        li.className = 'tpl-empty';
        li.textContent = 'Only you so far';
        list.replaceChildren(li);
        return;
      }
      list.replaceChildren(...rows.map((email) => {
        const li = document.createElement('li');
        li.className = 'acct-member';
        const who = document.createElement('span');
        who.className = 'acct-member-who';
        const name = names.get(email);
        who.append(Object.assign(document.createElement('strong'), { textContent: name || 'Not signed in yet' }), Object.assign(document.createElement('span'), { className: 'meta', textContent: email }));
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'btn-sm acct-kick';
        kick.textContent = 'Kick';
        kick.setAttribute('aria-label', `Kick ${email}`);
        kick.addEventListener('click', async () => {
          if (!(await askConfirm({ title: `Kick ${name || email}?`, body: `${email} loses access to Haru right away (an open Haru locks). Invite again to bring them back.`, ok: 'Kick', danger: true }))) return;
          await fs.deleteDoc(fs.doc(db, 'allow', email)).catch(() => {});
        });
        li.append(who, kick);
        return li;
      }));
    }
    /** The members taken off for being idle, newest first; one can be invited again. */
    function mountExpired(): () => void {
      const box = document.createElement('details');
      box.className = 'acct-more';
      const head = document.createElement('summary');
      const n = document.createElement('span');
      n.className = 'meta';
      head.append(icon('chevron-right'), 'Expired', n);
      const note = document.createElement('p');
      note.className = 'set-note';
      note.textContent = `Taken off after ${IDLE_DAYS} days without adding a task to Today`;
      const ul = document.createElement('ul');
      ul.className = 'acct-list';
      box.append(head, note, ul);
      invites.append(box);
      const day = (t: number) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
      return fs.onSnapshot(fs.collection(db, 'expired'), (snap) => {
        const gone = snap.docs.map((d) => d.data() as Expired).sort((a, b) => b.expiredAt - a.expiredAt);
        n.textContent = String(gone.length);
        if (!gone.length) {
          const li = document.createElement('li');
          li.className = 'tpl-empty';
          li.textContent = 'No one has expired';
          ul.replaceChildren(li);
          return;
        }
        ul.replaceChildren(...gone.map((x) => {
          const li = document.createElement('li');
          li.className = 'acct-member';
          const who = document.createElement('span');
          who.className = 'acct-member-who';
          who.append(
            Object.assign(document.createElement('strong'), { textContent: x.name || x.email }),
            Object.assign(document.createElement('span'), { className: 'meta', textContent: `${x.email} · last task ${day(x.lastAdded)} · expired ${day(x.expiredAt)}` }),
          );
          const again = document.createElement('button');
          again.type = 'button';
          again.className = 'btn-sm';
          again.textContent = 'Invite again';
          again.setAttribute('aria-label', `Invite ${x.email} again`);
          again.addEventListener('click', () => invite(x.email));
          li.append(who, again);
          return li;
        }));
      }, () => {
        // the rules for `expired` aren't published yet
        n.textContent = '';
        const li = document.createElement('li');
        li.className = 'tpl-empty';
        li.textContent = 'Expired list isn’t allowed yet: the Firestore rules need publishing again';
        ul.replaceChildren(li);
      });
    }

    // stop listening when this account signs out
    const { authMod, auth } = fbRef!;
    const off = authMod.onAuthStateChanged(auth, (u) => {
      if (u?.email?.toLowerCase() === ownerEmail) return;
      unsub();
      unsubNames();
      unsubExpired();
      clearInterval(timer);
      off();
    });
  }
}
