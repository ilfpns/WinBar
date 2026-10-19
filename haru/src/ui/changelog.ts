import { lang } from './i18n';
import { icon } from './icons';

/**
 * What's new: the record of how Haru has changed, read inside the app (Settings → What's new), newest first.
 * Every entry is written in both languages here (the i18n pass leaves this list alone). An entry newer than
 * the last visit to the page is marked New, and the page's button in Settings carries a dot until it is seen.
 *
 * Add to the top when something ships; README.md's "Changes" keeps the same record for the repository.
 */
interface Release {
  /** YYYY-MM-DD the batch went live. */
  date: string;
  /** A short name for the batch. */
  title: { en: string; ko: string };
  items: { en: string; ko: string }[];
}

const SEEN_KEY = 'haru:changelog-seen';

export const CHANGELOG: Release[] = [
  {
    date: '2026-10-19',
    title: { en: 'A calmer left drawer', ko: '더 차분한 왼쪽 서랍' },
    items: [
      { en: 'The left drawer folds back into the rail when it closes, so only the rail stays; no half panel passes by.', ko: '왼쪽 서랍이 닫힐 때 레일 속으로 접혀 들어가서 레일만 남아요. 반쯤 걸친 판이 지나가지 않아요.' },
      { en: 'The close button at the top of the drawer is gone; close it with [ or a click beside it.', ko: '서랍 위쪽의 닫기 버튼을 없앴어요. [ 키나 바깥을 눌러 닫으면 돼요.' },
    ],
  },
  {
    date: '2026-10-19',
    title: { en: 'QA pass and What’s new', ko: 'QA 점검과 새 소식 화면' },
    items: [
      { en: 'This page: what changed in Haru, inside Haru (Settings → What’s new). New entries carry a mark until read.', ko: '이 화면: Haru가 어떻게 바뀌었는지 Haru 안에서 봅니다 (설정 → 새 소식). 아직 안 읽은 항목에는 표시가 붙어요.' },
      { en: 'Calendar: a six-week month on a short screen scrolls inside its card instead of being cut off at the bottom.', ko: '캘린더: 화면이 낮을 때 6주짜리 달이 아래가 잘리지 않고 카드 안에서 스크롤돼요.' },
      { en: 'Phones: the calendar’s month buttons no longer sit on top of the title; Journal and Words pages scroll down to the editor and the add-word card.', ko: '휴대폰: 캘린더의 달 이동 버튼이 제목 위에 겹치지 않고, 일기와 단어 페이지가 편집기와 단어 추가 카드까지 스크롤돼요.' },
      { en: 'Journal: two folders can’t share a name.', ko: '일기: 같은 이름의 폴더를 두 개 만들 수 없어요.' },
      { en: 'Today: marking a task done in the editor applies at once, so the list and the dial agree while you keep editing.', ko: 'Today: 편집기에서 완료를 누르면 바로 반영돼서, 계속 편집하는 동안에도 목록과 다이얼이 같게 보여요.' },
      { en: 'Korean: the photo buttons in a page, the folder menu tip and a few more labels are translated.', ko: '한국어: 페이지 속 사진 버튼, 폴더 메뉴 도움말 등 빠져 있던 문구를 번역했어요.' },
      { en: 'Touch: the small delete buttons on templates and word cards are easier to hit.', ko: '터치: 템플릿과 단어 카드의 작은 삭제 버튼을 누르기 쉽게 키웠어요.' },
    ],
  },
  {
    date: '2026-10-19',
    title: { en: 'Photos in the text, badges that pop', ko: '글 속 사진, 튀어나오는 완료 배지' },
    items: [
      { en: 'Journal: a photo you add, paste or drop goes into the text where the caret is, as in Notion or Obsidian. Click it to see it large; copy or remove it from the photo itself.', ko: '일기: 추가·붙여넣기·끌어다 놓은 사진이 노션이나 옵시디언처럼 커서 위치의 글 사이에 들어가요. 클릭하면 크게 보이고, 사진에서 바로 복사하거나 지울 수 있어요.' },
      { en: 'Today: the check badge springs in when a task is done; the right drawer always opens on the Today tab.', ko: 'Today: 할 일을 완료하면 체크 배지가 튀어나오듯 나타나고, 오른쪽 창은 항상 Today 탭으로 열려요.' },
      { en: 'School timetable: subjects were read from the wrong digits, so a class showed another class’s lessons. Fixed.', ko: '학교 시간표: 과목 번호를 잘못 읽어 다른 반 수업이 보이던 문제를 고쳤어요.' },
    ],
  },
  {
    date: '2026-10-19',
    title: { en: 'Your days, pinning, school timetables', ko: '나의 하루들, 페이지 고정, 학교 시간표' },
    items: [
      { en: 'Journal: Your days — Today’s history as statistics at the top; pin a page to keep it on top of its folder; photos (add, Ctrl+V, drop, copy).', ko: '일기: 나의 하루들 — Today 기록을 통계로 맨 위에; 페이지를 폴더 맨 위에 고정; 사진 (추가, Ctrl+V, 끌어다 놓기, 복사).' },
      { en: 'School timetable from any school: 대덕소프트웨어마이스터고 from 컴시간알리미 with its bell times, other schools from NEIS. Settings → Today → Apply.', ko: '어느 학교든 시간표를: 대덕소프트웨어마이스터고는 컴시간알리미(교시 시간 포함), 다른 학교는 NEIS에서. 설정 → Today → 적용.' },
      { en: 'Categories School, Meeting and Meal, with darker, more distinct colours.', ko: '카테고리 학교·회의·식사 추가, 색은 더 어둡고 서로 뚜렷하게.' },
      { en: 'Today: done tasks carry a check; a task can hold a note (a dot by its name); the new-day mark on the ring can be dragged.', ko: 'Today: 완료한 일에 체크 표시, 할 일에 메모(이름 옆 점), 원 위의 하루 시작 표시를 끌어 옮길 수 있어요.' },
      { en: 'Notion attendance syncs both ways, undo included, every few minutes. Only Today of another member can be looked at. Search removed.', ko: 'Notion 출석이 몇 분마다 양방향으로 맞춰지고 취소도 돼요. 다른 사람은 Today만 볼 수 있어요. 검색은 뺐어요.' },
    ],
  },
  {
    date: '2026-10-18',
    title: { en: 'Accounts and the shared Archive', ko: '계정과 공유 아카이브' },
    items: [
      { en: 'Invite-only Google sign-in; everyone’s planner is their own and syncs across devices.', ko: '초대받은 Google 계정으로 로그인; 각자의 플래너는 각자의 것이고 기기 간에 동기화돼요.' },
      { en: 'Archive: share a Journal page for everyone invited; only its author can take it down.', ko: '아카이브: 일기 페이지를 초대된 모두에게 공유; 내린 건 작성자만 할 수 있어요.' },
      { en: 'A reconnect screen on reload; a simpler attendance grass with a best streak.', ko: '새로고침 때 다시 연결 화면; 더 단순한 출석 잔디와 최고 연속 기록.' },
    ],
  },
];

const seen = (): string => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
};
const markSeen = (): void => {
  try {
    localStorage.setItem(SEEN_KEY, CHANGELOG[0]?.date ?? '');
  } catch { /* storage may be off */ }
};

/** Dates as the page shows them, in the picked language. */
function fmtDate(d: string): string {
  const dt = new Date(`${d}T00:00`);
  return lang() === 'ko'
    ? `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일`
    : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Fills Settings → What's new and marks the unread entries; the page's button carries a dot until they're read. */
export function mountChangelog(): void {
  const page = document.querySelector<HTMLElement>('.set-page[data-page="changelog"]');
  const list = document.getElementById('changelog-list');
  const nav = document.querySelector<HTMLElement>('.set-nav [data-set-page="changelog"]');
  if (!page || !list || !nav) return;
  const l = lang();
  const last = seen();
  const unread = CHANGELOG.filter((r) => r.date > last).length;
  // this list is written in both languages already: the i18n pass must leave it alone
  list.dataset.noI18n = '';
  list.replaceChildren(...CHANGELOG.map((r) => {
    const art = document.createElement('article');
    art.className = 'cl-release';
    const head = document.createElement('div');
    head.className = 'cl-head';
    const title = document.createElement('h3');
    title.className = 'cl-title';
    title.textContent = r.title[l];
    const date = document.createElement('span');
    date.className = 'meta cl-date';
    date.textContent = fmtDate(r.date);
    head.append(title, date);
    if (r.date > last) {
      const n = document.createElement('span');
      n.className = 'cl-new';
      n.append(icon('sparkles'), l === 'ko' ? '새 소식' : 'New');
      head.append(n);
    }
    const ul = document.createElement('ul');
    ul.className = 'cl-items';
    for (const it of r.items) {
      const li = document.createElement('li');
      li.textContent = it[l];
      ul.append(li);
    }
    art.append(head, ul);
    return art;
  }));
  nav.classList.toggle('has-new', unread > 0);
  nav.setAttribute('aria-label', unread ? (l === 'ko' ? `새 소식 · 안 읽은 항목 ${unread}개` : `What’s new · ${unread} unread`) : (l === 'ko' ? '새 소식' : 'What’s new'));
  // once the page is opened, everything on it counts as read (the marks stay until next time)
  new MutationObserver(() => {
    if (page.hidden) return;
    markSeen();
    nav.classList.remove('has-new');
  }).observe(page, { attributes: true, attributeFilter: ['hidden'] });
}
