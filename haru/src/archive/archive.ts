import { avatar, onSession, session, type Session } from '../cloud/session';
import { icon } from '../ui/icons';
import { mentionsIn, renderMarkdown } from '../ui/markdown';
import { setBadge } from '../ui/badge';
import { mentions } from '../cloud/viewing';
import { askConfirm } from '../ui/modal';
import { type Notice, markUpdatesSeen, updatesItem, updatesPage, updatesUnread, watchNotice } from './updates';

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
  // the comments fold open under their count; the ones already drawn don't animate in again
  let commentsOpen = false;
  let drawn = new Set<string>();
  let lastCount = -1;
  let postError = '';
  // the Updates page pinned on top (its key never matches a shared page's)
  const PIN = '__updates';
  const pinned = (k: string | null) => k === PIN;
  let notice: Notice | null = null;
  let stopNotice: (() => void) | null = null;
  let editingNotice = false;

  // ---- comments you haven't read: per page, the time of the newest comment from someone else you have seen
  const cSeenKey = (uid: string) => `haru:comments-seen:${uid}`;
  const cSeen = (uid: string): Record<string, number> => {
    try {
      return JSON.parse(localStorage.getItem(cSeenKey(uid)) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  };
  const newestOthers = (uid: string) => comments.reduce((m, { c }) => (c.uid !== uid ? Math.max(m, c.at) : m), 0);
  const commentsUnread = (s: Session, key: string) => newestOthers(s.uid) > (cSeen(s.uid)[key] ?? 0);
  function markCommentsSeen(s: Session, key: string): void {
    const at = newestOthers(s.uid);
    const all = cSeen(s.uid);
    if (!at || (all[key] ?? 0) >= at) return;
    all[key] = at;
    // only the pages still shared are worth remembering
    const live = new Set(pages.map((x) => keyOf(x)));
    try {
      localStorage.setItem(cSeenKey(s.uid), JSON.stringify(Object.fromEntries(Object.entries(all).filter(([k]) => live.has(k)))));
    } catch {
      // for this visit
    }
  }

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
    !!s && p.authorUid !== s.uid && mentions(p.mentions, s.uid) && !seenSet(s.uid).has(stamp(p));
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
    const n = pages.filter((p) => unread(p, s)).length + (updatesUnread(s, notice) ? 1 : 0);
    setBadge('mentions', n);
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
    if (openKey === PIN) {
      markUpdatesSeen(session(), notice);
      paintDots();
      renderList();
      return;
    }
    const p = pages.find((x) => keyOf(x) === openKey);
    if (p) markRead(p);
  });

  function note(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'a-note';
    p.textContent = text;
    return p;
  }

  function openUpdates(): void {
    openKey = PIN;
    if (archiveShown()) markUpdatesSeen(session(), notice);
    paintDots();
    renderList();
    renderReader();
  }

  function renderList(): void {
    sum.textContent = pages.length ? `${pages.length} shared` : '';
    const s0 = session();
    const pin = s0 ? [updatesItem(openKey === PIN, updatesUnread(s0, notice), openUpdates)] : [];
    if (!pages.length) {
      const li = document.createElement('li');
      li.className = 'j-empty';
      li.textContent = s0 ? 'Nothing shared yet' : 'Sign in to see shared pages';
      list.replaceChildren(...pin, li);
      return;
    }
    list.replaceChildren(...pin, ...pages.map((p) => {
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
    const p = pinned(openKey) ? undefined : pages.find((x) => keyOf(x) === openKey) ?? pages[0];
    if (!s) {
      reader.replaceChildren(note('Pages shared from Journal show here once you sign in.'));
      return;
    }
    if (!p) {
      // the pinned Updates page (also what shows while nothing is shared)
      openKey = PIN;
      if (archiveShown()) markUpdatesSeen(s, notice);
      reader.replaceChildren(...updatesPage(s, notice, editingNotice, (v) => {
        editingNotice = v;
        renderReader();
      }));
      return;
    }
    editingNotice = false;
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
    commentsOpen = false;
    drawn = new Set();
    lastCount = -1;
    postError = '';
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
    // the count, as a speech bubble over the box you write in: a click folds the comments open or shut
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'a-c-toggle';
    h.setAttribute('aria-expanded', String(commentsOpen));
    const n = document.createElement('span');
    if (commentsOpen && comments.length) markCommentsSeen(s, keyOf(p));
    const fresh = commentsUnread(s, keyOf(p));
    n.className = `a-c-n${fresh ? '' : ' read'}${lastCount >= 0 && comments.length !== lastCount ? ' bump' : ''}`;
    if (fresh) n.title = 'New comments';
    n.textContent = String(comments.length);
    const label = document.createElement('span');
    label.className = 'a-c-label';
    label.textContent = comments.length ? (commentsOpen ? 'Hide comments' : 'Show comments') : 'No comments yet';
    h.append(icon('message'), n, label, icon('chevron-down', 'ic a-c-caret'));
    h.disabled = !comments.length;
    lastCount = comments.length;
    const fold = document.createElement('div');
    fold.className = `a-c-fold${commentsOpen && comments.length ? ' open' : ''}`;
    const ul = document.createElement('ul');
    ul.className = 'a-c-list';
    h.addEventListener('click', () => {
      commentsOpen = !commentsOpen;
      fold.classList.toggle('open', commentsOpen);
      h.setAttribute('aria-expanded', String(commentsOpen));
      label.textContent = commentsOpen ? 'Hide comments' : 'Show comments';
      if (commentsOpen) {
        markCommentsSeen(s, keyOf(p));
        n.classList.add('read');
        n.removeAttribute('title');
      }
      if (commentsOpen) requestAnimationFrame(() => (ul.scrollTop = ul.scrollHeight));
    });
    fold.append(ul);
    ul.append(...comments.map(({ id, c }) => {
      const li = document.createElement('li');
      // only a comment not drawn before comes in with its animation
      li.className = `a-c${c.uid === s.uid ? ' mine' : ''}${drawn.has(id) ? '' : ' new'}`;
      drawn.add(id);
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
      // cleared first: the comment shows (and the box redraws) before the write is confirmed; sent, the
      // comments open to show it
      draft = '';
      input.value = '';
      commentsOpen = true;
      postError = '';
      try {
        await fs.addDoc(fs.collection(db, 'archive', keyOf(p), 'comments'), c);
      } catch (err) {
        draft = textValue;
        // say why: a refusal from the rules reads differently from a lost connection
        postError = String((err as { code?: string })?.code ?? '').includes('permission')
          ? 'Comments aren’t allowed yet: the Firestore rules need publishing again'
          : 'Couldn’t post. Check your connection.';
        const box2 = reader.querySelector('.a-comments');
        if (box2) box2.replaceWith(commentsBox(s, p));
      }
      fit();
      (reader.querySelector<HTMLTextAreaElement>('.a-c-input') ?? input).focus();
    });
    form.append(input, send);
    const err = document.createElement('p');
    err.className = 'a-c-err';
    err.setAttribute('role', 'alert');
    err.textContent = postError;
    err.hidden = !postError;
    box.append(h, fold, form, err);
    requestAnimationFrame(() => {
      fit();
      ul.scrollTop = ul.scrollHeight;
      if (postError) input.classList.add('bad');
    });
    return box;
  }

  function listen(s: Session | null): void {
    stop?.();
    stop = null;
    stopNotice?.();
    stopNotice = null;
    notice = null;
    editingNotice = false;
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
        if (!openKey || (!pinned(openKey) && !pages.some((x) => keyOf(x) === openKey))) {
          const first = pages.find((x) => unread(x, s2)) ?? (updatesUnread(s2, notice) ? undefined : pages[0]);
          openKey = first ? keyOf(first) : PIN;
        }
        paintDots();
        renderList();
        // the notice being written isn't thrown away by someone sharing a page meanwhile
        if (!(openKey === PIN && editingNotice)) renderReader();
      }, () => {
        reader.replaceChildren(note('The Archive couldn’t be loaded. Check your connection.'));
      });
      stopNotice = watchNotice(s, (n) => {
        notice = n;
        // open in front of you, it is read as it arrives
        if (openKey === PIN && archiveShown()) markUpdatesSeen(session(), notice);
        paintDots();
        renderList();
        if (openKey === PIN && !editingNotice) renderReader();
      });
    }
    paintDots();
    renderList();
    renderReader();
  }
  onSession(listen);
  listen(session());
}
