import { avatar, onSession, session, type Session } from '../cloud/session';
import { icon } from '../ui/icons';
import { renderMarkdown } from '../ui/markdown';
import { askConfirm } from '../ui/modal';

/**
 * Archive: journal pages people chose to share (Share on a page in Journal), from everyone invited, newest
 * first. A shared page is a copy taken when it was shared; sharing the same page again updates it. Its
 * author (or an owner) can take it down. Reading only: everyone's own pages stay in their Journal.
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
}

/** One archive document per author and page, so sharing a page again replaces its copy. */
export const sharedId = (uid: string, entryId: string) => `${uid}_${entryId}`;

/** Copies a journal page into the Archive (or refreshes its copy). */
export async function sharePage(s: Session, page: { id: string; title: string; body: string; date: string }): Promise<void> {
  const { fs, db } = s.fb;
  const doc: Shared = {
    authorUid: s.uid, authorName: s.name, authorPhoto: s.photo,
    entryId: page.id, title: page.title, body: page.body, date: page.date, sharedAt: Date.now(),
  };
  await fs.setDoc(fs.doc(db, 'archive', sharedId(s.uid, page.id)), doc);
}

/** Takes a page's copy out of the Archive. */
export async function unsharePage(s: Session, uid: string, entryId: string): Promise<void> {
  const { fs, db } = s.fb;
  await fs.deleteDoc(fs.doc(db, 'archive', sharedId(uid, entryId)));
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

  const keyOf = (p: Shared) => sharedId(p.authorUid, p.entryId);

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
      const by = b.querySelector('.a-by')!;
      by.append(avatar({ name: p.authorName, photo: p.authorPhoto }, 'a-avatar'), p.authorName);
      b.addEventListener('click', () => {
        openKey = keyOf(p);
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
    // its author, or an owner, may take it down
    if (p.authorUid === s.uid || s.owner) {
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
    reader.replaceChildren(head, title, text, foot);
  }

  function listen(s: Session | null): void {
    stop?.();
    stop = null;
    pages = [];
    if (s) {
      const { fs, db } = s.fb;
      stop = fs.onSnapshot(fs.query(fs.collection(db, 'archive'), fs.orderBy('sharedAt', 'desc')), (snap) => {
        pages = snap.docs.map((d) => d.data() as Shared);
        renderList();
        renderReader();
      }, () => {
        reader.replaceChildren(note('The Archive couldn’t be loaded. Check your connection.'));
      });
    }
    renderList();
    renderReader();
  }
  onSession(listen);
  listen(session());
}
