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
  /** Something to try on the spot, under the words ([English, Korean]). */
  try?: [string, string];
}

export const TOURS: Record<View, { name: [string, string]; steps: Step[] }> = {
  today: { name: ['Today', '오늘'], steps: [
    { en: ['Welcome to Haru', 'Haru keeps one day at a time. These steps go through Today one part at a time. Skip any time — Archive → 사용 안내 shows them again.'],
      ko: ['Haru에 오신 걸 환영해요', 'Haru는 하루를 한 장씩 관리해요. Today의 각 부분을 하나씩 짚어 드릴게요. 언제든 건너뛸 수 있고, Archive → 사용 안내에서 다시 볼 수 있어요.'] },
    { target: '.dial-wrap', en: ['The day as a ring', 'The ring is 24 hours, midnight at the top. Coloured arcs are tasks; the green hand is now.'],
      ko: ['하루를 한 바퀴로', '링 한 바퀴가 24시간이고, 맨 위가 자정이에요. 색칠된 호가 할 일이고, 초록 바늘이 지금 시각이에요.'] },
    { target: '.dial-wrap', en: ['Make a task', 'Press on the ring where it starts and drag round to where it ends. Let go and name it.'],
      ko: ['할 일 만들기', '시작할 시각에서 링을 누른 채 끝날 시각까지 끌어요. 손을 떼면 이름을 적어요.'],
      try: ['Drag from 9 to 10 o’clock on the ring', '링에서 9시부터 10시까지 끌어 보세요'] },
    { target: '.dial-wrap', en: ['Change a task', 'Click a task on the ring: the editor opens with its name, time, category, notes and status (Yet, In progress, Done).'],
      ko: ['할 일 고치기', '링 위의 할 일을 누르면 편집기가 열려요. 이름, 시간, 카테고리, 메모, 상태(시작 전·진행 중·완료)를 바꿀 수 있어요.'] },
    { target: '.today-views', en: ['Other ways to look', 'Dial, Slices, By category, Flow, the next 3 hours, this week and this month. The same tasks, drawn differently.'],
      ko: ['다르게 보기', '다이얼, 조각, 카테고리별, Flow, 다음 3시간, 이번 주, 이번 달로 바꿔 볼 수 있어요. 같은 할 일을 다른 모양으로 보여 줘요.'],
      try: ['Pick Flow: tasks wired in order, add one right on a wire', 'Flow를 눌러 보세요: 할 일이 순서대로 이어지고, 선 위에서 바로 추가돼요'] },
    { target: '.greet-ahead', en: ['Plan ahead', 'Tomorrow turns the ring into tomorrow’s plan. ‹ › step through the days. A plan becomes that day’s tasks when the day starts.'],
      ko: ['미리 계획하기', 'Tomorrow를 누르면 링이 내일 계획으로 바뀌어요. ‹ ›로 날짜를 넘겨요. 계획은 그날이 시작되면 할 일이 돼요.'] },
    { target: '.drawer-tab[aria-controls="panel-right"]', en: ['The task list', 'This drawer holds today’s tasks as a list. The round button on each one steps Yet → In progress → Done.'],
      ko: ['할 일 목록', '이 서랍에 오늘 할 일이 목록으로 있어요. 각 할 일 앞의 동그란 버튼을 누를 때마다 시작 전 → 진행 중 → 완료로 바뀌어요.'],
      try: ['Press ] to open it, again to close', ']를 눌러 열고, 한 번 더 눌러 닫아 보세요'] },
    { target: '.drawer-tab[aria-controls="panel-right"]', en: ['Day templates', 'Templates (in the same drawer) keep a whole day to use again: save today as one, or fill today from one.'],
      ko: ['하루 템플릿', '같은 서랍의 템플릿에는 하루 전체를 저장해 두고 다시 써요. 오늘을 템플릿으로 저장하거나, 템플릿으로 오늘을 채울 수 있어요.'] },
    { target: '[aria-controls="panel-left"]', en: ['Overview', 'The left drawer shows the clock, how much of today is done, and the time by category.'],
      ko: ['오버뷰', '왼쪽 서랍에는 시계, 오늘 얼마나 했는지, 카테고리별 시간이 보여요.'],
      try: ['Press [ to open it', '[를 눌러 열어 보세요'] },
    { target: '#rail', en: ['Every page', 'All pages are here; click one to go. Drag them to change the order.'],
      ko: ['모든 페이지', '모든 페이지가 여기 있어요. 눌러서 이동하고, 끌어서 순서를 바꿔요.'] },
    { target: '.rail-rule[data-split]', en: ['The swipe line', 'Pages above this line turn with one wheel step or a swipe. Pages below open only from here.'],
      ko: ['넘기기 선', '이 선 위의 페이지는 휠 한 번이나 스와이프로 넘어가요. 선 아래 페이지는 여기서 눌러야 열려요.'] },
    { target: '.rail-brand', en: ['Settings and more', 'The logo opens the menu: Settings (account, look, backup, school timetable), What’s new and more.'],
      ko: ['설정과 더 보기', '로고를 누르면 메뉴가 열려요. 설정(계정, 모양, 백업, 학교 시간표), What’s new 등이 있어요.'] },
  ] },
  calendar: { name: ['Calendar', '캘린더'], steps: [
    { target: '#cal-grid', en: ['The month', 'Each day shows what it held: tasks, plans and memos.'],
      ko: ['한 달 보기', '날마다 무엇을 했는지 보여요. 할 일, 계획, 메모가 칸에 표시돼요.'] },
    { target: '#cal-today', en: ['Moving around', '‹ and › go a month back or ahead; Today comes back to this month.'],
      ko: ['달 넘기기', '‹ ›로 지난달·다음 달로 가고, 오늘을 누르면 이번 달로 돌아와요.'] },
    { target: '#cal-grid', en: ['Open a day', 'Click a day to open it beside the month.'],
      ko: ['하루 열기', '날짜를 누르면 달력 옆에 그날이 열려요.'],
      try: ['Click today’s date', '오늘 날짜를 눌러 보세요'] },
    { target: '#cal-day', en: ['The memo', 'Write anything for the day. It’s Markdown: # heading, - list, **bold**.'],
      ko: ['메모', '그날의 메모를 자유롭게 써요. 마크다운이라 # 제목, - 목록, **굵게**가 돼요.'] },
    { target: '#cal-day', en: ['A memo line to Today', 'A line starting with ! becomes a task in Today: "! 12:00-12:30 work Title".'],
      ko: ['메모를 할 일로', '!로 시작하는 줄은 Today의 할 일이 돼요. 예: "! 12:00-12:30 work 제목"'] },
    { target: '#cal-filters', en: ['What shows', 'Turn kinds of things on or off in the month.'],
      ko: ['보이는 것 고르기', '달력에 보일 종류를 켜고 꺼요.'] },
    { target: '#cal-mode', en: ['Month and Week', 'Week shows seven small rings, one per day.'],
      ko: ['월과 주', '주 보기에서는 일주일을 하루 하나씩 작은 링으로 봐요.'] },
    { target: '#cal-plan', en: ['Plan days', 'Plan days ahead with a template, or by hand.'],
      ko: ['날짜 계획', '템플릿이나 직접 입력으로 앞날을 미리 계획해요.'] },
    { target: '#cal-stats', en: ['Statistics', 'How your days have gone: hours done and planned, by category, over time.'],
      ko: ['통계', '지금까지의 하루들: 완료·계획 시간과 카테고리별 흐름을 보여요.'] },
  ] },
  news: { name: ['News', '뉴스'], steps: [
    { target: '#globe', en: ['The globe', 'Drag to spin it, scroll to zoom in and out.'],
      ko: ['지구본', '끌어서 돌리고, 스크롤로 확대·축소해요.'] },
    { target: '#globe', en: ['Headlines', 'Pins are fresh headlines where they happened. Click a pin to read it.'],
      ko: ['헤드라인', '핀은 일이 일어난 곳의 최신 헤드라인이에요. 핀을 누르면 읽을 수 있어요.'] },
    { target: '.attend', en: ['Check in', 'One tap a day. The grid fills in with the days you came.'],
      ko: ['출석', '하루 한 번 눌러요. 출석한 날이 칸으로 채워져요.'],
      try: ['Check in for today', '오늘 출석을 눌러 보세요'] },
    { target: '.drawer-tab[aria-controls="panel-news"]', en: ['All the news', 'The full list opens here, by topic and by region.'],
      ko: ['뉴스 목록', '전체 목록이 여기서 열려요. 주제별, 지역별로 볼 수 있어요.'] },
  ] },
  words: { name: ['Words', '단어'], steps: [
    { target: '.w-card', en: ['A card', 'The word is on the front. Flip it (or press Space) to see its meaning.'],
      ko: ['단어 카드', '앞면에 단어가 있어요. 뒤집으면(또는 Space) 뜻이 보여요.'] },
    { target: '.w-know', en: ['Did you know it?', 'Got it (→) brings the word back later; Again (←) brings it back sooner.'],
      ko: ['알았나요?', '알아요(→)를 누르면 나중에, 다시(←)를 누르면 더 빨리 다시 나와요.'],
      try: ['Flip with Space, then press →', 'Space로 뒤집고 →를 눌러 보세요'] },
    { target: '.w-mode', en: ['Study or list', 'Switch between studying cards and the full word list.'],
      ko: ['공부와 목록', '카드 공부와 전체 단어 목록을 오가요.'] },
    { target: '.w-add', en: ['Your own words', 'Add a word with its meaning, or paste a whole list, one per line.'],
      ko: ['내 단어 추가', '단어와 뜻을 하나씩 넣거나, 한 줄에 하나씩 목록을 통째로 붙여 넣어요.'] },
  ] },
  journal: { name: ['Journal', '일기'], steps: [
    { target: '.insights', en: ['Your days', 'Everything Today has held so far: by category, top tasks and weekdays. Click to open it.'],
      ko: ['나의 하루들', '지금까지 Today에 담긴 기록이에요. 카테고리, 많이 한 일, 요일별로 보여요. 눌러서 펼쳐요.'] },
    { target: '.j-side', en: ['Folders and pages', 'Pages are filed in folders. Drag a page onto a folder to move it.'],
      ko: ['폴더와 페이지', '페이지는 폴더에 정리돼요. 페이지를 폴더 위로 끌어 놓으면 옮겨져요.'] },
    { target: '.j-new', en: ['A new page', 'New page starts one in the open folder.'],
      ko: ['새 페이지', '새 페이지로 지금 폴더에 새 페이지를 만들어요.'],
      try: ['Make a page and give it a title', '페이지를 하나 만들고 제목을 써 보세요'] },
    { target: '.j-new-folder', en: ['A new folder', 'This makes a folder to group pages.'],
      ko: ['새 폴더', '페이지를 묶을 폴더를 만들어요.'] },
    { target: '.j-editor', en: ['Writing', 'Markdown that formats as you type. / opens the block menu: headings, lists, quotes, code.'],
      ko: ['쓰기', '쓰는 대로 모양이 잡히는 마크다운이에요. /를 누르면 제목, 목록, 인용, 코드 같은 블록 메뉴가 열려요.'] },
    { target: '.j-editor', en: ['Photos, PDF, sharing', 'The buttons above the page add photos, export a PDF, or share the page to Archive for everyone.'],
      ko: ['사진·PDF·공유', '페이지 위 버튼으로 사진을 넣고, PDF로 내보내고, Archive에 공유해 모두에게 보여 줄 수 있어요.'] },
  ] },
  archive: { name: ['Archive', '아카이브'], steps: [
    { target: '#archive-body .j-side', en: ['Shared pages', 'Pages everyone shared from Journal, newest first.'],
      ko: ['공유된 페이지', '모두가 Journal에서 공유한 페이지가 최신순으로 보여요.'] },
    { target: '#archive-body .a-pin', en: ['Pinned', 'On top: the update notices and this guide.'],
      ko: ['고정 항목', '맨 위에는 업데이트 공지와 이 사용 안내가 있어요.'] },
    { target: '#archive-body .j-editor', en: ['Read and talk', 'Open a page to read it and leave comments. Only its author can take it down.'],
      ko: ['읽고 댓글 달기', '페이지를 열어 읽고 댓글을 남겨요. 내리는 건 쓴 사람만 할 수 있어요.'] },
  ] },
  board: { name: ['Dot board', '도트 보드'], steps: [
    { target: '.bd-map', en: ['Every day, a cell', 'Each category grows a hexagon for each day you kept it. Hover a cell to see that day.'],
      ko: ['하루에 한 칸', '카테고리마다 기록한 날만큼 육각형이 자라요. 칸에 마우스를 올리면 그날이 보여요.'] },
    { target: '.bd-legend', en: ['Categories', 'Click a category to light up only its cells.'],
      ko: ['카테고리', '카테고리를 누르면 그 칸들만 켜져요.'],
      try: ['Click one category', '카테고리 하나를 눌러 보세요'] },
    { target: '.bd-legend', en: ['Streaks', 'The flame number is how many days in a row you kept it.'],
      ko: ['연속 기록', '불꽃 옆 숫자는 며칠 연속으로 했는지예요.'] },
    { target: '.bd-who', en: ['Someone else’s board', 'Pick a member to look at their board (look only).'],
      ko: ['다른 사람 보드', '멤버를 골라 그 사람의 보드를 볼 수 있어요(보기만 해요).'] },
    { target: '.bd-review', en: ['Review', 'Your week, month or all time in one card.'],
      ko: ['리뷰', '한 주, 한 달, 전체 기간을 카드 한 장으로 봐요.'] },
  ] },
  library: { name: ['Library', '라이브러리'], steps: [
    { target: '.lib-add, .lib-kinds', en: ['Bring notes in', 'Connect an Obsidian vault (a folder on this computer) or a Notion workspace (with its token).'],
      ko: ['노트 가져오기', 'Obsidian 보관함(이 컴퓨터의 폴더)이나 Notion 워크스페이스(토큰 필요)를 연결해요.'] },
    { target: '.lib-git-set', en: ['Keep notes in Git', 'Set a GitHub repository once here. Then on a note: Add → Commit → Push.'],
      ko: ['Git에 기록하기', '여기서 GitHub 레포를 한 번 정해 두면, 노트에서 Add → Commit → Push로 기록돼요.'] },
    { target: '.lib-stage', en: ['Cards', 'Folders are stacked cards, notes single sheets. Wheel, drag or ← → to move.'],
      ko: ['카드 넘기기', '폴더는 겹친 카드, 노트는 한 장이에요. 휠·드래그·← →로 넘겨요.'],
      try: ['Press → a few times', '→를 몇 번 눌러 보세요'] },
    { target: '.lib-arc', en: ['Where in the row', 'The dot on the arc shows where you are among the cards.'],
      ko: ['지금 몇 번째인지', '호 위의 점이 카드 줄에서 지금 위치를 보여 줘요.'] },
    { target: '.lib-stage', en: ['Open the middle card', 'Click (or Enter) the middle card: a folder steps in, a note opens to read.'],
      ko: ['가운데 카드 열기', '가운데 카드를 누르면(또는 Enter) 폴더는 안으로 들어가고, 노트는 열려서 읽을 수 있어요.'] },
    { target: '.lib-crumbs', en: ['Where you are', 'The path steps back out of folders. New note makes one in the open folder.'],
      ko: ['지금 위치', '경로를 눌러 폴더 밖으로 나가요. New note로 열린 폴더에 노트를 만들어요.'] },
    { target: '.lib-recent', en: ['Recently opened', 'Notes you opened lately, from every source.'],
      ko: ['최근 연 노트', '모든 소스에서 최근에 연 노트가 모여 있어요.'] },
    { target: '.lib-reader', en: ['Read and edit', 'Edit any note — it saves back to the vault file or the Notion page. Pictures and pages can be added or deleted here too.'],
      ko: ['읽기와 편집', '노트를 바로 고치면 보관함 파일이나 Notion 페이지에 그대로 저장돼요. 그림과 페이지 추가·삭제도 여기서 해요.'] },
    { target: '.lib-reader', en: ['Memos', 'A memo on any note goes to your memo repository on GitHub. Esc closes the reader.'],
      ko: ['메모', '어떤 노트에 단 메모든 GitHub 메모 레포에 커밋돼요. Esc로 읽기 창을 닫아요.'] },
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
    const doIt = s.try ? document.createElement('p') : null;
    if (doIt && s.try) {
      doIt.className = 'tour-try';
      const tag = document.createElement('span');
      tag.textContent = ko ? '해 보기' : 'Try';
      doIt.append(tag, s.try[ko ? 1 : 0]);
    }
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
    card.append(top, h, p, ...(doIt ? [doIt] : []), nav);
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
