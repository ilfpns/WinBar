# Design References — 일정 관리 + 뉴스 크롤링 웹

수집일: 2026-10-14 · 출처: [refs.gallery](https://refs.gallery) (2,284개 사이트 큐레이션) · 기준 레퍼런스: [CREGG Paris](https://www.cregg-paris.com)

> **참고:** refs.gallery에는 "디자인 시스템"이나 "design.md" 같은 별도 섹션이 없습니다(sitemap 2,382개 URL 전수 확인).
> 대신 **카테고리 / 컬렉션 / Margins(에디토리얼 글)** 구조라서, 관련 카테고리의 프로젝트를 수집하고
> 실제 사이트에 접속해 computed style로 **디자인 토큰을 직접 추출**했습니다.
> 최종 디자인 시스템은 → [`DESIGN.md`](./DESIGN.md), CSS 토큰은 → [`tokens.css`](./tokens.css)

## 파일 구성

| 파일 | 내용 |
|---|---|
| `DESIGN.md` | 이 프로젝트용 디자인 시스템 (색·타입·간격·컴포넌트·화면 구성) |
| `tokens.css` | DESIGN.md를 CSS 변수로 옮긴 것 — `src/styles/tokens.css`와 동일 |
| `refs-gallery-categories.json` | refs.gallery 12개 카테고리 프로젝트 목록 원본 (이름 / URL / 태그) |
| `screenshots/*.jpg` | 1440×900 첫 화면 캡처 20장 |

---

## 1. 기준 레퍼런스 — CREGG Paris (토큰 전량 추출)

Next.js + Tailwind v4. 다크 모노톤, 단일 폰트, 거대한 타입 + 작은 UI 텍스트의 극단적 대비.

| 항목 | 값 |
|---|---|
| 배경 / 텍스트 | `#0a0a0a` / `#d9d9d9` (순백 대신 밝은 회색) · 강조 `#ffffff` |
| 회색 단계 | `#232323`(grey-dark) · `#5e5e5e`(grey) · `#686868`(grey-alt) · `#a9a9a9`(grey-light) · `#1e1e1e99`(transparent) |
| 포인트 컬러 | `#00ff85`(green) · `#00a8ff`(blue) · `red` — 거의 안 씀 |
| 폰트 | **KHTeka** 단일 (weight 400/500, 이탤릭), `ss08` 등 OpenType feature 사용 |
| 타입 스케일 (root 10px) | 2xs 13/16 · xs 14/16 · s 15/1.2 · m 22/25 · l 27/32 · xl 34/1 · 2xl 42/45 · 3xl 58/54 · 4xl 62/58 · 6xl **96/86** |
| 자간 | 대제목 `-0.035em`, 중제목 `-0.03em`, 본문 `-0.01em`, 작은 UI `+0.005em` |
| 간격 | 1rem=10px 단위: 10·20·30·40·50·70·80·90·100·110·120·200·270·300 |
| 헤더 | `fixed`, 높이 58px, padding `12px 20px` |
| 내비 버튼 | 사각형(radius 0), padding `8px 15px`, bg `rgba(169,169,169,.19)` + `backdrop-filter: blur(24px)` |
| 링크 | "Learn More →" 22px 회색 `#5e5e5e` → hover시 밝아짐, `color .2s cubic-bezier(0,0,.2,1)` |
| 모션 | 색 전환 0.2–0.3s, accordion 0.4s, marquee 10s linear, 히어로는 canvas 도트 애니메이션 |
| 레이아웃 | 좌측 정렬 대형 H1 (폭 ~74%), 섹션 사이 여백 매우 큼, 푸터에 3단 가치 문구 + 주소 |

**가져올 것:** 회색 텍스트(#d9d9d9) 위 흰색 강조, 반투명 blur 사각 버튼, 거대한 헤드라인/작은 메타 텍스트 대비, 0.2s ease-out 색 전환만으로 된 절제된 인터랙션.

### 1-b. skills.sh (추가 기준)
| 항목 | 값 |
|---|---|
| 배경 / 패널 | `lab(1.8)` ≈ `#050505` / 반투명 블랙 `rgba(10,10,10,.95)` |
| 텍스트 | `lab(93.7)` ≈ `#ebebeb` · 보조 `lab(56)` ≈ `#8f8f8f` |
| 보더 | 0.8px `lab(11.7)` ≈ `#1c1c1c` — 표/섹션 전부 헤어라인 |
| 폰트 | **Geist** + **Geist Mono** (14px가 대부분) |
| 섹션 라벨 | Geist Mono 14px w500 uppercase, 본문색 ("TRY IT NOW", "SKILLS LEADERBOARD") |
| 기타 | 탭은 밑줄, 검색창은 하단 보더만, 리더보드 행 높이 ~56px |

### 1-c. 컬러 팔레트 (사용자 지정)
채도 낮은 어스 톤 9색 × 3단계 (딥 레드 → 브라운 → 올리브 → 모스 → 그린 → 틸 → 페트롤 → 네이비 → 플럼). 값은 `DESIGN.md` §1.

---

## 2. 엄선 레퍼런스 (실측 토큰)

### A. 일정 / 할 일 (Calendar · Tasks · Productivity)

| 사이트 | 배경 | 폰트 | 핵심 토큰 | 참고 포인트 |
|---|---|---|---|---|
| [Daybox](https://usedaybox.com) | `#111111` | Inter Tight 500 | 텍스트 `#fff` / 보조 `#fff 40%`, 카드 `#1e1e1e`, pill 버튼 r30 bg `#fff 10%`, max-w 1120 | **cregg 톤과 가장 가까운 일정 앱.** 다크 + 흰색 투명도 단계로 위계 |
| [Joi Planner](https://joi.software) | `#ffffff` | SF Pro Display | 96px 헤드라인, 포인트 블루 `#086fff`, pill r999 | 데일리 플래너 — 큰 숫자/시간 표기 |
| [Daily Four](https://dailyfour.app) | `#f8f5f0` | Inter + Georgia | H1 56/70 w700, 본문 17/28, 카드 `#e9e4d9`, r 4–8 | "오늘 4개만" — 할 일 개수 제한 UX |
| [Todoist](https://www.todoist.com) | `oklch(.99 .002 68)` | Graphik + Inter | 텍스트 `#25221e` / 66% 투명, 브랜드 `oklch(.61 .2 30)`, r 8–15 | 투명도 기반 텍스트 위계, 리스트 밀도 |
| [Hourly](https://hourly-app.com) | `#0a0a0a` | Neue Haas Grotesk Bd | 크림 `#eee3c1` + 레드 `#d0021b`, 4px 보더 | 시간 트래킹 — 굵은 2색 타이포 |
| [Superlist](https://superlist.com) | `#181824` | Haffer XH + Inter | H1 64/61 ls-1.28, 보조 `#8e8da0`, 헤더 blur 29px | 할 일+노트 통합 |
| [Blok](https://blok.so) | `#f8f8f8` | SF Pro Display | 텍스트 `#141414`/`#525252`/`#737373`, r 8 | 회색 3단 위계가 깔끔 |
| [Raycast](https://www.raycast.com) | `#07080a` | Inter + GeistMono | 카드 `#fff 5%`, 보조 `#9c9c9d`, r 6–11 | 키보드 우선, 커맨드 팔레트(⌘K) |

### B. 뉴스 / 에디토리얼 (News feed · Reading)

| 사이트 | 배경 | 폰트 | 핵심 토큰 | 참고 포인트 |
|---|---|---|---|---|
| [ART+TECH Report](https://www.arttechreport.com) | `#ffffff` | Instrument Sans + **Instrument Serif** + Space Mono | 텍스트 `#1a1b1f`, 메타 `#919191`, 메타 11px mono | **리포트/뉴스 레이아웃 최우선 참고.** sans+serif+mono 3종 조합 (전부 Google Fonts 무료) |
| [Editorial New](https://editorialnew.com) | `#f4f4f4` ↔ `#1a1a1a` | Editorial New + Neue Montreal | 헤더 fixed 57px, 하단 보더 `rgba(244,244,244,.25)`, "Invert Colors" 토글 | 세리프 본문 + 다크/라이트 반전 |
| [SAPIENS](https://www.sapiens.org) | `#f9f9f4` | Unica + Rosart | 메타 12px, 카테고리 pill r25 | 매거진 그리드, 카테고리 필터 칩 |
| [Oku](https://oku.club) | `#ffffff` | Inter + FabricSerif | H1 48/62 serif, 본문 16/28.8 `#46474e`, 버튼 r8 bg `#000` | 리스트형 콘텐츠 (책 → 기사로 치환 가능) |
| [Fey](https://fey.com) | `#fafafa` | -apple-system | 본문 21/32.5 w600 `#595959` | 금융 뉴스/마켓 — 숫자·티커 표현 |

### C. 클린 / 미니멀 (전체 톤 & 레이아웃)

| 사이트 | 배경 | 폰트 | 핵심 토큰 | 참고 포인트 |
|---|---|---|---|---|
| [Singular Forms](https://www.singularforms.com) | `#f9f9f8` | Neue Montreal | 텍스트 `#2b2b2b`, 보조 `#9c9c9c`, 14px/0.5px 자간, max-w 1800 | cregg의 **라이트 버전**처럼 보임. 1px 구분선 + 넉넉한 여백 |
| [Brikken+Co](https://brikken.co) | `#eeece9` | PP Neue Montreal + Sometype Mono | 보조 `#c3c2bf`, mono 버튼 12px ls1.2 r6, max-w 1480 | mono 라벨/버튼 |
| [ANTI](https://anti.as) | `#ffffff` | Studio Pro | 14.4 / 21.6 두 사이즈만 사용, 오버레이 `#000 56%` | 사이즈 2개로 끝내는 절제 |
| [Cosmos](https://www.cosmos.so) | `#ffffff` | cosmosOracle | H1 72/72 ls-2.88 (-0.04em), sticky 헤더 92px | 그리드 카드 (뉴스 썸네일 그리드용) |
| [Vercel](https://vercel.com) | `#fafafa` | **Geist + Geist Mono** | 텍스트 `#171717`/`#4d4d4d`, H1 64 ls **-0.06em**, r 6 | 무료 폰트, 대시보드 톤 |
| [Mintlify](https://www.mintlify.com) | `#ffffff` | Inter + Paper Mono + Arizona Flare | 보더 `#f1f0ee`, sticky 헤더 65px, r 4–6 | 문서형 사이드바 레이아웃 |
| [Emmpo](https://emmpo.com) | — | — | 스크린샷만 | 에이전시, clean/minimal/dark 3개 카테고리 동시 등재 |

---

## 3. 수집한 카테고리 전체 목록

`refs-gallery-categories.json`에 원본이 있습니다. 카테고리 페이지 1페이지 기준(최대 25개).

- **calendar** (2): Show And Tell, Joi
- **tasks** (13): Uncle Rudy, Rows, Hustla, Pattrn, Daybox, Hourly, Daily Four, Huly, Aim, Todoist, Joi …
- **productivity** (24): Gamma, Manifest, The InnerWebs, Notion, Superlist, Campsite, Copilot Money, TakeProfit …
- **keyboard-first** (8): Portal, Raycast, Fernand, Warp, Tatem, Lazy …
- **habits** (16): Blok, Then, Presence.supply, Oku, Tiempo, Deltaboard …
- **workflow / launcher**: Cofounder, Mymind, Cool Stuff, Essential, Parabola, Uni …
- **clean / minimal / typography / elegant / dark**: 각 25개 (CREGG Paris는 clean에 등재)
- **blog / data-viz / light / docs**: ART+TECH Report, SAPIENS, Design Spells, PostHog, Mixpanel, Attio, Felt …

### 읽을 만한 Margins 글 (refs.gallery 에디토리얼)
- [Top 10 best typography websites in 2026](https://refs.gallery/margins/best-typography-websites-2026) — "타입을 1차 디자인 시스템으로"
- [Top 10 best dark UI websites in 2026](https://refs.gallery/margins/best-dark-ui-websites-2026) — 다크 UI 대비/가독성
- [Top 10 best Next.js websites in 2026](https://refs.gallery/margins/best-nextjs-websites-2026)
- [Top 15 best SaaS websites in 2026](https://refs.gallery/margins/best-saas-websites-2026)
- [How to use Refs.Gallery for design research](https://refs.gallery/margins/how-to-use-refs-gallery-for-design-research)

### 컬렉션 바로가기
[Minimal](https://refs.gallery/collections/minimal-website-design) ·
[Typography](https://refs.gallery/collections/typography-website-design) ·
[Dark UI](https://refs.gallery/collections/dark-ui-website-design) ·
[Data Viz & Dashboard](https://refs.gallery/collections/data-visualization-dashboard-design) ·
[Education & Productivity](https://refs.gallery/collections/education-productivity-websites)
