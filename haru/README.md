# Haru

Haru is WinBar's day planner: a web app built around a 24-hour dial, opened from the emblem next to the flame in the menu bar. Drag the ring to plan, check tasks off, and watch the dot emblem in the centre fill as the day gets done.

**Live:** https://ilfpns.github.io/WinBar/

- **Today** — drag on the ring to add a block; drag across tasks to select several and edit them together. Done tasks are filled and carry a check; a task can hold a note (a dot by its name). A new day starts at a time you set (drag the ↺ mark on the ring, or Settings → Today); the day that ended stays in the calendar.
- **School timetable** — Settings → Today: find a school, pick a class, Apply puts today's lessons on Today. 대덕소프트웨어마이스터고 comes from 컴시간알리미 (with its bell times); other schools from NEIS.
- **Calendar** — Korean holidays & observances, the school's academic calendar, day memos (with images) and statistics.
- **News** — headlines on the globe, and attendance: check in daily; the grass also fills from the Notion attendance table.
- **Words**, **Journal** (pages in folders, photos inline in the text, pinning, share to **Archive**), and **Your days** — Today's history as statistics at the top of Journal.
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
