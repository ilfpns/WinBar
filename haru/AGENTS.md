# AGENTS.md — Haru 작업 규칙

WinBar 저장소 루트의 `AGENTS.md`는 C# 메뉴바 앱 규칙이고, 이 파일은 `haru/`(웹 플래너) 전용 규칙이다.
규칙을 추가할 때는 해당 섹션 아래에 `-`  한 줄로 적는다.

## 프로젝트 소개

- Haru: 하루 시간표(Today 다이얼) + 달력(Calendar) + 뉴스 지구본(News)을 한 화면에서 보는 개인 플래너 웹앱.
- 배포 주소: [https://ilfpns.github.io/WinBar/](https://ilfpns.github.io/WinBar/) (`#/`, `#/calendar`, `#/news`)
- WinBar 메뉴바의 Haru 버튼이 이 주소를 연다(`?winbar=1`).

## 기술과 구조

- Vite + TypeScript(strict), 아이콘은 `lucide`만 쓴다. 새 프레임워크·라이브러리는 먼저 이유를 설명하고 허락을 받는다.
- `src/timetable/`: Today 다이얼, 할 일 목록, 편집기 / `src/calendar/`: 달력, 날짜 메모 / `src/news/`: 지구본, 뉴스 서랍
- `src/ui/`: 페이지 전환(router, view-swipe), 서랍(drawers), 공통 UI / `src/storage/`: IndexedDB, 백업
- `scripts/`: 빌드 시 데이터 생성(`fetch-calendar.mjs`, `fetch-news.mjs`, `build-globe.mjs`)과 배포(`deploy.mjs`)
- `public/data/*.json`은 스크립트가 만든 결과물이다. 직접 고치지 않는다.

## 디자인 규칙

- 검정 배경, 반투명 회색 패널, 흑백 위주(지구본·메뉴바 아이콘 포함). 참고: cregg-paris, skills.sh, neoconda.
- 아이콘은 Lucide만 쓴다. 이모지·유니코드 기호 아이콘 금지. 아이콘만 있는 버튼에는 aria-label을 단다.
- 화면 글자는 영어, 설명 문구는 최소로. 단, 달력 메모 아래 `!` 문법 안내는 항상 보이게 둔다.
- 애니메이션은 85fps 이상으로 자연스럽게. transform/opacity 위주로 컴포지터에서 처리한다.
- 점(dot) 효과는 색은 부드럽게, 움직임은 분명하게. 만들다 취소한 것은 바로 사라져야 한다.

## 화면 동작 규칙

- 페이지 순서는 Today → Calendar → News(세로로 쌓임). 휠·스와이프 한 번 = 한 페이지, 짧고 딱 끊기게 넘어간다.
- 연속으로 넘길 때 입력이 막히는 구간이 없어야 한다(트랙패드 관성만 무시).
- 왼쪽 서랍(Overview)은 모든 페이지, 오른쪽 서랍은 Today(Tasks)와 News(News)에만 있다. Calendar에는 오른쪽 서랍이 없다.
- 페이지를 넘기면 그 페이지 전용 서랍과 탭은 즉시 사라진다.
- 배경 클릭: 페이지 중심(다이얼 / 달력 그리드 / 지구본) 기준 왼쪽이면 왼쪽 서랍, 오른쪽이면 오른쪽 서랍을 연다.

## 데이터 규칙

- 사용자 데이터는 어떤 상황에서도 사라지면 안 된다.
  - 시간표: localStorage + IndexedDB 미러(`haru` DB의 `kv`), 메모: IndexedDB `notes`
  - 저장 방식을 바꿀 때는 기존 데이터를 옮기는(마이그레이션) 코드를 같이 넣는다.
  - 백업(Export/Import, Auto-backup)으로 복원할 때 잘못된 항목은 걸러낸다.
- 테스트할 때 사용자가 쓰는 브라우저의 저장소를 지우지 않는다. 테스트는 별도 브라우저 컨텍스트에서 한다.
- API 키·토큰은 코드나 데이터 파일에 넣지 않는다(공개 사이트다).

## 빌드·배포

- 타입 검사: `npx tsc --noEmit -p .` / 개발 서버: `npm run dev`
- 배포: `npm run deploy` (달력·뉴스·학교 시간표 데이터를 받고, `/WinBar/` 경로로 빌드해 `gh-pages` 브랜치에 올린다)
- 배포 후 `git checkout -- public/data/calendar.json public/data/news.json public/data/school-timetable.json` (시각만 바뀐 파일 되돌리기)
- 뉴스·학교 시간표는 `.github/workflows/haru-news.yml`, Notion 출석은 `.github/workflows/haru-attendance.yml`이 `gh-pages`의 `data/`만 갱신한다 (GitHub 예약 실행은 몇 시간씩 늦을 수 있다).
- `firestore.rules`가 바뀌면 Firebase 콘솔에 다시 게시해야 한다 (사용자에게 알린다).

## 작업 규칙

- 사용자는 한국어로 소통한다. 보고와 질문은 한국어로 한다.
- 변경 후에는 테스트 빌드로 실제 동작(클릭·전환·콘솔 오류)을 확인하고 나서 완료라고 말한다.
- 커밋은 `main`에 바로 하고 푸시한다.
- 사용자 요구 사항 반영/수정이 3번 반복될 동안 한번도 배포하지 않으면 최신화를 위하여 자동으로 배포한다.
- 기능이 바뀌면 `src/ui/changelog.ts` 맨 위에 두 언어로 적는다(설정 → What's new에 보인다). README의 Changes도 같이 적는다.
- QA를 하면 `QA.md`에 날짜, 확인한 것, 찾은 문제와 처리 결과를 남긴다.

## 제약

- Github에 WinBar 레포에는 마음대로 커밋/푸시 할 수 있다. 
- WinBar 외의 레포를 마음대로 생성할 수 없다.
- Github의 WinBar외의 다른 레포나 올가에 대한 접근을 절대 허가하지 않는다.
- 다른 레포나 올가에 접근하고자 할 경우 사용자에게 묻는다.
- 커밋/푸시는 사용자가 허락 시 진행하며, 개발 후 커밋 내용애 대해 한줄의 리뷰를 진행한다.

