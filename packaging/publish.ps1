# WinBar 배포용 exe 만들기 (Windows 10/11 x64 전용 프로토타입)
# .NET 런타임을 함께 넣은 단일 실행 파일을 dist\ 에 만든다. 받는 사람은 .NET을 따로 설치하지 않아도 된다.
# 사용법: 저장소 맨 위 폴더에서  powershell -ExecutionPolicy Bypass -File packaging\publish.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'dist'
$publish = Join-Path $root 'obj\publish-win-x64'

dotnet publish (Join-Path $root 'WinBar.csproj') -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=none `
    -o $publish
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish 실패' }

$version = (Select-Xml -Path (Join-Path $root 'WinBar.csproj') -XPath '//InformationalVersion').Node.InnerText
New-Item -ItemType Directory -Force $out | Out-Null
$target = Join-Path $out "WinBar-$version-win10-11-x64.exe"
Copy-Item (Join-Path $publish 'WinBar.exe') $target -Force

$hash = (Get-FileHash $target -Algorithm SHA256).Hash
Set-Content (Join-Path $out "WinBar-$version-win10-11-x64.exe.sha256") "$hash  $(Split-Path -Leaf $target)" -Encoding ascii
"만든 파일: $target"
"크기: {0:N1} MB" -f ((Get-Item $target).Length / 1MB)
"SHA256: $hash"
