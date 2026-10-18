import { LARGE, slicesChart } from '../calendar/day-charts';
import { avatar, onSession, session, type Profile, type Session } from '../cloud/session';
import { icon } from '../ui/icons';
import { showMenu } from '../ui/modal';
import { type Block, isBlock, labelOf, progressOf } from './model';
import { DAY, formatDuration, hhmm } from './time';

/**
 * Today, someone else's: the people button (top right of Today, signed in only) lists everyone in Haru;
 * picking someone lays their Today over yours — the day as slices with its tasks beside it, live and read
 * only. Your own dial stays underneath, untouched; Close (or Esc) goes back to it.
 */
export function mountPeek(stage: HTMLElement): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'peek-btn';
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-label', 'See someone’s Today');
  btn.title = 'See someone’s Today';
  btn.hidden = true;
  stage.append(btn);

  const layer = document.createElement('section');
  layer.className = 'peek';
  layer.hidden = true;
  layer.setAttribute('aria-label', 'Someone’s Today (read only)');
  stage.append(layer);

  let members: Profile[] = [];
  let stopMembers: (() => void) | null = null;
  let stopDay: (() => void) | null = null;
  let viewing: Profile | null = null;

  function paintBtn(): void {
    const s = session();
    btn.hidden = !s;
    if (!s) return;
    const who = viewing ?? { name: s.name, photo: s.photo };
    btn.replaceChildren(avatar(who, 'a-avatar'), viewing ? viewing.name : 'Me', icon('users'));
    btn.classList.toggle('on', !!viewing);
  }

  btn.addEventListener('click', () => {
    const s = session();
    if (!s) return;
    const others = members.filter((m) => m.uid !== s.uid);
    showMenu(btn, [
      { label: viewing ? 'Back to my Today' : 'My Today', icon: 'clock', run: () => close() },
      ...others.map((m) => ({ label: m.name || m.email, icon: 'eye', run: () => open(s, m) })),
      ...(others.length ? [] : [{ label: 'No one else yet', icon: 'user', run: () => {} }]),
    ]);
  });

  function close(): void {
    stopDay?.();
    stopDay = null;
    viewing = null;
    layer.hidden = true;
    layer.replaceChildren();
    document.body.classList.remove('peeking');
    paintBtn();
  }

  function open(s: Session, who: Profile): void {
    stopDay?.();
    viewing = who;
    paintBtn();
    layer.hidden = false;
    // your own Tasks drawer has nothing to do with their day
    document.body.classList.add('peeking');
    render(who, null);
    const { fs, db } = s.fb;
    stopDay = fs.onSnapshot(fs.doc(db, `users/${who.uid}/state/timetable`), (snap) => {
      const data = snap.data() as { blocks?: unknown[] } | undefined;
      render(who, (data?.blocks ?? []).filter(isBlock).map((b) => ({ ...b, done: b.done === true })));
    }, () => render(who, null, 'Their Today couldn’t be loaded.'));
  }

  function render(who: Profile, blocks: Block[] | null, failed?: string): void {
    const head = document.createElement('div');
    head.className = 'peek-head';
    const name = document.createElement('span');
    name.className = 'peek-name';
    name.append(avatar(who, 'a-avatar'), `${who.name}’s Today`);
    const tag = document.createElement('span');
    tag.className = 'meta peek-tag';
    tag.append(icon('eye'), 'Read only');
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.setAttribute('aria-label', 'Back to my Today');
    x.title = 'Back to my Today';
    x.append(icon('x'));
    x.addEventListener('click', close);
    head.append(name, tag, x);

    const body = document.createElement('div');
    body.className = 'peek-body';
    if (!blocks) {
      const p = document.createElement('p');
      p.className = 'a-note';
      p.textContent = failed ?? 'Loading…';
      body.append(p);
      layer.replaceChildren(head, body);
      return;
    }
    const chart = document.createElement('div');
    chart.className = 'peek-chart';
    chart.append(slicesChart(blocks, LARGE));
    const list = document.createElement('ol');
    list.className = 'peek-list';
    const sorted = [...blocks].sort((a, b) => a.start - b.start);
    if (!sorted.length) {
      const li = document.createElement('li');
      li.className = 'j-empty';
      li.textContent = 'Nothing planned yet';
      list.append(li);
    }
    for (const b of sorted) {
      const li = document.createElement('li');
      li.classList.toggle('done', b.done);
      li.style.setProperty('--c', `var(--cat-${b.cat})`);
      li.innerHTML = '<span class="peek-t"></span><span class="dot"></span><span class="peek-n"></span><span class="peek-d"></span>';
      li.querySelector('.peek-t')!.textContent = `${hhmm(b.start)}–${hhmm(b.start + b.dur)}`;
      li.querySelector('.peek-n')!.textContent = labelOf(b);
      li.querySelector('.peek-d')!.textContent = formatDuration(b.dur);
      list.append(li);
    }
    const { done, planned } = progressOf(blocks);
    const sum = document.createElement('p');
    sum.className = 'meta peek-sum';
    sum.textContent = `${formatDuration(planned)} planned · ${Math.round((done / DAY) * 100)}% of the day done`;
    const side = document.createElement('div');
    side.className = 'peek-side';
    side.append(sum, list);
    body.append(chart, side);
    layer.replaceChildren(head, body);
  }

  // Esc goes back to your own Today
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && viewing && !document.querySelector('.pop-menu, dialog[open]')) close();
  });

  onSession((s) => {
    stopMembers?.();
    stopMembers = null;
    members = [];
    close();
    if (!s) return;
    const { fs, db } = s.fb;
    stopMembers = fs.onSnapshot(fs.collection(db, 'profiles'), (snap) => {
      members = snap.docs.map((d) => d.data() as Profile).sort((a, b) => a.name.localeCompare(b.name));
    }, () => {});
  });
  paintBtn();
}
