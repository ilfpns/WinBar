import { onSession, session } from '../cloud/session';
import { featureOn, type Feature } from './features';
import { icon } from './icons';
import { lang } from './i18n';
import { currentView, onView, type View } from './router';

/**
 * Tours: the first time a page is opened, a few steps point at its parts and say what they do — a spotlight on the
 * part, a card beside it, Back / Next, Skip (or Esc) to stop. Each page's tour shows once per account: what was
 * seen is kept on this device (`haru:tour-seen:<uid>`) and in the account (`users/{uid}/meta/tour`), so a new
 * device doesn't show it again. Archive → 사용 안내 replays any page's tour (see archive/guide.ts).
 * The words are in English, or Korean with Korean picked.
 */
interface Step {
  /** The part to point at (the first visible match); none: a card in the middle. */
  target?: string;
  en: [string, string];
  ko: [string, string];
}

export const TOURS: Record<View, { name: [string, string]; steps: Step[] }> = {
  today: { name: ['Today', '오늘'], steps: [
    { en: ['Welcome to Haru', 'Haru keeps one day at a time. This short tour shows what each part of Today does. Skip it any time — Archive → 사용 안내 shows it again.'],
      ko: ['Haru에 오신 걸 환영해요', 'Haru는 하루를 한 장씩 관리해요. 이 짧은 안내로 Today의 각 부분이 무엇을 하는지 보여 드릴게요. 언제든 Skip으로 넘길 수 있고, Archive → 사용 안내에서 다시 볼 수 있어요.'] },
    { target: '.dial-wrap', en: ['The day as a ring', 'Drag along the ring from a start to an end to make a task. Click a task to edit it; tick it off when it’s done. The green hand is now.'],
      ko: ['하루를 한 바퀴로', '링을 따라 시작부터 끝까지 끌면 할 일이 만들어져요. 할 일을 누르면 고칠 수 있고, 다 하면 체크해요. 초록 바늘이 지금 시각이에요.'] },
    { target: '.today-views', en: ['Other ways to look', 'Dial, Slices, By category, Flow (tasks wired in order — add one right on a wire), the next 3 hours, this week and this month.'],
      ko: ['다르게 보기', '다이얼, 조각, 카테고리별, Flow(할 일이 순서대로 이어진 다이어그램, 선 위에서 바로 추가), 다음 3시간, 이번 주, 이번 달을 골라 볼 수 있어요.'] },
    { target: '.greet-ahead', en: ['Plan ahead', 'Tomorrow turns the dial into tomorrow’s plan. ‹ › step through the days; what you plan becomes that day’s tasks when it starts.'],
      ko: ['미리 계획하기', 'Tomorrow를 누르면 다이얼이 내일 계획으로 바뀌어요. ‹ ›로 날짜를 넘기고, 계획한 것은 그날이 시작되면 할 일이 돼요.'] },
    { target: '.drawer-tab[aria-controls="panel-right"]', en: ['Tasks', 'The list of today’s tasks, day templates and the editor live in this drawer. Shortcut: ]'],
      ko: ['할 일 서랍', '오늘 할 일 목록, 하루 템플릿, 편집기가 이 서랍에 있어요. 단축키는 ] 예요.'] },
    { target: '#rail', en: ['Every page', 'All pages are here. Drag them to reorder; the ones above the line turn with the wheel or a swipe. The logo at the top opens Settings.'],
      ko: ['모든 페이지', '모든 페이지가 여기 있어요. 끌어서 순서를 바꾸고, 선 위의 페이지는 휠이나 스와이프로 넘어가요. 맨 위 로고는 설정을 열어요.'] },
  ] },
  calendar: { name: ['Calendar', '캘린더'], steps: [
    { target: '#cal-grid', en: ['The month', 'Each day shows what it held. Click a day to open it beside the month.'],
      ko: ['한 달 보기', '날마다 무엇을 했는지 보여요. 날짜를 누르면 옆에 그날이 열려요.'] },
    { target: '#cal-day', en: ['A day and its memo', 'The memo is Markdown. A line starting with ! (e.g. "! 12:00-12:30 work Title") moves to Today as a task.'],
      ko: ['하루와 메모', '메모는 마크다운으로 써요. !로 시작하는 줄(예: "! 12:00-12:30 work 제목")은 Today의 할 일로 옮겨져요.'] },
    { target: '#cal-mode', en: ['Month and Week', 'Week shows seven small dials and lets you plan days ahead with a template.'],
      ko: ['월과 주', 'Week에서는 일주일을 작은 다이얼로 보고, 템플릿으로 앞날을 미리 계획할 수 있어요.'] },
    { target: '#cal-stats', en: ['Statistics', 'How your days have gone: hours done and planned, by category, over time.'],
      ko: ['통계', '지금까지의 하루들: 완료·계획 시간, 카테고리별 흐름을 보여요.'] },
  ] },
  news: { name: ['News', '뉴스'], steps: [
    { target: '#globe', en: ['Headlines on the globe', 'Drag to spin, scroll to zoom. Pins are fresh headlines — click one to read.'],
      ko: ['지구본 위 뉴스', '끌어서 돌리고 스크롤로 확대해요. 핀은 최신 헤드라인이고, 누르면 읽을 수 있어요.'] },
    { target: '.attend', en: ['Check in', 'One tap a day. The grid fills in with the days you came.'],
      ko: ['출석', '하루 한 번 눌러요. 출석한 날이 칸으로 채워져요.'] },
    { target: '.drawer-tab[aria-controls="panel-news"]', en: ['All the news', 'The full list of headlines opens here.'],
      ko: ['뉴스 목록', '헤드라인 전체 목록이 여기서 열려요.'] },
  ] },
  words: { name: ['Words', '단어'], steps: [
    { target: '.w-card', en: ['Flashcards', 'Flip a card, then say if you knew it. Known words come back later, missed ones sooner.'],
      ko: ['단어 카드', '카드를 뒤집고 알았는지 골라요. 아는 단어는 나중에, 모르는 단어는 더 빨리 다시 나와요.'] },
    { target: '.w-mode', en: ['Modes', 'Switch between studying and the full list.'],
      ko: ['모드', '공부와 전체 목록을 오가요.'] },
    { target: '.w-add', en: ['Your own words', 'Add words yourself, or paste a list.'],
      ko: ['내 단어 추가', '단어를 직접 넣거나 목록을 붙여 넣을 수 있어요.'] },
  ] },
  journal: { name: ['Journal', '일기'], steps: [
    { target: '.insights', en: ['Your days', 'Everything Today has held so far: charts by category, top tasks and weekdays. Click to open it.'],
      ko: ['나의 하루들', '지금까지 Today에 담긴 기록이에요. 카테고리, 많이 한 일, 요일별 차트를 볼 수 있어요. 눌러서 펼쳐요.'] },
    { target: '.j-side', en: ['Folders and pages', 'Pages are filed in folders. Drag to move them; New makes a page.'],
      ko: ['폴더와 페이지', '페이지는 폴더에 정리돼요. 끌어서 옮기고, New로 새 페이지를 만들어요.'] },
    { target: '.j-editor', en: ['Writing', 'Markdown that formats as you type. / opens the block menu. Add photos, export a PDF, or share a page to Archive.'],
      ko: ['쓰기', '쓰는 대로 모양이 잡히는 마크다운이에요. /를 누르면 블록 메뉴가 열려요. 사진 추가, PDF 내보내기, Archive에 공유도 돼요.'] },
  ] },
  archive: { name: ['Archive', '아카이브'], steps: [
    { target: '#archive-body .j-side', en: ['Shared pages', 'Pages everyone shared from Journal, newest first. The pinned ones on top are notices and this guide.'],
      ko: ['공유된 페이지', '모두가 Journal에서 공유한 페이지가 최신순으로 보여요. 맨 위 고정 항목은 공지와 이 사용 안내예요.'] },
    { target: '#archive-body .j-editor', en: ['Read and talk', 'Open a page to read it and leave comments. Only its author can take it down.'],
      ko: ['읽고 댓글 달기', '페이지를 열어 읽고 댓글을 남겨요. 내리는 건 쓴 사람만 할 수 있어요.'] },
  ] },
  board: { name: ['Dot board', '도트 보드'], steps: [
    { target: '.bd-map', en: ['Every day, a cell', 'Each category grows a hexagon for each day you kept it. Hover a cell for that day.'],
      ko: ['하루에 한 칸', '카테고리마다 기록한 날만큼 육각형이 자라요. 칸에 마우스를 올리면 그날이 보여요.'] },
    { target: '.bd-side', en: ['Categories and streaks', 'The flame is how many days in a row. Click a category to light up its cells.'],
      ko: ['카테고리와 연속 기록', '불꽃은 며칠 연속인지예요. 카테고리를 누르면 그 칸들이 켜져요.'] },
    { target: '.bd-review', en: ['Review', 'Your week, month or all time in one card.'],
      ko: ['리뷰', '한 주, 한 달, 전체 기간을 카드 한 장으로 봐요.'] },
  ] },
  library: { name: ['Library', '라이브러리'], steps: [
    { target: '.lib-add, .lib-kinds', en: ['Bring notes in, keep them in Git', 'Connect an Obsidian vault or a Notion workspace. The branch button sets a GitHub repository once; then Add on a note, Commit, Push. Tokens stay encrypted in this browser.'],
      ko: ['노트 가져오기, Git에 기록하기', 'Obsidian 보관함이나 Notion 워크스페이스를 연결해요. 브랜치 버튼으로 GitHub 레포를 한 번 정해 두면, 노트에서 Add → Commit → Push로 기록돼요. 토큰은 이 브라우저에 암호화돼 저장돼요.'] },
    { target: '.lib-stage', en: ['Cards', 'Folders are stacked cards, notes single sheets. Wheel, drag or ← → to move; open the middle one to step in or read.'],
      ko: ['카드 넘기기', '폴더는 겹친 카드, 노트는 한 장이에요. 휠·드래그·← →로 넘기고, 가운데 카드를 열면 폴더로 들어가거나 노트를 읽어요.'] },
    { target: '.lib-crumbs', en: ['Where you are', 'The path steps back out of folders. New note makes one in the open folder.'],
      ko: ['지금 위치', '경로를 눌러 폴더 밖으로 나가요. New note로 열린 폴더에 노트를 만들어요.'] },
    { target: '.lib-reader', en: ['Read, edit and memo', 'Edit any note — it saves back to the vault file, a GitHub commit, or the Notion page. Add or delete pictures and pages here too. A memo on any note goes to your memo repo on GitHub. Esc closes.'],
      ko: ['읽기·편집·메모', '어떤 노트든 바로 고치면 보관함 파일, GitHub 커밋, Notion 페이지에 그대로 저장돼요. 그림과 페이지 추가·삭제도 여기서 해요. 메모는 설정한 GitHub 메모 레포에 커밋돼요. Esc로 닫아요.'] },
  ] },
};

const localKey = (uid: string) => `haru:tour-seen:${uid}`;
let seen: Record<string, number> = {};
let uidNow = 'local';

function loadLocal(uid: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(localKey(uid)) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function keep(): void {
  try {
    localStorage.setItem(localKey(uidNow), JSON.stringify(seen));
  } catch {
    // shown again next visit
  }
  const s = session();
  if (!s) return;
  const { fs, db } = s.fb;
  // the whole list each time (not merged), so a tour asked for again stays asked for
  void fs.setDoc(fs.doc(db, `users/${s.uid}/meta/tour`), { seen, updated: Date.now() }).catch(() => {});
}

export const tourSeen = (v: View): boolean => !!seen[v];

/** Forgets that `views` were seen, so they show again next time (Archive → 사용 안내 → Show all again). */
export function resetTours(views: View[] = Object.keys(TOURS) as View[]): void {
  for (const v of views) delete seen[v];
  keep();
}

// ---------- the tour on screen
let running: { stop: () => void } | null = null;

export function startTour(view: View, done?: () => void): void {
  running?.stop();
  const t = TOURS[view];
  const ko = lang() === 'ko';
  const visible = (sel?: string): HTMLElement | null => {
    if (!sel) return null;
    for (const e of document.querySelectorAll<HTMLElement>(sel)) {
      const r = e.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight) return e;
    }
    return null;
  };
  // the steps whose part is on screen now (and the ones with none)
  const steps = t.steps.filter((s) => !s.target || visible(s.target));
  if (!steps.length) return;
  let at = 0;

  const layer = document.createElement('div');
  layer.className = 'tour';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  const card = document.createElement('div');
  card.className = 'tour-card';
  layer.append(spot, card);
  document.body.append(layer);

  const finish = () => {
    seen[view] = Date.now();
    keep();
    stop();
    done?.();
  };
  function stop(): void {
    removeEventListener('resize', place);
    document.removeEventListener('keydown', key, true);
    layer.classList.add('out');
    setTimeout(() => layer.remove(), 180);
    running = null;
  }
  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  function go(by: number): void {
    const to = at + by;
    if (to < 0) return;
    if (to >= steps.length) return finish();
    at = to;
    paint();
  }
  function place(): void {
    const target = visible(steps[at]!.target);
    const pad = 8;
    const cw = Math.min(340, innerWidth - 32);
    card.style.width = `${cw}px`;
    if (!target) {
      spot.classList.add('none');
      card.style.left = `${(innerWidth - cw) / 2}px`;
      card.style.top = `${Math.max(16, (innerHeight - card.offsetHeight) / 2)}px`;
      return;
    }
    spot.classList.remove('none');
    const r = target.getBoundingClientRect();
    const box = { x: Math.max(4, r.left - pad), y: Math.max(4, r.top - pad), w: Math.min(innerWidth - 8, r.width + 2 * pad), h: Math.min(innerHeight - 8, r.height + 2 * pad) };
    Object.assign(spot.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    // the card where it fits: right of the part, left, below, above, else over it at the bottom
    const ch = card.offsetHeight;
    const gap = 14;
    const fits = [
      { x: box.x + box.w + gap, y: box.y, ok: box.x + box.w + gap + cw < innerWidth - 12 },
      { x: box.x - gap - cw, y: box.y, ok: box.x - gap - cw > 12 },
      { x: box.x, y: box.y + box.h + gap, ok: box.y + box.h + gap + ch < innerHeight - 12 },
      { x: box.x, y: box.y - gap - ch, ok: box.y - gap - ch > 12 },
    ].find((f) => f.ok) ?? { x: (innerWidth - cw) / 2, y: innerHeight - ch - 16 };
    card.style.left = `${Math.min(Math.max(12, fits.x), innerWidth - cw - 12)}px`;
    card.style.top = `${Math.min(Math.max(12, fits.y), innerHeight - ch - 12)}px`;
  }
  function paint(): void {
    const s = steps[at]!;
    const [title, body] = ko ? s.ko : s.en;
    card.replaceChildren();
    const top = document.createElement('div');
    top.className = 'tour-top';
    const count = document.createElement('span');
    count.className = 'tour-count';
    count.textContent = `${t.name[ko ? 1 : 0]} · ${at + 1}/${steps.length}`;
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'tour-skip';
    skip.textContent = ko ? '건너뛰기' : 'Skip';
    skip.addEventListener('click', finish);
    top.append(count, skip);
    const h = document.createElement('h3');
    h.className = 'tour-title';
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'tour-body';
    p.textContent = body;
    const dots = document.createElement('div');
    dots.className = 'tour-dots';
    steps.forEach((_, k) => dots.append(Object.assign(document.createElement('i'), { className: k === at ? 'on' : '' })));
    const nav = document.createElement('div');
    nav.className = 'tour-nav';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn-sm tour-back';
    back.append(icon('chevron-left'), ko ? '이전' : 'Back');
    back.disabled = at === 0;
    back.addEventListener('click', () => go(-1));
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn-accent tour-next';
    const last = at === steps.length - 1;
    next.append(last ? (ko ? '시작하기' : 'Got it') : (ko ? '다음' : 'Next'), ...(last ? [] : [icon('chevron-right')]));
    next.addEventListener('click', () => go(1));
    nav.append(dots, back, next);
    card.append(top, h, p, nav);
    place();
    next.focus({ preventScroll: true });
  }
  // a click on the dimmed part does nothing (the tour is ended with Skip, Esc or the last step)
  layer.addEventListener('pointerdown', (e) => {
    if (!(e.target as Element).closest('.tour-card')) e.preventDefault();
  });
  addEventListener('resize', place);
  document.addEventListener('keydown', key, true);
  running = { stop };
  paint();
}

/** Shows a page's tour the first time it is opened (signed in, the page switched on, nothing else open). */
export function mountTours(): void {
  seen = loadLocal(uidNow);
  let timer = 0;
  const maybe = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const v = currentView();
      if (tourSeen(v) || running || document.body.classList.contains('gated')) return;
      if (v !== 'today' && !featureOn(v as Feature)) return;
      if (document.querySelector('dialog[open], .tour') || document.body.classList.contains('planning')) return;
      startTour(v);
    }, 900);
  };
  onView(() => maybe());
  onSession(async (s) => {
    uidNow = s?.uid ?? 'local';
    seen = loadLocal(uidNow);
    if (s) {
      // what this account has seen on other devices
      const { fs, db } = s.fb;
      const snap = await fs.getDoc(fs.doc(db, `users/${s.uid}/meta/tour`)).catch(() => null);
      const cloud = (snap?.data() as { seen?: Record<string, number> } | undefined)?.seen ?? {};
      seen = { ...cloud, ...seen };
    }
    maybe();
  });
  // the gate going away (signed in) is the moment to start
  // and the gate coming back (signed out) ends a tour on screen, so it never sits over the sign-in card
  new MutationObserver(() => {
    if (!document.body.classList.contains('gated')) maybe();
    else running?.stop();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  maybe();
}
