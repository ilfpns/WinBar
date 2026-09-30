# WinBar

Windows 10/11용 macOS 스타일 메뉴바입니다.
모든 모니터 상단에 CPU, GPU, RAM, 배터리 상태를 표시합니다.

![WinBar](screenshot.png)

## 실행
.NET 10 SDK가 필요합니다.

```powershell
dotnet build WinBar.csproj -c Release
.\bin\Release\net10.0-windows\WinBar.exe
```

## 특징
- 외부 패키지 없이 C# / .NET 10 WinForms로 개발
- 2초마다 갱신, 유휴 CPU 0.02%, 메모리 약 33MB
- 관리자 권한 불필요, Windows와 다른 앱을 막지 않음
