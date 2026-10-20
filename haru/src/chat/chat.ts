import { avatar, onSession, session, type Session } from '../cloud/session';
import { icon } from '../ui/icons';
import { askConfirm } from '../ui/modal';
import { currentView, onView } from '../ui/router';
import { setBadge } from '../ui/badge';

/**
 * Chat: one room for everyone invited, under Archive. Messages arrive live (the latest 300), every one on the
 * left with who sent it (face and name; yours marked "me" and tinted); a run of messages from one person within
 * a few minutes shares one name line, and days are marked.
 * A message from someone else you haven't seen puts a bouncing dot (and how many) on Chat's buttons until
 * you open the room. You can take back your own messages.
 */
interface Message {
  uid: string;
  name: string;
  photo: string | null;
  text: string;
  at: number;
}
const MAX = 1000;
const RUN = 5 * 60_000;
const SEEN_KEY = (uid: string) => `haru:chat-seen:${uid}`;

const dayLabel = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

export function mountChat(body: HTMLElement, sum: HTMLElement): void {
  body.innerHTML = `
    <section class="chat glass-card" aria-label="Chat">
      <ol class="chat-list" aria-live="polite"></ol>
      <form class="chat-form">
        <textarea class="set-input chat-input" rows="1" maxlength="${MAX}" placeholder="Message everyone" aria-label="Message everyone"></textarea>
        <button type="submit" class="btn-sm chat-send" aria-label="Send"></button>
      </form>
      <p class="chat-err" role="alert" hidden></p>
    </section>`;
  const list = body.querySelector<HTMLOListElement>('.chat-list')!;
  const form = body.querySelector<HTMLFormElement>('.chat-form')!;
  const input = body.querySelector<HTMLTextAreaElement>('.chat-input')!;
  const send = body.querySelector<HTMLButtonElement>('.chat-send')!;
  const err = body.querySelector<HTMLElement>('.chat-err')!;
  send.append(icon('arrow-right'));

  let msgs: { id: string; m: Message }[] = [];
  let drawn = new Set<string>();
  let stop: (() => void) | null = null;

  // ---- unread: others' messages newer than the last time you had the room open
  const seenAt = (uid: string) => {
    try {
      return Number(localStorage.getItem(SEEN_KEY(uid))) || 0;
    } catch {
      return 0;
    }
  };
  const looking = () => currentView() === 'chat' && document.visibilityState === 'visible';
  function paintDot(): void {
    const s = session();
    if (s && looking() && msgs.length) {
      try {
        localStorage.setItem(SEEN_KEY(s.uid), String(msgs[msgs.length - 1]!.m.at));
      } catch {
        // for this visit
      }
    }
    const n = s ? msgs.filter(({ m }) => m.uid !== s.uid && m.at > seenAt(s.uid)).length : 0;
    setBadge('chat', n);
    for (const el of document.querySelectorAll<HTMLElement>('[data-view="chat"]')) {
      el.classList.toggle('has-unread', n > 0);
      if (n) el.dataset.unread = String(Math.min(n, 99));
      else delete el.dataset.unread;
    }
  }
  onView(() => paintDot());
  document.addEventListener('visibilitychange', paintDot);

  const fit = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    send.disabled = !input.value.trim() || !session();
  };
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  function note(text: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'chat-note';
    li.textContent = text;
    return li;
  }

  function render(): void {
    const s = session();
    const people = new Set(msgs.map(({ m }) => m.uid)).size;
    sum.textContent = s && msgs.length ? `${people} ${people === 1 ? 'person' : 'people'} · ${msgs.length} ${msgs.length === 1 ? 'message' : 'messages'}` : '';
    if (!s) {
      list.replaceChildren(note('Sign in to chat with everyone invited.'));
      return;
    }
    if (!msgs.length) {
      list.replaceChildren(note('No messages yet. Say hello.'));
      return;
    }
    // stay at the bottom when you were there (or the new message is yours)
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const out: HTMLElement[] = [];
    let prev: Message | null = null;
    for (const { id, m } of msgs) {
      if (!prev || dayLabel(prev.at) !== dayLabel(m.at)) {
        const d = document.createElement('li');
        d.className = 'chat-day';
        d.textContent = dayLabel(m.at);
        out.push(d);
      }
      const mine = m.uid === s.uid;
      const cont = !!prev && prev.uid === m.uid && m.at - prev.at < RUN && dayLabel(prev.at) === dayLabel(m.at);
      const li = document.createElement('li');
      li.className = `chat-msg${mine ? ' mine' : ''}${cont ? ' cont' : ''}${drawn.has(id) ? '' : ' new'}`;
      drawn.add(id);
      // who sent it: their face by every run, their name over its first message
      const face = avatar({ name: m.name, photo: m.photo }, 'a-avatar chat-face');
      if (cont) face.style.visibility = 'hidden';
      li.append(face);
      const col = document.createElement('div');
      col.className = 'chat-col';
      if (!cont) {
        const who = document.createElement('span');
        who.className = 'chat-who';
        who.textContent = m.name;
        if (mine) who.append(Object.assign(document.createElement('span'), { className: 'chat-me', textContent: 'me' }));
        col.append(who);
      }
      const row = document.createElement('div');
      row.className = 'chat-row';
      const bubble = document.createElement('p');
      bubble.className = 'chat-bubble';
      bubble.textContent = m.text;
      const time = document.createElement('span');
      time.className = 'chat-time';
      time.textContent = clock(m.at);
      row.append(bubble, time);
      if (mine) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'tpl-del chat-del';
        del.setAttribute('aria-label', 'Delete message');
        del.title = 'Delete message';
        del.append(icon('x'));
        del.addEventListener('click', async () => {
          if (!(await askConfirm({ title: 'Delete this message?', danger: true }))) return;
          const { fs, db } = s.fb;
          await fs.deleteDoc(fs.doc(db, 'chat', id)).catch(() => {});
        });
        row.append(del);
      }
      col.append(row);
      li.append(col);
      out.push(li);
      prev = m;
    }
    list.replaceChildren(...out);
    const last = msgs[msgs.length - 1]!.m;
    if (atBottom || last.uid === s.uid) list.scrollTop = list.scrollHeight;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = session();
    const text = input.value.trim();
    if (!s || !text) return;
    // cleared first: the message shows before the write is confirmed
    input.value = '';
    fit();
    err.hidden = true;
    const { fs, db } = s.fb;
    const m: Message = { uid: s.uid, name: s.name, photo: s.photo, text: text.slice(0, MAX), at: Date.now() };
    try {
      await fs.addDoc(fs.collection(db, 'chat'), m);
    } catch (x) {
      input.value = text;
      fit();
      err.textContent = String((x as { code?: string })?.code ?? '').includes('permission')
        ? 'Chat isn’t allowed yet: the Firestore rules need publishing again'
        : 'Couldn’t send. Check your connection.';
      err.hidden = false;
    }
    input.focus();
  });

  function listen(s: Session | null): void {
    stop?.();
    stop = null;
    msgs = [];
    drawn = new Set();
    if (s) {
      const { fs, db } = s.fb;
      stop = fs.onSnapshot(fs.query(fs.collection(db, 'chat'), fs.orderBy('at', 'desc'), fs.limit(300)), (snap) => {
        msgs = snap.docs.map((d) => ({ id: d.id, m: d.data() as Message })).reverse();
        render();
        paintDot();
      }, () => {
        list.replaceChildren(note('The chat couldn’t be loaded. Check your connection.'));
      });
    }
    render();
    paintDot();
    fit();
  }
  onSession(listen);
  listen(session());
}
