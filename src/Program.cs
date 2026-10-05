using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace WinBar;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        // 로그인 자동 실행과 직접 실행이 겹쳐도 메뉴바는 하나만 뜬다.
        using var singleInstance = new Mutex(true, @"Local\WinBar.SingleInstance", out bool firstInstance);
        if (!firstInstance) return;

        // 한 기능에서 처리되지 않은 오류가 나도 메뉴바 전체가 종료되지 않게 한다.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => System.Diagnostics.Debug.WriteLine(e.Exception);
        ApplicationConfiguration.Initialize();
        Application.Run(new WinBarContext());
    }
}

internal static class Theme
{
    public static bool IsLight => AppSettings.Current.LightMode;
    public static Color BarBackground => IsLight ? Color.FromArgb(242, 242, 244) : Color.FromArgb(30, 30, 32);
    // 메뉴바 유리에 깔 테마 색의 실제 불투명도(%).
    // 0%: 배경을 완전히 없앤다(흐림·색 없음, 아이콘과 글자만 보임).
    // 1~100%: 15~100%로 환산한다. 아주 옅으면 Windows 아크릴이 테마 색(화이트·다크)을 따르지 않아 글자가 배경에 묻힌다.
    public static int BarTintPercent => Math.Clamp(AppSettings.Current.BarOpacity, 0, 100) is int value && value > 0
        ? 15 + value * 85 / 100
        : 0;
    public static Color BarText => IsLight ? Color.FromArgb(28, 28, 30) : Color.FromArgb(232, 232, 235);
    public static Color Dim => IsLight ? Color.FromArgb(132, 132, 138) : Color.FromArgb(118, 118, 124);
    public static Color PopupBackground => IsLight ? Color.FromArgb(244, 244, 246) : Color.FromArgb(36, 36, 38);
    public static Color PopupBorder => IsLight ? Color.FromArgb(188, 188, 194) : Color.FromArgb(70, 70, 74);
    public static Color Primary => IsLight ? Color.FromArgb(28, 28, 30) : Color.FromArgb(236, 236, 239);
    public static Color Secondary => IsLight ? Color.FromArgb(92, 92, 98) : Color.FromArgb(158, 158, 164);
    public static Color Separator => IsLight ? Color.FromArgb(205, 205, 210) : Color.FromArgb(55, 55, 58);
    public static Color Hover => IsLight ? Color.FromArgb(220, 220, 224) : Color.FromArgb(52, 52, 55);
    public static Color Card => IsLight ? Color.FromArgb(218, 250, 250, 252) : Color.FromArgb(172, 54, 54, 58);
    public static Color Track => IsLight ? Color.FromArgb(194, 194, 200) : Color.FromArgb(72, 72, 76);
    public static Color Accent => IsLight ? Color.FromArgb(28, 28, 30) : Color.FromArgb(236, 236, 239);
    public static Color AccentText => IsLight ? Color.White : Color.FromArgb(24, 24, 26);
    // 배터리 잔량 구간별 색(메뉴바 배터리 채움과 배터리 모달의 큰 숫자에 같이 쓴다).
    // 10% 미만 빨강 · 10%~절전 기준 노랑 · 절전 기준 초과~70% 미만 옅은 파랑 · 70~100% 초록. 기준을 못 읽으면 Windows 기본 20%.
    // 설정에서 배터리를 흑백으로 고르면 구간과 상관없이 글자 색과 같은 색.
    public static Color BatteryLevel(int percent, int? saverThreshold)
    {
        if (AppSettings.Current.MonochromeBattery) return Primary;
        int threshold = saverThreshold ?? 20;
        if (percent < 10) return IsLight ? Color.FromArgb(255, 59, 48) : Color.FromArgb(255, 69, 58);
        if (percent <= threshold) return IsLight ? Color.FromArgb(242, 176, 0) : Color.FromArgb(255, 214, 10);
        if (percent < 70) return IsLight ? Color.FromArgb(64, 170, 235) : Color.FromArgb(100, 210, 255);
        return IsLight ? Color.FromArgb(40, 180, 80) : Color.FromArgb(48, 209, 88);
    }

    // 메뉴·설정 호버 색(macOS 강조 파랑, 종료는 빨강). 배경은 옅게 물들이고 아이콘은 이 색으로 바뀐다.
    public static Color HoverAccent => IsLight ? Color.FromArgb(0, 122, 255) : Color.FromArgb(10, 132, 255);
    public static Color HoverDanger => IsLight ? Color.FromArgb(255, 59, 48) : Color.FromArgb(255, 69, 58);
    public static Color HoverTint(Color accent, float level) =>
        Color.FromArgb((int)Math.Round(Math.Clamp(level, 0, 1) * (IsLight ? 32 : 52)), accent);
    public static Color Knob => IsLight ? Color.White : Color.FromArgb(246, 246, 248);
    // 카메라 초록 · 마이크 주황(설정에서 흑백이면 글자 색)
    public static Color CameraDot => AppSettings.Current.MonochromePrivacy ? Primary : Color.FromArgb(52, 199, 89);
    public static Color MicrophoneDot => AppSettings.Current.MonochromePrivacy ? Primary : Color.FromArgb(255, 159, 10);
    public static Color Warning => IsLight ? Color.FromArgb(255, 149, 0) : Color.FromArgb(255, 159, 10);
    // 사용량 막대: 파랑(거의 찬 저장 공간은 빨강). 흑백이면 글자 색
    public static Color UsageFill(bool danger = false) =>
        AppSettings.Current.MonochromeUsage ? Primary : danger ? HoverDanger : HoverAccent;
    // 온도: 75°C 미만 파랑 · 75~90°C 주황 · 90°C 이상 빨강. 흑백이면 글자 색
    public static Color TemperatureColor(double celsius) =>
        AppSettings.Current.MonochromeTemperature ? Primary : celsius >= 90 ? HoverDanger : celsius >= 75 ? Warning : HoverAccent;

    public static GraphicsPath RoundedRectangle(Rectangle rectangle, int radius)
    {
        int diameter = Math.Max(1, Math.Min(radius * 2, Math.Min(rectangle.Width, rectangle.Height)));
        var path = new GraphicsPath();
        path.AddArc(rectangle.Left, rectangle.Top, diameter, diameter, 180, 90);
        path.AddArc(rectangle.Right - diameter, rectangle.Top, diameter, diameter, 270, 90);
        path.AddArc(rectangle.Right - diameter, rectangle.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rectangle.Left, rectangle.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    public static void DrawPopupBackground(Graphics graphics, Size size, int radius = 14, bool glass = false)
    {
        Rectangle body = new(0, 0, size.Width - 1, size.Height - 1);
        using GraphicsPath path = RoundedRectangle(body, radius);
        Color background = glass
            ? Color.FromArgb(IsLight ? 178 : 158, PopupBackground)
            : PopupBackground;
        using var fill = new SolidBrush(background);
        using var border = new Pen(PopupBorder);
        graphics.FillPath(fill, path);
        graphics.DrawPath(border, path);
        if (glass)
        {
            using var highlight = new Pen(Color.FromArgb(IsLight ? 150 : 48, Color.White));
            graphics.DrawArc(highlight, body.Left + 1, body.Top + 1, body.Width - 2, Math.Max(8, radius * 2), 190, 160);
        }
    }

    public static void ApplyRoundedRegion(Form form, int radius)
    {
        Region? previous = form.Region;
        using GraphicsPath path = RoundedRectangle(new Rectangle(0, 0, form.Width, form.Height), radius);
        form.Region = new Region(path);
        previous?.Dispose();
    }
}

// 반투명 배경 위에서도 글자가 보이도록 GDI+ 회색조 안티앨리어싱으로 글자를 그린다.
internal static class BarText
{
    private static readonly StringFormat Format = CreateFormat();

    private static StringFormat CreateFormat()
    {
        var format = (StringFormat)StringFormat.GenericTypographic.Clone();
        format.LineAlignment = StringAlignment.Center;
        format.FormatFlags |= StringFormatFlags.NoWrap | StringFormatFlags.MeasureTrailingSpaces;
        // 한글 글꼴은 줄 높이가 커서, 상자보다 줄이 조금만 커도 글자를 통째로 그리지 않는 LineLimit을 끈다.
        format.FormatFlags &= ~StringFormatFlags.LineLimit;
        format.Trimming = StringTrimming.EllipsisCharacter;
        return format;
    }

    public static float Measure(Graphics graphics, string text, Font font) =>
        graphics.MeasureString(text, font, PointF.Empty, Format).Width;

    public static void Draw(Graphics graphics, string text, Font font, Rectangle area, Color color, StringAlignment alignment) =>
        Draw(graphics, text, font, (RectangleF)area, color, alignment);

    public static void Draw(Graphics graphics, string text, Font font, RectangleF area, Color color, StringAlignment alignment)
    {
        System.Drawing.Text.TextRenderingHint previous = graphics.TextRenderingHint;
        graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        Format.Alignment = alignment;
        using var brush = new SolidBrush(color);
        graphics.DrawString(text, font, brush, area, Format);
        graphics.TextRenderingHint = previous;
    }
}

// Windows 10/11의 아크릴(흐림) 효과를 창 배경에 적용한다. 지원하지 않으면 false를 돌려준다.
internal static class BarBackdrop
{
    // moving: 창을 움직이는 동안에는 흐림 없이 반투명 색만 쓴다(아크릴은 움직일 때 매 프레임 다시 계산돼 끊긴다).
    public static bool Apply(IntPtr window, Color tint, int opacityPercent, bool moving = false)
    {
        try
        {
            // 0%는 흐림 없이 완전히 투명한 배경(움직이는 동안에도 그대로)
            bool clear = opacityPercent <= 0;
            int alpha = clear ? 0 : (int)Math.Round(Math.Clamp(moving ? Math.Max(opacityPercent, 80) : opacityPercent, 0, 100) * 2.55);
            var accent = new AccentPolicy
            {
                AccentState = moving || clear ? 2 : 4, // ACCENT_ENABLE_TRANSPARENTGRADIENT : ACCENT_ENABLE_ACRYLICBLURBEHIND
                AccentFlags = 2,
                GradientColor = (alpha << 24) | (tint.B << 16) | (tint.G << 8) | tint.R
            };
            int size = Marshal.SizeOf<AccentPolicy>();
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(accent, buffer, false);
                var data = new CompositionData { Attribute = 19, Data = buffer, Size = size }; // WCA_ACCENT_POLICY
                return SetWindowCompositionAttribute(window, ref data) != 0;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        catch (Exception) { return false; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AccentPolicy { public int AccentState, AccentFlags, GradientColor, AnimationId; }

    [StructLayout(LayoutKind.Sequential)]
    private struct CompositionData { public int Attribute; public IntPtr Data; public int Size; }

    [DllImport("user32.dll")] private static extern int SetWindowCompositionAttribute(IntPtr window, ref CompositionData data);
}

// 모달·메뉴·설정 창을 닫고 1.5초 뒤 한 번, 그리는 데 쓴 메모리를 Windows에 돌려준다(유휴 메모리 40MB 이하 유지).
// 연달아 닫으면 마지막에 한 번만 한다. UI 스레드에서만 부른다.
// 화면 새로 고침에 맞춘 애니메이션 박자. 움직이는 것이 있을 때만 별도 스레드가 Windows 화면 합성(DWM 프레임)을 기다렸다가
// UI 스레드에 한 번씩 알린다(15ms 타이머는 화면 주기와 어긋나 가끔 한 장면이 두 번 보이거나 건너뛰어 끊겨 보임).
// 앞 장면을 아직 그리는 중이면 다음 알림을 쌓지 않는다. 구독이 없으면 스레드가 끝나 유휴 CPU를 쓰지 않는다.
internal static class FrameClock
{
    private static readonly List<Action> subscribers = [];
    private static readonly object gate = new();
    private static SynchronizationContext? ui;
    private static Thread? thread;
    private static int posted;

    // UI 스레드에서만 부른다.
    public static void Add(Action tick)
    {
        ui ??= SynchronizationContext.Current;
        if (ui is null) return;
        lock (gate)
        {
            if (!subscribers.Contains(tick)) subscribers.Add(tick);
            if (thread is not null) return;
            thread = new Thread(Run) { IsBackground = true, Name = "WinBar frame clock", Priority = ThreadPriority.AboveNormal };
            thread.Start();
        }
    }

    public static void Remove(Action tick)
    {
        lock (gate) subscribers.Remove(tick);
    }

    // 지금 움직이는 애니메이션이 있는지
    public static bool Active
    {
        get { lock (gate) return subscribers.Count > 0; }
    }

    private static void Run()
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        double last = 0;
        while (true)
        {
            lock (gate)
            {
                if (subscribers.Count == 0) { thread = null; return; }
            }
            // 화면 합성을 기다린다. 실패하거나 너무 빨리 돌아오면(합성할 것이 없을 때) 잠깐 쉰다.
            int result;
            try { result = DwmFlush(); } catch (Exception) { result = -1; }
            double now = clock.Elapsed.TotalMilliseconds;
            if (result != 0 || now - last < 4) Thread.Sleep(6);
            last = clock.Elapsed.TotalMilliseconds;
            if (Interlocked.Exchange(ref posted, 1) == 1) continue;
            ui!.Post(_ =>
            {
                Volatile.Write(ref posted, 0);
                Action[] ticks;
                lock (gate) ticks = [.. subscribers];
                foreach (Action tick in ticks)
                {
                    try { tick(); } catch (Exception) { }
                }
            }, null);
        }
    }

    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
}

internal static class MemoryTrim
{
    private static System.Windows.Forms.Timer? timer;

    public static void Request()
    {
        if (timer is null)
        {
            timer = new System.Windows.Forms.Timer { Interval = 1500 };
            timer.Tick += (_, _) =>
            {
                // 애니메이션 중이거나 모달이 열려 있거나 마우스가 메뉴바 위에 있으면 미룬다
                // (정리 직후 다시 그릴 때 메모리를 되돌려 받느라 애니메이션이 0.1초 멈추는 것을 막음).
                if (Busy) return;
                timer.Stop();
                WinBarContext.TrimWorkingSet();
            };
        }
        timer.Stop();
        timer.Start();
    }

    public static bool Busy
    {
        get
        {
            if (FrameClock.Active) return true;
            Point cursor = Cursor.Position;
            foreach (Form form in Application.OpenForms)
            {
                if (form is GlassPanel { Visible: true }) return true;
                if (form is BarForm bar && bar.Visible && Rectangle.Inflate(bar.Bounds, 0, 12).Contains(cursor)) return true;
            }
            return false;
        }
    }
}

internal static class Topmost
{
    // 항상 위 창들 사이에서 WinBar 창을 맨 앞으로 올린다(활성화하지 않음).
    public static void Raise(Form form)
    {
        if (form.IsHandleCreated)
            SetWindowPos(form.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); // HWND_TOPMOST, NOSIZE|NOMOVE|NOACTIVATE
    }

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
}

// Windows 11의 Segoe Fluent Icons(macOS SF Symbols와 비슷한 선 아이콘)를 쓰고, 없으면 MDL2로 대체한다.
internal static class Icons
{
    public static readonly string Family = PickFamily();

    private static string PickFamily()
    {
        try
        {
            using var family = new FontFamily("Segoe Fluent Icons");
            return family.Name;
        }
        catch (ArgumentException) { return "Segoe MDL2 Assets"; }
    }

    public static Font Create(float size) => new(Family, size, FontStyle.Regular, GraphicsUnit.Point);

    private static readonly FontFamily IconFamily = new(Family);

    // 호버 애니메이션용: 아이콘을 칸 가운데를 기준으로 돌리거나(angle, 도) 키우고(scale) 옮겨(dx, dy) 그린다.
    public static void DrawMoved(Graphics graphics, string glyph, Rectangle area, Color color, float points,
        float angle = 0, float scale = 1, float dx = 0, float dy = 0)
    {
        GraphicsState state = graphics.Save();
        float centerX = area.Left + area.Width / 2f, centerY = area.Top + area.Height / 2f;
        graphics.TranslateTransform(centerX + dx, centerY + dy);
        if (angle != 0) graphics.RotateTransform(angle);
        if (scale != 1) graphics.ScaleTransform(scale, scale);
        graphics.TranslateTransform(-centerX, -centerY);
        DrawBold(graphics, glyph, area, color, points);
        graphics.Restore(state);
    }

    // 0→1 값을 천천히 출발해 천천히 멈추는 곡선으로 바꾼다.
    public static float Ease(float value) => value * value * (3 - 2 * value);

    // 모든 아이콘의 선 굵기 기준(화면 배율 100%에서 1.25px). 글꼴 아이콘·직접 그린 아이콘(Wi-Fi·배터리·제어 센터)이
    // 크기와 상관없이 같은 굵기로 보이게 한다.
    public static float Stroke(Graphics graphics) => 1.25f * graphics.DpiY / 96f;

    // macOS SF Symbols처럼 굵게 보이도록 글꼴 외곽선을 채운 뒤 테두리를 한 번 더 그린다.
    // 글꼴 아이콘의 원래 선 굵기는 글자 크기의 약 1/16이라, 모자란 만큼만 테두리로 채워 크기와 상관없이 기준 굵기에 맞춘다.
    public static void DrawBold(Graphics graphics, string glyph, Rectangle area, Color color, float points = 12)
    {
        float emPixels = graphics.DpiY * points / 72f;
        float outline = Math.Max(0.3f, Stroke(graphics) - emPixels / 16f);
        using var path = new GraphicsPath();
        path.AddString(glyph, IconFamily, 0, emPixels, PointF.Empty, StringFormat.GenericTypographic);
        RectangleF bounds = path.GetBounds();
        if (bounds.IsEmpty) return;
        using (var move = new Matrix())
        {
            move.Translate(area.Left + (area.Width - bounds.Width) / 2f - bounds.Left,
                area.Top + (area.Height - bounds.Height) / 2f - bounds.Top);
            path.Transform(move);
        }
        SmoothingMode previous = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var brush = new SolidBrush(color);
        using var pen = new Pen(color, outline) { LineJoin = LineJoin.Round };
        graphics.FillPath(brush, path);
        graphics.DrawPath(pen, path);
        graphics.SmoothingMode = previous;
    }

    // macOS 메뉴바 배터리: 둥근 테두리 + 잔량만큼 채움(잔량 구간별 색), 충전 중이면 번개.
    public static void DrawBattery(Graphics graphics, Rectangle area, byte? percent, bool charging, Color color, int? saverThreshold = null)
    {
        float scale = graphics.DpiY / 96f;
        float width = 23 * scale, height = 11.5f * scale;
        var body = new RectangleF(area.Left + (area.Width - width - 2.5f * scale) / 2f,
            area.Top + (area.Height - height) / 2f, width, height);
        SmoothingMode previous = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;

        using (var outline = new Pen(Color.FromArgb(170, color), Stroke(graphics)))
        using (GraphicsPath bodyPath = Rounded(body, 3.2f * scale))
            graphics.DrawPath(outline, bodyPath);
        using (var nub = new SolidBrush(Color.FromArgb(170, color)))
        using (GraphicsPath nubPath = Rounded(new RectangleF(body.Right + 1f * scale, body.Top + height * 0.32f, 1.6f * scale, height * 0.36f), 0.8f * scale))
            graphics.FillPath(nub, nubPath);

        float level = Math.Clamp((percent ?? 0) / 100f, 0, 1);
        var inner = RectangleF.Inflate(body, -2f * scale, -2f * scale);
        if (level > 0)
        {
            Color fillColor = Theme.BatteryLevel(percent ?? 0, saverThreshold);
            using var fill = new SolidBrush(fillColor);
            using GraphicsPath fillPath = Rounded(new RectangleF(inner.Left, inner.Top, Math.Max(inner.Width * level, 2f * scale), inner.Height), 1.6f * scale);
            graphics.FillPath(fill, fillPath);
        }
        if (charging)
        {
            float cx = body.Left + body.Width / 2f, cy = body.Top + body.Height / 2f, s = scale;
            PointF[] bolt =
            [
                new(cx + 1.2f * s, cy - 6.5f * s), new(cx - 3.6f * s, cy + 0.8f * s), new(cx - 0.2f * s, cy + 0.8f * s),
                new(cx - 1.2f * s, cy + 6.5f * s), new(cx + 3.6f * s, cy - 0.8f * s), new(cx + 0.2f * s, cy - 0.8f * s)
            ];
            using var boltFill = new SolidBrush(Theme.BarBackground);
            using var boltEdge = new Pen(color, 0.9f * s) { LineJoin = LineJoin.Round };
            graphics.FillPolygon(boltFill, bolt);
            graphics.DrawPolygon(boltEdge, bolt);
        }
        graphics.SmoothingMode = previous;
    }

    private static GraphicsPath Rounded(RectangleF rectangle, float radius)
    {
        float diameter = Math.Min(radius * 2, Math.Min(rectangle.Width, rectangle.Height));
        var path = new GraphicsPath();
        path.AddArc(rectangle.Left, rectangle.Top, diameter, diameter, 180, 90);
        path.AddArc(rectangle.Right - diameter, rectangle.Top, diameter, diameter, 270, 90);
        path.AddArc(rectangle.Right - diameter, rectangle.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rectangle.Left, rectangle.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    public const string Logo = "";
    public const string Cpu = "";
    public const string Brightness = "";
    public const string Bluetooth = "";
    public const string Ethernet = "";
    public const string Settings = "";
    public const string Chevron = "";
    public const string Power = "";
    public const string Close = "";

    public static string Volume(double? percent, bool muted) =>
        muted || percent is null or <= 0 ? ""
        : percent <= 33 ? ""
        : percent <= 66 ? "" : "";

    public static string Wifi(int? quality) => quality switch
    {
        null or >= 75 => "",
        >= 50 => "",
        >= 25 => "",
        _ => ""
    };
}

// 메뉴바의 달리는 고양이(macOS RunCat처럼). 그림 파일 없이 몸통·머리·귀·꼬리·다리를 직접 그린다.
// 4장면: 쭉 뻗기 → 착지 → 웅크리기 → 박차기. 설계는 가로 24 × 세로 18 칸 기준(오른쪽을 보고 달림).
internal static class RunCat
{
    public const int FrameCount = 4;

    // 장면마다 (뒷발 끝, 앞발 끝, 몸 위아래 흔들림)
    private static readonly (PointF Back, PointF Front, float Bob)[] Frames =
    [
        (new(2.6f, 15.4f), new(21.4f, 15.0f), -0.5f), // 쭉 뻗기
        (new(5.4f, 14.2f), new(18.0f, 15.6f), 0f),    // 착지
        (new(8.6f, 15.6f), new(14.2f, 15.6f), 0.6f),  // 웅크리기(다리를 몸 아래로 세움, 서로 겹치지 않게)
        (new(4.4f, 15.6f), new(20.0f, 13.4f), 0f)     // 박차기
    ];

    public static void Draw(Graphics graphics, Rectangle area, int frame, Color color)
    {
        (PointF back, PointF front, float bob) = Frames[Math.Clamp(frame, 0, FrameCount - 1)];
        float scale = Math.Min(graphics.DpiY / 96f, Math.Min(area.Width / 24f, area.Height / 18f));
        GraphicsState state = graphics.Save();
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.TranslateTransform(area.Left + (area.Width - 24 * scale) / 2f, area.Top + (area.Height - 18 * scale) / 2f);
        graphics.ScaleTransform(scale, scale);
        using var brush = new SolidBrush(color);
        // 다리·꼬리는 메뉴바 크기에서도 또렷하게 보이도록 굵게(다리 3.2, 꼬리 2.3칸)
        using var leg = new Pen(color, 3.2f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var tail = new Pen(color, 2.3f) { StartCap = LineCap.Round, EndCap = LineCap.Round };

        // 다리(몸 뒤에 먼저 그려 엉덩이·어깨에 붙어 보이게)
        graphics.DrawLine(leg, 7.6f, 10.8f + bob, back.X, back.Y);
        graphics.DrawLine(leg, 15.4f, 10.8f + bob, front.X, front.Y);
        // 꼬리: 엉덩이에서 위로 휘어 올라감
        graphics.DrawBezier(tail, new PointF(5.6f, 8.0f + bob), new PointF(2.6f, 7.6f + bob), new PointF(1.4f, 4.8f + bob), new PointF(2.6f, 2.4f + bob));
        // 몸통·머리·귀
        graphics.FillEllipse(brush, 4.8f, 6.2f + bob, 12.6f, 5.6f);
        graphics.FillEllipse(brush, 15.0f, 3.4f + bob, 6.4f, 5.8f);
        graphics.FillPolygon(brush, new PointF[] { new(15.6f, 4.8f + bob), new(16.2f, 1.2f + bob), new(18.2f, 3.6f + bob) });
        graphics.FillPolygon(brush, new PointF[] { new(18.4f, 3.5f + bob), new(20.6f, 1.4f + bob), new(21.2f, 5.0f + bob) });
        graphics.Restore(state);
    }
}

// 메뉴바의 타오르는 불꽃(도트 그래픽, 검정·회색·흰색만). 가로 12 × 세로 14칸.
// 모양: 아래는 둥근 공, 위로는 일렁이며 솟는 불꽃 혀, 그 끝에서 구슬 같은 불티가 떨어져 나와 위로 오르며 사라진다.
// 크기는 40단계: CPU 사용량에 맞는 단계로 한 장면에 한 단계씩 다가가 툭 바뀌지 않는다.
// 일렁임은 실제 시간 기준으로 움직여, 장면 수가 바뀌어도 속도가 고르다(바쁠수록 빨리 일렁임).
internal sealed class FlameIcon
{
    private const int Columns = 12, Rows = 14;
    public const int Levels = 40;
    private readonly float[] heat = new float[Columns * Rows];
    private readonly Random random = new();
    private readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
    private readonly List<(float X, float Y, float Life)> embers = [];
    private double phase, lastSeconds;

    public int Level { get; private set; } = 1;

    // CPU 사용량(0~100)에 맞는 단계(1~40)
    public static int LevelFor(double cpu) => 1 + (int)Math.Round(Math.Clamp(cpu, 0, 100) / 100 * (Levels - 1));

    // cpu: 0~100. steps: 한 장면에 움직일 수 있는 단계 수(바탕화면 불꽃은 클릭에 빨리 반응하도록 크게)
    public void Step(double cpu, int steps = 1)
    {
        int target = LevelFor(cpu);
        Level = Level < target ? Math.Min(target, Level + steps) : Math.Max(target, Level - steps);
        double size = Level / (double)Levels;

        double now = clock.Elapsed.TotalSeconds;
        double delta = Math.Min(0.2, now - lastSeconds);
        lastSeconds = now;
        phase += delta * (5 + 9 * size);

        // 불꽃 몸통: 칸마다 0~1 밝기. 아래 둥근 공 + 위로 좁아지며 흔들리는 혀
        float radius = (float)(1.4 + 3.6 * size);                       // 아래 공 반지름 1.4~5칸
        float centerX = (Columns - 1) / 2f, centerY = Rows - 0.7f - radius;
        float tongue = (float)((1.2 + 6.5 * size) * (0.85 + 0.15 * Math.Sin(phase * 1.7)));
        float top = Math.Max(0.3f, centerY - radius * 0.6f - tongue);
        for (int y = 0; y < Rows; y++)
        {
            for (int x = 0; x < Columns; x++)
            {
                float px = x + 0.5f - 0.5f, py = y + 0.5f;
                float distance;
                if (py >= centerY)
                    distance = MathF.Sqrt((px - centerX) * (px - centerX) + (py - centerY) * (py - centerY)) / radius;
                else
                {
                    float t = (centerY - py) / Math.Max(0.5f, centerY - top);   // 0: 공 가운데 높이, 1: 혀 끝
                    if (t > 1) { heat[y * Columns + x] = 0; continue; }
                    float sway = (float)(Math.Sin(phase + t * 3.2) * 0.8 * size * t);       // 위로 갈수록 크게 흔들림
                    float half = radius * MathF.Pow(1 - t, 0.85f) * (float)(1 + 0.14 * Math.Sin(phase * 2.3 + t * 5));
                    distance = Math.Max(MathF.Abs(px - (centerX + sway)) / Math.Max(0.35f, half), MathF.Pow(t, 1.6f));
                }
                heat[y * Columns + x] = Math.Max(0, 1 - distance);
            }
        }

        // 구슬 같은 불티: 혀 끝 근처에서 생겨 위로 오르며 옅어진다(바쁠수록 자주·빨리).
        for (int index = embers.Count - 1; index >= 0; index--)
        {
            (float ex, float ey, float life) = embers[index];
            ey -= (float)(delta * (5 + 6 * size));
            ex += (float)((random.NextDouble() - 0.5) * 0.5);
            life -= (float)(delta * 1.8);
            if (life <= 0 || ey < 0) embers.RemoveAt(index);
            else embers[index] = (ex, ey, life);
        }
        if (embers.Count < 4 && random.NextDouble() < delta * (1.2 + 4 * size))
            embers.Add((centerX + (float)((random.NextDouble() - 0.5) * 2 * size), top + 0.8f, 1f));
    }

    // 정수 픽셀 크기의 네모 도트로 또렷하게 찍는다. 밝기 → 테두리(검정, 다크 모드는 회색) · 회색 두 단계 · 흰 심지
    public void Draw(Graphics graphics, Rectangle area)
    {
        Color[] shades = Theme.IsLight
            ? [Color.FromArgb(30, 30, 32), Color.FromArgb(95, 95, 100), Color.FromArgb(170, 170, 175), Color.White]
            : [Color.FromArgb(130, 130, 136), Color.FromArgb(180, 180, 186), Color.FromArgb(225, 225, 230), Color.White];
        int dot = Math.Max(1, (int)Math.Floor(Math.Min(area.Width / (float)Columns, area.Height / (float)Rows)));
        int left = area.Left + (area.Width - dot * Columns) / 2;
        int top = area.Top + (area.Height - dot * Rows) / 2;
        SmoothingMode previous = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.None;
        using var outer = new SolidBrush(shades[0]);
        using var mid = new SolidBrush(shades[1]);
        using var inner = new SolidBrush(shades[2]);
        using var core = new SolidBrush(shades[3]);
        for (int y = 0; y < Rows; y++)
            for (int x = 0; x < Columns; x++)
            {
                float value = heat[y * Columns + x];
                if (value <= 0) continue;
                Brush brush = value > 0.72f ? core : value > 0.48f ? inner : value > 0.25f ? mid : outer;
                graphics.FillRectangle(brush, left + x * dot, top + y * dot, dot, dot);
            }
        foreach ((float ex, float ey, float life) in embers)
        {
            int cellX = (int)Math.Round(ex), cellY = (int)Math.Round(ey);
            if (cellX < 0 || cellX >= Columns || cellY < 0 || cellY >= Rows) continue;
            graphics.FillRectangle(life > 0.55f ? mid : outer, left + cellX * dot, top + cellY * dot, dot, dot);
        }
        graphics.SmoothingMode = previous;
    }
}

// 바탕화면 불꽃(재미 요소): 메뉴바 불꽃을 끌어 바탕화면에 놓으면 생기는 60×60 이하의 작은 불꽃.
// 좌클릭할 때마다 땔감을 넣어 크고 빠르게 타오르고(연타하면 활활), 시간이 지나면 천천히 작은 불꽃으로 돌아간다.
// 좌클릭 후 끌면 옮기고, 우클릭하면 꺼진다. 배경은 투명(도트만 보임)하고 작업 표시줄·Alt+Tab에 나오지 않으며 포커스를 가져가지 않는다.
internal sealed class DesktopFlame : Form
{
    private const int MaxFlames = 5, FlameSize = 60;
    private static readonly List<DesktopFlame> flames = [];
    private static readonly Color Key = Color.FromArgb(255, 0, 255); // 투명하게 뺄 색(불꽃 색과 겹치지 않음)
    private readonly FlameIcon flame = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 80 };
    private readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
    private double fuel;      // 클릭으로 넣은 땔감 0~100(시간이 지나면 줄어듦)
    private double lastSeconds, lastRaise;
    private Point pressAt, startLocation;
    private bool pressed, moved;

    // 화면 좌표 center에 새 불꽃을 만든다. 이미 5개면 만들지 않는다.
    public static DesktopFlame? Spawn(Point center)
    {
        if (flames.Count >= MaxFlames) return null;
        var created = new DesktopFlame();
        created.MoveCenter(center);
        flames.Add(created);
        created.Show();
        return created;
    }

    public static void CloseAll()
    {
        foreach (DesktopFlame item in flames.ToArray()) item.Close();
    }

    // 전체 화면 앱(게임·동영상)이 켜진 모니터에서는 앱을 가리지 않도록 잠시 숨기고, 끝나면 다시 보인다(완료 기준 7).
    public static void SetFullscreen(Rectangle monitor, bool fullscreen)
    {
        foreach (DesktopFlame item in flames)
        {
            Point center = new(item.Left + FlameSize / 2, item.Top + FlameSize / 2);
            if (!monitor.Contains(center) || item.pressed) continue;
            if (fullscreen && item.Visible) item.Hide();
            else if (!fullscreen && !item.Visible) { item.Show(); Topmost.Raise(item); }
        }
    }

    private DesktopFlame()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(FlameSize, FlameSize);
        BackColor = Key;
        TransparencyKey = Key;
        DoubleBuffered = true;
        Cursor = Cursors.Hand;
        // 다른 모든 창보다 위(항상 위). 다른 항상 위 창이 덮어도 1초마다 다시 맨 앞으로 올린다(Burn).
        TopMost = true;
        timer.Tick += (_, _) => Burn();
        timer.Start();
        FormClosed += (_, _) =>
        {
            flames.Remove(this);
            timer.Dispose();
            MemoryTrim.Request();
        };
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            const int WsExToolWindow = 0x80, WsExNoActivate = 0x08000000;
            CreateParams value = base.CreateParams;
            value.ExStyle |= WsExToolWindow | WsExNoActivate;
            return value;
        }
    }

    public void MoveCenter(Point center) => Location = new Point(center.X - FlameSize / 2, center.Y - FlameSize / 2);

    // 땔감이 많을수록 크고(40단계 중 위쪽) 빠르게(초당 10~25장면) 탄다. 땔감은 초당 12씩 줄어든다.
    private void Burn()
    {
        double now = clock.Elapsed.TotalSeconds;
        fuel = Math.Max(0, fuel - (now - lastSeconds) * 12);
        lastSeconds = now;
        double intensity = 15 + fuel * 0.85;
        flame.Step(intensity, steps: 3);
        if (Visible && now - lastRaise >= 1)
        {
            lastRaise = now;
            Topmost.Raise(this);
        }
        timer.Interval = (int)Math.Round(1000 / (10 + intensity / 100 * 15));
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Key);
        flame.Draw(e.Graphics, ClientRectangle);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        pressed = true;
        moved = false;
        pressAt = Cursor.Position;
        startLocation = Location;
        Capture = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!pressed) return;
        Point now = Cursor.Position;
        if (!moved && Math.Abs(now.X - pressAt.X) + Math.Abs(now.Y - pressAt.Y) < 5) return;
        moved = true;
        Location = new Point(startLocation.X + now.X - pressAt.X, startLocation.Y + now.Y - pressAt.Y);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button == MouseButtons.Right) { Close(); return; }
        if (e.Button != MouseButtons.Left || !pressed) return;
        pressed = false;
        Capture = false;
        if (!moved) fuel = Math.Min(100, fuel + 14); // 땔감 넣기(연타하면 활활)
    }
}

// 지금 재생 중 로고: 브라우저에서 YouTube를 재생 중이면 YouTube 로고(빨간 둥근 사각형 + 흰 재생 삼각형),
// 아니면 Windows가 준 앱 아이콘(Spotify 등), 아이콘이 없으면 음표.
internal static class MediaLogo
{
    // 그린 로고를 앱·크기·색 설정별로 기억해 두고 붙이기만 한다(애니메이션 중 매 장면 아이콘 확대·흑백 변환을 하지 않음).
    private static readonly Dictionary<(string Id, bool YouTube, int Icon, bool Mono, bool Light, int Width, int Height, int Fallback), Bitmap> cache = [];

    // opacity: 1보다 작으면 흐리게(선택되지 않은 로고)
    public static void Draw(Graphics graphics, Rectangle area, NowPlayingInfo media, Color fallback, float opacity = 1)
    {
        if (area.Width <= 0 || area.Height <= 0) return;
        bool mono = AppSettings.Current.MonochromeLogos;
        var key = (media.Id, media.YouTube, media.Icon is null ? 0 : System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(media.Icon),
            mono, Theme.IsLight, area.Width, area.Height, fallback.ToArgb());
        if (!cache.TryGetValue(key, out Bitmap? image))
        {
            if (cache.Count > 12)
            {
                foreach (Bitmap old in cache.Values) old.Dispose();
                cache.Clear();
            }
            image = Render(area.Size, media, fallback, mono);
            cache[key] = image;
        }
        if (opacity >= 1) { graphics.DrawImage(image, area); return; }
        using var attributes = new System.Drawing.Imaging.ImageAttributes();
        attributes.SetColorMatrix(new System.Drawing.Imaging.ColorMatrix { Matrix33 = Math.Clamp(opacity, 0, 1) });
        graphics.DrawImage(image, area, 0, 0, area.Width, area.Height, GraphicsUnit.Pixel, attributes);
    }

    // 설정에서 흑백을 고르면 같은 로고를 회색조로 그린다(다크 모드에서는 어두운 배경에서 보이게 조금 밝게).
    private static Bitmap Render(Size size, NowPlayingInfo media, Color fallback, bool mono)
    {
        var color = new Bitmap(size.Width, size.Height, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
        using (Graphics inner = Graphics.FromImage(color)) DrawColor(inner, new Rectangle(Point.Empty, size), media, fallback);
        if (!mono) return color;
        var gray = new Bitmap(size.Width, size.Height, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
        using (Graphics inner = Graphics.FromImage(gray))
        using (System.Drawing.Imaging.ImageAttributes attributes = Grayscale())
            inner.DrawImage(color, new Rectangle(Point.Empty, size), 0, 0, size.Width, size.Height, GraphicsUnit.Pixel, attributes);
        color.Dispose();
        return gray;
    }

    private static System.Drawing.Imaging.ImageAttributes Grayscale()
    {
        float scale = Theme.IsLight ? 1f : 0.8f, lift = Theme.IsLight ? 0f : 0.24f;
        float r = 0.299f * scale, g = 0.587f * scale, b = 0.114f * scale;
        var attributes = new System.Drawing.Imaging.ImageAttributes();
        attributes.SetColorMatrix(new System.Drawing.Imaging.ColorMatrix(
        [
            [r, r, r, 0, 0],
            [g, g, g, 0, 0],
            [b, b, b, 0, 0],
            [0, 0, 0, 1, 0],
            [lift, lift, lift, 0, 1]
        ]));
        return attributes;
    }

    private static void DrawColor(Graphics graphics, Rectangle area, NowPlayingInfo media, Color fallback)
    {
        GraphicsState state = graphics.Save();
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        if (media.YouTube)
        {
            var body = new RectangleF(area.Left, area.Top + area.Height * 0.16f, area.Width, area.Height * 0.68f);
            using (GraphicsPath path = Theme.RoundedRectangle(Rectangle.Round(body), (int)Math.Round(body.Height * 0.3f)))
            using (var red = new SolidBrush(Color.FromArgb(255, 0, 51)))
                graphics.FillPath(red, path);
            float cx = body.Left + body.Width / 2f, cy = body.Top + body.Height / 2f, s = body.Height * 0.28f;
            using var white = new SolidBrush(Color.White);
            graphics.FillPolygon(white, new PointF[] { new(cx - s * 0.8f, cy - s), new(cx - s * 0.8f, cy + s), new(cx + s * 1.1f, cy) });
        }
        else if (media.Icon is Bitmap icon)
        {
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(icon, area);
        }
        else Icons.DrawBold(graphics, "\uE8D6", area, fallback, 9);
        graphics.Restore(state);
    }
}

internal sealed class WinBarContext : ApplicationContext
{    private const uint EventSystemForeground = 0x0003;
    private const uint EventSystemMoveSizeStart = 0x000A;
    private const uint EventSystemMoveSizeEnd = 0x000B;
    private const uint EventObjectImeShow = 0x8027;
    private const uint EventObjectImeChange = 0x8029;
    private const uint WinEventOutOfContext = 0x0000;
    private const uint WinEventSkipOwnProcess = 0x0002;

    private readonly List<BarForm> bars = [];
    private readonly SystemMetrics metrics = new();
    private readonly StatusSensors sensors = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 2000 };
    private readonly System.Windows.Forms.Timer fullscreenTimer = new() { Interval = 200 };
    // 한/영 키·클릭 직후에만 잠깐 입력 상태를 확인한다(30ms 간격으로 최대 4번). 평소에는 멈춰 있다.
    private readonly System.Windows.Forms.Timer inputBurstTimer = new() { Interval = 30 };
    private int inputBurstRemaining;
    private SystemEventWatcher? watcher;
    private readonly SynchronizationContext? uiContext;
    private readonly WinEventDelegate? winEventCallback;
    private readonly List<IntPtr> winEventHooks = [];
    private int tickCount;
    private int controlsPending;
    private int statusPending;
    private SystemSnapshot latestSnapshot = new();
    private StatusSnapshot latestStatus = new();

    public WinBarContext()
    {
        CreateBars();
        if (bars.Count == 0) { ExitThread(); return; }
        uiContext = SynchronizationContext.Current;

        UpdateBars();
        RefreshStatusNow(includeBluetooth: true);
        timer.Tick += (_, _) => OnTick();
        timer.Start();
        metrics.ControlsChanged += OnControlsChanged;
        metrics.AudioDevicesChanged += OnAudioDevicesChanged;
        metrics.PowerModeChanged += OnPowerModeChanged;
        sensors.Changed += OnStatusChanged;
        // 지금 재생 중: Windows가 곡·재생 상태 변화를 알려 줄 때만 메뉴바를 다시 그린다.
        NowPlaying.Changed += OnNowPlayingChanged;
        NowPlaying.Start();
        AppSettings.Current.Changed += OnSettingsChanged;
        fullscreenTimer.Tick += (_, _) => UpdateFullscreenState();
        fullscreenTimer.Start();

        // 한/영 전환은 Windows 이벤트가 오지 않을 수 있어, 한/영 키·마우스 클릭을 감지한 직후에만 확인한다.
        // 충전기 연결·분리는 Windows 전원 알림을 받는 즉시 배터리를 다시 읽는다.
        inputBurstTimer.Tick += (_, _) =>
        {
            RefreshInputSource();
            if (--inputBurstRemaining <= 0) inputBurstTimer.Stop();
        };
        try
        {
            watcher = new SystemEventWatcher();
            watcher.InputToggleKey += hangulKey =>
            {
                // 한/영 키를 누른 순간을 기록해, 메모장처럼 Windows 값이 바뀌지 않는 앱도 따라갈 수 있게 한다.
                if (hangulKey) sensors.NoteInputToggle();
                StartInputBurst(5);
            };
            watcher.MouseButtonDown += OnMouseButtonDown;
            watcher.EscapePressed += () => { foreach (BarForm bar in bars) bar.CloseMenus(); SettingsForm.CloseIfOpen(); };
            watcher.PowerChanged += UpdateBars;
        }
        catch (Exception) { watcher = null; }
        winEventCallback = OnWinEvent;
        const uint flags = WinEventOutOfContext | WinEventSkipOwnProcess;
        winEventHooks.Add(SetWinEventHook(EventSystemForeground, EventSystemForeground, IntPtr.Zero, winEventCallback, 0, 0, flags));
        winEventHooks.Add(SetWinEventHook(EventSystemMoveSizeStart, EventSystemMoveSizeEnd, IntPtr.Zero, winEventCallback, 0, 0, flags));
        winEventHooks.Add(SetWinEventHook(EventObjectImeShow, EventObjectImeChange, IntPtr.Zero, winEventCallback, 0, 0, flags));

        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
    }

    private void CreateBars()
    {
        foreach (Screen screen in Screen.AllScreens)
        {
            var bar = new BarForm(screen, metrics, sensors, ExitThread, ToggleInputSource);
            bars.Add(bar);
            bar.Show();
        }
    }

    private void OnTick()
    {
        UpdateBars();
        // Bluetooth 연결 기기는 10초마다만 확인한다.
        RefreshStatus(includeBluetooth: tickCount % 5 == 0);
        // 시작 직후 한 번만 쓰인 DLL·초기화 페이지와 GC가 늘려 둔 빈 공간을 작업 집합에서 내보낸다(1분마다).
        // 메뉴바를 쓰는 중(애니메이션·모달·마우스가 위)이면 다음 주기로 미룬다.
        if (tickCount++ % 30 == 0) trimDue = true;
        if (trimDue && !MemoryTrim.Busy) { trimDue = false; TrimWorkingSet(); }
    }

    internal static void TrimWorkingSet()
    {
        try
        {
            GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true);
            SetProcessWorkingSetSize(GetCurrentProcess(), -1, -1);
        }
        catch (Exception) { }
    }

    private void UpdateBars()
    {
        try { latestSnapshot = metrics.Sample(); } catch (Exception) { }
        foreach (BarForm bar in bars) bar.UpdateSnapshot(latestSnapshot);
    }

    private bool trimDue;
    private int statusRunning, statusAgain, statusAgainBluetooth;

    // 연결 상태(Wi-Fi·Bluetooth·입력 소스 등)는 읽는 데 20~30ms가 걸려, UI 스레드에서 읽으면 2초마다 애니메이션이 한 장면 멈춘다.
    // 백그라운드에서 읽고 결과만 UI 스레드로 넘긴다. 읽는 중에 또 요청이 오면 끝난 뒤 한 번 더 읽는다.
    private void RefreshStatus(bool includeBluetooth)
    {
        if (uiContext is not SynchronizationContext context) { RefreshStatusNow(includeBluetooth); return; }
        if (Interlocked.Exchange(ref statusRunning, 1) == 1)
        {
            Volatile.Write(ref statusAgain, 1);
            if (includeBluetooth) Volatile.Write(ref statusAgainBluetooth, 1);
            return;
        }
        ThreadPool.QueueUserWorkItem(_ =>
        {
            StatusSnapshot? next = null;
            try { next = sensors.Sample(includeBluetooth); } catch (Exception) { }
            context.Post(_ =>
            {
                if (next is not null) latestStatus = next;
                foreach (BarForm bar in bars) bar.UpdateStatus(latestStatus);
                Volatile.Write(ref statusRunning, 0);
                if (Interlocked.Exchange(ref statusAgain, 0) == 1)
                    RefreshStatus(Interlocked.Exchange(ref statusAgainBluetooth, 0) == 1);
            }, null);
        });
    }

    // 시작할 때 처음 한 번은 바로 읽는다(메뉴바가 빈 값으로 뜨지 않게).
    private void RefreshStatusNow(bool includeBluetooth)
    {
        try { latestStatus = sensors.Sample(includeBluetooth); } catch (Exception) { }
        foreach (BarForm bar in bars) bar.UpdateStatus(latestStatus);
    }

    // 음량·밝기 변경 알림(백그라운드 스레드)을 UI 스레드로 넘긴다. 연속 알림은 한 번으로 묶는다.
    private void OnControlsChanged()
    {
        if (uiContext is null || Interlocked.Exchange(ref controlsPending, 1) == 1) return;
        uiContext.Post(_ =>
        {
            Volatile.Write(ref controlsPending, 0);
            latestSnapshot = metrics.ApplyControls(latestSnapshot);
            foreach (BarForm bar in bars) bar.UpdateSnapshot(latestSnapshot);
        }, null);
    }

    // 기본 출력 장치 변경(블루투스 헤드폰 연결 등)·장치 추가/제거: 새 장치의 음량에 다시 연결한다.
    private int audioPending;

    private void OnAudioDevicesChanged()
    {
        if (uiContext is null || Interlocked.Exchange(ref audioPending, 1) == 1) return;
        uiContext.Post(_ =>
        {
            Volatile.Write(ref audioPending, 0);
            metrics.RebindAudio();
            latestSnapshot = metrics.ApplyControls(latestSnapshot);
            foreach (BarForm bar in bars)
            {
                bar.UpdateSnapshot(latestSnapshot);
                bar.RefreshOutputs();
            }
        }, null);
    }

    private void OnPowerModeChanged() => uiContext?.Post(_ => UpdateBars(), null);

    private void OnStatusChanged()
    {
        if (uiContext is null || Interlocked.Exchange(ref statusPending, 1) == 1) return;
        uiContext.Post(_ =>
        {
            Volatile.Write(ref statusPending, 0);
            RefreshStatus(includeBluetooth: false);
        }, null);
    }

    // 곡이 바뀌면 앨범 그림을 푸느라 잠깐 늘어난 메모리를 1.5초 뒤 돌려준다(메모리 40MB 이하 유지).
    // 보이는 내용이 바뀔 때만 불린다(재생 위치만 바뀐 경우는 오지 않음). 앨범 그림이 바뀐 경우에만 메모리를 정리한다.
    private void OnNowPlayingChanged(bool artChanged) =>
        uiContext?.Post(_ =>
        {
            foreach (BarForm bar in bars) bar.OnNowPlayingChanged();
            if (artChanged) MemoryTrim.Request();
        }, null);

    private void OnSettingsChanged()
    {
        foreach (BarForm bar in bars) bar.ApplyAppearance();
    }

    private void OnWinEvent(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint thread, uint time)
    {
        // 창을 끄는 동안에만 50ms 간격으로 위치를 확인해 메뉴바를 덮는 순간 바로 숨긴다. 평소에는 200ms.
        if (eventType is EventSystemMoveSizeStart or EventSystemMoveSizeEnd)
        {
            fullscreenTimer.Interval = eventType == EventSystemMoveSizeStart ? 50 : 200;
            UpdateFullscreenState();
            return;
        }
        if (eventType == EventSystemForeground) UpdateFullscreenState();
        RefreshInputSource();
    }

    private void StartInputBurst(int checks)
    {
        inputBurstRemaining = Math.Max(inputBurstRemaining, checks);
        inputBurstTimer.Stop();
        inputBurstTimer.Start();
    }

    // 다른 곳을 누르면 열린 메뉴·팝업을 닫고, 작업 표시줄의 한/영 단추일 수 있으니 입력 상태를 다시 확인한다.
    private void OnMouseButtonDown(Point point)
    {
        bool insideWinBar = false;
        foreach (BarForm bar in bars)
            insideWinBar |= bar.ContainsScreenPoint(point);
        if (insideWinBar || SettingsForm.ContainsScreenPoint(point)) return;
        foreach (BarForm bar in bars) bar.CloseMenus();
        StartInputBurst(5);
    }

    // WinBar의 한/영 스위치를 누르면 사용 중인 앱에 한/영 키를 보내 실제로 전환한다.
    public void ToggleInputSource()
    {
        // 보낸 한/영 키도 SystemEventWatcher가 감지해 기록한다. 감지기를 못 만든 경우에만 여기서 기록한다.
        if (watcher is null) sensors.NoteInputToggle();
        SystemEventWatcher.SendInputToggle();
        StartInputBurst(5);
    }

    private void RefreshInputSource()
    {
        StatusSnapshot next = sensors.WithInput(latestStatus);
        if (next == latestStatus) return;
        latestStatus = next;
        foreach (BarForm bar in bars) bar.UpdateStatus(latestStatus);
    }

    // 모니터를 연결하거나 빼면 메뉴바를 모니터 구성에 맞게 다시 만든다.
    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        uiContext?.Post(_ =>
        {
            foreach (BarForm bar in bars) bar.Dispose();
            bars.Clear();
            CreateBars();
            foreach (BarForm bar in bars)
            {
                bar.UpdateSnapshot(latestSnapshot);
                bar.UpdateStatus(latestStatus);
            }
        }, null);
    }

    private void UpdateFullscreenState()
    {
        IntPtr foreground = GetForegroundWindow();
        Rectangle? fullscreenBounds = null;
        Rectangle? coveringBounds = null;
        if (foreground != IntPtr.Zero && !IsShellWindow(foreground) && !IsIconic(foreground)
            && GetWindowRect(foreground, out NativeRect window))
        {
            Rectangle windowBounds = Rectangle.FromLTRB(window.Left, window.Top, window.Right, window.Bottom);
            // 보이는 테두리 기준 위치(Windows 10/11 창의 투명한 크기 조절 여백 제외)
            if (DwmGetWindowAttribute(foreground, 9, out NativeRect frame, Marshal.SizeOf<NativeRect>()) == 0)
                coveringBounds = Rectangle.FromLTRB(frame.Left, frame.Top, frame.Right, frame.Bottom);
            else
                coveringBounds = windowBounds;
            Rectangle monitor = Screen.FromHandle(foreground).Bounds;
            // 창이 모니터 전체를 덮거나 최대화 상태이면 전체 화면으로 본다.
            // 최대화 창은 앱바 작업 영역 아래에서 시작하므로 좌표 비교만으로는 감지할 수 없다.
            const int tolerance = 2;
            bool coversMonitor = windowBounds.Left <= monitor.Left + tolerance
                && windowBounds.Top <= monitor.Top + tolerance
                && windowBounds.Right >= monitor.Right - tolerance
                && windowBounds.Bottom >= monitor.Bottom - tolerance;
            if (coversMonitor || IsZoomed(foreground))
                fullscreenBounds = monitor;
        }

        GetWindowThreadProcessId(foreground, out uint foregroundOwner);
        bool ownForeground = foregroundOwner == (uint)Environment.ProcessId;
        bool hasCursor = GetCursorPos(out NativePoint cursor);
        foreach (BarForm bar in bars)
        {
            // macOS처럼 전체 화면에서는 메뉴바가 위로 숨고, 마우스를 화면 맨 위에 대면 다시 내려온다.
            // 직접 계산한 결과와 Windows의 전체 화면 알림 중 하나라도 전체 화면이면 숨긴다.
            Rectangle monitor = bar.MonitorBounds;
            bool pointerAtTop = hasCursor && cursor.X >= monitor.Left && cursor.X < monitor.Right
                && cursor.Y >= monitor.Top && cursor.Y <= monitor.Top + (bar.IsShown ? bar.Height : 1);
            bool fullscreen = fullscreenBounds == monitor;
            // 사용자가 창을 위로 끌어 메뉴바 자리에 닿게 하면 메뉴바가 위로 숨고, 창을 내리면 다시 나온다.
            bool covered = !fullscreen && coveringBounds is Rectangle cover && cover.IntersectsWith(bar.VisibleArea);
            bar.SetFullscreen(fullscreen, covered, pointerAtTop);
            DesktopFlame.SetFullscreen(monitor, fullscreen);
        }

        // 다른 앱의 항상 위 창이 메뉴바나 WinBar 메뉴·팝업을 덮고 있으면,
        // 마우스가 그 위에 왔을 때만 해당 창을 다시 맨 앞으로 올려 클릭이 닿게 한다.
        if (!hasCursor) return;
        GetWindowThreadProcessId(GetAncestor(WindowFromPoint(cursor), 2), out uint owner);
        if (owner == (uint)Environment.ProcessId) return;
        foreach (BarForm bar in bars)
            if (bar.RaiseWindowAt(new Point(cursor.X, cursor.Y))) break;
    }

    // 바탕 화면·작업 표시줄과 WinBar 자신의 창(설정 모달 배경 등)은 전체 화면 앱으로 보지 않는다.
    private static bool IsShellWindow(IntPtr window)
    {
        GetWindowThreadProcessId(window, out uint processId);
        if (processId == (uint)Environment.ProcessId) return true;
        var name = new StringBuilder(64);
        if (GetClassName(window, name, name.Capacity) == 0) return false;
        string value = name.ToString();
        return value is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd";
    }

    protected override void ExitThreadCore()
    {
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        foreach (IntPtr hook in winEventHooks)
            if (hook != IntPtr.Zero) UnhookWinEvent(hook);
        metrics.ControlsChanged -= OnControlsChanged;
        metrics.AudioDevicesChanged -= OnAudioDevicesChanged;
        metrics.PowerModeChanged -= OnPowerModeChanged;
        sensors.Changed -= OnStatusChanged;
        NowPlaying.Changed -= OnNowPlayingChanged;
        NowPlaying.Stop();
        DesktopFlame.CloseAll();
        AppSettings.Current.Changed -= OnSettingsChanged;
        timer.Dispose();
        fullscreenTimer.Dispose();
        inputBurstTimer.Dispose();
        watcher?.Dispose();
        foreach (BarForm bar in bars) bar.Dispose();
        metrics.Dispose();
        sensors.Dispose();
        base.ExitThreadCore();
    }

    private delegate void WinEventDelegate(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint thread, uint time);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X, Y; }

    [DllImport("user32.dll")] private static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(NativePoint point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetProcessWorkingSetSize(IntPtr process, nint minimum, nint maximum);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr window, out NativeRect rectangle);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out NativeRect value, int size);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventDelegate callback, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
}

internal sealed class BarForm : Form
{
    // 오른쪽에서부터: 날짜시간 · 제어 센터(스위치) · 소리 · 네트워크 · 배터리 · … · 카메라/마이크
    private enum Item { None, Privacy, Cat, Media, More, Battery, Network, Sound, Control, Clock }

    private const int BarHeight = 30;

    private readonly SystemMetrics metrics;
    private readonly Screen screen;
    private SystemSnapshot snapshot = new();
    private StatusSnapshot status = new();
    private readonly Font font = new("Segoe UI Semibold", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    // 메뉴바 가운데 '지금 재생 중' 글자
    private readonly Font mediaFont = new("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
    // 배터리를 한 번이라도 읽었으면 칸을 유지해, 잠깐 못 읽어도 다른 아이콘이 밀리지 않게 한다.
    private bool batterySeen;
    private (bool Light, int Tint)? appliedAppearance;
    private readonly GlassPanel panel;
    private readonly LogoMenuPopup logoMenu;
    private readonly Dictionary<Item, Rectangle> areas = [];
    private Rectangle logoArea;
    private Item hoverItem;
    private Item panelItem;
    private bool logoHovered;
    private bool appBarRegistered;
    private bool translucent;
    private bool reservePending;
    private bool reserveAfterSlide;
    private bool fullscreenActive;
    private bool edgeRevealArmed;
    private Rectangle reservedBounds;
    // 숨김·표시 애니메이션: 화면 갱신(DWM 프레임)에 맞춰 별도 스레드에서 창을 옮긴다.
    private const int SlideDurationMilliseconds = 240;
    private int slideVersion;
    private bool sliding;
    private int visibleTop;
    private int hiddenTop;
    private int targetTop;
    // 초 단위 시계: 1초마다 시계 부분만 다시 그린다(센서를 다시 읽지 않음).
    private readonly System.Windows.Forms.Timer clockTimer = new() { Interval = 1000 };
    // Wi-Fi 연결 중일 때만 아이콘을 깜빡인다.
    private readonly System.Windows.Forms.Timer blinkTimer = new() { Interval = 450 };
    // 달리는 고양이(RunCat): CPU 사용량이 높을수록 장면을 빨리 넘긴다(초당 2~15장면). 고양이 칸만 다시 그린다.
    private readonly System.Windows.Forms.Timer catTimer = new() { Interval = 500 };
    private int catFrame;
    private readonly FlameIcon flame = new();
    private bool blinkOn = true;
    // 마우스로만 연 모달은 마우스가 항목과 모달을 모두 벗어나면 닫는다(모달이 열린 동안만 동작).
    // 30ms마다 확인하고 벗어난 지 120ms가 지나면 닫는다 → 마우스를 떼고 늦어도 150ms 안에 닫힘(170ms 기준). 항목과 모달 사이 틈을 지나는 동안은 닫지 않는다.
    private readonly System.Windows.Forms.Timer panelWatchTimer = new() { Interval = 30 };
    private long panelLeftAt;
    // 다른 앱이 항상 위 창을 계속 다시 올려도, WinBar 메뉴·모달이 열려 있는 동안에는 그 위에 머물게 한다.
    private readonly System.Windows.Forms.Timer keepOnTopTimer = new() { Interval = 150 };

    public Rectangle MonitorBounds { get; }

    public BarForm(Screen screen, SystemMetrics metrics, StatusSensors sensors, Action requestExit, Action toggleInput)
    {
        this.screen = screen;
        this.metrics = metrics;
        panel = new GlassPanel(metrics, sensors, toggleInput);
        panel.VisibleChanged += (_, _) =>
        {
            if (!panel.Visible) panelItem = Item.None;
            StartMediaAnimation();
            UpdateKeepOnTop();
            Invalidate();
        };
        logoMenu = new LogoMenuPopup(screen, requestExit);
        logoMenu.VisibleChanged += (_, _) =>
        {
            UpdateKeepOnTop();
            Invalidate();
        };
        keepOnTopTimer.Tick += (_, _) =>
        {
            if (logoMenu.Visible) Topmost.Raise(logoMenu);
            if (panel.Visible) Topmost.Raise(panel);
        };
        panelWatchTimer.Tick += (_, _) => WatchHoverPanel();
        clockTimer.Tick += (_, _) => TickClock();
        blinkTimer.Tick += (_, _) =>
        {
            blinkOn = !blinkOn;
            if (!status.WifiConnecting) { blinkOn = true; blinkTimer.Stop(); }
            InvalidateItem(Item.Network);
        };

        Rectangle bounds = screen.Bounds;
        MonitorBounds = bounds;
        visibleTop = bounds.Top;
        hiddenTop = bounds.Top - BarHeight;
        targetTop = visibleTop;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(bounds.Left, bounds.Top, bounds.Width, BarHeight);
        BackColor = Theme.BarBackground;
        DoubleBuffered = true;
        MouseMove += OnBarMouseMove;
        // macOS 메뉴바처럼 누르는 순간 메뉴·모달을 연다.
        MouseDown += OnBarMouseClick;
        MouseUp += OnBarMouseUp;
        MouseLeave += (_, _) =>
        {
            hoverItem = Item.None;
            StartMediaAnimation();
            logoHovered = false;
            Cursor = Cursors.Default;
            Invalidate();
        };
        clockTimer.Start();
        catTimer.Tick += (_, _) => TickCat();
        mediaFrame = AnimateMedia;
        catTimer.Start();
    }

    private void TickCat()
    {
        // 꺼져 있거나 메뉴바가 숨어 있으면 다시 그리지 않고 1초마다 확인만 한다.
        if (!AppSettings.Current.ShowRunCat || targetTop == hiddenTop || !areas.ContainsKey(Item.Cat))
        {
            catTimer.Interval = 1000;
            return;
        }
        double cpu = Math.Clamp(snapshot.CpuPercent ?? 0, 0, 100);
        if (AppSettings.Current.RunCatStyle == "cat")
        {
            catTimer.Interval = (int)Math.Round(1000 / (2 + cpu / 100 * 13)); // 0% → 500ms, 100% → 67ms
            catFrame = (catFrame + 1) % RunCat.FrameCount;
        }
        else
        {
            // 불꽃은 한가해도 일렁이고, 바쁠수록 빠르게 타오른다(초당 10~20장면, 단계에 따라).
            catTimer.Interval = (int)Math.Round(1000 / (10 + 10.0 * flame.Level / FlameIcon.Levels));
            flame.Step(cpu);
        }
        InvalidateItem(Item.Cat);
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get { const int WsExToolWindow = 0x80, WsExNoActivate = 0x08000000; CreateParams value = base.CreateParams; value.ExStyle |= WsExToolWindow | WsExNoActivate; return value; }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        RestoreScreenSpace();
        ApplyAppearance();
        // 모달 창(유리·둥근 모서리 설정 포함)을 미리 만들어 둔다 → 처음 마우스를 올릴 때도 150ms 안에 열림.
        BeginInvoke(() => { if (!IsDisposed && !panel.IsDisposed) _ = panel.Handle; });
        // 2초 뒤(곡 정보를 읽은 뒤) 메뉴바 가운데 글자·로고와 재생 모달을 보이지 않게 한 번 그려 둔다.
        var warm = new System.Windows.Forms.Timer { Interval = 2000 };
        warm.Tick += (_, _) =>
        {
            warm.Dispose();
            if (IsDisposed) return;
            try
            {
                using var image = new Bitmap(600, Math.Max(1, ClientSize.Height), System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                using Graphics graphics = Graphics.FromImage(image);
                foreach (NowPlayingInfo media in NowPlaying.All)
                {
                    MediaLogo.Draw(graphics, new Rectangle(8, 6, 18, 18), media, Theme.Primary);
                    MediaLogo.Draw(graphics, new Rectangle(8, 6, 18, 18), media, Theme.Primary, 0.5f);
                    BarText.Draw(graphics, MediaText(media), mediaFont, new Rectangle(34, 0, 560, image.Height), Theme.Primary, StringAlignment.Near);
                }
            }
            catch (Exception) { }
            panel.WarmUp();
            MemoryTrim.Request();
        };
        warm.Start();
    }

    // macOS처럼 배경화면이 비치는 반투명(흐림) 배경. 불투명도는 설정에서 조절한다.
    public void ApplyAppearance()
    {
        // 테마·불투명도가 그대로면(예: 표시 항목 스위치) 유리 효과를 다시 걸지 않는다.
        // 다시 걸면 Windows가 창을 새로 합성하느라 설정 창 스위치 애니메이션이 잠깐 끊긴다.
        (bool, int) appearance = (Theme.IsLight, Theme.BarTintPercent);
        if (appliedAppearance == appearance && IsHandleCreated)
        {
            // 언어 등 글자만 바뀐 경우: 메뉴바·로고 메뉴·모달을 다시 그리기만 한다.
            Invalidate();
            logoMenu.Invalidate();
            panel.Invalidate();
            return;
        }
        appliedAppearance = appearance;
        BackColor = Theme.BarBackground;
        translucent = BarBackdrop.Apply(Handle, Theme.BarBackground, Theme.BarTintPercent, moving: sliding);
        panel.ApplyGlass();
        logoMenu.BackColor = Theme.PopupBackground;
        logoMenu.Invalidate();
        Invalidate();
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (translucent) e.Graphics.Clear(Color.Transparent);
        else base.OnPaintBackground(e);
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        ReleaseScreenSpace();
        base.OnHandleDestroyed(e);
    }

    protected override void WndProc(ref Message m)
    {
        // 위치 변경 알림은 보낸 쪽이 기다리는 중에 처리하지 않고, 한 번으로 묶어 나중에 처리한다.
        if (appBarRegistered && m.Msg == AppBar.CallbackMessage && (int)m.WParam == AppBar.PositionChanged
            && !reservePending)
        {
            reservePending = true;
            BeginInvoke(() =>
            {
                reservePending = false;
                if (appBarRegistered && !IsDisposed) ReserveScreenSpace();
            });
        }
        base.WndProc(ref m);
    }

    // 메뉴바 높이만큼 화면 위쪽을 작업 영역에서 비워 둔다(최대화 창이 메뉴바 아래에서 시작).
    private void RestoreScreenSpace()
    {
        if (appBarRegistered || !IsHandleCreated || IsDisposed) return;
        appBarRegistered = AppBar.Register(Handle);
        reservedBounds = Rectangle.Empty;
        if (appBarRegistered) ReserveScreenSpace();
    }

    // 전체 화면·최대화일 때는 비워 둔 공간을 Windows에 돌려줘서 앱이 화면 맨 위까지 채우게 한다.
    private void ReleaseScreenSpace()
    {
        if (!appBarRegistered) return;
        AppBar.Unregister(Handle);
        appBarRegistered = false;
        reservedBounds = Rectangle.Empty;
    }

    private void ReserveScreenSpace()
    {
        if (!appBarRegistered) return;
        if (sliding)
        {
            reserveAfterSlide = true;
            return;
        }
        if (AppBar.Reserve(Handle, MonitorBounds, BarHeight, reservedBounds) is not Rectangle reserved) return;
        if (reserved == reservedBounds) return;
        reservedBounds = reserved;
        bool hidden = targetTop == hiddenTop;
        visibleTop = reserved.Top;
        hiddenTop = reserved.Top - BarHeight;
        targetTop = hidden ? hiddenTop : visibleTop;
        SetBounds(reserved.Left, targetTop, reserved.Width, BarHeight);
    }

    public void UpdateSnapshot(SystemSnapshot value)
    {
        snapshot = value;
        UpdateDiagnosticsTitle();
        RefreshPanel();
    }

    public void UpdateStatus(StatusSnapshot value)
    {
        bool wasConnecting = status.WifiConnecting;
        status = value;
        if (status.WifiConnecting && !wasConnecting) { blinkOn = true; blinkTimer.Start(); }
        UpdateDiagnosticsTitle();
        RefreshPanel();
    }

    // 출력 장치가 추가·제거·변경되면 소리 모달의 목록을 다시 읽는다.
    public void RefreshOutputs() => panel.RefreshOutputs();

    // 시험·점검용: 창 제목에 지금 표시 중인 값을 남긴다(화면에는 보이지 않음).
    private void UpdateDiagnosticsTitle()
    {
        string title = $"WinBar|Volume={snapshot.VolumePercent:0}|Muted={snapshot.Muted}|Output={snapshot.OutputName}|Input={status.InputLabel}"
            + $"|Bars={status.WifiBars}|Connecting={status.WifiConnecting}|Battery={snapshot.BatteryPercent}|Charging={snapshot.Charging}"
            + $"|Saver={snapshot.SaverThreshold}|SaverOn={snapshot.SaverOn}|Mode={snapshot.PowerMode}";
        if (Text != title) Text = title;
    }

    private void RefreshPanel()
    {
        if (panel.Visible) panel.UpdateData(snapshot, status);
        Invalidate();
    }

    private void TickClock()
    {
        // 다음 초가 바뀌는 순간에 맞춘다.
        clockTimer.Interval = Math.Max(200, 1000 - DateTime.Now.Millisecond + 5);
        InvalidateItem(Item.Clock);
    }

    private void InvalidateItem(Item item)
    {
        if (areas.TryGetValue(item, out Rectangle area)) Invalidate(area);
        else Invalidate();
    }

    public bool ContainsScreenPoint(Point point) =>
        (Visible && Bounds.Contains(point))
        || (logoMenu.Visible && logoMenu.Bounds.Contains(point))
        || panel.ContainsScreenPoint(point);

    public void CloseMenus()
    {
        logoMenu.HideMenu();
        panel.HidePanel();
        // 설정 창은 메뉴 옆에 붙어 뜨는 창이라 바깥을 누르면 메뉴와 함께 닫는다.
        SettingsForm.CloseIfOpen();
    }

    public bool RaiseWindowAt(Point cursor)
    {
        foreach (Form form in new Form[] { logoMenu, panel, this })
        {
            if (!form.Visible || !form.Bounds.Contains(cursor)) continue;
            Topmost.Raise(form);
            return true;
        }
        return false;
    }

    private void UpdateKeepOnTop()
    {
        if (logoMenu.Visible || panel.Visible) keepOnTopTimer.Start();
        else keepOnTopTimer.Stop();
        if (panel.Visible) { panelLeftAt = 0; panelWatchTimer.Start(); }
        else panelWatchTimer.Stop();
    }

    private void WatchHoverPanel()
    {
        if (!panel.Visible || panel.Pinned) { panelLeftAt = 0; return; }
        Point cursor = Cursor.Position;
        bool inside = panel.ContainsScreenPoint(cursor)
            || (areas.TryGetValue(panelItem, out Rectangle area) && RectangleToScreen(area).Contains(cursor));
        if (inside) { panelLeftAt = 0; return; }
        long now = Environment.TickCount64;
        if (panelLeftAt == 0) panelLeftAt = now;
        else if (now - panelLeftAt > 120) panel.HidePanel();
    }

    public bool IsShown => targetTop == visibleTop;

    public bool HasOpenPopup => logoMenu.Visible || (panel.Visible && panel.Pinned);

    // 메뉴바 영역(보일 때 자리)을 화면 좌표로 돌려준다. 창이 이 영역을 덮으면 메뉴바를 위로 숨긴다.
    public Rectangle VisibleArea => new(MonitorBounds.Left, visibleTop, MonitorBounds.Width, BarHeight);

    // fullscreen: 최대화·전체 화면 앱(비워 둔 공간을 돌려줌, 맨 위에 마우스를 대면 잠깐 표시)
    // covered: 사용자가 창을 끌어 올려 메뉴바 자리를 덮은 경우(공간은 그대로, 창을 내리면 다시 표시)
    public void SetFullscreen(bool fullscreen, bool covered, bool pointerAtTop)
    {
        if (!fullscreen)
        {
            fullscreenActive = false;
            edgeRevealArmed = false;
            RestoreScreenSpace();
        }
        else if (!fullscreenActive)
        {
            // 전체 화면에 들어가는 순간 커서가 위에 있어도 먼저 숨긴다.
            // 이후 커서가 상단을 떠나야 가장자리 표시가 다시 활성화된다.
            fullscreenActive = true;
            edgeRevealArmed = false;
            visibleTop = MonitorBounds.Top;
            hiddenTop = MonitorBounds.Top - BarHeight;
        }
        else if (!pointerAtTop)
        {
            edgeRevealArmed = true;
        }

        bool revealAtEdge = fullscreen && edgeRevealArmed && pointerAtTop;
        bool shouldHide = ((fullscreen && !revealAtEdge) || (!fullscreen && covered)) && !HasOpenPopup;
        int nextTarget = shouldHide ? hiddenTop : visibleTop;
        if (targetTop == nextTarget)
        {
            // 숨김 애니메이션이 끝난 뒤 전체 화면이 이어지면 비워 둔 30px을 돌려준다.
            if (fullscreenActive && shouldHide && !sliding) ReleaseScreenSpace();
            return;
        }
        targetTop = nextTarget;
        if (shouldHide) panel.HidePanel();
        StartSlide();
    }

    // 화면 새로 고침(DWM 프레임)마다 한 번씩 창을 옮겨 끊김 없이 움직인다.
    // 움직이는 동안에는 흐림(아크릴)을 잠시 끄고 반투명 색만 써서, Windows가 매 프레임 흐림을 다시 계산하느라 늦어지지 않게 한다.
    private void StartSlide()
    {
        if (!IsHandleCreated || IsDisposed) return;
        int version = ++slideVersion;
        int from = Top, to = targetTop, left = Left;
        IntPtr handle = Handle;
        if (!sliding && translucent)
            BarBackdrop.Apply(handle, Theme.BarBackground, Theme.BarTintPercent, moving: true);
        sliding = true;
        var thread = new Thread(() =>
        {
            var clock = System.Diagnostics.Stopwatch.StartNew();
            double lastFrame = -16;
            while (version == Volatile.Read(ref slideVersion))
            {
                double now = clock.Elapsed.TotalMilliseconds;
                double progress = Math.Min(1, now / SlideDurationMilliseconds);
                // macOS처럼 천천히 출발해 천천히 멈추는 곡선
                double eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.Pow(-2 * progress + 2, 3) / 2;
                int y = (int)Math.Round(from + (to - from) * eased);
                SetWindowPos(handle, IntPtr.Zero, left, y, 0, 0, SwpNoSize | SwpNoZOrder | SwpNoActivate | SwpNoOwnerZOrder);
                if (progress >= 1) break;
                // 다음 화면 갱신까지 기다린다. 실패하거나 너무 빨리 돌아오면 짧게 쉰다.
                if (DwmFlush() != 0 || now - lastFrame < 4) Thread.Sleep(6);
                lastFrame = now;
            }
            try { BeginInvoke(() => FinishSlide(version)); } catch (Exception) { }
        }) { IsBackground = true, Name = "WinBar slide" };
        thread.Start();
    }

    private void FinishSlide(int version)
    {
        if (version != slideVersion || IsDisposed) return;
        sliding = false;
        if (Top != targetTop) SetBounds(Left, targetTop, Width, Height, BoundsSpecified.Y);
        if (translucent) BarBackdrop.Apply(Handle, Theme.BarBackground, Theme.BarTintPercent);
        // 숨긴 뒤에 공간을 돌려줘야 최대화 창이 다시 배치되는 작업이 애니메이션과 겹치지 않는다.
        if (fullscreenActive && targetTop == hiddenTop) ReleaseScreenSpace();
        if (reserveAfterSlide)
        {
            reserveAfterSlide = false;
            ReserveScreenSpace();
        }
    }

    private const uint SwpNoSize = 0x0001, SwpNoZOrder = 0x0004, SwpNoActivate = 0x0010, SwpNoOwnerZOrder = 0x0200;
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();

    private Item ItemAt(Point location)
    {
        foreach ((Item item, Rectangle area) in areas)
            if (area.Contains(location)) return item;
        return Item.None;
    }

    private static GlassPanel.Kind? KindOf(Item item) => item switch
    {
        Item.Battery => GlassPanel.Kind.Battery,
        Item.Network => GlassPanel.Kind.Network,
        Item.Sound => GlassPanel.Kind.Sound,
        Item.Control => GlassPanel.Kind.Control,
        Item.Clock => GlassPanel.Kind.Clock,
        Item.Privacy => GlassPanel.Kind.Privacy,
        Item.More => GlassPanel.Kind.More,
        Item.Cat => GlassPanel.Kind.Cat,
        Item.Media => GlassPanel.Kind.Media,
        _ => null
    };

    private void OpenPanel(Item item, bool pinned)
    {
        if (KindOf(item) is not GlassPanel.Kind kind || !areas.TryGetValue(item, out Rectangle area)) return;
        logoMenu.HideMenu();
        panelItem = item;
        panel.ShowPanel(kind, RectangleToScreen(area), snapshot, status, pinned);
        Invalidate();
    }

    // 메뉴바 불꽃 끌어서 바탕화면에 놓기: 누른 채 5px 넘게 움직이면 바탕화면 불꽃이 생겨 커서를 따라온다.
    private Point? flamePress;
    private DesktopFlame? draggingFlame;

    private void OnBarMouseUp(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        if (draggingFlame is not null)
        {
            // 메뉴바 위에서 놓으면 취소, 바깥에서 놓으면 그 자리에 남는다.
            if (Bounds.Contains(Cursor.Position)) draggingFlame.Close();
            draggingFlame = null;
            flamePress = null;
            Capture = false;
            return;
        }
        if (flamePress is not null)
        {
            // 끌지 않고 그냥 누른 경우: 다른 항목처럼 불꽃 모달을 고정해서 연다.
            flamePress = null;
            OpenPanel(Item.Cat, pinned: true);
        }
    }

    private void OnBarMouseMove(object? sender, MouseEventArgs e)
    {
        if (flamePress is Point start && MouseButtons == MouseButtons.Left)
        {
            if (draggingFlame is null && Math.Abs(e.X - start.X) + Math.Abs(e.Y - start.Y) > 5)
            {
                panel.HidePanel();
                draggingFlame = DesktopFlame.Spawn(Cursor.Position);
                if (draggingFlame is null) { flamePress = null; return; } // 이미 5개
                Capture = true;
            }
            if (draggingFlame is not null) { draggingFlame.MoveCenter(Cursor.Position); return; }
        }
        bool nextLogoHovered = logoArea.Contains(e.Location);
        if (nextLogoHovered != logoHovered)
        {
            logoHovered = nextLogoHovered;
            Invalidate();
        }

        Item next = ItemAt(e.Location);
        Cursor = logoHovered || next != Item.None ? Cursors.Hand : Cursors.Default;
        // 로고가 여러 개면 마우스를 올린 로고의 곡을 고른다(메뉴바 글자·재생 카드·버튼이 그 앱을 따른다).
        if (next == Item.Media && MediaLogoAt(e.Location) is int index and >= 0 && index < NowPlaying.All.Count
            && NowPlaying.All[index].Id != NowPlaying.Current?.Id)
        {
            NowPlaying.SelectedId = NowPlaying.All[index].Id;
            StartMediaAnimation();
            Invalidate();
            if (panel.Visible && panel.Current == GlassPanel.Kind.Media) panel.Invalidate();
        }
        if (next == hoverItem) return;
        hoverItem = next;
        Invalidate();
        StartMediaAnimation();
        if (next == Item.Media) NowPlaying.Recheck(); // 브라우저 탭이 바뀌었을 수 있어 YouTube 여부를 다시 확인
        // macOS처럼 마우스를 올리면 모달이 열리고, 열린 상태에서 다른 항목으로 옮기면 그 모달로 바뀐다.
        if (next != Item.None && !logoMenu.Visible && (panelItem != next || !panel.Visible))
            OpenPanel(next, pinned: panel.Visible && panel.Pinned);
    }

    private void OnBarMouseClick(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        // 불꽃은 누르는 순간 바로 열지 않고, 끄는지(바탕화면으로 가져가기) 그냥 누르는지 손을 뗄 때 정한다.
        if (ItemAt(e.Location) == Item.Cat && AppSettings.Current.RunCatStyle == "flame")
        {
            flamePress = e.Location;
            return;
        }

        if (logoArea.Contains(e.Location))
        {
            panel.HidePanel();
            if (logoMenu.Visible || SettingsForm.IsOpen)
            {
                logoMenu.HideMenu();
                SettingsForm.CloseIfOpen();
            }
            else if (!logoMenu.RecentlyHidden)
                logoMenu.ShowMenu(PointToScreen(new Point(logoArea.Left, ClientSize.Height + 6)));
            return;
        }

        Item item = ItemAt(e.Location);
        if (KindOf(item) is null) return;
        // 이미 고정된 같은 모달을 다시 누르면 닫는다. 마우스로만 열린 모달을 누르면 고정한다.
        if (panel.Visible && panelItem == item && panel.Pinned)
        {
            panel.HidePanel();
            return;
        }
        OpenPanel(item, pinned: true);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            panel.Dispose();
            logoMenu.Dispose();
            keepOnTopTimer.Dispose();
            panelWatchTimer.Dispose();
            clockTimer.Dispose();
            catTimer.Dispose();
            FrameClock.Remove(mediaFrame);
            blinkTimer.Dispose();
            slideVersion++; // 진행 중인 애니메이션 스레드를 멈춘다.
            font.Dispose();
            mediaFont.Dispose();
        }
        base.Dispose(disposing);
    }

    private void LayoutItems(AppSettings options, int clockWidth)
    {
        areas.Clear();
        int right = ClientSize.Width - 10;
        int spacing = Math.Clamp(options.IconSpacing, AppSettings.MinIconSpacing, AppSettings.MaxIconSpacing);
        void Add(Item item, int width)
        {
            areas[item] = new Rectangle(right - width, 0, width, ClientSize.Height);
            right -= width + spacing;
        }
        Add(Item.Clock, clockWidth + 16);
        Add(Item.Control, 32);
        if (options.ShowVolume) Add(Item.Sound, 32);
        if (options.ShowWifi) Add(Item.Network, 32);
        batterySeen |= snapshot.BatteryPercent is not null;
        if (options.ShowBattery && batterySeen) Add(Item.Battery, 40);
        Add(Item.More, 30);
        // 움직이는 아이콘(불꽃·고양이)은 맨 왼쪽 로고 바로 오른쪽에 둔다(로고 칸 10~40px).
        if (options.ShowRunCat) areas[Item.Cat] = new Rectangle(44, 0, 32, ClientSize.Height);
        if (options.ShowPrivacy && (status.CameraInUse || status.MicrophoneInUse))
            Add(Item.Privacy, status.CameraInUse && status.MicrophoneInUse ? 32 : 22);
    }

    // 지금 재생 중: 메뉴바 정가운데(가로 폭의 절반 지점)에 둔다. 평소에는 앱 로고만(앱마다 하나, Spotify와 YouTube가 함께 있으면 두 개).
    // 로고에 마우스를 올리면 그 로고 바로 오른쪽에 "제목 — 가수"가 펼쳐지고 뒤의 로고는 옆으로 밀려난다(가운데는 유지).
    // 다른 로고로 옮기면 앞 글자는 접히고 새 글자가 펼쳐진다. 좌우 아이콘과 겹치면 양쪽을 같이 줄이고(글자는 말줄임), 너무 좁으면 숨긴다.
    private const int MediaPadding = 8, MediaLogoCell = 32, MediaTextGap = 8;
    private const double MediaAnimationMs = 450;
    // 로고 사이 거리: 오른쪽 아이콘처럼 32px 칸 + 설정의 '아이콘 사이 간격'(설정을 바꾸면 함께 넓어지고 좁아진다)
    private int mediaLogoStep = MediaLogoCell + 4;
    // 앱별 펼침 진행도(0~1, 시간에 비례). 그릴 때는 천천히 시작해 천천히 멈추는 곡선을 씌운다.
    private readonly Dictionary<string, double> mediaProgress = [];
    private readonly Dictionary<string, int> mediaTextSpace = [];   // 앱별 다 펼쳐졌을 때 글자 칸 폭
    private readonly System.Diagnostics.Stopwatch mediaClock = new();
    private Action mediaFrame = () => { };
    private bool mediaAnimating;
    private Rectangle mediaBand;   // 펼침 애니메이션 동안 다시 그릴 가운데 띠(가장 넓게 펼쳐졌을 때까지)
    private readonly Dictionary<string, int> mediaTextWidths = [];   // 글자 폭 기억(매 장면 다시 재지 않음)

    private bool MediaOpen => hoverItem == Item.Media || (panel.Visible && panel.Current == GlassPanel.Kind.Media);

    // 사인 곡선: 첫 장면부터 바로 움직이기 시작하고(반응이 늦어 보이지 않음) 끝은 부드럽게 멈춘다.
    private static double EaseInOut(double p) => (1 - Math.Cos(Math.PI * p)) / 2;

    private double MediaOpenness(string id) => mediaProgress.TryGetValue(id, out double p) ? EaseInOut(p) : 0;

    private int MediaCollapsedWidth(int count) => MediaPadding + (count - 1) * mediaLogoStep + 18 + MediaPadding;

    // 로고 index 앞에서 펼쳐진 글자 폭의 합(그만큼 뒤 로고가 밀려난다)
    private int MediaShift(IReadOnlyList<NowPlayingInfo> all, int index)
    {
        double shift = 0;
        for (int j = 0; j < index; j++)
            shift += MediaOpenness(all[j].Id) * mediaTextSpace.GetValueOrDefault(all[j].Id);
        return (int)Math.Round(shift);
    }

    private void LayoutMedia(Graphics graphics, AppSettings options)
    {
        IReadOnlyList<NowPlayingInfo> all = NowPlaying.All;
        if (!options.ShowNowPlaying || all.Count == 0) return;
        mediaLogoStep = MediaLogoCell + Math.Clamp(options.IconSpacing, AppSettings.MinIconSpacing, AppSettings.MaxIconSpacing);
        int collapsed = MediaCollapsedWidth(all.Count);
        int center = ClientSize.Width / 2;
        int leftLimit = (areas.TryGetValue(Item.Cat, out Rectangle cat) ? cat.Right : 44) + 16;
        int rightLimit = areas.Values.Where(area => area.Left > ClientSize.Width / 3).Select(area => area.Left).DefaultIfEmpty(ClientSize.Width).Min() - 16;
        // 가운데에서 양쪽으로 쓸 수 있는 폭 중 좁은 쪽에 맞춘다(정가운데 유지).
        int room = 2 * Math.Min(center - leftLimit, rightLimit - center);
        if (room < collapsed) return;
        double extra = 0;
        foreach (NowPlayingInfo media in all)
        {
            // 글자 칸: 로고 뒤 간격 + 글자(최대 420px) — 남는 폭을 넘지 않게
            string label = MediaText(media);
            if (!mediaTextWidths.TryGetValue(label, out int measured))
            {
                if (mediaTextWidths.Count > 16) mediaTextWidths.Clear();
                mediaTextWidths[label] = measured = (int)Math.Ceiling(BarText.Measure(graphics, label, mediaFont));
            }
            int text = Math.Min(420, measured);
            int space = Math.Max(0, Math.Min(MediaTextGap + text + 6, room - collapsed));
            mediaTextSpace[media.Id] = space;
            extra += MediaOpenness(media.Id) * space;
        }
        int width = Math.Min(room, collapsed + (int)Math.Round(extra));
        int widest = Math.Min(room, collapsed + mediaTextSpace.Values.DefaultIfEmpty(0).Max());
        mediaBand = new Rectangle(center - widest / 2 - 6, 0, widest + 12, ClientSize.Height);
        areas[Item.Media] = new Rectangle(center - width / 2, 0, width, ClientSize.Height);
    }

    private Rectangle MediaLogoRect(Rectangle area, IReadOnlyList<NowPlayingInfo> all, int index) =>
        new(area.Left + MediaPadding + index * mediaLogoStep + MediaShift(all, index), area.Top + (area.Height - 18) / 2, 18, 18);

    // 마우스가 올라간 로고 번호(로고 사이·글자 위면 -1)
    private int MediaLogoAt(Point point)
    {
        if (!areas.TryGetValue(Item.Media, out Rectangle area)) return -1;
        IReadOnlyList<NowPlayingInfo> all = NowPlaying.All;
        for (int i = 0; i < all.Count; i++)
        {
            Rectangle logo = MediaLogoRect(area, all, i);
            if (point.X >= logo.Left - 4 && point.X < logo.Right + 4) return i;
        }
        return -1;
    }

    // 펼침 애니메이션: 0.45초, 시간 기준(프레임이 밀려도 속도가 같음). 도중에 방향이 바뀌면 지금 위치에서 이어서 움직인다.
    // 화면 새로 고침마다 한 장면(FrameClock), 가운데 띠만 바로 다시 그린다. 움직이는 동안에만 돈다.
    private void StartMediaAnimation()
    {
        if (mediaAnimating) return;
        mediaAnimating = true;
        mediaClock.Restart();
        FrameClock.Add(mediaFrame);
    }

    private void AnimateMedia()
    {
        if (IsDisposed) { FrameClock.Remove(mediaFrame); return; }
        double step = Math.Min(100, mediaClock.Elapsed.TotalMilliseconds) / MediaAnimationMs;
        mediaClock.Restart();
        string? open = MediaOpen ? NowPlaying.Current?.Id : null;
        bool moving = false;
        foreach (NowPlayingInfo media in NowPlaying.All)
        {
            double target = media.Id == open ? 1 : 0;
            double now = mediaProgress.GetValueOrDefault(media.Id);
            double next = now < target ? Math.Min(target, now + step) : Math.Max(target, now - step);
            mediaProgress[media.Id] = next;
            moving |= next != target;
        }
        foreach (string gone in mediaProgress.Keys.Where(id => NowPlaying.All.All(media => media.Id != id)).ToArray())
            mediaProgress.Remove(gone);
        if (!moving) { mediaAnimating = false; FrameClock.Remove(mediaFrame); }
        if (mediaBand.Width > 0) Invalidate(mediaBand); else Invalidate();
        Update();
    }

    private static string MediaText(NowPlayingInfo media) =>
        string.IsNullOrWhiteSpace(media.Artist) ? media.Title : $"{media.Title} — {media.Artist}";

    private void DrawMedia(Graphics graphics, Rectangle area, Color color)
    {
        IReadOnlyList<NowPlayingInfo> all = NowPlaying.All;
        if (all.Count == 0) return;
        string? selected = NowPlaying.Current?.Id;
        // 펼쳐진 정도(가장 많이 펼쳐진 앱 기준). 여러 개면 선택되지 않은 로고는 펼쳐질수록 조금 흐리게
        double expand = all.Max(media => MediaOpenness(media.Id));
        GraphicsState state = graphics.Save();
        graphics.SetClip(area);
        for (int i = 0; i < all.Count; i++)
        {
            NowPlayingInfo media = all[i];
            Rectangle logo = MediaLogoRect(area, all, i);
            bool dim = media.Id != selected && all.Count > 1 && expand > 0;
            MediaLogo.Draw(graphics, logo, media, color, dim ? (float)(1 - 0.5 * expand) : 1);

            // 이 로고의 글자: 펼쳐지는 만큼 서서히 나타난다(일시정지 중이면 더 흐리게)
            double open = MediaOpenness(media.Id);
            int space = (int)Math.Round(open * mediaTextSpace.GetValueOrDefault(media.Id));
            if (open <= 0.05 || space < 24) continue;
            int alpha = (int)Math.Round(255 * Math.Clamp((open - 0.3) / 0.7, 0, 1) * (media.Playing ? 1 : 0.55));
            if (alpha <= 0) continue;
            var text = Rectangle.FromLTRB(logo.Right + MediaTextGap, area.Top, Math.Min(area.Right - 8, logo.Right + space), area.Bottom);
            BarText.Draw(graphics, MediaText(media), mediaFont, text, Color.FromArgb(alpha, color), StringAlignment.Near);
        }
        graphics.Restore(state);
    }

    // 곡·재생 상태가 바뀌면(UI 스레드에서) 메뉴바를 다시 배치하고, 열린 재생 모달도 새로 그린다.
    public void OnNowPlayingChanged()
    {
        if (IsDisposed) return;
        mediaTextWidths.Clear();
        if (NowPlaying.Current is null && panel.Visible && panel.Current == GlassPanel.Kind.Media) panel.HidePanel();
        else if (panel.Visible && panel.Current == GlassPanel.Kind.Media) panel.Invalidate();
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics graphics = e.Graphics;
        AppSettings options = AppSettings.Current;
        LayoutItems(options, Slots(graphics, options.Use24HourClock).Width);
        LayoutMedia(graphics, options);
        if (!areas.ContainsKey(hoverItem)) hoverItem = Item.None;

        foreach (Item highlighted in new[] { hoverItem, panel.Visible ? panelItem : Item.None }.Distinct())
            if (areas.TryGetValue(highlighted, out Rectangle area)) DrawHighlight(graphics, Rectangle.Inflate(area, -1, -4));

        logoArea = new Rectangle(10, 0, 30, ClientSize.Height);
        if (logoHovered || logoMenu.Visible) DrawHighlight(graphics, Rectangle.Inflate(logoArea, 0, -4));
        Icons.DrawBold(graphics, Icons.Logo, logoArea, Theme.BarText, 11);

        foreach ((Item item, Rectangle area) in areas)
        {
            // 일부만 다시 그릴 때(시계 1초, 고양이 장면)는 그 칸만 그린다.
            if (!e.ClipRectangle.IntersectsWith(area)) continue;
            try { DrawItem(graphics, item, area); }
            catch (Exception) { }
        }
    }

    private void DrawItem(Graphics graphics, Item item, Rectangle area)
    {
        Color color = Theme.BarText;
        Color dim = Color.FromArgb(80, color);
        switch (item)
        {
            case Item.Battery:
                // macOS처럼 메뉴바에는 아이콘만, 퍼센트는 마우스를 올렸을 때 보여 준다.
                Icons.DrawBattery(graphics, area, snapshot.BatteryPercent, snapshot.Charging, color, snapshot.SaverThreshold);
                break;
            case Item.Network:
                var wifiArea = new Rectangle(area.Left + (area.Width - 20) / 2, area.Top + (area.Height - 16) / 2, 20, 16);
                if (status.WifiConnecting)
                    WifiIcon.Draw(graphics, wifiArea, blinkOn ? 5 : 0, color, dim);
                else if (status.WifiConnected)
                    WifiIcon.Draw(graphics, wifiArea, status.WifiBars, color, dim);
                else if (status.EthernetConnected)
                    Icons.DrawBold(graphics, Icons.Ethernet, area, color, 11);
                else
                    // Wi-Fi 연결이 끊기면 흐린 아이콘 위로 대각선을 긋는다.
                    WifiIcon.Draw(graphics, wifiArea, 0, color, Color.FromArgb(110, color), disconnected: true);
                break;
            case Item.Sound:
                string glyph = snapshot.VolumePercent is null ? ""
                    : IsHeadphones(snapshot.OutputName) && !snapshot.Muted ? ""
                    : Icons.Volume(snapshot.VolumePercent, snapshot.Muted);
                Icons.DrawBold(graphics, glyph, area, snapshot.VolumePercent is null ? dim : color, 11);
                break;
            case Item.Control:
                DrawControlCenterIcon(graphics, area, color);
                break;
            case Item.Media:
                DrawMedia(graphics, area, color);
                break;
            case Item.Cat:
                if (AppSettings.Current.RunCatStyle == "cat") RunCat.Draw(graphics, area, catFrame, color);
                else flame.Draw(graphics, area);
                break;
            case Item.More:
                Icons.DrawBold(graphics, "", area, color, 11);
                break;
            case Item.Privacy:
                DrawPrivacyDots(graphics, area);
                break;
            case Item.Clock:
                DrawClock(graphics, area, color, AppSettings.Current.Use24HourClock);
                break;
        }
    }

    private static bool IsHeadphones(string? name) =>
        name is not null && (name.Contains("Headphone", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Headset", StringComparison.OrdinalIgnoreCase)
            || name.Contains("헤드폰") || name.Contains("헤드셋")
            || name.Contains("Buds", StringComparison.OrdinalIgnoreCase)
            || name.Contains("AirPods", StringComparison.OrdinalIgnoreCase));

    // macOS 제어 센터 아이콘: 토글 스위치 두 개(위는 켜짐, 아래는 꺼짐).
    private static void DrawControlCenterIcon(Graphics graphics, Rectangle area, Color color)
    {
        SmoothingMode previous = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        float scale = graphics.DpiY / 96f;
        float width = 16 * scale, height = 6.5f * scale, gap = 2.5f * scale;
        float left = area.Left + (area.Width - width) / 2f;
        float top = area.Top + (area.Height - height * 2 - gap) / 2f;
        using var pen = new Pen(color, Icons.Stroke(graphics));
        using var brush = new SolidBrush(color);
        for (int row = 0; row < 2; row++)
        {
            var pill = new RectangleF(left, top + row * (height + gap), width, height);
            using (var path = new GraphicsPath())
            {
                path.AddArc(pill.Left, pill.Top, pill.Height, pill.Height, 90, 180);
                path.AddArc(pill.Right - pill.Height, pill.Top, pill.Height, pill.Height, 270, 180);
                path.CloseFigure();
                graphics.DrawPath(pen, path);
            }
            // 손잡이는 테두리 안쪽에 작게 그려 스위치처럼 보이게 한다.
            float knob = pill.Height - 2.6f * scale;
            float knobX = row == 0 ? pill.Right - knob - 1.3f * scale : pill.Left + 1.3f * scale;
            graphics.FillEllipse(brush, knobX, pill.Top + 1.3f * scale, knob, knob);
        }
        graphics.SmoothingMode = previous;
    }

    // macOS처럼 카메라 사용 중은 초록 점, 마이크 사용 중은 주황 점으로 표시한다.
    private void DrawPrivacyDots(Graphics graphics, Rectangle area)
    {
        var colors = new List<Color>();
        if (status.CameraInUse) colors.Add(Theme.CameraDot);
        if (status.MicrophoneInUse) colors.Add(Theme.MicrophoneDot);
        const int size = 8, gap = 6;
        int x = area.Left + (area.Width - (colors.Count * size + (colors.Count - 1) * gap)) / 2;
        int y = area.Top + (area.Height - size) / 2;
        SmoothingMode previous = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        foreach (Color dotColor in colors)
        {
            using var brush = new SolidBrush(dotColor);
            graphics.FillEllipse(brush, x, y, size, size);
            x += size + gap;
        }
        graphics.SmoothingMode = previous;
    }

    private static void DrawHighlight(Graphics graphics, Rectangle area)
    {
        SmoothingMode previous = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        // macOS처럼 반투명으로 눌린 항목을 표시한다(밝은 테마에서는 어둡게).
        using var highlight = new SolidBrush(Theme.IsLight ? Color.FromArgb(36, 0, 0, 0) : Color.FromArgb(46, 255, 255, 255));
        using GraphicsPath path = Theme.RoundedRectangle(area, 6);
        graphics.FillPath(highlight, path);
        graphics.SmoothingMode = previous;
    }

    // 메뉴바 시계(초 단위). 표시 언어에 맞춰 "10월 2일 (금) 오후 1:44:05" / "Fri Oct 2  1:44:05 PM" / "10月2日 周五 下午1:44:05" / "10月2日(金) 午後 1:44:05".
    // 글자마다 폭이 조금씩 달라 초가 바뀔 때 흔들리지 않도록
    // ① 숫자는 모두 가장 넓은 숫자 폭의 같은 칸에 한 글자씩 그리고
    // ② [날짜] [시각]을 각자 가장 긴 경우(모든 달·요일·두 자리 날짜와 시) 폭의 고정 칸에 오른쪽 정렬로 둔다.
    // 그래서 초·분이 바뀌면 아무것도 움직이지 않고, 2일→10일·9시→10시가 되어도 자기 칸 안에서만 늘어나 옆 아이콘이 밀리지 않는다.
    private sealed record ClockSlots(bool Use24Hour, string Language, float Digit, float Gap, float Date, float Time)
    {
        public int Width => (int)Math.Ceiling(Date + Gap + Time) + 2;
    }

    private ClockSlots? clockSlots;
    private readonly Dictionary<char, float> glyphWidths = [];

    private ClockSlots Slots(Graphics graphics, bool use24Hour)
    {
        string language = L.Code;
        if (clockSlots is { } cached && cached.Use24Hour == use24Hour && cached.Language == language) return cached;
        float digit = 0;
        for (char c = '0'; c <= '9'; c++) digit = Math.Max(digit, BarText.Measure(graphics, c.ToString(), font));
        clockSlots = new ClockSlots(use24Hour, language, digit, 0, 0, 0); // 숫자 폭을 먼저 정해야 아래 폭을 잴 수 있다.
        // 12개월 × 7요일(22~28일) × 오전·오후 두 자리 시를 모두 재서 가장 넓은 폭을 쓴다(언어를 바꿀 때 한 번만).
        float date = 0, time = 0;
        for (int month = 1; month <= 12; month++)
            for (int day = 22; day <= 28; day++)
                date = Math.Max(date, FixedWidth(graphics, L.Clock(new DateTime(2000, month, day), use24Hour).Date));
        foreach (int hour in new[] { 10, 22 })
            time = Math.Max(time, FixedWidth(graphics, L.Clock(new DateTime(2000, 1, 1, hour, 58, 58), use24Hour).Time));
        clockSlots = new ClockSlots(use24Hour, language, digit, GlyphWidth(graphics, ' '), date, time);
        return clockSlots;
    }

    private float GlyphWidth(Graphics graphics, char glyph)
    {
        if (char.IsAsciiDigit(glyph) && clockSlots is { Digit: > 0 } slots) return slots.Digit;
        if (!glyphWidths.TryGetValue(glyph, out float width))
            glyphWidths[glyph] = width = BarText.Measure(graphics, glyph.ToString(), font);
        return width;
    }

    private float FixedWidth(Graphics graphics, string text)
    {
        float width = 0;
        foreach (char glyph in text) width += GlyphWidth(graphics, glyph);
        return width;
    }

    // 오른쪽 끝(right)에 맞춰 뒤에서부터 한 글자씩 자기 칸 가운데에 그린다.
    private void DrawFixed(Graphics graphics, string text, float right, Rectangle area, Color color)
    {
        float x = right;
        for (int index = text.Length - 1; index >= 0; index--)
        {
            float width = GlyphWidth(graphics, text[index]);
            x -= width;
            if (text[index] != ' ')
                BarText.Draw(graphics, text[index].ToString(), font, new RectangleF(x, area.Top, width, area.Height), color, StringAlignment.Center);
        }
    }

    private void DrawClock(Graphics graphics, Rectangle area, Color color, bool use24Hour)
    {
        ClockSlots slots = Slots(graphics, use24Hour);
        (string date, string time) = L.Clock(DateTime.Now, use24Hour);
        float right = area.Right - 8;
        DrawFixed(graphics, time, right, area, color);
        DrawFixed(graphics, date, right - slots.Time - slots.Gap, area, color);
    }
}

internal sealed class LogoMenuPopup : Form
{
    private readonly Screen screen;
    private readonly Action requestExit;
    private readonly Font titleFont = new("Segoe UI Semibold", 10, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font itemFont = new("Segoe UI", 9, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font iconFont = Icons.Create(11);
    private readonly Rectangle settingsArea = new(8, 50, 220, 40);
    private readonly Rectangle exitArea = new(8, 92, 220, 40);
    private Rectangle hovered;
    private long hiddenAt;
    // 호버 애니메이션: 0(보통) → 1(마우스 올림). 움직이는 동안에만 타이머가 돈다.
    private readonly System.Windows.Forms.Timer animationTimer = new() { Interval = 15 };
    private float settingsLevel, exitLevel;

    // 메뉴 바깥(로고 포함)을 눌러 닫힌 직후의 클릭은 다시 열지 않는다.
    public bool RecentlyHidden => Environment.TickCount64 - hiddenAt < 300;

    public void HideMenu()
    {
        if (!Visible) return;
        Hide();
        hiddenAt = Environment.TickCount64;
        MemoryTrim.Request();
        hovered = Rectangle.Empty;
        settingsLevel = exitLevel = 0;
        animationTimer.Stop();
    }

    private void AnimateStep()
    {
        static float Approach(float value, float target)
        {
            float next = value + (target - value) * 0.25f;
            return Math.Abs(target - next) < 0.01f ? target : next;
        }
        settingsLevel = Approach(settingsLevel, hovered == settingsArea ? 1 : 0);
        exitLevel = Approach(exitLevel, hovered == exitArea ? 1 : 0);
        if (settingsLevel == (hovered == settingsArea ? 1 : 0) && exitLevel == (hovered == exitArea ? 1 : 0))
            animationTimer.Stop();
        Invalidate();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) HideMenu();
    }

    public LogoMenuPopup(Screen screen, Action requestExit)
    {
        this.screen = screen;
        this.requestExit = requestExit;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        BackColor = Theme.PopupBackground;
        Size = new Size(236, 140);
        KeyPreview = true;
        AccessibleName = "WinBar 메뉴";
        animationTimer.Tick += (_, _) => AnimateStep();
    }

    // 포커스를 가져가지 않아 사용 중인 앱의 한/영 상태가 바뀌지 않는다.
    // 바깥 클릭·Esc로 닫는 것은 SystemEventWatcher가 알려 준다.
    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            const int WsExToolWindow = 0x80;
            const int WsExNoActivate = 0x08000000;
            const int CsDropShadow = 0x00020000;
            CreateParams value = base.CreateParams;
            value.ExStyle |= WsExToolWindow | WsExNoActivate;
            value.ClassStyle |= CsDropShadow;
            return value;
        }
    }

    public void ShowMenu(Point anchor)
    {
        Rectangle workArea = Screen.FromPoint(anchor).WorkingArea;
        int x = Math.Clamp(anchor.X, workArea.Left + 8, workArea.Right - Width - 8);
        int y = Math.Min(anchor.Y, workArea.Bottom - Height - 8);
        Location = new Point(x, Math.Max(workArea.Top + 6, y));
        if (!Visible) Show();
        Topmost.Raise(this);
        Invalidate();
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        Rectangle next = settingsArea.Contains(e.Location) ? settingsArea
            : exitArea.Contains(e.Location) ? exitArea : Rectangle.Empty;
        if (next == hovered) return;
        hovered = next;
        Cursor = hovered.IsEmpty ? Cursors.Default : Cursors.Hand;
        animationTimer.Start();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        hovered = Rectangle.Empty;
        Cursor = Cursors.Default;
        animationTimer.Start();
    }

    protected override void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        if (e.Button != MouseButtons.Left) return;
        if (settingsArea.Contains(e.Location))
        {
            // 메뉴는 열어 둔 채 그 오른쪽에 설정 창을 붙여 연다.
            SettingsForm.ShowBeside(Bounds);
        }
        else if (exitArea.Contains(e.Location))
        {
            HideMenu();
            requestExit();
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Theme.DrawPopupBackground(e.Graphics, ClientSize);

        TextRenderer.DrawText(e.Graphics, "WinBar", titleFont,
            new Rectangle(18, 14, Width - 36, 20), Theme.Primary,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        using (var separator = new Pen(Theme.Separator))
            e.Graphics.DrawLine(separator, 14, 42, Width - 14, 42);

        // 설정: 톱니바퀴가 돌아가고 › 가 오른쪽으로 밀린다. 종료: 전원 아이콘이 한 번 톡 커졌다가 살짝 아래로 눌린다.
        float settings = Icons.Ease(settingsLevel), exit = Icons.Ease(exitLevel);
        DrawItem(e.Graphics, settingsArea, settingsLevel, Theme.HoverAccent, L.T("설정"), showChevron: true, (graphics, area, color) =>
            Icons.DrawMoved(graphics, Icons.Settings, area, color, 10, angle: 120 * settings));
        DrawItem(e.Graphics, exitArea, exitLevel, Theme.HoverDanger, L.T("WinBar 종료"), showChevron: false, (graphics, area, color) =>
            Icons.DrawMoved(graphics, Icons.Power, area, color, 10,
                scale: 1 + 0.18f * (float)Math.Sin(Math.PI * exit) + 0.04f * exit, dy: 1.2f * exit));
    }

    private void DrawItem(Graphics graphics, Rectangle area, float level, Color accent, string label, bool showChevron,
        Action<Graphics, Rectangle, Color> drawIcon)
    {
        float t = Icons.Ease(level);
        if (level > 0)
        {
            // 배경이 강조색으로 서서히 물든다.
            using var hover = new SolidBrush(Theme.HoverTint(accent, level));
            using GraphicsPath itemPath = Theme.RoundedRectangle(area, 9);
            graphics.FillPath(hover, itemPath);
        }
        // 아이콘과 › 는 회색에서 강조색으로 바뀐다.
        Color iconColor = Color.FromArgb(
            (int)(Theme.Secondary.R + (accent.R - Theme.Secondary.R) * t),
            (int)(Theme.Secondary.G + (accent.G - Theme.Secondary.G) * t),
            (int)(Theme.Secondary.B + (accent.B - Theme.Secondary.B) * t));
        drawIcon(graphics, new Rectangle(area.Left + 10, area.Top, 24, area.Height), iconColor);
        int slide = (int)Math.Round(2 * t);
        TextRenderer.DrawText(graphics, label, itemFont,
            new Rectangle(area.Left + 43 + slide, area.Top, 130, area.Height), Theme.Primary,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        if (showChevron)
            Icons.DrawMoved(graphics, Icons.Chevron, new Rectangle(area.Right - 30, area.Top, 20, area.Height), iconColor, 8, dx: 3 * t);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            animationTimer.Dispose();
            titleFont.Dispose();
            itemFont.Dispose();
            iconFont.Dispose();
        }
        base.Dispose(disposing);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        Theme.ApplyRoundedRegion(this, 14);
    }
}

internal sealed class StatusPopup : Form
{
    internal sealed record Row(string Label, string Value, double? Percent, bool ShowBar = true);

    private readonly Font titleFont = new("Segoe UI", 10, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font rowFont = new("Segoe UI", 9, FontStyle.Regular, GraphicsUnit.Point);
    private string title = string.Empty;
    private Row[] rows = [];

    public StatusPopup()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        BackColor = Theme.PopupBackground;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            const int WsExToolWindow = 0x80;
            const int WsExNoActivate = 0x08000000;
            const int CsDropShadow = 0x00020000;
            CreateParams value = base.CreateParams;
            value.ExStyle |= WsExToolWindow | WsExNoActivate;
            value.ClassStyle |= CsDropShadow;
            return value;
        }
    }

    public void ShowStatus(string nextTitle, Row[] nextRows, Point anchor)
    {
        title = nextTitle;
        rows = nextRows;
        Size = new Size(236, 50 + rows.Sum(row => row.ShowBar ? 32 : 24));

        Rectangle workArea = Screen.FromPoint(anchor).WorkingArea;
        int x = Math.Min(anchor.X, workArea.Right - Width - 8);
        int y = Math.Min(anchor.Y, workArea.Bottom - Height - 8);
        Location = new Point(Math.Max(workArea.Left + 8, x), Math.Max(workArea.Top + 6, y));

        if (!Visible) Show();
        Topmost.Raise(this);
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Theme.DrawPopupBackground(e.Graphics, ClientSize);

        TextRenderer.DrawText(e.Graphics, title, titleFont, new Rectangle(18, 14, Width - 36, 20),
            Theme.Primary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        int y = 43;
        using var trackBrush = new SolidBrush(Color.FromArgb(58, 58, 62));
        using var valueBrush = new SolidBrush(Color.FromArgb(204, 204, 209));
        foreach (Row row in rows)
        {
            TextRenderer.DrawText(e.Graphics, row.Label, rowFont, new Rectangle(18, y, row.Value.Length == 0 ? 200 : 110, 18),
                Theme.Secondary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter
                | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(e.Graphics, row.Value, rowFont, new Rectangle(118, y, 100, 18),
                Theme.Primary, TextFormatFlags.Right | TextFormatFlags.VerticalCenter
                | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);

            if (!row.ShowBar)
            {
                y += 24;
                continue;
            }
            var track = new Rectangle(18, y + 22, 200, 2);
            e.Graphics.FillRectangle(trackBrush, track);
            if (row.Percent is double value)
                e.Graphics.FillRectangle(valueBrush, track.X, track.Y,
                    (int)Math.Round(track.Width * Math.Clamp(value, 0, 100) / 100), track.Height);
            y += 32;
        }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        Theme.ApplyRoundedRegion(this, 14);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            titleFont.Dispose();
            rowFont.Dispose();
        }
        base.Dispose(disposing);
    }
}
