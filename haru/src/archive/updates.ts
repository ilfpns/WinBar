import type { Session } from '../cloud/session';
import { CHANGELOG } from '../ui/changelog';
import { icon } from '../ui/icons';
import { renderMarkdown } from '../ui/markdown';

/**
 * The Updates page pinned at the top of the Archive: a notice the admin writes (Markdown) and, under it, every
 * release's patch notes. Everyone invited reads it; only the admin's account may change it (the Firestore rules
 * hold the same address, so the button below is a convenience, not the lock). Until you open it after a change
 * (a new notice or a new release) it carries a "New" tag and Archive's dot.
 */
export const ADMIN = 'publicclaude223@gmail.com';
export const isAdmin = (s: Session | null): boolean => !!s && s.email.toLowerCase() === ADMIN;
export const MAX_NOTICE = 20_000;

export interface Notice {
  body: string;
  updatedAt: number;
  by: string;
}

/** What "seen" is measured against: the notice's time and the newest release. */
export const noticeStamp = (n: Notice | null): string => `${n?.updatedAt ?? 0}|${CHANGELOG[0]?.version ?? ''}`;
const seenKey = (uid: string) => `haru:updates-seen:${uid}`;
export function updatesUnread(s: Session | null, n: Notice | null): boolean {
  if (!s) return false;
  try {
    return localStorage.getItem(seenKey(s.uid)) !== noticeStamp(n);
  } catch {
    return false;
  }
}
export function markUpdatesSeen(s: Session | null, n: Notice | null): void {
  if (!s) return;
  try {
    localStorage.setItem(seenKey(s.uid), noticeStamp(n));
  } catch {
    // for this visit
  }
}

/** Follows the notice live; `null` until the admin has written one. */
export function watchNotice(s: Session, on: (n: Notice | null) => void): () => void {
  const { fs, db } = s.fb;
  return fs.onSnapshot(fs.doc(db, 'notices', 'updates'), (snap) => {
    const d = snap.exists() ? (snap.data() as Partial<Notice>) : null;
    on(d && typeof d.body === 'string' ? { body: d.body, updatedAt: Number(d.updatedAt) || 0, by: String(d.by ?? '') } : null);
  }, () => on(null));
}

const fmt = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The pinned item for the list. */
export function updatesItem(on: boolean, unread: boolean, open: () => void): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'a-pin';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `j-item a-pin-item${on ? ' on' : ''}`;
  b.innerHTML = '<span class="j-i-top"><span class="j-i-title"></span><span class="meta j-i-date"></span></span><span class="a-by meta">Haru</span>';
  b.querySelector('.j-i-title')!.textContent = '업데이트 공지';
  b.querySelector('.j-i-date')!.textContent = `v${CHANGELOG[0]?.version ?? ''}`;
  const top = b.querySelector('.j-i-top')!;
  top.prepend(icon('pin', 'ic a-pin-ic'));
  if (unread) {
    const tag = document.createElement('span');
    tag.className = 'a-mention-tag a-new-tag';
    tag.textContent = 'New';
    top.prepend(tag);
  }
  b.addEventListener('click', open);
  li.append(b);
  return li;
}

/** The page itself: the notice (editable by the admin) and the patch notes. */
export function updatesPage(s: Session, n: Notice | null, editing: boolean, setEditing: (v: boolean) => void): HTMLElement[] {
  const head = document.createElement('div');
  head.className = 'j-ed-head';
  const by = document.createElement('span');
  by.className = 'a-by a-by-lg';
  by.append(icon('pin', 'ic a-pin-ic'), '고정됨');
  const fill = document.createElement('span');
  fill.className = 'j-head-fill';
  head.append(by, fill);
  const admin = isAdmin(s);
  if (admin && !editing) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'icon-btn a-pin-edit';
    edit.setAttribute('aria-label', 'Edit notice');
    edit.title = '공지 수정 (관리자)';
    edit.append(icon('pencil'));
    edit.addEventListener('click', () => setEditing(true));
    head.append(edit);
  }
  const title = document.createElement('h2');
  title.className = 'a-title';
  title.textContent = '업데이트 공지';

  // one scrolling column under the title: the notice, then the patch notes
  const out: HTMLElement[] = [];
  if (admin && editing) {
    const form = document.createElement('form');
    form.className = 'a-notice-form';
    const ta = document.createElement('textarea');
    ta.className = 'set-input a-notice-input';
    ta.value = n?.body ?? '';
    ta.maxLength = MAX_NOTICE;
    ta.rows = 10;
    ta.placeholder = '모두에게 알릴 내용 (Markdown)';
    ta.setAttribute('aria-label', 'Notice');
    const row = document.createElement('div');
    row.className = 'a-notice-row';
    const err = document.createElement('span');
    err.className = 'a-c-err';
    err.setAttribute('role', 'alert');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-ghost';
    cancel.textContent = '취소';
    cancel.addEventListener('click', () => setEditing(false));
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn-sm';
    save.textContent = '게시';
    row.append(err, cancel, save);
    form.append(ta, row);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      err.textContent = '';
      const { fs, db } = s.fb;
      const doc: Notice = { body: ta.value.slice(0, MAX_NOTICE), updatedAt: Date.now(), by: s.name };
      try {
        await fs.setDoc(fs.doc(db, 'notices', 'updates'), doc);
        setEditing(false);
      } catch (x) {
        save.disabled = false;
        err.textContent = String((x as { code?: string })?.code ?? '').includes('permission')
          ? '게시할 수 없어요: Firestore 규칙을 다시 게시해야 해요'
          : '게시하지 못했어요. 연결을 확인하세요.';
      }
    });
    out.push(form);
    requestAnimationFrame(() => ta.focus());
  } else if (n?.body.trim()) {
    const text = document.createElement('div');
    text.className = 'md-view a-notice';
    text.innerHTML = renderMarkdown(n.body);
    const foot = document.createElement('div');
    foot.className = 'j-foot meta';
    foot.textContent = `${n.by || 'Admin'} · ${fmt(n.updatedAt)}`;
    out.push(text, foot);
  } else if (admin) {
    const p = document.createElement('p');
    p.className = 'a-note';
    p.textContent = '아직 공지가 없어요. 연필 버튼으로 모두에게 알릴 내용을 쓸 수 있어요.';
    out.push(p);
  }

  // the patch notes, newest first
  const notes = document.createElement('section');
  notes.className = 'a-releases';
  notes.append(Object.assign(document.createElement('span'), { className: 'card-title', textContent: '패치 노트' }));
  for (const r of CHANGELOG) {
    const sec = document.createElement('div');
    sec.className = 'a-rel';
    const h = document.createElement('div');
    h.className = 'a-rel-head';
    h.append(Object.assign(document.createElement('strong'), { textContent: `v${r.version}` }), Object.assign(document.createElement('span'), { className: 'meta', textContent: r.date }));
    const ul = document.createElement('ul');
    for (const it of r.items) ul.append(Object.assign(document.createElement('li'), { textContent: it }));
    sec.append(h, ul);
    notes.append(sec);
  }
  out.push(notes);
  const scroll = document.createElement('div');
  scroll.className = 'a-pin-body';
  scroll.append(...out);
  return [head, title, scroll];
}
