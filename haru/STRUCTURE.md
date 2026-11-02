# STRUCTURE.md — Haru 코드 지도

고칠 곳을 빨리 찾기 위한 지도다. 규칙은 `AGENTS.md`, 바뀐 기록은 `README.md`의 Changes와 `QA.md`에 있다.
파일을 옮기거나 새로 만들면 이 문서도 같은 커밋에서 고친다.

## 시작점

- `index.html`: 페이지마다 `<main class="… page" id="…">` 하나, 페이지 목록 세 곳(타이틀바 `.tb-tabs`, 레일 `#rail`, 오버뷰 `.panel-left .nav`), 설정 대화상자.
- `src/main.ts`: 모든 모듈을 붙이는 곳(`mount…` 호출 순서). 새 기능은 여기서 마운트한다.
- `src/styles/tokens.css`: 색·크기 변수(다크 / `:root[data-theme="light"]`).
- `src/styles/app.css`: `@import` 목록뿐이다. 실제 스타일은 `src/styles/app/NN-이름.css`에 있다(아래 CSS 지도).

## 폴더별

| 폴더 | 무엇 | 주요 파일 |
|---|---|---|
| `src/timetable/` | Today의 데이터와 다이얼 | `state.ts`(앱 상태·할 일 추가/수정/상태 변경, `openDraft`·`addBlock`·`cycleStatus`), `model.ts`(Block·카테고리·`passedOf`), `time.ts`, `dial.ts`(다이얼 SVG), `orb.ts`(가운데 점), `editor.ts`(오른쪽 서랍 편집기), `schedule.ts`(할 일 목록), `history.ts`(지난 날 스냅숏·`dayOf`), `day-reset.ts`(새 날 시각), `plans.ts`·`plan-form.ts`(미리 계획), `templates*.ts`, `streaks.ts`, `review.ts`, `school*.ts`, `reminders.ts` |
| `src/timetable/views/` | Today의 다른 보기와 겹쳐 보는 화면 | `today-views.ts`(아래쪽 보기 전환 바, 보기 추가는 여기), `today-modes.ts`(Next 3 hours·This week·dots), `flow.ts`(Flow 다이어그램), `plan-ahead.ts`(Tomorrow 칩), `peek.ts`·`profile-card.ts`(다른 멤버 Today) |
| `src/calendar/` | Calendar 페이지 | `calendar.ts`(월 그리드·날짜 패널), `week.ts`, `stats.ts`, `notes.ts`·`images.ts`(메모), `quick-add.ts`(`!` 문법), `attendance.ts`(News 페이지의 출석), `day-charts.ts` |
| `src/news/` | News 지구본 | `globe*.ts`, `news.ts` |
| `src/words/` | Words | `words.ts` |
| `src/journal/` | Journal | `journal.ts`(화면), `journal-store.ts`(데이터), `journal-tree.ts`, `journal-photos.ts`, `insights.ts`(Your days 카드) |
| `src/archive/` | Archive(공유 페이지)·고정 항목 | `archive.ts`, `updates.ts`(업데이트 공지), `guide.ts`(사용 안내: 투어 다시 보기) |
| `src/board/` | Dot board | `board.ts` |
| `src/library/` | Library(Obsidian·GitHub·Notion) | `library.ts`(화면: 카드 부채·경로·Recent·읽기/편집), `sources.ts`(소스 목록·토큰 저장, Driver 인터페이스), `obsidian.ts`·`github.ts`·`notion.ts`(소스별 읽기/쓰기), `note-text.ts`(앞머리·`[[링크]]`), `opened.ts`(최근 연 노트), `memo.ts`(노트 메모를 GitHub 메모 레포에 커밋) |
| `src/cloud/` | 로그인·동기화·멤버 | `sync.ts`(Firestore 구조 표가 맨 위에 있다), `merge.ts`(목록 합치기), `account.ts`, `session.ts`, `viewing.ts`(다른 멤버 보기, `watchTheirToday`), `log.ts`, `activity.ts`, `firebase.ts` |
| `src/storage/` | 이 기기 저장 | `db.ts`(IndexedDB: `notes`·`images`·`kv`), `list-store.ts`, `gone.ts`(삭제 기록), `backup.ts` |
| `src/ui/` | 공통 화면 | `router.ts`(페이지 목록 `VIEW_ORDER`·`TEXT_PAGES`), `features.ts`(켜고 끄기), `page-order.ts`·`page-drag.ts`, `view-swipe.ts`, `drawers.ts`, `settings.ts`(설정 대화상자), `modal.ts`(`askText`·`askConfirm`·`askForm`·`showMenu`), `icons.ts`(Lucide 등록), `markdown.ts`(읽기용 렌더러), `md-editor.ts`·`md-pad.ts`(쓰기), `i18n.ts`(한국어), `changelog.ts`(What's new), `tour.ts`(페이지별 첫 안내: 단계 내용 `TOURS`, 본 기록은 `users/{uid}/meta/tour`), `greeting.ts`, `titlebar.ts`, `winbar.ts` |
| `mcp/` | Claude용 MCP 서버 | `haru-mcp.mjs`(앱의 Firestore 구조를 그대로 따른다) |
| `scripts/` | 빌드·배포 | `deploy.mjs`, `fetch-*.mjs`, `change-requests.mjs` |

## 데이터가 흐르는 길

- Today: `state.ts`의 `setState` → localStorage + IndexedDB 미러 → `cloud/sync.ts`가 `users/{uid}/state/timetable`로 보냄(할 일마다 `u`, 삭제는 `gone`).
- 지난 날: `history.ts`가 `day:YYYY-MM-DD`로 저장 → `sync.ts`가 `days/{date}`로 올림. 시작할 때는 최근 바뀐 날만 읽는다(`haru:days-cloud:{uid}`, 일주일마다 전체).
- 다른 멤버: `viewing.ts`의 `watchTheirs`/`watchTheirToday`로 읽기만 한다(쓰기 금지).
- Library: 클라우드에 아무것도 올리지 않는다. 소스 설정 `haru:library`, 토큰 `haru:library-keys`, 보관함 폴더 핸들은 IndexedDB `kv`의 `library:vault:{id}`.

## 자주 하는 일

- **새 페이지**: `router.ts`의 `View`·`VIEW_ORDER`(본문형이면 `TEXT_PAGES`) → `features.ts`의 `Feature`·`FEATURES` → `index.html`의 `<main>`과 페이지 목록 세 곳 → `main.ts`의 `mountViewSwipe` 맵과 `mount…` → `styles/app/21-features.css`의 `body.off-<id>` → 새 CSS 파일.
- **Today 보기 추가**: `views/today-views.ts`의 `TodayView`·`VIEWS`, `render()`에 분기. 다이얼을 가리면 `wrap.classList.toggle('alt', …)`.
- **아이콘**: `ui/icons.ts`에 import와 `ICONS` 이름을 같이 넣는다(브랜드 아이콘 없음).
- **대화상자**: `ui/modal.ts`의 `askText`/`askConfirm`/`askForm`/`showMenu`를 쓴다. 브라우저 `prompt`·`confirm`은 쓰지 않는다.
- **설정 항목**: `index.html`의 설정 섹션에 `.set-row`를 넣고 `ui/settings.ts`에서 연결한다(예: Glass `data-glass-pick`).
- **페이지 안내 바꾸기**: `ui/tour.ts`의 `TOURS`(단계마다 가리킬 선택자, 영어·한국어 문구). 새 페이지는 여기에도 넣는다.
- **배포**: `AGENTS.md`의 빌드·배포 절차. 버전마다 `ui/changelog.ts` 맨 위, README Changes, `QA.md`.

## CSS 지도 (`src/styles/app/`)

번호가 곧 적용 순서다. 같은 우선순위면 뒤 파일이 이긴다. 원래 한 파일(`app.css`)을 순서 그대로 나눈 것이라, 반응형·모션처럼 여러 부분에 걸친 덮어쓰기 파일은 그 자리에 남아 있다.

| 파일 | 내용 |
|---|---|
| `01-base` `02-buttons` | 전역 기본값, 버튼 |
| `03-today` `05-greeting` | Today 다이얼·보기 바·모드, 인사말 |
| `04-calendar` `06-calendar-week` | Calendar 월·주 |
| `07-news` | 지구본·뉴스 서랍 |
| `08-drawers` `09-rail` `10-page-order` `11-panel-left` `12-panel-right` | 서랍, 레일, 페이지 순서, 왼쪽 패널(오버뷰·템플릿·계정·로그인), 오른쪽 패널(편집기·할 일 목록·상태) |
| `13-responsive` `14-rail-hints` | 화면 폭별 조정, 레일 힌트 |
| `15-settings` | 설정 대화상자 |
| `16-text-pages` `17-your-days` | 본문형 페이지(Words·Journal 공통), Journal의 Your days |
| `18-markdown` `19-print` `25-md-editor` | 마크다운 보기, PDF 인쇄, 쓰기 편집기 |
| `20-logo-menu` `21-features` | 로고 메뉴, 꺼진 기능 숨기기 |
| `22-archive` `23-viewing` `24-dialogs` `26-chat` | Archive, 다른 멤버 보기, 대화상자·메뉴, Chat |
| `27-phones` `28-big-screens` `29-motion` `30-titlebar` | 폰 하단 탭바, 큰 화면, 모션 줄이기, 설치형 타이틀바 |
| `31-board` | Dot board(Tomorrow 칩·리뷰 카드도 여기) |
| `32-library` `33-flow` `34-glass` `35-tour` | Library, Today Flow, Glass 투명도, 안내 투어·사용 안내 |

새 부분은 맨 뒤에 새 번호로 추가하고 `app.css`의 `@import` 목록에도 넣는다.

## QA

- 테스트는 별도 헤드리스 컨텍스트(playwright-core)로 한다. 사용자 브라우저 저장소는 건드리지 않는다.
- 캡처·임시 파일은 작업 폴더 밖(스크래치패드)에 절대경로로 저장한다. 상대경로를 쓰면 프로젝트 폴더에 떨어진다.
- 외부 API(GitHub·Notion)는 `page.route`로 가짜 응답을 주고 확인한다. 실제 레포·워크스페이스에 쓰는 테스트는 사용자 허락을 받는다.
