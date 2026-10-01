# WinBar 마이크로소프트 스토어 제출용 MSIX 만들기 (Windows 10/11 x64, 프로토타입)
# 서명하지 않은 MSIX를 만든다. 스토어에 올리면 스토어가 서명한다.
# 사용법: 저장소 맨 위 폴더에서  powershell -ExecutionPolicy Bypass -File packaging\pack-msix.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$layout = Join-Path $root 'obj\msix-layout'
$out = Join-Path $root 'dist'

# 1) .NET을 포함해 폴더로 게시한다.
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
dotnet publish (Join-Path $root 'WinBar.csproj') -c Release -r win-x64 --self-contained true -p:DebugType=none -o $layout
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish 실패' }

# 2) 스토어 아이콘을 WinBar 로고(네모 4칸)로 그린다.
Add-Type -AssemblyName System.Drawing
$assets = Join-Path $layout 'Assets'
New-Item -ItemType Directory -Force $assets | Out-Null
function New-Logo([string]$name, [int]$width, [int]$height) {
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)
    $size = [Math]::Min($width, $height)
    $radius = [int]($size * 0.22)
    $x = [int](($width - $size) / 2); $y = [int](($height - $size) / 2)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $radius * 2, $radius * 2, 180, 90)
    $path.AddArc($x + $size - $radius * 2 - 1, $y, $radius * 2, $radius * 2, 270, 90)
    $path.AddArc($x + $size - $radius * 2 - 1, $y + $size - $radius * 2 - 1, $radius * 2, $radius * 2, 0, 90)
    $path.AddArc($x, $y + $size - $radius * 2 - 1, $radius * 2, $radius * 2, 90, 90)
    $path.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(28, 28, 30))), $path)
    $family = try { New-Object System.Drawing.FontFamily 'Segoe Fluent Icons' } catch { New-Object System.Drawing.FontFamily 'Segoe MDL2 Assets' }
    $glyph = New-Object System.Drawing.Drawing2D.GraphicsPath
    $glyph.AddString([string][char]0xE8A9, $family, 0, [single]($size * 0.52), (New-Object System.Drawing.PointF 0, 0), [System.Drawing.StringFormat]::GenericTypographic)
    $b = $glyph.GetBounds()
    $m = New-Object System.Drawing.Drawing2D.Matrix
    $m.Translate($x + ($size - $b.Width) / 2 - $b.X, $y + ($size - $b.Height) / 2 - $b.Y); $glyph.Transform($m)
    $white = [System.Drawing.Color]::FromArgb(236, 236, 239)
    $g.FillPath((New-Object System.Drawing.SolidBrush $white), $glyph)
    $g.DrawPath((New-Object System.Drawing.Pen $white, ([single]([Math]::Max(1, $size * 0.025)))), $glyph)
    $bmp.Save((Join-Path $assets $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}
New-Logo 'StoreLogo.png' 50 50
New-Logo 'Square44x44Logo.png' 44 44
New-Logo 'Square150x150Logo.png' 150 150
New-Logo 'Wide310x150Logo.png' 310 150

# 3) 패키지 설명 파일에 버전을 채운다(스토어 규칙: 네 자리, 마지막은 0).
$version = (Select-Xml -Path (Join-Path $root 'WinBar.csproj') -XPath '//Version').Node.InnerText
$packageVersion = "$version.0"
$manifest = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'AppxManifest.xml'), [System.Text.Encoding]::UTF8).Replace('{VERSION}', $packageVersion)
[System.IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding $false))

# 4) makeappx로 MSIX를 만든다(설명 파일 형식도 이때 검사된다).
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter makeappx.exe |
    Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'Windows SDK의 makeappx.exe를 찾을 수 없습니다.' }
New-Item -ItemType Directory -Force $out | Out-Null
$msix = Join-Path $out "WinBar_${packageVersion}_x64.msix"
& $makeappx.FullName pack /d $layout /p $msix /o
if ($LASTEXITCODE -ne 0) { throw 'makeappx pack 실패' }
"만든 파일: $msix"
"크기: {0:N1} MB" -f ((Get-Item $msix).Length / 1MB)
