import { avatar, onSession, session, type Session } from '../cloud/session';
import { mentionable } from '../cloud/viewing';
import { mentionsIn } from '../ui/markdown';
import { icon } from '../ui/icons';
import { askConfirm } from '../ui/modal';
import { currentView, onView } from '../ui/router';
import { setBadge } from '../ui/badge';
import { renderMarkdown } from '../ui/markdown';
import '../ui/md-editor';
import { type EditorCommand, type MdEditor } from '../ui/md-editor';
import { mountBoard } from './board';
import { mountNotifyToggle, notifyMessage } from './notify';
import { fileRequest, isRequest, onOutcomes, outcomeLine, refreshOutcomes } from './requests';

/**
 * Chat: one room for everyone invited, under Archive. Messages arrive live (the latest 300), every one on the
 * left with who sent it (face and name; yours marked "me" and tinted); a run of messages from one person within
 * a few minutes shares one name line, and days are marked.
 * You write as in Journal (the same editor: formatting, lists, links with their site's logo, @ to name someone,
 * / for commands such as /변경요청), add photos (the clip, Ctrl+V or a drop; shrunk and carried in the message itself, so everyone
 * sees them) and emoji (the face button, or the system's own picker). Enter sends; in a list it starts the next
 * item, and Shift+Enter breaks the line.
 * A message from someone else you haven't seen puts a bouncing dot (and how many) on Chat's buttons until
 * you open the room. You can take back your own messages.
 */
interface Message {
  uid: string;
  name: string;
  photo: string | null;
  /** Markdown, as the editor writes it (may be empty when there are photos). */
  text: string;
  /** Photos as JPEG data URLs, shrunk to fit a message. */
  images?: string[];
  at: number;
  /** Filed as a change request ("@변경요청 …" from the admin). */
  request?: boolean;
  /** Who reacted, by reaction (their uids). */
  reactions?: Partial<Record<Reaction, string[]>>;
}
/** The reactions a message can take: a heart, a check. */
const REACTIONS = ['heart', 'check'] as const;
type Reaction = (typeof REACTIONS)[number];
const REACTION_LABEL: Record<Reaction, string> = { heart: 'Heart', check: 'Check' };
const MAX = 1000;
const MAX_IMAGES = 4;
/** Each photo is shrunk until it is about this many characters (a Firestore document holds 1 MB in all). */
const IMAGE_BUDGET = 200_000;
const RUN = 5 * 60_000;
const SEEN_KEY = (uid: string) => `haru:chat-seen:${uid}`;
const EMOJI = '😀 😂 🥹 😊 😍 🥰 😎 🤔 😮 😢 😭 😡 🥳 😴 🤯 🙏 👍 👎 👏 🙌 💪 👀 🔥 ✨ 🎉 💯 ❤️ 💚 💙 ✅ ❌ ⭐ ☕ 🍕 🍚 📚 💻 📝 ⏰ 📌'.split(' ');

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

/** A photo made small enough to travel inside a message: at most 1280px, JPEG, under the budget. */
async function shrink(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  let side = 1280;
  let q = 0.82;
  for (;;) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length <= IMAGE_BUDGET || side <= 320) {
      bmp.close();
      return url;
    }
    if (q > 0.6) q -= 0.1;
    else side = Math.round(side * 0.75);
  }
}

export function mountChat(body: HTMLElement, sum: HTMLElement): void {
  body.innerHTML = `
    <section class="chat glass-card" aria-label="Chat">
      <ol class="chat-list" aria-live="polite"></ol>
      <div class="chat-pending" hidden></div>
      <form class="chat-form">
        <div class="chat-tools">
          <button type="button" class="icon-btn chat-attach" aria-label="Add photos" title="Add photos (or paste with Ctrl+V)"></button>
          <button type="button" class="icon-btn chat-emoji-btn" aria-label="Emoji" title="Emoji" aria-haspopup="dialog"></button>
          <button type="button" class="icon-btn chat-board-btn" aria-label="Draw on the chat" title="Draw on the chat (everyone sees it)" aria-pressed="false"></button>
        </div>
        <md-editor class="chat-input" aria-label="Message everyone"></md-editor>
        <button type="submit" class="btn-sm chat-send" aria-label="Send"></button>
        <input type="file" class="chat-file" accept="image/*" multiple hidden>
      </form>
      <p class="chat-err" role="alert" hidden></p>
    </section>`;
  const list = body.querySelector<HTMLOListElement>('.chat-list')!;
  const form = body.querySelector<HTMLFormElement>('.chat-form')!;
  const input = body.querySelector<MdEditor>('.chat-input')!;
  const send = body.querySelector<HTMLButtonElement>('.chat-send')!;
  const err = body.querySelector<HTMLElement>('.chat-err')!;
  const pendingEl = body.querySelector<HTMLElement>('.chat-pending')!;
  const attach = body.querySelector<HTMLButtonElement>('.chat-attach')!;
  const file = body.querySelector<HTMLInputElement>('.chat-file')!;
  const emojiBtn = body.querySelector<HTMLButtonElement>('.chat-emoji-btn')!;
  send.append(icon('arrow-right'));
  // the bell beside the title: notices for new messages
  mountNotifyToggle(sum.parentElement!);
  attach.append(icon('image-plus'));
  emojiBtn.append(icon('smile'));
  input.placeholder = 'Message everyone · @ to name someone';
  // in the chat, / is for commands (/변경요청), not Markdown blocks (those are typed as Markdown: # - > and so on)
  input.slashBlocks = false;
  input.people = () => mentionable(session()?.uid);
  // the chat's commands: / lists them all, each with an example (the admin also has /변경요청, see requests.ts)
  // (the bell sits in the page's title row, outside the chat's own box: looked up across the page)
  const press = (sel: string) => () => (body.closest('.page') ?? document).querySelector<HTMLButtonElement>(sel)?.click();
  input.commands = (): EditorCommand[] => [
    { label: '전체', hint: '모두 부르기', example: '/전체 내일 3시에 모여요', icon: 'users', keys: ['all', 'everyone'], text: '@[ALL](user:all) ' },
    { label: '사진', hint: '사진 올리기', example: '/사진 → 사진 고르기 (4장까지)', icon: 'image-plus', keys: ['photo', 'image'], run: press('.chat-attach') },
    { label: '이모지', hint: '이모지 넣기', example: '/이모지 → 이모지 고르기', icon: 'smile', keys: ['emoji'], run: press('.chat-emoji-btn') },
    { label: '그리기', hint: '채팅 위에 그리기', example: '/그리기 → 붓으로 그리기 켜고 끄기', icon: 'brush', keys: ['draw', 'board'], run: press('.chat-board-btn') },
    { label: '알림', hint: '알림 켜고 끄기', example: '/알림 → 새 메시지 알림', icon: 'bell', keys: ['bell', 'notify'], run: press('.chat-bell') },
    { label: '규칙', hint: 'Chat 사용 규칙', example: '/규칙 → 아카이브의 규칙 페이지', icon: 'pin', keys: ['rules', 'help'], run: () => (location.hash = '#/archive/rules') },
    ...(isRequest('/변경요청', session())
      ? [{ label: '변경요청', hint: 'Haru 수정 요청 (관리자)', example: '/변경요청 달력 글씨를 크게', icon: 'pencil' as const, keys: ['change', 'request'], text: '/변경요청 ' }]
      : []),
  ];

  let msgs: { id: string; m: Message }[] = [];
  let drawn = new Set<string>();
  const mentionsOf = (text: string, uid: string) => { const l = mentionsIn(text); return l.includes(uid) || l.includes('all'); };
  /** Messages already known (the first snapshot only fills this: notices are for what arrives after). */
  let known: Set<string> | null = null;
  let stop: (() => void) | null = null;
  /** Photos waiting to go with the next message. */
  let pending: string[] = [];

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
    send.disabled = (!input.value.trim() && !pending.length) || !session();
  };
  input.addEventListener('input', fit);
  // Enter sends; the editor has had it first (a / or @ menu takes it, a list carries on), so only an Enter it
  // left alone is ours
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    e.preventDefault();
    form.requestSubmit();
  });

  // ---- photos: the clip, Ctrl+V, or dropped on the room
  function paintPending(): void {
    pendingEl.hidden = !pending.length;
    pendingEl.replaceChildren(...pending.map((url, k) => {
      const item = document.createElement('div');
      item.className = 'chat-thumb';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'cal-img-del';
      x.setAttribute('aria-label', 'Remove photo');
      x.append(icon('x'));
      x.addEventListener('click', () => {
        pending.splice(k, 1);
        paintPending();
      });
      item.append(img, x);
      return item;
    }));
    fit();
  }
  async function addPhotos(files: Blob[]): Promise<void> {
    const imgs = files.filter((f) => f.type.startsWith('image/')).slice(0, MAX_IMAGES - pending.length);
    if (!imgs.length) {
      if (files.length && pending.length >= MAX_IMAGES) showError(`Up to ${MAX_IMAGES} photos a message`);
      return;
    }
    for (const f of imgs) pending.push(await shrink(f).catch(() => ''));
    pending = pending.filter(Boolean);
    paintPending();
    input.focus();
  }
  attach.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    void addPhotos([...(file.files ?? [])]);
    file.value = '';
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void addPhotos(files);
  });
  const room = body.querySelector<HTMLElement>('.chat')!;
  room.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) return;
    e.preventDefault();
    room.classList.add('drop');
  });
  room.addEventListener('dragleave', (e) => {
    if (!room.contains(e.relatedTarget as Node)) room.classList.remove('drop');
  });
  room.addEventListener('drop', (e) => {
    room.classList.remove('drop');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    void addPhotos(files);
  });

  // ---- drawing on the room itself, together
  mountBoard(room, list, body.querySelector<HTMLButtonElement>('.chat-board-btn')!);

  // ---- emoji: a small picker over the box; a pick goes in where the caret is
  const picker = document.createElement('div');
  picker.className = 'chat-emoji';
  picker.popover = 'auto';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Emoji');
  picker.append(...EMOJI.map((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.setAttribute('aria-label', em);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      const at = input.selectionStart;
      input.setRangeText(em, at, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.setSelectionRange(at + em.length);
    });
    return b;
  }));
  document.body.append(picker);
  emojiBtn.addEventListener('mousedown', (e) => e.preventDefault());
  emojiBtn.addEventListener('click', () => {
    if (picker.matches(':popover-open')) return picker.hidePopover();
    picker.showPopover();
    const r = emojiBtn.getBoundingClientRect();
    picker.style.left = `${Math.max(8, Math.min(r.left, innerWidth - picker.offsetWidth - 8))}px`;
    picker.style.top = `${Math.max(8, r.top - picker.offsetHeight - 8)}px`;
  });

  // ---- a photo opened large
  const viewer = document.createElement('dialog');
  viewer.className = 'img-view';
  const big = document.createElement('img');
  big.alt = '';
  viewer.append(big);
  viewer.addEventListener('click', () => viewer.close());
  document.body.append(viewer);

  function note(text: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'chat-note';
    li.textContent = text;
    return li;
  }
  function showError(text: string): void {
    err.textContent = text;
    err.hidden = false;
  }

  /** A name for a uid, from who has written in the chat (or "someone"). */
  const nameOf = (uid: string): string => (uid === session()?.uid ? 'you' : msgs.find(({ m }) => m.uid === uid)?.m.name ?? 'someone');

  /** Puts your heart or check on a message, or takes it back. */
  async function react(s: Session, id: string, m: Message, r: Reaction): Promise<void> {
    const on = !!m.reactions?.[r]?.includes(s.uid);
    const { fs, db } = s.fb;
    // drawn at once; the snapshot confirms it (or puts it back)
    const who = new Set(m.reactions?.[r] ?? []);
    if (on) who.delete(s.uid);
    else who.add(s.uid);
    m.reactions = { ...m.reactions, [r]: [...who] };
    render();
    try {
      await fs.updateDoc(fs.doc(db, 'chat', id), { [`reactions.${r}`]: on ? fs.arrayRemove(s.uid) : fs.arrayUnion(s.uid) });
    } catch (x) {
      showError(String((x as { code?: string })?.code ?? '').includes('permission')
        ? 'Reactions aren’t allowed yet: the Firestore rules need publishing again'
        : 'Couldn’t react. Check your connection.');
    }
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
      // drawings on the chat keep to their message by this
      li.dataset.id = id;
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
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble${m.text.trim() ? '' : ' photos-only'}`;
      if (m.text.trim()) {
        // rendered from escaped text: someone else's message can never inject markup
        const text = document.createElement('div');
        text.className = 'chat-md';
        text.innerHTML = renderMarkdown(m.text);
        bubble.append(text);
      }
      if (m.images?.length) {
        const pics = document.createElement('div');
        pics.className = `chat-pics n${Math.min(m.images.length, 4)}`;
        pics.append(...m.images.map((url) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chat-pic';
          b.setAttribute('aria-label', 'Open photo');
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          img.loading = 'lazy';
          b.append(img);
          b.addEventListener('click', () => {
            big.src = url;
            viewer.showModal();
          });
          return b;
        }));
        bubble.append(pics);
      }
      const time = document.createElement('span');
      time.className = 'chat-time';
      time.textContent = clock(m.at);
      row.append(bubble, time);
      // a change request: whether it has been made yet, under it
      const request = m.request ? outcomeLine(id) : null;
      // someone else's message takes a heart or a check: two small buttons beside it on hover
      if (!mine) {
        const pick = document.createElement('span');
        pick.className = 'chat-react-pick';
        for (const r of REACTIONS) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `chat-react-btn r-${r}${m.reactions?.[r]?.includes(s.uid) ? ' on' : ''}`;
          b.setAttribute('aria-label', REACTION_LABEL[r]);
          b.setAttribute('aria-pressed', String(!!m.reactions?.[r]?.includes(s.uid)));
          b.title = REACTION_LABEL[r];
          b.append(icon(r));
          b.addEventListener('click', () => void react(s, id, m, r));
          pick.append(b);
        }
        row.append(pick);
      }
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
      if (request) col.append(request);
      // the reactions it has: a chip each, with how many (yours lit; a click on someone else's message turns yours)
      const given = REACTIONS.filter((r) => m.reactions?.[r]?.length);
      if (given.length) {
        const chips = document.createElement('div');
        chips.className = 'chat-reacts';
        for (const r of given) {
          const who = m.reactions![r]!;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `chat-react r-${r}${who.includes(s.uid) ? ' on' : ''}`;
          b.disabled = mine;
          const names = who.map((u) => nameOf(u)).join(', ');
          b.title = `${REACTION_LABEL[r]} · ${names}`;
          b.setAttribute('aria-label', `${REACTION_LABEL[r]} ${who.length}: ${names}`);
          b.append(icon(r), Object.assign(document.createElement('span'), { textContent: String(who.length) }));
          if (!mine) b.addEventListener('click', () => void react(s, id, m, r));
          chips.append(b);
        }
        col.append(chips);
      }
      li.append(col);
      out.push(li);
      prev = m;
    }
    list.replaceChildren(...out);
    const last = msgs[msgs.length - 1]!.m;
    if (atBottom || last.uid === s.uid) list.scrollTop = list.scrollHeight;
    // photos still loading change the height: keep the bottom in view while they come in
    if (atBottom || last.uid === s.uid) list.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => (list.scrollTop = list.scrollHeight), { once: true }));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = session();
    const text = input.value.trim();
    const images = pending;
    if (!s || (!text && !images.length)) return;
    if (text.length > MAX) return showError(`Up to ${MAX} characters a message`);
    // cleared first: the message shows before the write is confirmed
    input.value = '';
    pending = [];
    paintPending();
    err.hidden = true;
    const { fs, db } = s.fb;
    const asks = isRequest(text, s);
    const m: Message = { uid: s.uid, name: s.name, photo: s.photo, text, at: Date.now(), ...(images.length ? { images } : {}), ...(asks ? { request: true } : {}) };
    try {
      const ref = await fs.addDoc(fs.collection(db, 'chat'), m);
      // "/변경요청 …" from the admin: also into the change-request queue (see requests.ts)
      if (asks) await fileRequest(s, ref.id, text).catch(() => showError('The change request couldn’t be queued: the Firestore rules need publishing again'));
    } catch (x) {
      input.value = text;
      pending = images;
      paintPending();
      showError(String((x as { code?: string })?.code ?? '').includes('permission')
        ? 'Chat isn’t allowed yet: the Firestore rules need publishing again'
        : 'Couldn’t send. Check your connection.');
    }
    input.focus();
  });

  // change requests' outcomes (published with the site): read when the chat opens, then every half minute there
  onOutcomes(() => render());
  onView((v) => {
    if (v === 'chat') void refreshOutcomes(true);
  });
  setInterval(() => {
    if (currentView() === 'chat' && document.visibilityState === 'visible') void refreshOutcomes();
  }, 30_000);
  function listen(s: Session | null): void {
    stop?.();
    stop = null;
    msgs = [];
    drawn = new Set();
    known = null;
    if (s) {
      const { fs, db } = s.fb;
      stop = fs.onSnapshot(fs.query(fs.collection(db, 'chat'), fs.orderBy('at', 'desc'), fs.limit(300)), (snap) => {
        msgs = snap.docs.map((d) => ({ id: d.id, m: d.data() as Message })).reverse();
        // someone else's new message: a notice, Discord-style (unless you're reading the chat right now)
        if (known) {
          for (const { id, m } of msgs) if (!known.has(id) && m.uid !== s.uid) notifyMessage(m, looking(), mentionsOf(m.text, s.uid));
        }
        known = new Set(msgs.map(({ id }) => id));
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
