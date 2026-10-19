import { avatar, onSession, session, type Session } from '../cloud/session';
import { icon } from '../ui/icons';
import { mentionsIn, renderMarkdown } from '../ui/markdown';
import { askConfirm } from '../ui/modal';

/**
 * Archive: journal pages people chose to share (Share on a page in Journal), from everyone invited, newest
 * first. A shared page is a copy taken when it was shared; sharing the same page again updates it. Only its
 * author can take it down. Reading only: everyone's own pages stay in their Journal.
 */
export interface Shared {
  authorUid: string;
  authorName: string;
  authorPhoto: string | null;
  entryId: string;
  title: string;
  body: string;
  /** YYYY-MM-DD the page is about. */
  date: string;
  sharedAt: number;
  /** Who the page names with @ (their uids). */
  mentions?: string[];
}

/** One archive document per author and page, so sharing a page again replaces its copy. */
export const sharedId = (uid: string, entryId: string) => `${uid}_${entryId}`;

/** Copies a journal page into the Archive (or refreshes its copy). */
export async function sharePage(s: Session, page: { id: string; title: string; body: string; date: string }): Promise<void> {
  const { fs, db } = s.fb;
  const doc: Shared = {
    authorUid: s.uid, authorName: s.name, authorPhoto: s.photo,
    entryId: page.id, title: page.title, body: page.body, date: page.date, sharedAt: Date.now(),
    mentions: mentionsIn(page.body).filter((uid) => uid !== s.uid),
  };
  await fs.setDoc(fs.doc(db, 'archive', sharedId(s.uid, page.id)), doc);
}

/** A comment under a shared page. */
export interface Comment {
  uid: string;
  name: string;
  photo: string | null;
  text: string;
  at: number;
}
const MAX_COMMENT = 1000;

/** Takes a page's copy out of the Archive (its comments with it). */
export async function unsharePage(s: Session, uid: string, entryId: string): Promise<void> {
  const { fs, db } = s.fb;
  const id = sharedId(uid, entryId);
  const comments = await fs.getDocs(fs.collection(db, 'archive', id, 'comments')).catch(() => null);
  await Promise.all((comments?.docs ?? []).map((d) => fs.deleteDoc(d.ref).catch(() => {})));
  await fs.deleteDoc(fs.doc(db, 'archive', id));
}

const fmtDay = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export function mountArchive(body: HTMLElement, sum: HTMLElement): void {
  body.innerHTML = `
    <aside class="j-side glass-card" aria-label="Shared pages">
      <div class="j-side-head"><span class="card-title">Shared</span></div>
      <ul class="j-list a-list"></ul>
    </aside>
    <article class="a-reader glass-card" aria-live="polite"></article>`;
  const list = body.querySelector<HTMLUListElement>('.a-list')!;
  const reader = body.querySelector<HTMLElement>('.a-reader')!;

  let pages: Shared[] = [];
  let openKey: string | null = null;
  let stop: (() => void) | null = null;
  // the open page's comments, live
  let comments: { id: string; c: Comment }[] = [];
  let commentsFor: string | null = null;
  let stopComments: (() => void) | null = null;
  let draft = '';

  const keyOf = (p: Shared) => sharedId(p.authorUid, p.entryId);

  // ---- mentions: a page that names you and you haven't read (since it was last shared) carries a dot, and so
  // does Archive's button wherever it shows, until you open the page
  const seenKey = (uid: string) => `haru:mentions-seen:${uid}`;
  const seenSet = (uid: string): Set<string> => {
    try {
      return new Set(JSON.parse(localStorage.getItem(seenKey(uid)) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  };
  const stamp = (p: Shared) => `${keyOf(p)}@${p.sharedAt}`;
  const unread = (p: Shared, s: Session | null): boolean =>
    !!s && p.authorUid !== s.uid && !!p.mentions?.includes(s.uid) && !seenSet(s.uid).has(stamp(p));
  function markRead(p: Shared): void {
    const s = session();
    if (!unread(p, s)) return;
    const set = seenSet(s!.uid);
    set.add(stamp(p));
    try {
      // only the pages still shared are worth remembering
      const live = new Set(pages.map(stamp));
      localStorage.setItem(seenKey(s!.uid), JSON.stringify([...set].filter((k) => live.has(k))));
    } catch {
      // for this visit
    }
    paintDots();
  }
  function paintDots(): void {
    const s = session();
    const n = pages.filter((p) => unread(p, s)).length;
    for (const el of document.querySelectorAll<HTMLElement>('[data-view="archive"]')) {
      el.classList.toggle('has-mention', n > 0);
      if (n) el.dataset.mentions = String(n);
      else delete el.dataset.mentions;
    }
  }
  const archiveShown = () => location.hash.startsWith('#/archive');
  addEventListener('hashchange', () => {
    // turning to Archive reads the page it opens on
    if (!archiveShown()) return;
    const p = pages.find((x) => keyOf(x) === openKey);
    if (p) markRead(p);
  });

  function note(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'a-note';
    p.textContent = text;
    return p;
  }

  function renderList(): void {
    sum.textContent = pages.length ? `${pages.length} shared` : '';
    if (!pages.length) {
      const li = document.createElement('li');
      li.className = 'j-empty';
      li.textContent = session() ? 'Nothing shared yet' : 'Sign in to see shared pages';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...pages.map((p) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `j-item${keyOf(p) === openKey ? ' on' : ''}`;
      b.innerHTML = '<span class="j-i-top"><span class="j-i-title"></span><span class="meta j-i-date"></span></span><span class="a-by"></span>';
      b.querySelector('.j-i-title')!.textContent = p.title || 'Untitled';
      b.querySelector('.j-i-date')!.textContent = fmtDay(p.date).replace(/, \d{4}$/, '');
      if (unread(p, session())) {
        const tag = document.createElement('span');
        tag.className = 'a-mention-tag';
        tag.textContent = '@ you';
        b.querySelector('.j-i-top')!.prepend(tag);
        b.classList.add('mentioned');
      }
      const by = b.querySelector('.a-by')!;
      by.append(avatar({ name: p.authorName, photo: p.authorPhoto }, 'a-avatar'), p.authorName);
      b.addEventListener('click', () => {
        openKey = keyOf(p);
        markRead(p);
        renderList();
        renderReader();
      });
      li.append(b);
      return li;
    }));
  }

  function renderReader(): void {
    const s = session();
    const p = pages.find((x) => keyOf(x) === openKey) ?? pages[0];
    if (!s) {
      reader.replaceChildren(note('Pages shared from Journal show here once you sign in.'));
      return;
    }
    if (!p) {
      reader.replaceChildren(note('Share a page from Journal and it shows here for everyone invited.'));
      return;
    }
    openKey = keyOf(p);
    if (archiveShown()) markRead(p);
    const head = document.createElement('div');
    head.className = 'j-ed-head';
    const by = document.createElement('span');
    by.className = 'a-by a-by-lg';
    by.append(avatar({ name: p.authorName, photo: p.authorPhoto }, 'a-avatar'), p.authorName);
    const date = document.createElement('span');
    date.className = 'j-date';
    date.textContent = fmtDay(p.date);
    const fill = document.createElement('span');
    fill.className = 'j-head-fill';
    head.append(by, date, fill);
    // only its author may take it down
    if (p.authorUid === s.uid) {
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'icon-btn';
      down.setAttribute('aria-label', 'Remove from Archive');
      down.title = 'Remove from Archive';
      down.append(icon('trash'));
      down.addEventListener('click', async () => {
        if (!(await askConfirm({ title: `Remove “${p.title || 'Untitled'}” from Archive?`, body: 'The page stays in its author’s Journal.', danger: true }))) return;
        await unsharePage(s, p.authorUid, p.entryId).catch(() => {});
      });
      head.append(down);
    }
    const title = document.createElement('h2');
    title.className = 'a-title';
    title.textContent = p.title || 'Untitled';
    const text = document.createElement('div');
    text.className = 'md-view a-text';
    // rendered from escaped text: someone else's page can never inject markup
    text.innerHTML = renderMarkdown(p.body);
    const foot = document.createElement('div');
    foot.className = 'j-foot meta';
    foot.textContent = `Shared ${new Date(p.sharedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    watchComments(s, keyOf(p));
    reader.replaceChildren(head, title, text, foot, commentsBox(s, p));
  }

  // ---- comments: under the page, newest last; Enter sends (Shift+Enter for a new line)
  function watchComments(s: Session, key: string): void {
    if (commentsFor === key) return;
    stopComments?.();
    commentsFor = key;
    comments = [];
    draft = '';
    const { fs, db } = s.fb;
    stopComments = fs.onSnapshot(fs.query(fs.collection(db, 'archive', key, 'comments'), fs.orderBy('at', 'asc')), (snap) => {
      comments = snap.docs.map((d) => ({ id: d.id, c: d.data() as Comment }));
      const box = reader.querySelector('.a-comments');
      if (box) box.replaceWith(commentsBox(s, pages.find((x) => keyOf(x) === key)!));
    }, () => {});
  }
  function commentsBox(s: Session, p: Shared): HTMLElement {
    const box = document.createElement('section');
    box.className = 'a-comments';
    box.setAttribute('aria-label', 'Comments');
    const h = document.createElement('div');
    h.className = 'a-c-head';
    h.append(icon('message'), Object.assign(document.createElement('span'), { className: 'card-title', textContent: 'Comments' }),
      Object.assign(document.createElement('span'), { className: 'meta a-c-n', textContent: comments.length ? String(comments.length) : '' }));
    const ul = document.createElement('ul');
    ul.className = 'a-c-list';
    ul.append(...comments.map(({ id, c }) => {
      const li = document.createElement('li');
      li.className = `a-c${c.uid === s.uid ? ' mine' : ''}`;
      const top = document.createElement('div');
      top.className = 'a-c-top';
      const when = document.createElement('span');
      when.className = 'meta a-c-when';
      when.textContent = new Date(c.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      top.append(avatar({ name: c.name, photo: c.photo }, 'a-avatar'), Object.assign(document.createElement('strong'), { textContent: c.name }), when);
      // whoever wrote it, or the page's author, may take it down
      if (c.uid === s.uid || p.authorUid === s.uid) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'tpl-del a-c-del';
        del.setAttribute('aria-label', 'Delete comment');
        del.title = 'Delete comment';
        del.append(icon('x'));
        del.addEventListener('click', async () => {
          if (!(await askConfirm({ title: 'Delete this comment?', danger: true }))) return;
          const { fs, db } = s.fb;
          await fs.deleteDoc(fs.doc(db, 'archive', keyOf(p), 'comments', id)).catch(() => {});
        });
        top.append(del);
      }
      const body = document.createElement('p');
      body.className = 'a-c-text';
      body.textContent = c.text;
      li.append(top, body);
      return li;
    }));
    if (!comments.length) ul.append(Object.assign(document.createElement('li'), { className: 'meta a-c-empty', textContent: 'No comments yet' }));
    const form = document.createElement('form');
    form.className = 'a-c-form';
    const input = document.createElement('textarea');
    input.className = 'set-input a-c-input';
    input.rows = 1;
    input.maxLength = MAX_COMMENT;
    input.placeholder = 'Write a comment';
    input.setAttribute('aria-label', 'Write a comment');
    input.value = draft;
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'btn-sm a-c-send';
    send.append(icon('arrow-right'));
    send.setAttribute('aria-label', 'Send comment');
    const fit = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
      send.disabled = !input.value.trim();
    };
    input.addEventListener('input', () => {
      draft = input.value;
      fit();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const textValue = input.value.trim();
      if (!textValue) return;
      send.disabled = true;
      const { fs, db } = s.fb;
      const c: Comment = { uid: s.uid, name: s.name, photo: s.photo, text: textValue.slice(0, MAX_COMMENT), at: Date.now() };
      // cleared first: the comment shows (and the box redraws) before the write is confirmed
      draft = '';
      input.value = '';
      try {
        await fs.addDoc(fs.collection(db, 'archive', keyOf(p), 'comments'), c);
      } catch {
        draft = textValue;
        const now = reader.querySelector<HTMLTextAreaElement>('.a-c-input') ?? input;
        now.value = textValue;
        now.classList.add('bad');
        setTimeout(() => now.classList.remove('bad'), 1500);
      }
      fit();
      (reader.querySelector<HTMLTextAreaElement>('.a-c-input') ?? input).focus();
    });
    form.append(input, send);
    box.append(h, ul, form);
    requestAnimationFrame(() => {
      fit();
      ul.scrollTop = ul.scrollHeight;
    });
    return box;
  }

  function listen(s: Session | null): void {
    stop?.();
    stop = null;
    stopComments?.();
    stopComments = null;
    commentsFor = null;
    comments = [];
    pages = [];
    if (s) {
      const { fs, db } = s.fb;
      stop = fs.onSnapshot(fs.query(fs.collection(db, 'archive'), fs.orderBy('sharedAt', 'desc')), (snap) => {
        pages = snap.docs.map((d) => d.data() as Shared);
        // a page that names you opens first
        const s2 = session();
        if (!openKey || !pages.some((x) => keyOf(x) === openKey)) {
          const first = pages.find((x) => unread(x, s2)) ?? pages[0];
          openKey = first ? keyOf(first) : null;
        }
        paintDots();
        renderList();
        renderReader();
      }, () => {
        reader.replaceChildren(note('The Archive couldn’t be loaded. Check your connection.'));
      });
    }
    paintDots();
    renderList();
    renderReader();
  }
  onSession(listen);
  listen(session());
}
