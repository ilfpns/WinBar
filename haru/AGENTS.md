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
- `public/data/*.json`은 스크립트가 만든 결과물이다. 직접 고치지 않는다(`change-requests.json`도 `scripts/change-requests.mjs`로만 바꾼다).

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

## Claude 연동(MCP)

- 구성: `mcp/haru-mcp.mjs` 한 파일짜리 stdio MCP 서버(Node 18+, 의존성 없음). Claude Code(CLI)에서만 쓴다. 원격 서버(claude.ai 채팅 커넥터)는 만들지 않는다.
- 등록: `node mcp/haru-mcp.mjs login`으로 한 번 로그인 → `claude mcp add haru -s user -- node <haru 절대경로>/mcp/haru-mcp.mjs`. 확인은 `claude mcp get haru`, 계정은 `whoami`, 끊기는 `logout`.
- 인증: 사용자 본인의 초대된 Google 계정으로만 접근해 `firestore.rules`가 앱과 똑같이 적용되게 한다. 서비스 계정·Admin SDK로 규칙을 우회하지 않는다.
- 비밀값: refresh token은 `~/.config/haru-mcp/credentials.json`(권한 600)에만 둔다. 저장소·로그·출력·커밋에 남기지 않는다. Firebase 웹 설정은 `haru/.env.local`(git 제외)에서 읽고 코드에 넣지 않는다.
- 데이터 구조: 앱의 Firestore 구조(`src/cloud/sync.ts` 맨 위 표, `model.ts`, `plans.ts`, `journal-store.ts`)를 그대로 따른다. 앱 쪽 구조를 바꾸면 `haru-mcp.mjs`도 같은 커밋에서 같이 고친다.
- 쓰기: 문서를 읽고 → 고치고 → `updateTime` 조건을 걸어 통째로 쓴다. 다른 기기가 먼저 바꿨으면 다시 읽어서 적용하고 덮어쓰지 않는다.
- 쓰기: 시각 필드(`updated`, 계획은 `saved`)를 지금 시각으로 찍어 열린 앱이 새 값으로 받게 한다. `undefined` 필드는 넣지 않고, `doing`·`note`는 값이 있을 때만 넣는다.
- 할 일 규칙은 앱과 같다: 같은 날 할 일은 겹치지 않고, 시간은 `HH:MM`(현지 시각), 기본 15분 단위. 오늘 날짜는 계정의 새 하루 시작 시각(`meta/settings.dayReset`, v1.70부터 동기화)으로 센다 — `haru_today`의 `today`·`newDayAt`.
- 저널 폴더에 `private: true`(앱의 Hide from Claude)가 있으면 그 폴더 페이지는 MCP 목록·읽기·쓰기·`haru_log` 어디에도 내보내지 않는다.
- 다른 멤버의 데이터(Today·지난 날)는 읽기만 한다. 바꾸는 도구는 내 계정 데이터만 다룬다.
- 사용: 바꾸기 전에 먼저 읽고(`haru_today`, `haru_plans`, `haru_calendar`), 바꾼 뒤에는 무엇을 바꿨는지 짧게 보고한다.
- 사용: 할 일 삭제, 여러 개 한꺼번에 바꾸기, 이미 있는 계획·메모를 덮어쓰거나 지우기, 저널 고치기는 먼저 사용자에게 확인받는다.
- 사용: 저널은 사용자가 요청할 때만 읽는다. 안의 내용(비밀번호·개인 정보)을 다른 곳에 옮기거나 그대로 출력하지 않는다.
- 테스트: 실제 데이터에 쓰는 테스트는 사용자 허락을 받고 하고, 테스트로 넣은 것은 바로 지운다. 읽기 테스트와 stdio 프로토콜 테스트(initialize, tools/list)는 자유롭게 한다.
- 기록: 도구를 추가하거나 바꾸면 README의 `Claude (MCP)`와 `QA.md`에 남긴다. MCP만 바뀐 경우 배포는 필요 없고, 배포할 때 패치노트에 같이 적는다.

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
- 커밋 작성자는 `ilfpns <yeomsh09@gmail.com>`(GitHub 잔디에 잡히는 이메일). 새로 클론하면 `git config user.name ilfpns && git config user.email yeomsh09@gmail.com`부터 한다.
- 사용자 요구 사항 반영/수정이 3번 반복될 동안 한번도 배포하지 않으면 최신화를 위하여 자동으로 배포한다.
- 배포할 때마다 `src/ui/changelog.ts` 맨 위에 새 버전(v1.x)을 추가하고, 바뀐 점을 한국어로 패치노트처럼 한 줄씩 짧게 적는다(설정 → What's new에 보인다). README의 Changes도 같은 형식으로 적는다.
- QA를 하면 `QA.md`에 날짜, 확인한 것, 찾은 문제와 처리 결과를 남긴다.
- 매 업데이트 이후 What's new에 기록을 남긴다.
- 변경요청 작업공간(큐): 누구든 채팅에 "/변경요청 …"을 쓰면(호출은 @, 명령어는 /) Firestore `change-requests`에 쌓인다. 작업을 마칠 때마다 `node scripts/change-requests.mjs list`로 확인하고, 대기 중인 요청이 있으면 몇 건인지와 내용을 사용자에게 알린다(처리할지 묻는다).
- 변경요청은 사용자가 처리하라고 할 때 하나씩 반영한다(구현 → QA → 패치노트 → 커밋·배포). 반영하면 `node scripts/change-requests.mjs done <id> "<한 줄 요약>" v1.x`, 하지 않기로 하면 `declined <id> "<이유>"`로 `public/data/change-requests.json`에 남긴다. 이 명령이 그 파일을 바로 사이트(gh-pages)에도 올려서 1~2분 안에 채팅의 "대기 중"이 "반영됨/보류"로 바뀐다. 파일은 main에도 커밋한다.
- 변경요청을 자동으로 처리(사람 확인 없이 수정·배포)하는 장치는 만들지 않는다.

## 제약

- Github에 WinBar 레포에는 마음대로 커밋/푸시 할 수 있다. 
- WinBar 외의 레포를 마음대로 생성할 수 없다.
- Github의 WinBar외의 다른 레포나 올가에 대한 접근을 절대 허가하지 않는다.
- 다른 레포나 올가에 접근하고자 할 경우 사용자에게 묻는다.
- 커밋/푸시는 사용자가 허락 시 진행하며, 개발 후 커밋 내용애 대해 한줄의 리뷰를 진행한다.

