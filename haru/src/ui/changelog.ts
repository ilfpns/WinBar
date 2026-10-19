import { icon } from './icons';

/**
 * 새 소식(설정 → What's new): Haru 패치노트. 최신이 위. 한국어로 짧게, 버전마다 바뀐 점을 한 줄씩.
 * 마지막으로 본 버전보다 새 버전에는 표시가 붙고, 설정의 버튼에는 다 볼 때까지 점이 붙는다.
 *
 * 배포할 때마다 맨 위에 새 버전을 추가한다 (README의 Changes도 같이).
 */
interface Release {
  version: string;
  /** YYYY-MM-DD 배포한 날. */
  date: string;
  items: string[];
}

const SEEN_KEY = 'haru:changelog-version';

export const CHANGELOG: Release[] = [
  {
    version: '1.4',
    date: '2026-10-19',
    items: [
      '뉴스: 서랍이 열리고 닫힐 때 출석 잔디가 함께 부드럽게 줄고 늘어남',
      '왼쪽 서랍이 닫힐 때 레일 속으로 접혀 들어감 (레일만 남음)',
      '왼쪽 서랍 위쪽 닫기 버튼 제거 ([ 키나 바깥 클릭으로 닫기)',
      '패치노트를 한국어로 정리, 버전 표시',
    ],
  },
  {
    version: '1.3',
    date: '2026-10-19',
    items: [
      '설정에 새 소식(패치노트) 추가',
      '캘린더: 화면이 낮을 때 마지막 주가 잘리던 문제 수정',
      '휴대폰: 캘린더 버튼이 제목과 겹치던 문제, 일기·단어 페이지 스크롤 문제 수정',
      '일기: 같은 이름의 폴더 생성 막음',
      'Today: 편집기에서 완료를 누르면 목록·다이얼에 바로 반영',
      '빠진 한국어 번역 보충, 터치 기기 삭제 버튼 크기 키움',
    ],
  },
  {
    version: '1.2',
    date: '2026-10-19',
    items: [
      '일기: 사진이 커서 위치의 글 사이에 들어감 (노션·옵시디언처럼)',
      'Today: 완료하면 체크 배지가 튀어나오는 애니메이션',
      'Today: 오른쪽 창은 항상 Today 탭으로 열림',
      '학교 시간표: 다른 반 수업이 보이던 문제 수정',
    ],
  },
  {
    version: '1.1',
    date: '2026-10-19',
    items: [
      '일기: 나의 하루들 통계, 페이지 고정, 사진 추가·붙여넣기·복사',
      '학교 시간표 적용 (컴시간알리미·NEIS, 학교·반 선택)',
      '카테고리 추가: 학교·회의·식사, 색 정리',
      'Today: 완료 체크 표시, 할 일 메모, 하루 시작 시각 드래그',
      'Notion 출석 양방향 연동 (취소 포함)',
      '다른 사람은 Today만 보기, 검색 기능 제거',
    ],
  },
  {
    version: '1.0',
    date: '2026-10-18',
    items: [
      '초대 전용 Google 로그인, 계정별 데이터·기기 간 동기화',
      '공유 아카이브 (작성자만 내리기 가능)',
      '새로고침 시 연결 화면, 출석 잔디 단순화',
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
    localStorage.setItem(SEEN_KEY, CHANGELOG[0]?.version ?? '');
  } catch { /* storage may be off */ }
};

const fmtDate = (d: string) => {
  const dt = new Date(`${d}T00:00`);
  return `${dt.getFullYear()}.${dt.getMonth() + 1}.${dt.getDate()}`;
};

/** Fills Settings → What's new and marks the unread entries; the page's button carries a dot until they're read. */
export function mountChangelog(): void {
  const page = document.querySelector<HTMLElement>('.set-page[data-page="changelog"]');
  const list = document.getElementById('changelog-list');
  const nav = document.querySelector<HTMLElement>('.set-nav [data-set-page="changelog"]');
  if (!page || !list || !nav) return;
  // the versions newer than the last one seen (all of them, the first time)
  const at = CHANGELOG.findIndex((r) => r.version === seen());
  const unread = at < 0 ? CHANGELOG.length : at;
  // written in Korean already: the i18n pass leaves it alone
  list.dataset.noI18n = '';
  list.replaceChildren(...CHANGELOG.map((r, k) => {
    const art = document.createElement('article');
    art.className = 'cl-release';
    const head = document.createElement('div');
    head.className = 'cl-head';
    const title = document.createElement('h3');
    title.className = 'cl-title';
    title.textContent = `v${r.version}`;
    const date = document.createElement('span');
    date.className = 'meta cl-date';
    date.textContent = fmtDate(r.date);
    head.append(title, date);
    if (k < unread) {
      const n = document.createElement('span');
      n.className = 'cl-new';
      n.append(icon('sparkles'), 'NEW');
      head.append(n);
    }
    const ul = document.createElement('ul');
    ul.className = 'cl-items';
    for (const it of r.items) {
      const li = document.createElement('li');
      li.textContent = it;
      ul.append(li);
    }
    art.append(head, ul);
    return art;
  }));
  nav.classList.toggle('has-new', unread > 0);
  if (unread) nav.setAttribute('aria-label', `What’s new · ${unread} unread`);
  // once the page is opened, everything on it counts as read (the marks stay until next time)
  new MutationObserver(() => {
    if (page.hidden) return;
    markSeen();
    nav.classList.remove('has-new');
  }).observe(page, { attributes: true, attributeFilter: ['hidden'] });
}
