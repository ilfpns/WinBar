# DESIGN.md — 개인 대시보드 (일정 관리 + 뉴스 크롤링)

> 기준: **CREGG Paris** + **skills.sh** — 블랙 배경, 헤어라인 보더, Geist 단일 계열, 큰 타입 / 작은 UI의 대비, 절제된 모션
> 컬러: 채도 낮은 **어스 팔레트**(딥 레드·브라운·올리브·모스·그린·틸·페트롤·네이비·플럼), 면은 **반투명 블랙**
> 보완: Daybox(일정 UI), ART+TECH Report · Editorial New(뉴스 리딩), Raycast(⌘K)
> 근거 데이터는 [`README.md`](./README.md), 변수는 [`tokens.css`](./tokens.css) (= `src/styles/tokens.css`)

---

## 0. 원칙

1. **색이 아니라 명도로 위계를 만든다.** 텍스트는 4단계(`text-strong / text / muted / subtle`)만. 포인트 컬러는 "지금" 신호에만.
2. **두 가지 크기의 세계.** 화면당 대형 숫자/제목 하나(시계, 날짜, 헤드라인) + 나머지는 12–15px UI 텍스트.
3. **면은 반투명 블랙, 구획은 헤어라인.** 패널은 `rgba(10,10,10,.6)` + `blur(24px)`, 보더는 1px `#1c1c1c`. 그림자 없음.
4. **모서리는 각지게.** radius 0 (cregg). 예외: 상태 점·아바타는 원형.
5. **모션은 색 전환만.** `color/background .2s cubic-bezier(0,0,.2,1)`.
6. **다크 고정.** OS 라이트 모드여도 다크 유지 (`color-scheme: dark`).

---

## 1. 컬러

### 베이스 — 블랙 + 반투명 블랙
| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#050505` | 페이지 배경 (뒤에 팔레트 딥 컬러로 아주 흐린 앰비언트 글로우) |
| `--surface` | `rgba(10,10,10,.6)` + `blur(24px)` | 패널, 에디터, 링 배경 |
| `--surface-2` / `-3` | `rgba(255,255,255,.04)` / `.07` | hover, 선택된 행, 입력창 |
| `--line` / `--line-strong` | `#1c1c1c` / `#2c2c2c` | 헤어라인 (skills.sh 실측 `lab(11.7)`) |
| `--glass` | `rgba(10,10,10,.55)` + 1px `rgba(255,255,255,.07)` | 헤더·칩 버튼 |
| `--text-strong` | `#ffffff` | 제목, 현재 시각, 선택 항목 |
| `--text` | `#ebebeb` | 본문 (skills.sh `lab(93.7)`) |
| `--text-muted` | `#8f8f8f` | 보조 정보 (skills.sh `lab(56)`) |
| `--text-subtle` | `#5a5a5a` | 메타, 비활성 |
| `--accent` | `#4fbf7a` | **지금** — 현재 시각선, 진행 중 일정 |
| `--info` | `#4a9fb3` | 포커스 링 |
| `--danger` | `#c0503c` | 오류, 삭제 hover |

### 어스 팔레트 (각 색상 `-1` 딥 · `-2` 미드 · `-3` 라이트)
| hue | -1 | -2 | -3 |
|---|---|---|---|
| red | `#4a1e17` | `#5c1d10` | `#8a3f30` |
| brown | `#432a16` | `#554210` | `#8a5a32` |
| olive | `#3f3614` | `#67592a` | `#8a7a32` |
| moss | `#3c4214` | `#5a6224` | `#7a8a30` |
| green | `#163e22` | `#226338` | `#2e8a50` |
| teal | `#144238` | `#1f6a5e` | `#2e8a7e` |
| petrol | `#153a44` | `#1f5a68` | `#2e7a8e` |
| navy | `#18184a` | `#24226a` | `#34308e` |
| plum | `#431844` | `#6a226a` | `#8a2e8a` |

### 일정 카테고리 = 면은 `-1`(딥), 선·점은 `-3`(라이트)
`업무 petrol` · `공부 navy (선 #4a45b0로 밝힘)` · `운동 moss` · `개인 green` · `수면 plum` · `기타 brown`
— 원형 시간표에서 블록 면은 딥 컬러 88%, 바깥 테두리 5px 라인 컬러. hover/선택 시 라인 컬러를 18% / 38% 섞음.

---

## 2. 타이포그래피

### 서체
| 역할 | 추천 (무료) | 유료 대안 (원본 느낌) |
|---|---|---|
| 라틴 UI/제목 | **Geist** (skills.sh) | KH Teka (cregg), PP Neue Montreal |
| 한글 | **Pretendard Variable** | — |
| 숫자·시간·메타 | **Geist Mono** / JetBrains Mono (`tabular-nums`) | Space Mono (ART+TECH) |
| 뉴스 본문 리딩 (선택) | **Instrument Serif** / Noto Serif KR | Editorial New |

```css
font-family: "Geist", "Pretendard Variable", Pretendard, system-ui, sans-serif;
/* 섹션 라벨: Geist Mono 12px w500 uppercase, 본문색 (skills.sh "TRY IT NOW" 스타일) */
```

### 스케일 (root 16px 기준, cregg 비율 유지)
| 토큰 | size / line-height | letter-spacing | 용도 |
|---|---|---|---|
| `display` | 96 / 86 (clamp 56→96) | -0.035em | 대시보드 시계, 오늘 날짜 |
| `h1` | 62 / 58 | -0.03em | 페이지 제목 |
| `h2` | 42 / 45 | -0.03em | 섹션 제목, 뉴스 상세 헤드라인 |
| `h3` | 27 / 32 | -0.015em | 카드 제목, 주요 헤드라인 |
| `lead` | 22 / 25 | -0.01em | 리드 문단, "더 보기 →" 링크 |
| `body` | 15 / 22 | 0 | 기본 본문 (한글은 line-height 1.6) |
| `ui` | 14 / 16 | +0.005em | 버튼, 내비, 리스트 항목 |
| `meta` | 12 / 16 mono | +0.02em, uppercase(라틴) | 출처, 시간, 태그 |

- 굵기는 **400 / 500 두 개만** (cregg은 400 단일). 강조는 굵기가 아니라 `--text-strong` 색으로.
- 한글 대제목은 자간을 -0.02em 정도로 덜 좁힌다.

---

## 3. 간격 · 레이아웃

- 기본 단위 **4px**, 주로 쓰는 값: `4 · 8 · 12 · 16 · 20 · 30 · 40 · 80 · 120`
- 페이지 좌우 패딩: 데스크톱 `20px`(cregg), 태블릿 `16px`
- 헤더: `fixed`, 높이 `58px`, padding `12px 20px`, 배경 투명 → 버튼만 glass
- 그리드: 12 col, gutter 20px, 최대 폭 제한 없음(풀블리드) — 단 뉴스 본문은 `max-width: 680px`
- 섹션 간격: 대시보드 내부 `40px`, 랜딩/히어로 `120px`

### 앱 레이아웃
```
┌─────────────────────────────────────────────────────────────┐
│ [Home]                         [Today][Calendar][News][⌘K]  │ ← header 58px, glass 버튼
├─────────────────────────────────────────────────────────────┤
│  10월 14일 화요일                                  09:42     │ ← display 96px
│  ───────────────────────────────────────────────────────── │
│  TODAY (col 1–5)          │  NEWS BRIEFING (col 6–12)        │
│  09:00 ● 스탠드업          │  REUTERS · 12m        ● NEW      │
│  11:00   리뷰             │  헤드라인 27px...                 │
│  ──── now (green 1px) ──  │  요약 2줄 15px #a9a9a9           │
│  14:00   PT               │  ─────────────────────────────   │
│  + 일정 추가               │  BLOOMBERG · 1h                  │
│                           │  헤드라인 ...           더 보기 → │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 컴포넌트

### Glass Button (cregg nav-button)
```css
.btn-glass { padding: 8px 15px; border-radius: 0; font: 500 14px/16px var(--font-sans);
  border: 1px solid var(--glass-border);
  color: var(--text); background: var(--glass); backdrop-filter: blur(24px);
  transition: color .2s var(--ease-out), background-color .2s var(--ease-out); }
.btn-glass:hover { color: var(--text-strong); background: var(--glass-hover); }
.btn-glass[aria-current="page"] { color: var(--bg); background: var(--text); }
```

### Arrow Link — "Learn More →"
22px, `--text-subtle` → hover `--text-strong`. 화살표는 hover시 `translateX(4px)`.

### Schedule Row (Daybox + cregg)
- 높이 48px, `grid-template-columns: 64px 1fr auto`
- 시간: mono 12px `--text-subtle` / 제목: 15px `--text` / 카테고리 점 6px
- 진행 중: 제목 `--text-strong` + 좌측 점 `--accent`, 지난 일정: 전체 `opacity:.4`
- 현재 시각선: 1px `--accent` 가로선 + 우측에 `09:42` mono 라벨
- hover: 배경 `--surface-2`, 보더 없음

### Calendar (월/주)
- 월간: 7열 그리드, 셀 구분은 1px `--line`, 날짜 숫자 14px 좌상단, 오늘은 숫자만 `--bg` on `--text` 사각 배지
- 주간: 시간축 좌측 mono 12px, 일정 블록은 **면 대신 좌측 2px 컬러 바 + `--surface`**
- 키보드: `←/→` 이동, `T` 오늘, `N` 새 일정, `⌘K` 팔레트 (Raycast 패턴)

### News Item (ART+TECH Report + Editorial New)
```
REUTERS · 경제 · 12분 전            ← meta: mono 12px uppercase --text-subtle
헤드라인은 27px, 최대 2줄            ← h3 --text-strong, line-clamp 2
요약은 15px --text-muted, 2줄        ← 크롤링 원문에서 추출/요약
```
- 구분선 1px `--line`, 항목 간 padding 20px 0
- 새 기사: 메타 앞에 6px `--accent` 점 · 읽은 기사: 헤드라인 `--text-muted`
- 썸네일은 선택(있으면 우측 120×80, radius 0, `grayscale(1)` → hover 컬러)
- 필터: SAPIENS식 칩 → 우리 톤에서는 glass button 그룹 (`전체 / 경제 / 테크 / 국내`)

### Input / Command Palette
- 입력: 배경 `--surface-2`, 보더 없음, 높이 40px, focus시 하단 1px `--info`
- ⌘K 팔레트: 중앙 640px, `--surface` + 1px `--line`, 결과 행 40px, 선택 행 `--surface-2`

### Toast / 크롤링 상태
우하단, glass 배경, mono 12px: `● 크롤링 완료 · 38건 · 09:40` (실패 시 점 `--danger`)

---

## 5. 모션
| 토큰 | 값 | 용도 |
|---|---|---|
| `--ease-out` | `cubic-bezier(0,0,.2,1)` | hover 색 전환 |
| `--ease-in-out` | `cubic-bezier(.4,0,.2,1)` | 패널 열기 |
| `--dur-fast` | `.2s` | hover |
| `--dur-base` | `.3s` | 탭 전환, 버튼 |
| `--dur-slow` | `.4s` | 아코디언, 팔레트 등장 |

- 뉴스 티커(선택): cregg `marquee-text 10s linear infinite`을 헤드라인 롤링에 응용
- `prefers-reduced-motion`에서는 marquee 정지, transition 0

---

## 5-b. App shell (Today, 2026-10-14 기준 구현)
- **원형 시간표를 가운데 두고, 좌/우 패널은 항상 고정 표시.** UI 텍스트는 영어. 좁은 화면(≤1000px)에선 원 → Tasks → 좌측 패널 순으로 세로 배치.
- 패널은 SaaS 사이드바 스타일: `rgba(12,12,12,.72)` + blur, 1px `rgba(255,255,255,.07)`, radius 14px, 화면 가장자리 10px 띄움. 패널 내부 요소는 radius 6–10px (원·링 영역은 각진 톤 유지).
  - Left: Brand · Nav(Today / Calendar `Soon` / News `Soon`) · Search(`/`) · Now 카드 · Planned/Free · Categories · Load sample / Clear all
  - Right: Tasks 리스트(체크박스로 완료) · `+ New` · 편집 카드(Title, Category, Start/End, Done)
- **원 중앙 = 하루 진행도 (시간 기준)** — 완료한 블록 시간 ÷ 24h. 24시간을 다 채우고 모두 완료하면 100% (Sleep 포함). 표시: `33%`, `8h / 24h`, `5h to go · 2h 30m free` + 안쪽 진행 링(`--accent`, 0시 기준 시계방향). 드래그·선택 중엔 해당 정보로 전환.
- **다중 선택 + 일괄 처리:** 원에서 Task를 눌러 다른 Task까지 드래그하거나, 리스트에서 행을 드래그하면 범위 선택. Shift-click = 범위 확장, Ctrl/Cmd-click = 토글, Ctrl/Cmd+A = 전체, Esc = 해제. 선택 중엔 원 중앙이 `SELECTED n`으로 바뀌고, 오른쪽 패널 하단(sticky)에 일괄 카드: Mark done/not done · Category · Move ±15m/±1h · Length ±15/30m · Delete. 하나라도 겹치거나 15분 미만이 되면 전체 적용을 거부하고 사유 표시.
- 블록 색: 면은 팔레트 `-1`을 검정과 55% 섞은 값, 테두리 라인은 `-2`. 완료 블록은 라인 불투명도 100%(미완료 50%) + 라벨 muted.

## 5-c. 아이콘 · 엠블럼 · 반응형 (업데이트)
- **아이콘은 Lucide만** (`lucide` 패키지, 16px · stroke 1.75). 이모지·유니코드 기호(✓, →)를 아이콘으로 쓰지 않는다. 아이콘만으로 뜻이 불분명하면 짧은 라벨을 붙인다(링 아래 `Done`, `Work` 등).
- 아이콘은 호버 시 선이 그려지는 애니메이션(`pathLength=1` + `stroke-dashoffset`).
- 원 중앙 점 엠블럼: 점 하나 = 하루의 한 조각. 완료한 Task 구간의 점은 그 카테고리 색으로 **옅고 얕게** 빛남. 저장·완료 순간에는 ripple / cross / diagonal / spiral / sweep / rain / twinkle 중 랜덤 패턴 + pop / flare / blink 중 랜덤 모션.
- 배경 클릭: 원 중심 기준 왼쪽 절반 → 왼쪽 서랍, 오른쪽 절반 → 오른쪽 서랍.
- 반응형: ≥1280 데스크톱(서랍이 원을 밀어냄) · 1001–1279 노트북(서랍 폭 축소) · 641–1000 태블릿(서랍이 원 위에 겹침, 배경 어둡게, 한 번에 하나) · ≤640 휴대폰(거의 전체 폭 서랍, 터치 영역 36–44px, safe-area).

## 6. 페이지 구성
1. **Today (홈)** — 대형 날짜/시계 + 오늘 일정 + 뉴스 브리핑 상위 5개
2. **Calendar** — 월/주 토글, 우측 드로어에 일정 상세
3. **News** — 출처·키워드 필터, 리스트 / 읽기 모드(본문 max 680px, 세리프 선택)
4. **Sources (설정)** — 크롤링 대상 RSS/URL, 키워드, 주기, 마지막 실행 상태

## 7. 하지 말 것
- 드롭 섀도우, 둥근 카드(radius > 2px), 배경 글로우 외의 그라디언트
- 일정 블록을 채도 높은 색 면으로 칠하기 (면은 항상 팔레트 `-1` 딥 컬러)
- 굵기 600 이상 / 폰트 3종 초과
- 네온/원색 (`#00ff85` 같은 형광 → 팔레트에서 고르기)
