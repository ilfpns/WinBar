# Haru

Haru is WinBar's day planner: a web app built around a 24-hour dial, opened from the emblem next to the flame in the menu bar. Drag the ring to plan, check tasks off, and watch the dot emblem in the centre fill as the day gets done.

**Live:** https://ilfpns.github.io/WinBar/

- **Today** — drag on the ring to add a block; drag across tasks to select several and edit them together. Done tasks are filled and carry a check; a task can hold a note (a dot by its name). A new day starts at a time you set (drag the ↺ mark on the ring, or Settings → Today); the day that ended stays in the calendar.
- **School timetable** — Settings → Today: find a school, pick a class, Apply puts today's lessons on Today. 대덕소프트웨어마이스터고 comes from 컴시간알리미 (with its bell times); other schools from NEIS.
- **Calendar** — Korean holidays & observances, the school's academic calendar, day memos (with images) and statistics.
- **News** — headlines on the globe, and attendance: check in daily; the grass also fills from the Notion attendance table.
- **Chat** (one room for everyone invited), **Words**, **Journal** (pages in folders, photos inline in the text, pinning, share to **Archive**), and **Your days** — Today's history as statistics at the top of Journal.
- **Accounts** — invite-only Google sign-in; everyone's planner is their own and syncs across devices (Firestore). Today of another member can be looked at, read only.
- Progress is measured against the whole day: finishing every block of a fully planned 24h is 100%.
- Opened from WinBar (`?winbar=1`), finishing tasks updates the WinBar menu-bar emblem via `winbar://`.

## Develop

```sh
cd haru
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run calendar # refresh holidays + school calendar (public/data/calendar.json)
npm run school   # refresh the school timetable from 컴시간알리미 (public/data/school-timetable.json)
npm run deploy   # publish to https://ilfpns.github.io/WinBar/
```

`npm run deploy` builds for GitHub Pages and publishes `dist/` to the `gh-pages` branch.

### Cloud & data

- `firestore.rules` — paste into Firebase console → Firestore → Rules after it changes (owners, invites, profiles, Archive, Notion check-ins, `config`).
- GitHub Actions: `haru-news.yml` (headlines + school timetable) and `haru-attendance.yml` (Notion attendance both ways) publish into `gh-pages`. GitHub runs scheduled jobs late, sometimes by hours.
- Secrets: `NOTION_TOKEN` (Notion integration), `FIREBASE_API_KEY` (reads the open `notion-checkins` collection). An NEIS API key, if any, goes in Firestore `config/neis` (`{ key }`), never in the site.

## Changes

앱 안에서는 설정 → What's new에서 같은 패치노트를 본다 (`src/ui/changelog.ts`).

- **v1.43** (2026-10-22) — 설치한 PC 앱의 제목 표시줄에 페이지 탭과 진행도
- **v1.42** (2026-10-22) — 앱으로 설치(PWA): 홈 화면 아이콘, 앱 창, 오프라인으로 열기, 새 버전 카드
- **v1.41** (2026-10-22) — PDF에서 브라우저 날짜·제목·주소 줄 제거, 머리에는 Haru와 구분선만
- **v1.40** (2026-10-22) — 반 고르기·시간 고르기·이모지 창이 Safari·옛 브라우저에서 안 되던 문제
- **v1.39** (2026-10-22) — 다이얼 실수 Ctrl+Z(새 할 일 창 닫기·선택 풀기) / /변경사항·/요청도 변경요청으로
- **v1.38** (2026-10-22) — 학교 급식 넣기 / 시간표·급식 매일 자동 / 숨은 페이지 편집기로 입력이 가던 문제 / 뉴스 첫 넘김 끊김
- **v1.37** (2026-10-21) — Slices에서 모든 할 일 이름 표시
- **v1.36** (2026-10-21) — 편집 중인 할 일 이름이 Slices에서 빠지던 문제 / 설정의 Members와 Kick
- **v1.35** (2026-10-21) — 저널 폴더 줄의 버튼 겹침 수정
- **v1.34** (2026-10-21) — 입력할 때 완료 체크 애니메이션이 반복되던 문제 수정
- **v1.33** (2026-10-21) — /변경요청을 모든 계정에 열기
- **v1.32** (2026-10-21) — 채팅 명령어 목록과 사용 예시(/전체 /사진 /이모지 /그리기 /알림 /규칙 /변경요청)
- **v1.31** (2026-10-21) — 채팅의 /는 명령어 전용
- **v1.30** (2026-10-21) — 변경요청을 /변경요청 명령어로 / 아카이브에 Chat 사용 규칙 고정
- **v1.29** (2026-10-21) — 채팅 @변경요청 큐와 진행 상태 표시
- **v1.28** (2026-10-21) — Today에서 Ctrl+Z 되돌리기 / Ctrl+Shift+Z·Ctrl+Y 다시 하기
- **v1.27** (2026-10-20) — 첫 로딩 최적화(뉴스·지구본 데이터 나중에, 글꼴 비차단) / 시작 시 숨은 페이지 측정 제거 / 뉴스 넘김 멈춤 제거
- **v1.26** (2026-10-20) — 성능(클릭 반영 3~4배 빠르게, 쉴 때 CPU 절약, 서랍 흐림 끔) / 움직임 줄이기 설정 / 휴대폰 아래 탭 바 / 낮은 창·큰 화면 대응
- **v1.25** (2026-10-20) — 배포해도 노션 출석 기록 유지
- **v1.24** (2026-10-20) — 전체 QA: Me 버튼이 할 일 서랍 가림 / 정보 카드가 다이얼 가림 / 휴대폰 채팅 말풍선·높이 / 밝은 테마 선택 항목 / 중복 패치 노트
- **v1.23** (2026-10-20) — 채팅 그리기 Ctrl+Z·Ctrl+Shift+Z / 화면에 남던 예전 그림 정리
- **v1.22** (2026-10-20) — 채팅 하트·체크 반응 / 한 글자 입력 때 안내 문구가 남던 문제 수정
- **v1.21** (2026-10-20) — 아카이브 업데이트 공지 고정(관리자만 수정) / 안 읽은 댓글은 초록, 읽으면 회색 / 왼쪽 서랍 애니메이션 가볍게
- **v1.20** (2026-10-20) — @ALL 멘션 / 다른 사람 정보 카드(오늘·출석·최근 7일)
- **v1.19** (2026-10-20) — 채팅 그림이 메시지와 함께 스크롤 / 입력하면 안내 문구 즉시 사라짐
- **v1.18** (2026-10-20) — 채팅 알림(카드·소리·시스템 알림) / 채팅 위에 직접 그리기 / 백스페이스는 번호 먼저, 들여쓰기 나중
- **v1.17** (2026-10-20) — 채팅 디자인 되돌림 / 한글 입력 중 번호 백스페이스 수정
- **v1.16** (2026-10-20) — 채팅 서식·사진·이모지·새 디자인·공유 보드 / 인용(|)·콜아웃 / 애니메이션 끊김 수정
- **v1.15** (2026-10-20) — 탭 제목·아이콘에 안 읽은 표시 / 채팅 전부 왼쪽, 프로필·이름 표시, 말풍선 꼬리가 프로필을 가리킴
- **v1.14** (2026-10-20) — 읽는 글 선택·복사 / Ctrl+A·Delete는 Today에서만 / 글쓰기 칸 단축키 점검
- **v1.13** (2026-10-20) — 채팅방 추가 (아카이브 아래, 실시간, 안 읽음 점)
- **v1.12** (2026-10-19) — 댓글 수 버튼으로 댓글 펼치기·접기 / 새 댓글 애니메이션 / 올리기 실패 이유 표시
- **v1.11** (2026-10-19) — 편집기 버튼 밀림 / 위 경계 동작 / 경계 클릭 시 서랍 열림 수정 / 둥근 탭 아이콘 / 댓글 입력칸 정렬
- **v1.10** (2026-10-19) — 아카이브 댓글 / 패널 경계 끌어서 크기 조절 / 일기 트리로 통일 / 둥근 탭 아이콘
- **v1.9** (2026-10-19) — 일기 루트에 페이지 두기 (트리 맨 바깥, Root 탭, 끌어서·메뉴로 꺼내기)
- **v1.8** (2026-10-19) — 탭 제목 Haru 고정 / 다이얼 모양 로고(파비콘·홈 화면 아이콘)
- **v1.7** (2026-10-19) — 일기 @멘션 / 멘션된 공유 페이지 안 읽음 점(아카이브) / 나의 하루들 펼침·접힘 애니메이션
- **v1.6** (2026-10-19) — 나의 하루들 리디자인 / 일기 트리 보기 / 링크 로고 표시 / 사진 크기 조절 / 캘린더 메모 점 / 완료 버튼 제거 / 반 선택 디자인, 설정에 로그인 계정 표시
- **v1.5** (2026-10-19) — 좁은 칸 한글 이름 줄임 표시 수정 / 마우스를 올리면 전체 이름·시간 표시
- **v1.4** (2026-10-19) — 뉴스 출석 잔디가 서랍과 함께 부드럽게 크기 변경 / 왼쪽 서랍이 레일 속으로 접히며 닫힘 / 서랍 닫기 버튼 제거 / 패치노트 한국어 정리
- **v1.3** (2026-10-19) — 설정에 새 소식 추가 / 캘린더·휴대폰 레이아웃 수정 / 같은 이름 폴더 막음 / 편집기 완료 즉시 반영 / 번역 보충
- **v1.2** (2026-10-19) — 일기 사진이 글 사이에 들어감 / 완료 배지 애니메이션 / 오른쪽 창 Today 탭 고정 / 학교 시간표 반 오류 수정
- **v1.1** (2026-10-19) — 나의 하루들 통계, 페이지 고정, 일기 사진 / 학교 시간표 / 카테고리 추가 / Notion 출석 양방향 / 검색 제거
- **v1.0** (2026-10-18) — 초대 전용 계정, 공유 아카이브, 연결 화면, 출석 잔디 단순화

## Design

`design-references/` holds the research behind the look (refs.gallery picks, measured tokens, `DESIGN.md`).

## Credits

Icons: [Lucide](https://lucide.dev) (ISC).
