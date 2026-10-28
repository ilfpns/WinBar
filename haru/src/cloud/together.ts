import { avatar, onSession, session, type Session } from './session';
import { memberList } from './viewing';
import { CATEGORIES, type Category, labelOf } from '../timetable/model';
import { addBlock, state } from '../timetable/state';
import { dayOf } from '../timetable/history';
import { planOn, setPlan } from '../timetable/plans';
import { templateBlock } from '../timetable/templates';
import { hhmm, mod } from '../timetable/time';
import { icon } from '../ui/icons';

/**
 * Together: a task made with other members. Whoever makes it (in the task editor or a day ahead's plan form)
 * picks the people; each of them is asked, and Accept puts the task on their own Today (or their plan for that
 * day) — nobody writes into anyone else's planner. The ask lives in `together/{id}` (firestore.rules):
 *
 *   { from, fromName, to: [uid], date, title, cat, start, dur, note?, created, answers: { uid: 'yes' | 'no' } }
 *
 * The maker sees who said yes; it goes once its day has passed (they can take it back before that).
 */
export interface Together {
  id: string;
  from: string;
  fromName: string;
  to: string[];
  date: string;
  title: string;
  cat: Category;
  start: number;
  dur: number;
  note?: string;
  created: number;
  answers: Record<string, 'yes' | 'no'>;
}
export interface TogetherTask { title: string; cat: Category; start: number; dur: number; note?: string }

/** Asks `to` (uids) to do `task` on `date` with you. Resolves false when it couldn't be sent. */
export async function invite(task: TogetherTask, date: string, to: readonly string[]): Promise<boolean> {
  const s = session();
  if (!s || !to.length) return false;
  const { fs, db } = s.fb;
  const doc = {
    from: s.uid,
    fromName: s.name,
    to: [...new Set(to)].filter((u) => u !== s.uid).slice(0, 20),
    date,
    ...templateBlock(task),
    created: Date.now(),
    answers: {},
  };
  return fs.addDoc(fs.collection(db, 'together'), doc).then(() => true, () => false);
}

let received: Together[] = [];
let sent: Together[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
const live = (t: Together) => t.date >= dayOf();
/** A member as shown: a profile may have no name yet (only its email), or not be there at all. */
const person = (m: { name?: string; email?: string; photo?: string | null } | undefined, fallback = '') => ({ name: m?.name || m?.email || fallback || 'Member', photo: m?.photo ?? null });

function watch(s: Session): () => void {
  const { fs, db } = s.fb;
  const col = fs.collection(db, 'together');
  const read = (docs: { id: string; data: () => unknown }[]) =>
    docs.map((d) => { const t = d.data() as Omit<Together, 'id'>; return { ...t, id: d.id, answers: t.answers ?? {} }; }).filter(live).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const a = fs.onSnapshot(fs.query(col, fs.where('to', 'array-contains', s.uid)), (snap) => {
    received = read(snap.docs);
    changed();
  }, () => {});
  const b = fs.onSnapshot(fs.query(col, fs.where('from', '==', s.uid)), (snap) => {
    sent = read(snap.docs);
    changed();
  }, () => {});
  return () => {
    a();
    b();
  };
}

/** Puts an accepted task on your own Today or plan; an error message when it overlaps something there. */
function place(t: Together): string | null {
  const today = dayOf();
  const same = (x: { title: string; start: number; dur: number }) => x.title === t.title && x.start === t.start && x.dur === t.dur;
  // already there (an earlier Accept whose answer didn't get through): nothing more to place
  if (t.date === today) {
    if (state.blocks.some(same)) return null;
    return addBlock({ id: null, title: t.title, cat: t.cat, start: t.start, dur: t.dur, done: false, ...(t.note && { note: t.note }) });
  }
  const plan = planOn(t.date);
  const blocks = plan?.blocks ?? [];
  if (blocks.some(same)) return null;
  const hit = blocks.find((x) => mod(t.start - x.start) < x.dur || mod(x.start - t.start) < t.dur);
  if (hit) return `Overlaps ${labelOf(hit)} ${hhmm(hit.start)}–${hhmm(hit.start + hit.dur)} on that day`;
  setPlan(t.date, [...blocks, templateBlock(t)], plan?.from || 'Together');
  return null;
}

async function answer(t: Together, yes: boolean): Promise<string | null> {
  const s = session();
  if (!s) return 'Sign in first';
  if (yes) {
    const err = place(t);
    if (err) return err;
  }
  const { fs, db } = s.fb;
  return fs.updateDoc(fs.doc(db, 'together', t.id), { [`answers.${s.uid}`]: yes ? 'yes' : 'no' }).then(() => null, () => 'Couldn’t send the answer');
}

async function takeBack(t: Together): Promise<void> {
  const s = session();
  if (!s) return;
  const { fs, db } = s.fb;
  await fs.deleteDoc(fs.doc(db, 'together', t.id)).catch(() => {});
}

// ---------- picking the people (the task editor and the plan form)

/** Member chips to pick who joins; `selected()` is their uids. Hidden while signed out or alone. */
export function withPicker(): { el: HTMLElement; selected: () => string[]; reset: () => void } {
  const el = document.createElement('div');
  el.className = 'with-row';
  const label = Object.assign(document.createElement('span'), { className: 'meta', textContent: 'With' });
  const chips = document.createElement('div');
  chips.className = 'with-chips';
  el.append(label, chips);
  const picked = new Set<string>();
  const paint = () => {
    const s = session();
    const others = s ? memberList().filter((m) => m.uid !== s.uid) : [];
    el.hidden = !others.length;
    chips.replaceChildren(...others.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'with-chip';
      b.setAttribute('aria-pressed', String(picked.has(m.uid)));
      const p = person(m);
      b.title = picked.has(m.uid) ? `${p.name} will be asked` : `Ask ${p.name} to join`;
      b.append(avatar(p, 'a-avatar'), p.name.split(/\s+/)[0]!);
      b.addEventListener('click', () => {
        if (picked.has(m.uid)) picked.delete(m.uid);
        else picked.add(m.uid);
        paint();
      });
      return b;
    }));
  };
  paint();
  // the member list arrives a moment after sign-in
  onSession(() => setTimeout(paint, 1500));
  return {
    el,
    selected: () => [...picked],
    reset: () => {
      picked.clear();
      paint();
    },
  };
}

// ---------- the inbox on Today: asks to answer, and who has answered yours

const when = (t: Together) => {
  const day = t.date === dayOf() ? 'Today' : new Date(`${t.date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} · ${hhmm(t.start)}–${hhmm(t.start + t.dur)}`;
};

export function mountTogether(stage: HTMLElement): void {
  const box = document.createElement('section');
  box.className = 'together-box';
  box.setAttribute('aria-label', 'Together');
  box.hidden = true;
  stage.append(box);
  const people = () => new Map(memberList().map((m) => [m.uid, m]));

  function card(t: Together): HTMLElement {
    const el = document.createElement('article');
    el.className = 'together-card';
    el.style.setProperty('--c', `var(--cat-${t.cat})`);
    const from = person(people().get(t.from), t.fromName);
    const head = document.createElement('div');
    head.className = 'together-head';
    head.append(avatar(from, 'a-avatar'), Object.assign(document.createElement('span'), { textContent: `${from.name.split(/\s+/)[0]} asks you to join` }));
    const what = document.createElement('div');
    what.className = 'together-what';
    what.append(Object.assign(document.createElement('span'), { className: 'dot' }), Object.assign(document.createElement('strong'), { textContent: labelOf(t) }));
    const sub = Object.assign(document.createElement('span'), { className: 'meta together-when', textContent: `${when(t)} · ${CATEGORIES[t.cat]}` });
    const err = Object.assign(document.createElement('p'), { className: 'err together-err' });
    const acts = document.createElement('div');
    acts.className = 'together-acts';
    const btn = (text: string, cls: string, yes: boolean) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: text });
      b.addEventListener('click', async () => {
        b.disabled = true;
        err.textContent = (await answer(t, yes)) ?? '';
        b.disabled = false;
      });
      return b;
    };
    acts.append(btn('Decline', 'btn-text', false), btn('Accept', 'btn-sm', true));
    el.append(head, what, sub, ...(t.note ? [Object.assign(document.createElement('p'), { className: 'together-note', textContent: t.note })] : []), err, acts);
    return el;
  }

  function sentLine(t: Together): HTMLElement {
    const el = document.createElement('div');
    el.className = 'together-sent';
    el.style.setProperty('--c', `var(--cat-${t.cat})`);
    const who = document.createElement('span');
    who.className = 'together-who';
    const map = people();
    for (const uid of t.to) {
      const m = person(map.get(uid));
      const a = avatar(m, 'a-avatar');
      const state = t.answers[uid];
      a.classList.add(state === 'yes' ? 'yes' : state === 'no' ? 'no' : 'wait');
      a.title = `${m.name}: ${state === 'yes' ? 'joined' : state === 'no' ? 'declined' : 'not answered yet'}`;
      who.append(a);
    }
    const text = Object.assign(document.createElement('span'), { className: 'together-sent-text' });
    text.append(Object.assign(document.createElement('span'), { className: 'dot' }), `${labelOf(t)} · ${when(t)}`);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn together-x';
    x.setAttribute('aria-label', `Take back ${labelOf(t)}`);
    x.title = 'Take it back';
    x.append(icon('x'));
    x.addEventListener('click', () => void takeBack(t));
    el.append(text, who, x);
    return el;
  }

  function paint(): void {
    const s = session();
    const mine = s ? received.filter((t) => !t.answers[s.uid]) : [];
    box.hidden = !mine.length && !sent.length;
    if (box.hidden) {
      box.replaceChildren();
      return;
    }
    const parts: HTMLElement[] = mine.map(card);
    if (sent.length) {
      const head = Object.assign(document.createElement('div'), { className: 'meta together-label' });
      head.append(icon('users'), 'Asked by you');
      parts.push(head, ...sent.map(sentLine));
    }
    box.replaceChildren(...parts);
  }
  listeners.add(paint);

  let stop: (() => void) | null = null;
  onSession((s) => {
    stop?.();
    stop = null;
    received = [];
    sent = [];
    paint();
    if (s) stop = watch(s);
  });
  // past days drop out at the new day
  setInterval(() => {
    const r = received.filter(live);
    const o = sent.filter(live);
    if (r.length !== received.length || o.length !== sent.length) {
      received = r;
      sent = o;
      paint();
    }
  }, 60_000);
}
