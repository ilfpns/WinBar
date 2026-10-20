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
    version: '1.21',
    date: '2026-10-20',
    items: [
      '아카이브 맨 위에 "업데이트 공지" 고정: 관리자 공지와 전체 패치 노트, 새 공지가 오면 아카이브에 점 (수정은 관리자 계정만)',
      '댓글 수 표시: 안 읽은 댓글이 있으면 초록, 펼쳐 읽으면 회색',
      '왼쪽 서랍 여닫기를 가볍게: 화면 다시 그리기 없이 움직이고, 닫을 때 아이콘이 겹쳐 보이지 않음',
    ],
  },
  {
    version: '1.20',
    date: '2026-10-20',
    items: [
      '멘션에 @ALL 추가: 모두를 부르면 모두의 아카이브에 점, 채팅 알림에 "나를 불렀어요"',
      'Today에서 다른 사람을 고르면 정보 카드: 오늘 완료율·계획·지금 하는 일·다음 일, 출석 연속·최고·5주 잔디, 최근 7일',
    ],
  },
  {
    version: '1.19',
    date: '2026-10-20',
    items: [
      '채팅 그림이 메시지에 붙어서 스크롤하면 함께 움직임 (그리는 중에도 휠로 스크롤)',
      '글을 한 글자만 입력해도 안내 문구가 바로 사라짐 (한글 조합 중에도)',
    ],
  },
  {
    version: '1.18',
    date: '2026-10-20',
    items: [
      '채팅 알림: 다른 페이지를 보고 있으면 오른쪽 아래 알림 카드와 알림음, 다른 창을 보고 있으면 시스템 알림 (채팅 제목 옆 🔔로 켜고 끄기)',
      '채팅 위에 직접 그리기: 붓 버튼으로 그리기 모드, 그린 그림은 모두의 채팅 화면 위에 남음',
      '목록에서 백스페이스: 번호가 먼저 지워지고, 그다음 들여쓰기가 한 단계씩 지워짐',
    ],
  },
  {
    version: '1.17',
    date: '2026-10-20',
    items: [
      '채팅 디자인을 이전 모양으로 되돌림 (사진·서식·이모지·보드 기능은 그대로)',
      '목록에서 들여쓴 번호가 백스페이스로 안 지워지던 문제 수정 (한글 입력 중에도)',
    ],
  },
  {
    version: '1.16',
    date: '2026-10-20',
    items: [
      '채팅: 일기 편집기로 쓰기 (서식·목록·링크 로고·@멘션·/ 메뉴), Enter로 보내기',
      '채팅: 사진 보내기 (📎·Ctrl+V·끌어다 놓기, 최대 4장, 누르면 크게), 이모지 고르기',
      '채팅: 새 디자인 — 민트·초록 알약 말풍선, 프로필에 겹친 말풍선 꼬리, 둥근 입력칸과 전송 버튼',
      '채팅: 보드 — 모두가 실시간으로 함께 그리는 그림판 (색·굵기, 내 획 되돌리기·지우기, 채팅으로 보내기)',
      '인용(| )과 콜아웃(/ 메뉴 → Callout) 추가, 모든 메모·일기·채팅에서 사용',
      '애니메이션 끊김 수정: 서랍 열고 닫기, 나의 하루들 펼치기, 지구본, 페이지 넘기기',
    ],
  },
  {
    version: '1.15',
    date: '2026-10-20',
    items: [
      '탭에 안 읽은 표시: 채팅·멘션이 있으면 탭 제목 "(2) Haru"와 탭 아이콘의 초록 점',
      '채팅: 모든 메시지가 왼쪽에서 올라오고, 누가 보냈는지 프로필 사진과 이름 표시 (내 메시지는 "나")',
      '채팅: 말풍선 꼬리가 왼쪽 위에서 보낸 사람 프로필을 가리킴',
    ],
  },
  {
    version: '1.14',
    date: '2026-10-20',
    items: [
      '채팅 말풍선, 아카이브 본문·댓글, 단어 카드 뜻 등 읽는 글을 선택해서 Ctrl+C로 복사 가능',
      'Ctrl+A·Delete가 다른 페이지에서 Today 할 일을 선택·삭제하던 문제 수정 (Today에서만)',
      '모든 글쓰기 칸에서 Ctrl+Z·Y·A·C·V·X 동작 확인',
    ],
  },
  {
    version: '1.13',
    date: '2026-10-20',
    items: [
      '채팅 추가: 아카이브 아래, 초대된 모두가 쓰는 대화방 하나 (실시간)',
      '채팅: 내 메시지는 오른쪽, 같은 사람의 연속 메시지는 묶어서, 날짜 구분선, 새 메시지만 들어오는 애니메이션',
      '채팅: 안 읽은 메시지가 있으면 채팅 버튼에 통통 튀는 점과 개수, 열면 사라짐',
      '채팅: 내 메시지 지우기, Enter로 보내기, 보내기 실패 시 이유 표시',
    ],
  },
  {
    version: '1.12',
    date: '2026-10-19',
    items: [
      '아카이브: 글 쓰는 칸 위에 💬 댓글 수, 누르면 댓글이 부드럽게 펼쳐지고 접힘',
      '아카이브: 새 댓글만 나타나는 애니메이션, 댓글 수가 바뀌면 숫자가 튀어 오름',
      '아카이브: 댓글이 안 올라가면 이유를 표시 (규칙 미게시 / 연결 문제), 쓴 글은 그대로 남음',
    ],
  },
  {
    version: '1.11',
    date: '2026-10-19',
    items: [
      '일기: 목록 폭을 넓혀도 편집기 위 버튼이 카드 밖으로 밀리지 않음 (줄바꿈)',
      '나의 하루들 높이 조절은 펼친 상태에서만 (접혀 있으면 경계 숨김)',
      '경계를 눌렀을 때 왼쪽 서랍이 열리던 문제 수정',
      '탭 아이콘: 검정 타일 모서리를 더 둥글게, 가장자리에 여백',
      '아카이브: 댓글 입력칸의 글자가 위로 붙어 보이던 문제 수정 (가운데 정렬)',
    ],
  },
  {
    version: '1.10',
    date: '2026-10-19',
    items: [
      '아카이브: 공유 페이지에 댓글 (Enter로 보내기, 내 댓글·내 페이지 댓글 지우기)',
      '패널 사이 경계를 끌어 크기 조절 (일기·아카이브·단어·캘린더, 일기 위 통계 카드 높이), 더블클릭하면 원래대로',
      '일기: 목록 보기를 없애고 트리로 통일, 새 폴더 버튼·폴더 우클릭 메뉴',
      '탭 아이콘 모서리를 둥글게',
    ],
  },
  {
    version: '1.9',
    date: '2026-10-19',
    items: [
      '일기: 폴더 밖 루트에도 페이지를 둘 수 있음 (트리 맨 바깥, 목록의 Root 탭)',
      '일기: 트리의 빈 곳이나 Root 탭으로 끌어 놓으면 폴더에서 꺼내기, 폴더 선택·우클릭 메뉴에 "Root로 옮기기"',
    ],
  },
  {
    version: '1.8',
    date: '2026-10-19',
    items: [
      '브라우저 탭 제목을 "Haru"로 고정',
      'Haru 로고 추가 (24시간 다이얼 모양, 탭 아이콘·홈 화면 아이콘)',
      '탭 아이콘도 홈 화면 아이콘과 같은 PNG 로고로 통일',
    ],
  },
  {
    version: '1.7',
    date: '2026-10-19',
    items: [
      '일기: @를 치면 초대된 사용자 목록에서 골라 멘션 (@이름 칩으로 표시)',
      '아카이브: 나를 멘션한 공유 페이지를 아직 안 읽었으면 아카이브 버튼에 통통 튀는 점, 목록에 "@나" 표시',
      '일기: 나의 하루들을 펼치고 접을 때 부드럽게 내려가고 올라감',
      '편집기: 다른 곳을 누르면 링크·멘션이 바로 칩으로 돌아감',
    ],
  },
  {
    version: '1.6',
    date: '2026-10-19',
    items: [
      '일기: 나의 하루들 리디자인 (숫자 애니메이션, 설명 툴팁, 최근 14일 차트, 계획 대비 완료 표시)',
      '일기: 폴더·페이지를 트리로 보기 (옥토트리처럼, 끌어서 폴더 이동)',
      '일기: 링크가 사이트 로고와 짧은 이름으로 표시 (유튜브는 영상 제목, 로고 없으면 고리)',
      '일기: 글 속 사진 모서리를 끌어 크기 조절 (더블클릭하면 원래 크기)',
      '일기: 사진이 많을 때 글 영역이 아래 사진 칸을 덮던 문제 수정',
      '캘린더: 메모 표시를 점으로 변경',
      'Today: 편집기의 완료 버튼 제거 (목록 체크로 완료)',
      '설정: 반 선택을 학년별 칩 선택으로 디자인, 로그인한 계정 정보 표시',
    ],
  },
  {
    version: '1.5',
    date: '2026-10-19',
    items: [
      'Today: 좁은 칸의 한글 이름이 사라지지 않고 "농구…"처럼 줄여서 표시',
      'Today: 할 일에 마우스를 올리면 이름 위에 전체 이름과 시간 표시',
    ],
  },
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
