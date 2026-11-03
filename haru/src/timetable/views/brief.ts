import { session, avatar } from '../../cloud/session';
import { DAY as WHOLE_DAY, cheersOn, onCheers, type Cheer } from '../../cloud/cheers';
import { viewing } from '../../cloud/viewing';
import { dayKey, dayOf, timetableOn } from '../history';
import { type Block, CATEGORIES, blockAt, freeAround, labelOf, progressOf } from '../model';
import { addBlock, state } from '../state';
import { streaks, todayRun } from '../streaks';
import { DAY, formatDuration, hhmm, mod, nowMinutes, snap } from '../time';
import { drawReadOnlyDial } from '../dial';
import { svgEl } from '../svg';
import { icon } from '../../ui/icons';
import { lang } from '../../ui/i18n';
import { currentView, onView } from '../../ui/router';

/**
 * The morning brief: the first time Today opens on a new day, one card with the day ahead — today's tasks on a small
 * ring, what comes first, the school day and lunch when they're in Today — and the day before: how much was done,
 * and what was left, each with a button that brings it into today. Under them the hearts the others sent and the
 * streaks. It comes up by itself once a day (after a page tour, never over one); the Brief chip under the
 * greeting opens it again.
 */
const SEEN_KEY = 'haru:brief-seen';
const ko = () => lang() === 'ko';

const shiftDay = (date: string, n: number) => {
  const d = new Date(`${date}T12:00`);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
const seen = (): string => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
};
const markSeen = (date: string) => {
  try {
    localStorage.setItem(SEEN_KEY, date);
  } catch {
    // shown again next visit
  }
};

/** Where `b` can go in today: its own time when that is free, else the first free stretch as long, from now on. */
function placeFor(b: Block, blocks: readonly Block[]): number | null {
  const fits = (m: number) => !blockAt(blocks, m) && freeAround(blocks, m).fwd >= b.dur;
  if (fits(b.start)) return b.start;
  const from = snap(nowMinutes());
  for (let i = 0; i < DAY; i += 15) {
    const m = mod(from + i);
    if (fits(m)) return m;
  }
  return null;
}

let dlg: HTMLDialogElement | null = null;

export async function openBrief(): Promise<void> {
  const today = dayOf();
  const yesterday = shiftDay(today, -1);
  const past = await timetableOn(yesterday).catch(() => null);
  const before = past && !past.carried ? past.snap.blocks : [];
  markSeen(today);

  dlg?.remove();
  dlg = document.createElement('dialog');
  dlg.className = 'modal brief';
  dlg.setAttribute('aria-label', ko() ? '오늘의 브리핑' : 'Morning brief');
  const card = document.createElement('div');
  card.className = 'modal-card brief-card';
  dlg.append(card);

  // ---- the day: its date, the part of the day, the name
  const hour = new Date().getHours();
  const hero = document.createElement('header');
  hero.className = 'brief-hero';
  const mark = document.createElement('span');
  mark.className = `brief-sun${hour >= 6 && hour < 18 ? ' day' : ''}`;
  mark.append(icon(hour >= 6 && hour < 18 ? 'sun' : 'moon'));
  const heading = document.createElement('div');
  heading.className = 'brief-heading';
  const date = new Date(`${today}T12:00`).toLocaleDateString(ko() ? 'ko-KR' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const first = (session()?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const hello = ko()
    ? (hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요')
    : (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  heading.append(
    Object.assign(document.createElement('span'), { className: 'meta brief-date', textContent: date }),
    Object.assign(document.createElement('h2'), { className: 'brief-title', textContent: first ? (ko() ? `${hello}, ${first}님` : `${hello}, ${first}`) : hello }),
  );
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn brief-x';
  close.setAttribute('aria-label', ko() ? '닫기' : 'Close');
  close.append(icon('x'));
  close.addEventListener('click', () => shut());
  hero.append(mark, heading, close);

  // ---- today: the ring and what it holds
  const todaySec = document.createElement('section');
  todaySec.className = 'brief-today';
  const ring = svgEl('svg', { class: 'peek-dial brief-ring', viewBox: '-520 -520 1040 1040', role: 'img' }) as SVGSVGElement;
  const blocks = [...state.blocks].sort((a, b) => a.start - b.start);
  const { planned } = progressOf(blocks);
  drawReadOnlyDial(ring, blocks, { center: String(blocks.length) });
  ring.setAttribute('aria-label', ko() ? `오늘 할 일 ${blocks.length}개` : `${blocks.length} tasks today`);
  const facts = document.createElement('div');
  facts.className = 'brief-facts';
  facts.append(Object.assign(document.createElement('span'), { className: 'card-title', textContent: ko() ? '오늘' : 'Today' }));
  const line = (label: string, value: string, cls = '') => {
    const row = document.createElement('div');
    row.className = `brief-fact ${cls}`.trim();
    row.append(Object.assign(document.createElement('span'), { className: 'k', textContent: label }), Object.assign(document.createElement('span'), { className: 'v', textContent: value }));
    facts.append(row);
    return row;
  };
  const now = nowMinutes();
  if (!blocks.length) {
    facts.append(Object.assign(document.createElement('p'), { className: 'brief-empty', textContent: ko() ? '아직 계획이 없어요. 링을 끌어서 첫 할 일을 만들어 보세요.' : 'Nothing planned yet. Drag on the ring to make the first task.' }));
  } else {
    line(ko() ? '계획' : 'Planned', ko() ? `${blocks.length}개 · ${formatDuration(planned)}` : `${blocks.length} ${blocks.length === 1 ? 'task' : 'tasks'} · ${formatDuration(planned)}`);
    const ahead = blocks.filter((b) => !b.done).sort((a, b) => mod(a.start - now) - mod(b.start - now));
    const next = ahead[0];
    if (next) line(ko() ? '다음' : 'Up next', `${hhmm(next.start)} ${labelOf(next)}`, 'next').style.setProperty('--c', `var(--cat-${next.cat})`);
    const lessons = blocks.filter((b) => b.cat === 'school');
    if (lessons.length) line(ko() ? '학교' : 'School', ko() ? `${lessons.length}교시 · ${hhmm(lessons[0]!.start)} 시작` : `${lessons.length} lessons · from ${hhmm(lessons[0]!.start)}`);
    const lunch = blocks.find((b) => b.cat === 'meal' && b.note && b.start >= 11 * 60 && b.start < 14 * 60) ?? blocks.find((b) => b.cat === 'meal' && b.note);
    if (lunch?.note) {
      const menu = lunch.note.split(/\n|,|·/).map((x) => x.trim()).filter(Boolean).slice(0, 5).join(' · ');
      line(labelOf(lunch), menu, 'menu');
    }
  }
  todaySec.append(ring, facts);

  // ---- the day before: how it went, what was left
  const ySec = document.createElement('section');
  ySec.className = 'brief-yesterday';
  const yp = progressOf(before);
  const pct = yp.planned ? Math.round((yp.done / yp.planned) * 100) : 0;
  const yHead = document.createElement('div');
  yHead.className = 'brief-row';
  yHead.append(Object.assign(document.createElement('span'), { className: 'card-title', textContent: ko() ? '어제' : 'Yesterday' }));
  const left = before.filter((b) => !b.done && !blocks.some((t) => t.title === b.title && t.cat === b.cat));
  if (before.length) {
    const meter = document.createElement('span');
    meter.className = 'brief-meter';
    meter.innerHTML = '<i><b></b></i><span></span>';
    meter.querySelector<HTMLElement>('b')!.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => (meter.querySelector<HTMLElement>('b')!.style.width = `${pct}%`)));
    meter.querySelector('span')!.textContent = ko()
      ? `${before.filter((b) => b.done).length}/${before.length} 완료 · ${pct}%`
      : `${before.filter((b) => b.done).length} of ${before.length} done · ${pct}%`;
    yHead.append(meter);
  }
  ySec.append(yHead);
  if (!before.length) {
    ySec.append(Object.assign(document.createElement('p'), { className: 'brief-empty', textContent: ko() ? '어제 기록이 없어요.' : 'Nothing kept yesterday.' }));
  } else if (!left.length) {
    ySec.append(Object.assign(document.createElement('p'), { className: 'brief-empty good', textContent: ko() ? '어제 할 일을 모두 끝냈어요. 멋져요!' : 'Everything from yesterday got done. Nice work!' }));
  } else {
    const sub = Object.assign(document.createElement('p'), { className: 'brief-sub', textContent: ko() ? '못 끝낸 일 · 눌러서 오늘로 가져와요' : 'Left over · bring any into today' });
    const list = document.createElement('ul');
    list.className = 'brief-left';
    for (const b of left.slice(0, 6)) {
      const li = document.createElement('li');
      li.style.setProperty('--c', `var(--cat-${b.cat})`);
      li.innerHTML = '<i class="dot"></i><span class="n"></span><span class="t"></span>';
      li.querySelector('.n')!.textContent = labelOf(b);
      li.querySelector('.t')!.textContent = `${hhmm(b.start)} · ${formatDuration(b.dur)}`;
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'btn-sm brief-take';
      take.append(icon('plus'), ko() ? '오늘로' : 'Today');
      take.addEventListener('click', () => {
        const at = placeFor(b, state.blocks);
        if (at === null) {
          take.replaceChildren(ko() ? '빈 시간 없음' : 'No free time');
          take.disabled = true;
          return;
        }
        const err = addBlock({ id: null, title: b.title, cat: b.cat, start: at, dur: b.dur, done: false, ...(b.note ? { note: b.note } : {}) });
        if (err) {
          take.replaceChildren(err);
          take.disabled = true;
          return;
        }
        take.replaceChildren(icon('check'), at === b.start ? (ko() ? '추가됨' : 'Added') : `${hhmm(at)}`);
        take.title = at === b.start ? '' : (ko() ? `${hhmm(b.start)}은 차 있어서 ${hhmm(at)}에 넣었어요` : `${hhmm(b.start)} was taken, so it went in at ${hhmm(at)}`);
        take.disabled = true;
        li.classList.add('taken');
        drawReadOnlyDial(ring, [...state.blocks], { center: String(state.blocks.length) });
      });
      li.append(take);
      list.append(li);
    }
    ySec.append(sub, list);
  }

  // ---- hearts and streaks
  const extra = document.createElement('section');
  extra.className = 'brief-extra';
  const cheersBox = document.createElement('div');
  cheersBox.className = 'brief-tile brief-cheers';
  const paintCheers = () => {
    const got: Cheer[] = [...cheersOn(today), ...cheersOn(yesterday)];
    cheersBox.hidden = !session();
    cheersBox.replaceChildren();
    const top = document.createElement('div');
    top.className = 'brief-tile-top';
    top.append(icon('heart'), Object.assign(document.createElement('span'), { textContent: ko() ? `받은 응원 ${got.length}` : `${got.length} ${got.length === 1 ? 'cheer' : 'cheers'}` }));
    cheersBox.append(top);
    if (!got.length) {
      cheersBox.append(Object.assign(document.createElement('p'), { className: 'brief-tile-sub', textContent: ko() ? '다른 멤버의 Today를 보고 하트를 보내 보세요' : 'Look at someone’s Today and send them a heart' }));
      return;
    }
    const faces = document.createElement('div');
    faces.className = 'brief-faces';
    const people = [...new Map(got.map((c) => [c.from, c])).values()];
    for (const c of people.slice(0, 5)) faces.append(avatar({ name: c.fromName || '?', photo: c.fromPhoto }, 'a-avatar'));
    const c0 = got[0]!;
    const what = c0.key === WHOLE_DAY ? (ko() ? '하루' : 'your day') : c0.title;
    const say = Object.assign(document.createElement('p'), {
      className: 'brief-tile-sub',
      textContent: ko() ? `${c0.fromName}님이 ${what}${got.length > 1 ? ` 외 ${got.length - 1}개` : ''}에 하트` : `${c0.fromName} cheered ${what}${got.length > 1 ? ` and ${got.length - 1} more` : ''}`,
    });
    cheersBox.append(faces, say);
  };
  paintCheers();
  onCheers(() => dlg?.open && paintCheers());
  const run = todayRun();
  const best = [...streaks()].sort((a, b) => b.days - a.days)[0];
  const streakBox = document.createElement('div');
  streakBox.className = 'brief-tile brief-streak';
  const sTop = document.createElement('div');
  sTop.className = 'brief-tile-top';
  sTop.append(icon('flame'), Object.assign(document.createElement('span'), { textContent: ko() ? `${run.days}일 연속` : `${run.days} ${run.days === 1 ? 'day' : 'days'} in a row` }));
  const sSub = document.createElement('p');
  sSub.className = 'brief-tile-sub';
  if (best && best.days > 1) {
    // the category on its own, so it reads in the language picked
    const cat = Object.assign(document.createElement('span'), { textContent: CATEGORIES[best.cat] });
    if (ko()) sSub.append('가장 긴 기록: ', cat, ` ${best.days}일 · 최고 ${run.best}일`);
    else sSub.append('Longest now: ', cat, ` · ${best.days} days · best ever ${run.best}`);
  } else sSub.textContent = ko() ? `최고 기록 ${run.best}일 · 오늘도 이어가요` : `Best ever ${run.best} · keep it going today`;
  streakBox.append(sTop, sSub);
  extra.append(cheersBox, streakBox);

  // ---- off we go
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn-accent brief-go';
  go.append(ko() ? '오늘 시작하기' : 'Start the day', icon('arrow-right'));
  go.addEventListener('click', () => shut());

  card.append(hero, todaySec, ySec, extra, go);
  document.body.append(dlg);
  dlg.showModal();
  go.focus();

  function shut(): void {
    const d = dlg;
    if (!d) return;
    d.classList.add('closing');
    setTimeout(() => {
      d.close();
      d.remove();
    }, 150);
  }
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    shut();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) shut();
  });
}

/** The chip under the greeting that opens the brief again. */
export function briefChip(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'greet-streak greet-brief';
  b.title = ko() ? '오늘의 브리핑 다시 보기' : 'See this morning’s brief again';
  b.append(icon('sun'), ko() ? '브리핑' : 'Brief');
  b.addEventListener('click', () => void openBrief());
  return b;
}

/** Once a day, on Today, when nothing else is on screen (a tour, a dialog, the sign-in card, someone else's Today). */
export function mountBrief(): void {
  const check = () => {
    const today = dayOf();
    const was = seen();
    if (was === today) return;
    // the very first visit has its page tour instead, and nothing to look back on
    if (!was) return markSeen(today);
    if (currentView() !== 'today' || viewing()) return;
    if (document.body.classList.contains('gated') || document.querySelector('dialog[open], .tour, .pop-menu')) return;
    void openBrief();
  };
  setTimeout(check, 3200);
  // also later: after a tour or the weekly review, on coming back to Today, or when the new day begins
  setInterval(check, 5000);
  onView((v) => v === 'today' && setTimeout(check, 800));
}
