import { avatar, session, type Profile } from '../cloud/session';
import { onViewing, watchTheirs } from '../cloud/viewing';
import { notionView } from '../calendar/notion-attendance';
import { dayKey } from './history';
import { type Block, isBlock, labelOf } from './model';
import { formatDuration, hhmm, mod, nowMinutes } from './time';
import { icon } from '../ui/icons';
import { lang } from '../ui/i18n';

/**
 * Looking at someone else's Today (the switcher at the top right): beside their dial, a card with what there is to
 * know about them — today (share done, time planned, what they're on now and next), attendance (streak, best,
 * the last five weeks) and the last seven days (planned, the part done). Read only and live; it goes when you
 * come back to your own.
 */
const WEEKS = 5;

const keyOf = (d: Date) => dayKey(d);
const ko = () => lang() === 'ko';

function streaks(days: Set<string>): { now: number; best: number } {
  const today = new Date();
  // up to today, or up to yesterday until today is checked
  const d = new Date(today);
  if (!days.has(keyOf(d))) d.setDate(d.getDate() - 1);
  let now = 0;
  while (days.has(keyOf(d))) {
    now++;
    d.setDate(d.getDate() - 1);
  }
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of [...days].sort()) {
    const cur = new Date(`${k}T00:00`);
    run = prev && Math.round((cur.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = cur;
  }
  return { now, best };
}

export function mountProfileCard(stage: HTMLElement): void {
  const card = document.createElement('aside');
  card.className = 'who-card glass-card';
  card.hidden = true;
  stage.append(card);

  let stops: (() => void)[] = [];
  let who: Profile | null = null;
  let blocks: Block[] = [];
  let checkins = new Set<string>();
  let notion = new Set<string>();
  let recent: { date: string; planned: number; done: number }[] = [];
  let clock = 0;

  function paint(): void {
    if (!who) return;
    const now = nowMinutes();
    const planned = blocks.reduce((a, b) => a + b.dur, 0);
    const done = blocks.filter((b) => b.done).reduce((a, b) => a + b.dur, 0);
    const pct = planned ? Math.round((done / planned) * 100) : 0;
    const cur = blocks.find((b) => mod(now - b.start) < b.dur);
    const next = [...blocks].filter((b) => b !== cur).sort((a, b) => mod(a.start - now) - mod(b.start - now))[0];
    const days = new Set([...checkins, ...notion]);
    const { now: streak, best } = streaks(days);

    card.replaceChildren();
    const head = document.createElement('div');
    head.className = 'who-head';
    const name = document.createElement('div');
    name.className = 'who-name';
    name.append(Object.assign(document.createElement('strong'), { textContent: who.name }), Object.assign(document.createElement('span'), { className: 'meta', textContent: ko() ? '보는 중 · 보기 전용' : 'Looking · read only' }));
    head.append(avatar(who, 'a-avatar who-face'), name);

    // today
    const today = document.createElement('section');
    today.className = 'who-sec';
    today.innerHTML = `<span class="card-title"></span><div class="who-today"><div class="who-ring"><svg viewBox="0 0 36 36"><circle class="t" cx="18" cy="18" r="16" pathLength="100"/><circle class="a" cx="18" cy="18" r="16" pathLength="100"/></svg><strong></strong></div><dl class="who-facts"></dl></div>`;
    today.querySelector('.card-title')!.textContent = 'Today';
    const arc = today.querySelector<SVGCircleElement>('circle.a')!;
    arc.style.strokeDashoffset = '100';
    requestAnimationFrame(() => requestAnimationFrame(() => (arc.style.strokeDashoffset = String(100 - pct))));
    today.querySelector('.who-ring strong')!.textContent = `${pct}%`;
    const facts = today.querySelector('.who-facts')!;
    const fact = (k: string, v: string) => facts.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
    fact(ko() ? '계획' : 'Planned', planned ? `${formatDuration(planned)} · ${blocks.length}${ko() ? '개' : ' tasks'}` : (ko() ? '아직 없음' : 'Nothing yet'));
    fact(ko() ? '완료' : 'Done', formatDuration(done));
    fact(ko() ? '지금' : 'Now', cur ? `${labelOf(cur)} · ${formatDuration(Math.ceil(cur.dur - mod(now - cur.start)))} ${ko() ? '남음' : 'left'}` : (ko() ? '여유' : 'Free'));
    if (next) fact(ko() ? '다음' : 'Next', `${hhmm(next.start)} ${labelOf(next)}`);

    // attendance
    const att = document.createElement('section');
    att.className = 'who-sec';
    const attHead = document.createElement('div');
    attHead.className = 'who-row';
    attHead.append(Object.assign(document.createElement('span'), { className: 'card-title', textContent: ko() ? '출석' : 'Attendance' }));
    const st = document.createElement('span');
    st.className = 'who-streak';
    st.append(icon('flame'), ko() ? `${streak}일 연속 · 최고 ${best}일` : `${streak}-day streak · best ${best}`);
    attHead.append(st);
    const grass = document.createElement('div');
    grass.className = 'who-grass';
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (WEEKS * 7 - 1) - end.getDay());
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const k = keyOf(d);
      const c = document.createElement('i');
      c.className = `${days.has(k) ? 'on' : ''}${k === keyOf(end) ? ' today' : ''}`;
      c.title = `${k} · ${days.has(k) ? (ko() ? '출석' : 'attended') : (ko() ? '결석' : 'missed')}`;
      grass.append(c);
    }
    att.append(attHead, grass);

    // the last seven days
    const week = document.createElement('section');
    week.className = 'who-sec';
    week.append(Object.assign(document.createElement('span'), { className: 'card-title', textContent: ko() ? '최근 7일' : 'Last 7 days' }));
    const cols = document.createElement('div');
    cols.className = 'who-cols';
    const max = Math.max(60, ...recent.map((r) => r.planned));
    recent.forEach((r, k) => {
      const col = document.createElement('div');
      col.className = 'who-col';
      col.style.setProperty('--i', String(k));
      col.title = r.planned ? `${r.date} · ${formatDuration(r.planned)} · ${Math.round((r.done / r.planned) * 100)}%` : `${r.date} · —`;
      const bar = document.createElement('span');
      bar.className = 'who-bar';
      const p = document.createElement('i');
      p.className = 'plan';
      p.style.height = `${(r.planned / max) * 100}%`;
      const dn = document.createElement('i');
      dn.className = 'done';
      dn.style.height = `${(r.done / max) * 100}%`;
      bar.append(p, dn);
      const lab = document.createElement('span');
      lab.className = 'who-col-label';
      lab.textContent = (ko() ? '일월화수목금토' : 'SMTWTFS')[new Date(`${r.date}T00:00`).getDay()]!;
      col.append(bar, lab);
      cols.append(col);
    });
    week.append(cols);

    card.append(head, today, att, week);
  }

  async function loadRecent(p: Profile): Promise<void> {
    const s = session();
    if (!s) return;
    const { fs, db } = s.fb;
    const out: { date: string; planned: number; done: number }[] = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    const keys: string[] = [];
    for (let k = 0; k < 7; k++) {
      keys.push(keyOf(d));
      d.setDate(d.getDate() + 1);
    }
    for (const date of keys) {
      const snap = await fs.getDoc(fs.doc(db, `users/${p.uid}/days/${date}`)).catch(() => null);
      const bl = ((snap?.data() as { blocks?: unknown[] } | undefined)?.blocks ?? []).filter(isBlock);
      out.push({ date, planned: bl.reduce((a, b) => a + b.dur, 0), done: bl.filter((b) => b.done).reduce((a, b) => a + b.dur, 0) });
    }
    if (who !== p) return;
    recent = out;
    // today counts as it is now
    const t = recent.find((r) => r.date === keyOf(new Date()));
    if (t && blocks.length) {
      t.planned = blocks.reduce((a, b) => a + b.dur, 0);
      t.done = blocks.filter((b) => b.done).reduce((a, b) => a + b.dur, 0);
    }
    paint();
  }

  onViewing((p) => {
    stops.forEach((f) => f());
    stops = [];
    clearInterval(clock);
    who = p;
    blocks = [];
    checkins = new Set();
    notion = new Set();
    recent = [];
    card.hidden = !p;
    if (!p) return;
    card.classList.remove('in');
    void card.offsetWidth;
    card.classList.add('in');
    paint();
    stops.push(watchTheirs<{ blocks?: unknown[] }>('state/timetable', (data) => {
      blocks = (data?.blocks ?? []).filter(isBlock).map((b) => ({ ...b, done: b.done === true }));
      paint();
    }));
    stops.push(watchTheirs<{ items?: unknown[] }>('lists/checkins', (data) => {
      checkins = new Set((data?.items ?? []).filter((x): x is string => typeof x === 'string'));
      paint();
    }));
    if (p.notionName) void notionView(p.notionName).then((v) => {
      if (who !== p) return;
      notion = v.days;
      paint();
    });
    void loadRecent(p);
    clock = window.setInterval(paint, 30_000);
  });
}
