import { cloudConfigured, loadFirebase, type Fb } from './firebase';
import { startSync, type SyncStatus } from './sync';
import { setSession } from './session';
import { icon } from '../ui/icons';
import { askConfirm } from '../ui/modal';
import { switchAccountData } from '../storage/backup';

/**
 * Sign-in with Google, invite-only. Who may use Haru is the `allow/{email}` collection (the owners manage it;
 * Firestore rules enforce it). Until a signed-in, invited account is confirmed, a gate covers the app.
 * Everyone's planner is their own: on a shared device, another account signing in puts the previous one's
 * data aside first. Without a Firebase config the app stays local and none of this appears.
 */
const INVITED_KEY = 'haru:invited';
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
      <button type="button" class="btn-text gate-out" hidden>Use another account</button>
    </div>`;
  gate.querySelector('.gate-mark')!.append(icon('circle-dot'));
  document.body.append(gate);
  const msg = gate.querySelector<HTMLElement>('.gate-msg')!;
  const signInBtn = gate.querySelector<HTMLButtonElement>('.gate-google')!;
  const otherBtn = gate.querySelector<HTMLButtonElement>('.gate-out')!;
  // reconnecting a known session (a reload): its own quiet screen, not the sign-in card
  const connect = document.createElement('div');
  connect.className = 'connect';
  connect.setAttribute('role', 'status');
  connect.innerHTML = '<span class="connect-mark"></span><p class="connect-msg"></p>';
  connect.querySelector('.connect-mark')!.append(icon('circle-dot'));
  connect.hidden = true;
  document.body.append(connect);
  const connectMsg = connect.querySelector<HTMLElement>('.connect-msg')!;

  const showGate = (text: string, canSignIn: boolean, canSwitch = false) => {
    connect.hidden = true;
    gate.hidden = false;
    document.body.classList.add('gated');
    msg.textContent = text;
    signInBtn.hidden = !canSignIn;
    otherBtn.hidden = !canSwitch;
  };
  const showConnecting = (text = 'Connecting…') => {
    gate.hidden = true;
    connect.hidden = false;
    document.body.classList.add('gated');
    connectMsg.textContent = text;
  };
  const hideGate = () => {
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
  if (known) showConnecting();
  else showGate('', false);

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
    const signIn = () => void authMod.signInWithPopup(auth, provider).catch((e: { code?: string }) => {
      if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') showGate('Sign-in failed. Try again.', true);
    });
    signInBtn.addEventListener('click', signIn);
    otherBtn.addEventListener('click', () => void authMod.signOut(auth));
    signOut.addEventListener('click', () => void authMod.signOut(auth));

    authMod.onAuthStateChanged(auth, async (user) => {
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
        showGate('Sign in with an invited Google account.', true);
        return;
      }
      const email = (user.email ?? '').toLowerCase();
      // invited? (the owner is always allowed by the rules; reading the own allow entry is permitted to everyone)
      showConnecting(known ? 'Connecting…' : 'Checking access…');
      let allowed = false;
      let owner = false;
      try {
        await fs.getDocs(fs.query(fs.collection(db, 'allow'), fs.limit(1)));
        owner = true; // only the owner may list the invitations
        allowed = true;
      } catch {
        try {
          allowed = (await fs.getDoc(fs.doc(db, 'allow', email))).exists();
        } catch {
          // offline: trust the last confirmed answer for this account
          allowed = localStorage.getItem(INVITED_KEY) === user.uid;
        }
      }
      if (!allowed) {
        localStorage.removeItem(INVITED_KEY);
        showGate(`${user.email} isn't invited to Haru yet.`, false, true);
        return;
      }
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
        await switchAccountData(dataOwner, user.uid);
      }
      try {
        localStorage.setItem(DATA_OWNER_KEY, user.uid);
      } catch {
        // ignore
      }
      hideGate();
      // taken off the invitations while signed in: locked out right away (the rules already refuse its data)
      if (!owner) {
        const stopWatch = fs.onSnapshot(fs.doc(db, 'allow', email), (snap) => {
          if (snap.exists()) return;
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
      stopSync = startSync(fb, user.uid, (s) => (status.textContent = labels[s]));
      if (owner) mountInvites(fb, email);
      // how the others see this account (the Today switcher, the Archive)
      // (merged, so anything else the profile holds stays)
      void fs.setDoc(fs.doc(db, 'profiles', user.uid), { uid: user.uid, name, email, photo: user.photoURL ?? null, updated: Date.now() }, { merge: true }).catch(() => {});
      setSession({ fb, uid: user.uid, email, name, photo: user.photoURL ?? null, owner });
    });
  }).catch(() => {
    // Firebase couldn't load (offline on first visit): keep working locally
    hideGate();
    refs.section.hidden = true;
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

  /** Owner only: the members (invited accounts) with their names; invite by email, and Kick one (asked first). */
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
    // names, from the profiles of those who have signed in
    let names = new Map<string, string>();
    let rows: string[] = [];
    const unsubNames = fs.onSnapshot(fs.collection(db, 'profiles'), (snap) => {
      names = new Map(snap.docs.map((d) => {
        const p = d.data() as { email?: string; name?: string };
        return [String(p.email ?? '').toLowerCase(), String(p.name ?? '')] as [string, string];
      }));
      paintRows();
    }, () => {});
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!email || email === ownerEmail) return;
      input.value = '';
      void fs.setDoc(fs.doc(db, 'allow', email), { email, invited: Date.now(), by: ownerEmail });
    });
    const unsub = fs.onSnapshot(fs.collection(db, 'allow'), (snap) => {
      rows = snap.docs.map((d) => d.id).sort();
      paintRows();
    });
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
    // stop listening when this account signs out
    const { authMod, auth } = fbRef!;
    const off = authMod.onAuthStateChanged(auth, (u) => {
      if (u?.email?.toLowerCase() === ownerEmail) return;
      unsub();
      unsubNames();
      off();
    });
  }
}
