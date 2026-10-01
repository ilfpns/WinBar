# 마이크로소프트 스토어 제출 안내

WinBar 0.1.0 (프로토타입, Windows 10/11 x64 전용)을 파트너 센터에 제출할 때 각 칸에 넣을 내용입니다.

## 0. 준비물
| 준비물 | 만드는 방법 · 위치 |
| --- | --- |
| MSIX 패키지 | `powershell -ExecutionPolicy Bypass -File packaging\pack-msix.ps1` → `dist\WinBar_0.1.0.0_x64.msix` |
| 스크린샷 3장 (1920×1080) | `dist\store\screenshot-1-menubar.png`, `screenshot-2-settings.png`, `screenshot-3-menu.png` |
| 개인정보 처리방침 주소 | https://github.com/ilfpns/WinBar/blob/main/docs/privacy.md |
| 지원 주소 | https://github.com/ilfpns/WinBar/issues |

패키지의 앱 ID는 파트너 센터에서 예약한 값(`E5DA490F.WinBar`, 게시자 `CN=95AE808F-40A7-4EA8-BC59-51F0BCE0B6AC`)으로 이미 들어가 있습니다. 서명은 스토어가 하므로 따로 하지 않습니다.

## 1. 제출 순서 (파트너 센터 → 앱 및 게임 → WinBar → 제출 시작)
1. **가격 및 가용성**: 시장 = 대한민국(또는 전체), 가격 = 무료, 공개 여부 = 공개(검색 가능)
2. **속성**: 범주 = 유틸리티 및 도구 / 개인정보 처리방침 = 위 주소 / 시스템 요구 사항 = Windows 10 1809 이상, x64
3. **연령 등급**: 설문에서 "사용자 간 소통·구매·위치 공유 없음"으로 답합니다.
4. **패키지**: `WinBar_0.1.0.0_x64.msix`를 끌어다 놓고, 기기 제품군은 **데스크톱**만 선택합니다.
5. **스토어 등록 정보 (한국어)**: 아래 2번 내용을 붙여 넣고 스크린샷 3장을 올립니다.
6. **제출 옵션 → 인증 담당자 참고 사항**: 아래 3번 내용을 붙여 넣습니다.
7. **스토어에 제출**을 누릅니다. 심사는 보통 며칠 걸리고, 결과는 파트너 센터와 메일로 옵니다.

## 2. 스토어 등록 정보 (한국어)
**제품 이름**: WinBar

**짧은 설명**
Windows 10/11 화면 맨 위에 macOS 같은 메뉴바를 띄워 컴퓨터 상태를 한눈에 보여 줍니다. (프로토타입)

**설명**
WinBar는 Windows 화면 맨 위에 macOS처럼 얇은 메뉴바를 띄우는 앱입니다. 배터리, Wi-Fi, 음량 같은 상태를 창을 여러 개 열지 않고 한눈에 볼 수 있습니다.

※ 프로토타입 버전입니다. Windows 10(1809 이상)과 Windows 11, 64비트(x64)에서만 동작합니다.

- 연결된 모든 모니터 맨 위에 메뉴바 표시
- CPU · GPU · 메모리 · 배터리(남은 시간) · Wi-Fi · Bluetooth · 음량 · 밝기 · 날짜와 시각
- 카메라·마이크 사용 중 표시
- 한/영 상태를 스위치로 표시하고, 눌러서 전환
- 음량·밝기는 메뉴바에서 바로 조절, Wi-Fi·Bluetooth는 Windows 설정으로 연결
- 전체 화면일 때는 메뉴바가 숨고, 화면 맨 위에 마우스를 대면 다시 표시
- 배경 불투명도(20~100%), 표시 항목, 24시간 시계 설정
- 관리자 권한 없이 동작하며, 설정은 이 PC에만 저장하고 외부로 보내지 않습니다

**기능 목록 (항목별 입력)**
- 모든 모니터 상단 메뉴바
- CPU·GPU·메모리·배터리 상태 표시
- 음량·밝기 바로 조절
- 한/영 스위치
- 전체 화면 자동 숨김
- 배경 불투명도 설정

**검색어**: 메뉴바, 맥 메뉴바, macOS, 상태 표시줄, 배터리, 시스템 모니터, menu bar

## 3. 인증 담당자 참고 사항 (영어로 붙여 넣기)
```
WinBar is a prototype menu bar for Windows 10/11 (x64). It is a WinForms (.NET 10, self-contained) desktop app.

- runFullTrust: required because WinBar is a Win32 desktop app. It docks a thin bar at the top of each monitor using the shell AppBar API (SHAppBarMessage) so maximized windows are not covered.
- Keyboard/mouse: WinBar registers Raw Input with RIDEV_INPUTSINK only to detect that the Hangul (Korean/English) key, the Esc key, or a mouse button was pressed. This updates the Korean/English indicator and closes open menus. No keystrokes or text are recorded, stored, or transmitted, and input is never blocked.
- Privacy: WinBar has no network code. Settings are stored locally only. Privacy policy: https://github.com/ilfpns/WinBar/blob/main/docs/privacy.md
- Startup: a startup task is declared but disabled by default; the user enables it in Settings > Apps > Startup.
- No administrator rights are required. To test: launch WinBar, hover icons on the top bar, click the volume/brightness icons, and open Settings from the left logo.
```

## 4. 알려 둘 점
- 앱 설명과 스크린샷은 실제 동작하는 기능만 담았습니다.
- 심사에서 키보드 입력 감지(Raw Input)나 `runFullTrust` 사유를 더 묻는 경우가 있습니다. 위 3번 설명으로 답하고, 필요하면 한/영 즉시 반영 기능을 빼고 다시 제출할 수 있습니다.
- MSIX 설치본에서는 "로그인 시 자동 실행"이 Windows 설정 > 앱 > 시작 프로그램을 여는 링크로 바뀝니다.
