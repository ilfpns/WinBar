import { cloudConfigured, loadFirebase, type Fb } from './firebase';
import { startSync, type SyncStatus } from './sync';
import { icon } from '../ui/icons';

/**
 * Sign-in with Google, invite-only. Who may use Haru is the `allow/{email}` collection (the owner manages it;
 * Firestore rules enforce it). Until a signed-in, invited account is confirmed, a gate covers the app.
 * Without a Firebase config the app stays local and none of this appears.
 */
const INVITED_KEY = 'haru:invited';

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
  const showGate = (text: string, canSignIn: boolean, canSwitch = false) => {
    gate.hidden = false;
    document.body.classList.add('gated');
    msg.textContent = text;
    signInBtn.hidden = !canSignIn;
    otherBtn.hidden = !canSwitch;
  };
  const hideGate = () => {
    gate.classList.add('leaving');
    document.body.classList.remove('gated');
    setTimeout(() => {
      gate.hidden = true;
      gate.classList.remove('leaving');
    }, 350);
  };
  showGate('', false);

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
      if (!user) {
        signOut.hidden = true;
        who.replaceChildren();
        status.textContent = '';
        showGate('Sign in with an invited Google account.', true);
        return;
      }
      const email = (user.email ?? '').toLowerCase();
      // invited? (the owner is always allowed by the rules; reading the own allow entry is permitted to everyone)
      showGate('Checking access…', false);
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
      hideGate();
      renderWho(user.displayName ?? email, email, user.photoURL);
      stopSync = startSync(fb, user.uid, (s) => (status.textContent = labels[s]));
      if (owner) mountInvites(fb, email);
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

  /** Owner only: invite Google accounts by email, and remove them. */
  function mountInvites(fb: Fb, ownerEmail: string): void {
    const { fs, db } = fb;
    invites.hidden = false;
    const form = document.createElement('form');
    form.className = 'tpl-save';
    form.innerHTML = '<input type="email" placeholder="Invite by Google email" aria-label="Email to invite" required><button type="submit" class="icon-btn" aria-label="Invite"></button>';
    form.querySelector('button')!.append(icon('plus'));
    const input = form.querySelector('input')!;
    const list = document.createElement('ul');
    list.className = 'acct-list';
    // tucked behind a one-line toggle so the drawer stays short
    const more = document.createElement('details');
    more.className = 'acct-more';
    const summary = document.createElement('summary');
    const count = document.createElement('span');
    count.className = 'meta';
    summary.append(icon('chevron-right'), 'Invites', count);
    more.append(summary, form, list);
    invites.replaceChildren(more);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!email || email === ownerEmail) return;
      input.value = '';
      void fs.setDoc(fs.doc(db, 'allow', email), { email, invited: Date.now(), by: ownerEmail });
    });
    const unsub = fs.onSnapshot(fs.collection(db, 'allow'), (snap) => {
      const rows = snap.docs.map((d) => d.id).sort();
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
        const span = document.createElement('span');
        span.textContent = email;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'tpl-del';
        del.setAttribute('aria-label', `Remove ${email}`);
        del.append(icon('x'));
        del.addEventListener('click', () => void fs.deleteDoc(fs.doc(db, 'allow', email)));
        li.append(span, del);
        return li;
      }));
    });
    // stop listening when this account signs out
    const { authMod, auth } = fbRef!;
    const off = authMod.onAuthStateChanged(auth, (u) => {
      if (u?.email?.toLowerCase() === ownerEmail) return;
      unsub();
      off();
    });
  }
}
