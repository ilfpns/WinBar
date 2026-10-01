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
    public static readonly Color BarBackground = Color.FromArgb(30, 30, 32);
    public static readonly Color BarText = Color.FromArgb(232, 232, 235);
    public static readonly Color Dim = Color.FromArgb(118, 118, 124);
    public static readonly Color PopupBackground = Color.FromArgb(36, 36, 38);
    public static readonly Color PopupBorder = Color.FromArgb(70, 70, 74);
    public static readonly Color Primary = Color.FromArgb(236, 236, 239);
    public static readonly Color Secondary = Color.FromArgb(158, 158, 164);
    public static readonly Color Separator = Color.FromArgb(55, 55, 58);
    public static readonly Color Hover = Color.FromArgb(52, 52, 55);
    public static readonly Color Card = Color.FromArgb(44, 44, 47);
    public static readonly Color Track = Color.FromArgb(72, 72, 76);
    public static readonly Color Accent = Color.FromArgb(10, 132, 255);
    public static readonly Color CameraDot = Color.FromArgb(52, 199, 89);
    public static readonly Color MicrophoneDot = Color.FromArgb(255, 159, 10);

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

    public static void DrawPopupBackground(Graphics graphics, Size size, int radius = 14)
    {
        Rectangle body = new(0, 0, size.Width - 1, size.Height - 1);
        using GraphicsPath path = RoundedRectangle(body, radius);
        using var fill = new SolidBrush(PopupBackground);
        using var border = new Pen(PopupBorder);
        graphics.FillPath(fill, path);
        graphics.DrawPath(border, path);
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
        return format;
    }

    public static float Measure(Graphics graphics, string text, Font font) =>
        graphics.MeasureString(text, font, PointF.Empty, Format).Width;

    public static void Draw(Graphics graphics, string text, Font font, Rectangle area, Color color, StringAlignment alignment)
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
    public static bool Apply(IntPtr window, Color tint, int opacityPercent)
    {
        try
        {
            int alpha = (int)Math.Round(Math.Clamp(opacityPercent, 0, 100) * 2.55);
            var accent = new AccentPolicy
            {
                AccentState = 4, // ACCENT_ENABLE_ACRYLICBLURBEHIND
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

    // macOS SF Symbols처럼 굵게 보이도록, 글꼴 외곽선을 채운 뒤 같은 색으로 한 번 더 테두리를 그린다.
    public static void DrawBold(Graphics graphics, string glyph, Rectangle area, Color color, float points = 12)
    {
        float emPixels = graphics.DpiY * points / 72f;
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
        using var pen = new Pen(color, emPixels * 0.05f) { LineJoin = LineJoin.Round };
        graphics.FillPath(brush, path);
        graphics.DrawPath(pen, path);
        graphics.SmoothingMode = previous;
    }

    // macOS 메뉴바 배터리: 둥근 테두리 + 잔량만큼 채움, 충전 중이면 번개, 20% 이하는 빨간색.
    public static void DrawBattery(Graphics graphics, Rectangle area, byte? percent, bool charging, Color color)
    {
        float scale = graphics.DpiY / 96f;
        float width = 23 * scale, height = 11.5f * scale;
        var body = new RectangleF(area.Left + (area.Width - width - 2.5f * scale) / 2f,
            area.Top + (area.Height - height) / 2f, width, height);
        SmoothingMode previous = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;

        using (var outline = new Pen(Color.FromArgb(170, color), 1.1f * scale))
        using (GraphicsPath bodyPath = Rounded(body, 3.2f * scale))
            graphics.DrawPath(outline, bodyPath);
        using (var nub = new SolidBrush(Color.FromArgb(170, color)))
        using (GraphicsPath nubPath = Rounded(new RectangleF(body.Right + 1f * scale, body.Top + height * 0.32f, 1.6f * scale, height * 0.36f), 0.8f * scale))
            graphics.FillPath(nub, nubPath);

        float level = Math.Clamp((percent ?? 0) / 100f, 0, 1);
        var inner = RectangleF.Inflate(body, -2f * scale, -2f * scale);
        if (level > 0)
        {
            Color fillColor = !charging && percent <= 20 ? Color.FromArgb(255, 69, 58) : color;
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

internal sealed class WinBarContext : ApplicationContext
{
    private const uint EventSystemForeground = 0x0003;
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
        RefreshStatus(includeBluetooth: true);
        timer.Tick += (_, _) => OnTick();
        timer.Start();
        metrics.ControlsChanged += OnControlsChanged;
        sensors.Changed += OnStatusChanged;
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
        if (tickCount++ % 30 == 0) TrimWorkingSet();
    }

    private static void TrimWorkingSet()
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

    private void RefreshStatus(bool includeBluetooth)
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

    private void OnStatusChanged()
    {
        if (uiContext is null || Interlocked.Exchange(ref statusPending, 1) == 1) return;
        uiContext.Post(_ =>
        {
            Volatile.Write(ref statusPending, 0);
            RefreshStatus(includeBluetooth: false);
        }, null);
    }

    private void OnSettingsChanged()
    {
        foreach (BarForm bar in bars) bar.ApplyAppearance();
    }

    private void OnWinEvent(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint thread, uint time)
    {
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
        if (foreground != IntPtr.Zero && !IsShellWindow(foreground)
            && GetWindowRect(foreground, out NativeRect window))
        {
            Rectangle windowBounds = Rectangle.FromLTRB(window.Left, window.Top, window.Right, window.Bottom);
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
            bool fullscreen = fullscreenBounds == monitor || (bar.ShellReportsFullscreen && !ownForeground);
            bar.SetFullscreen(fullscreen, pointerAtTop);
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
        sensors.Changed -= OnStatusChanged;
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
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventDelegate callback, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
}

internal sealed class BarForm : Form
{
    private enum Item { None, Privacy, Input, Wifi, Bluetooth, Cpu, Volume, Brightness, Battery, Clock }

    private const int BarHeight = 30;

    private readonly SystemMetrics metrics;
    private readonly StatusSensors sensors;
    private readonly Screen screen;
    private SystemSnapshot snapshot = new();
    private StatusSnapshot status = new();
    private readonly Font font = new("Segoe UI Semibold", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    private string clockText = string.Empty;
    private readonly Font badgeFont = new("Segoe UI Semibold", 7, FontStyle.Regular, GraphicsUnit.Point);
    private readonly StatusPopup statusPopup = new();
    private readonly ControlPopup controlPopup;
    private readonly LogoMenuPopup logoMenu;
    private readonly Dictionary<Item, Rectangle> areas = [];
    private Rectangle logoArea;
    private Item hoverItem;
    private Item openItem;
    private bool logoHovered;
    private bool metricTipVisible;
    private bool appBarRegistered;
    private bool translucent;
    private bool reservePending;
    private bool reserveAfterSlide;
    private bool fullscreenActive;
    private bool edgeRevealArmed;
    private Rectangle reservedBounds;
    private readonly System.Windows.Forms.Timer slideTimer = new() { Interval = 10 };
    private const int SlideDurationMilliseconds = 220;
    private long slideStartedAt;
    private int slideStartTop;
    private readonly System.Windows.Forms.Timer inputTransitionTimer = new() { Interval = 15 };
    private const int InputTransitionDurationMilliseconds = 160;
    private bool inputTransitionInitialized;
    private long inputTransitionStartedAt;
    private double inputPosition;
    private double inputStartPosition;
    private double inputTargetPosition;
    private int visibleTop;
    private int hiddenTop;
    private int targetTop;

    public Rectangle MonitorBounds { get; }

    private readonly Action toggleInput;

    public BarForm(Screen screen, SystemMetrics metrics, StatusSensors sensors, Action requestExit, Action toggleInput)
    {
        this.toggleInput = toggleInput;
        this.screen = screen;
        this.metrics = metrics;
        this.sensors = sensors;
        controlPopup = new ControlPopup(metrics);
        controlPopup.VisibleChanged += (_, _) =>
        {
            if (!controlPopup.Visible) openItem = Item.None;
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
            if (controlPopup.Visible) Topmost.Raise(controlPopup);
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
        // macOS 메뉴바처럼 누르는 순간 메뉴·팝업을 연다.
        MouseDown += OnBarMouseClick;
        MouseLeave += (_, _) =>
        {
            HideMetricTip();
            hoverItem = Item.None;
            logoHovered = false;
            Cursor = Cursors.Default;
            Invalidate();
        };
        slideTimer.Tick += (_, _) => AnimateSlide();
        inputTransitionTimer.Tick += (_, _) => AnimateInputTransition();
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get { const int WsExToolWindow = 0x80, WsExNoActivate = 0x08000000; CreateParams value = base.CreateParams; value.ExStyle |= WsExToolWindow | WsExNoActivate; return value; }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        appBarRegistered = AppBar.Register(Handle);
        if (appBarRegistered) ReserveScreenSpace();
        ApplyAppearance();
    }

    // macOS처럼 배경화면이 비치는 반투명(흐림) 배경. 불투명도는 설정에서 조절한다.
    public void ApplyAppearance()
    {
        translucent = BarBackdrop.Apply(Handle, Theme.BarBackground, AppSettings.Current.BarOpacity);
        Invalidate();
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (translucent) e.Graphics.Clear(Color.Transparent);
        else base.OnPaintBackground(e);
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        if (appBarRegistered) AppBar.Unregister(Handle);
        appBarRegistered = false;
        base.OnHandleDestroyed(e);
    }

    protected override void WndProc(ref Message m)
    {
        // Windows 작업 표시줄이 쓰는 전체 화면 알림: 전체 화면 앱이 열리면 1, 닫히면 0이 온다.
        if (appBarRegistered && m.Msg == AppBar.CallbackMessage && (int)m.WParam == AppBar.FullscreenApp)
            ShellReportsFullscreen = m.LParam != IntPtr.Zero;

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

    private void ReserveScreenSpace()
    {
        if (slideTimer.Enabled)
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
        RefreshPopups();
    }

    public void UpdateStatus(StatusSnapshot value)
    {
        string previousInput = status.InputLabel;
        status = value;
        UpdateInputTransition(previousInput, value.InputLabel);
        UpdateDiagnosticsTitle();
        RefreshPopups();
    }

    private void UpdateInputTransition(string previous, string next)
    {
        double target = next == "A" ? 0 : 1;
        if (!inputTransitionInitialized)
        {
            inputTransitionInitialized = true;
            inputPosition = inputStartPosition = inputTargetPosition = target;
            return;
        }
        if (previous == next && Math.Abs(inputTargetPosition - target) < 0.001) return;
        inputStartPosition = inputPosition;
        inputTargetPosition = target;
        inputTransitionStartedAt = Environment.TickCount64;
        inputTransitionTimer.Start();
    }

    private void AnimateInputTransition()
    {
        double progress = Math.Clamp(
            (Environment.TickCount64 - inputTransitionStartedAt) / (double)InputTransitionDurationMilliseconds, 0, 1);
        double eased = progress * progress * (3 - 2 * progress);
        inputPosition = inputStartPosition + (inputTargetPosition - inputStartPosition) * eased;
        if (areas.TryGetValue(Item.Input, out Rectangle inputArea)) Invalidate(inputArea);
        else Invalidate();
        if (progress < 1) return;
        inputPosition = inputTargetPosition;
        inputTransitionTimer.Stop();
    }

    private void UpdateDiagnosticsTitle()
    {
        string title = $"WinBar|Volume={snapshot.VolumePercent:0}|Brightness={snapshot.BrightnessPercent:0}|Input={status.InputLabel}";
        if (Text != title) Text = title;
    }

    private void RefreshPopups()
    {
        if (metricTipVisible) ShowMetricTip();
        if (controlPopup.Visible) controlPopup.UpdateData(snapshot, status);
        Invalidate();
    }

    public bool ContainsScreenPoint(Point point) =>
        (Visible && Bounds.Contains(point))
        || (logoMenu.Visible && logoMenu.Bounds.Contains(point))
        || (controlPopup.Visible && controlPopup.Bounds.Contains(point));

    public void CloseMenus()
    {
        logoMenu.HideMenu();
        controlPopup.HidePopup();
    }

    public bool RaiseWindowAt(Point cursor)
    {
        foreach (Form form in new Form[] { logoMenu, controlPopup, statusPopup, this })
        {
            if (!form.Visible || !form.Bounds.Contains(cursor)) continue;
            Topmost.Raise(form);
            return true;
        }
        return false;
    }

    // 다른 앱이 항상 위 창을 계속 다시 올려도, WinBar 메뉴·팝업이 열려 있는 동안에는 그 위에 머물게 한다.
    // 팝업이 닫히면 타이머도 멈춘다.
    private readonly System.Windows.Forms.Timer keepOnTopTimer = new() { Interval = 150 };

    private void UpdateKeepOnTop()
    {
        if (logoMenu.Visible || controlPopup.Visible) keepOnTopTimer.Start();
        else keepOnTopTimer.Stop();
    }

    public bool IsShown => targetTop == visibleTop;

    public bool ShellReportsFullscreen { get; private set; }

    public bool HasOpenPopup => logoMenu.Visible || controlPopup.Visible;

    public void SetFullscreen(bool fullscreen, bool pointerAtTop)
    {
        if (!fullscreen)
        {
            fullscreenActive = false;
            edgeRevealArmed = false;
        }
        else if (!fullscreenActive)
        {
            // 전체 화면에 들어가는 순간 커서가 위에 있어도 먼저 숨긴다.
            // 이후 커서가 상단을 떠나야 가장자리 표시가 다시 활성화된다.
            fullscreenActive = true;
            edgeRevealArmed = false;
        }
        else if (!pointerAtTop)
        {
            edgeRevealArmed = true;
        }

        bool revealAtEdge = fullscreen && edgeRevealArmed && pointerAtTop;
        bool shouldHide = fullscreen && !revealAtEdge && !HasOpenPopup;
        int nextTarget = shouldHide ? hiddenTop : visibleTop;
        if (targetTop == nextTarget) return;
        targetTop = nextTarget;
        HideMetricTip();
        slideStartTop = Top;
        slideStartedAt = Environment.TickCount64;
        slideTimer.Start();
    }

    private void AnimateSlide()
    {
        double progress = Math.Clamp(
            (Environment.TickCount64 - slideStartedAt) / (double)SlideDurationMilliseconds, 0, 1);
        // 작은 30px 이동에서도 픽셀 단계가 고르게 보이는 smoothstep 곡선.
        double eased = progress * progress * (3 - 2 * progress);
        int nextTop = progress >= 1
            ? targetTop
            : (int)Math.Round(slideStartTop + (targetTop - slideStartTop) * eased);

        if (nextTop != Top)
            SetBounds(Left, nextTop, Width, Height, BoundsSpecified.Y);

        if (progress >= 1)
        {
            slideTimer.Stop();
            if (reserveAfterSlide)
            {
                reserveAfterSlide = false;
                BeginInvoke(ReserveScreenSpace);
            }
        }
    }

    private Item ItemAt(Point location)
    {
        foreach ((Item item, Rectangle area) in areas)
            if (area.Contains(location)) return item;
        return Item.None;
    }

    private void OnBarMouseMove(object? sender, MouseEventArgs e)
    {
        bool nextLogoHovered = logoArea.Contains(e.Location);
        if (nextLogoHovered != logoHovered)
        {
            logoHovered = nextLogoHovered;
            Invalidate();
        }

        Item next = ItemAt(e.Location);
        Cursor = logoHovered || next != Item.None ? Cursors.Hand : Cursors.Default;
        if (next != hoverItem)
        {
            HideMetricTip();
            hoverItem = next;
            Invalidate();
        }
        if (hoverItem != Item.None && !metricTipVisible && !controlPopup.Visible && !logoMenu.Visible)
            ShowMetricTip();
    }

    private void OnBarMouseClick(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;

        if (logoArea.Contains(e.Location))
        {
            HideMetricTip();
            controlPopup.HidePopup();
            if (logoMenu.Visible)
                logoMenu.HideMenu();
            else if (!logoMenu.RecentlyHidden)
                logoMenu.ShowMenu(PointToScreen(new Point(logoArea.Left, ClientSize.Height + 6)));
            return;
        }

        Item item = ItemAt(e.Location);
        if (item == Item.Input)
        {
            // 메뉴바는 포커스를 가져가지 않으므로, 한/영 키는 지금 사용 중인 앱에 전달된다.
            HideMetricTip();
            toggleInput();
            return;
        }
        ControlPopup.Kind? kind = item switch
        {
            Item.Volume => ControlPopup.Kind.Volume,
            Item.Brightness => ControlPopup.Kind.Brightness,
            Item.Wifi => ControlPopup.Kind.Wifi,
            Item.Bluetooth => ControlPopup.Kind.Bluetooth,
            _ => null
        };
        if (kind is null) return;

        HideMetricTip();
        logoMenu.HideMenu();
        bool sameOpen = (controlPopup.Visible || controlPopup.RecentlyHidden) && openItem == item;
        if (controlPopup.Visible) controlPopup.HidePopup();
        if (sameOpen)
        {
            openItem = Item.None;
            return;
        }
        if (kind == ControlPopup.Kind.Bluetooth) status = sensors.Sample(includeBluetooth: true);
        openItem = item;
        Rectangle area = areas[item];
        controlPopup.ShowControl(kind.Value, PointToScreen(new Point(area.Left - 4, ClientSize.Height + 6)), snapshot, status);
        Invalidate();
    }

    private void ShowMetricTip()
    {
        if (!areas.TryGetValue(hoverItem, out Rectangle area)) return;
        string Value(double? value) => value is null ? "--" : $"{value:0}%";
        string title;
        StatusPopup.Row[] rows;
        switch (hoverItem)
        {
            case Item.Cpu:
                title = "시스템 사용량";
                rows =
                [
                    new("CPU", Value(snapshot.CpuPercent), snapshot.CpuPercent),
                    new("GPU", Value(snapshot.GpuPercent), snapshot.GpuPercent),
                    new("메모리", Value(snapshot.RamPercent), snapshot.RamPercent)
                ];
                break;
            case Item.Volume:
                title = "음량";
                rows = [new(snapshot.Muted ? "음소거" : "출력 음량", Value(snapshot.VolumePercent), snapshot.VolumePercent)];
                break;
            case Item.Brightness:
                title = "화면 밝기";
                rows = [new("밝기", Value(snapshot.BrightnessPercent), snapshot.BrightnessPercent)];
                break;
            case Item.Wifi:
                title = "네트워크";
                rows = status.WifiConnected
                    ? [new(status.WifiName ?? "Wi-Fi", Value(status.WifiQuality), status.WifiQuality)]
                    : [new("Wi-Fi", "연결 안 됨", null, false)];
                if (status.EthernetConnected) rows = [.. rows, new("유선 네트워크", "연결됨", null, false)];
                break;
            case Item.Bluetooth:
                title = "Bluetooth";
                rows =
                [
                    new("상태", status.BluetoothOn == true ? "켜짐" : "꺼짐", null, false),
                    new("연결된 기기", $"{status.BluetoothDevices?.Length ?? 0}개", null, false)
                ];
                break;
            case Item.Input:
                title = "입력 소스";
                rows = [new("현재", status.InputName, null, false)];
                break;
            case Item.Clock:
                title = "날짜와 시간";
                rows = [new(DateTime.Now.ToString("yyyy년 M월 d일") + $" {"일월화수목금토"[(int)DateTime.Now.DayOfWeek]}요일", "", null, false)];
                break;
            case Item.Privacy:
                title = "개인 정보 표시";
                rows = [];
                if (status.CameraInUse) rows = [.. rows, new("카메라", "사용 중", null, false)];
                if (status.MicrophoneInUse) rows = [.. rows, new("마이크", "사용 중", null, false)];
                break;
            default:
                title = "배터리";
                rows = [new(snapshot.Charging ? "충전 중" : "배터리 잔량", Value(snapshot.BatteryPercent), snapshot.BatteryPercent)];
                if (snapshot.BatteryMinutes is int minutes)
                    rows = [.. rows, new("남은 시간", minutes >= 60 ? $"{minutes / 60}시간 {minutes % 60}분" : $"{minutes}분", null, false)];
                break;
        }

        Point anchor = PointToScreen(new Point(area.Left, ClientSize.Height + 5));
        statusPopup.ShowStatus(title, rows, anchor);
        metricTipVisible = true;
    }

    private void HideMetricTip()
    {
        if (!metricTipVisible) return;
        statusPopup.Hide();
        metricTipVisible = false;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            statusPopup.Dispose();
            controlPopup.Dispose();
            logoMenu.Dispose();
            keepOnTopTimer.Dispose();
            badgeFont.Dispose();
            slideTimer.Dispose();
            inputTransitionTimer.Dispose();
            font.Dispose();
        }
        base.Dispose(disposing);
    }

    // 오른쪽부터 배치한다: 시계 · 배터리 · 밝기 · 음량 · 시스템 · Bluetooth · Wi-Fi · 입력 소스 · 카메라/마이크
    private void LayoutItems(AppSettings options, int clockWidth)
    {
        areas.Clear();
        int right = ClientSize.Width - 10;
        void Add(Item item, int width)
        {
            areas[item] = new Rectangle(right - width, 0, width, ClientSize.Height);
            right -= width + 4;
        }
        Add(Item.Clock, clockWidth + 16);
        if (options.ShowBattery && snapshot.BatteryPercent is not null) Add(Item.Battery, options.ShowBatteryPercent ? 88 : 40);
        if (options.ShowBrightness) Add(Item.Brightness, 34);
        if (options.ShowVolume) Add(Item.Volume, 34);
        if (options.ShowSystemUsage) Add(Item.Cpu, 32);
        if (options.ShowBluetooth) Add(Item.Bluetooth, 32);
        if (options.ShowWifi) Add(Item.Wifi, 34);
        if (options.ShowInputSource) Add(Item.Input, 38);
        if (options.ShowPrivacy && (status.CameraInUse || status.MicrophoneInUse))
            Add(Item.Privacy, status.CameraInUse && status.MicrophoneInUse ? 32 : 22);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics graphics = e.Graphics;
        AppSettings options = AppSettings.Current;
        clockText = FormatDateTime(DateTime.Now, options.Use24HourClock);
        int clockWidth = (int)Math.Ceiling(BarText.Measure(graphics, clockText, font));
        LayoutItems(options, clockWidth);
        if (!areas.ContainsKey(hoverItem)) hoverItem = Item.None;

        foreach (Item highlighted in new[] { hoverItem, openItem }.Distinct())
            if (areas.TryGetValue(highlighted, out Rectangle area)) DrawHighlight(graphics, Rectangle.Inflate(area, -1, -4));

        const TextFormatFlags commonFlags = TextFormatFlags.VerticalCenter
            | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding;
        logoArea = new Rectangle(10, 0, 30, ClientSize.Height);
        if (logoHovered || logoMenu.Visible) DrawHighlight(graphics, Rectangle.Inflate(logoArea, 0, -4));
        Icons.DrawBold(graphics, Icons.Logo, logoArea, Theme.BarText, 11);

        foreach ((Item item, Rectangle area) in areas)
        {
            try { DrawItem(graphics, item, area, commonFlags); }
            catch (Exception) { }
        }
    }

    private void DrawItem(Graphics graphics, Item item, Rectangle area, TextFormatFlags flags)
    {
        Color color = Theme.BarText;
        switch (item)
        {
            case Item.Battery:
                if (AppSettings.Current.ShowBatteryPercent)
                {
                    // macOS처럼 퍼센트를 먼저, 배터리 아이콘을 오른쪽에 둔다.
                    BarText.Draw(graphics, $"{snapshot.BatteryPercent}%", font,
                        new Rectangle(area.Left + 2, 0, 46, area.Height), color, StringAlignment.Far);
                    Icons.DrawBattery(graphics, new Rectangle(area.Right - 38, 0, 36, area.Height),
                        snapshot.BatteryPercent, snapshot.Charging, color);
                }
                else
                {
                    Icons.DrawBattery(graphics, area, snapshot.BatteryPercent, snapshot.Charging, color);
                }
                break;
            case Item.Brightness:
                DrawGlyph(graphics, Icons.Brightness, area, snapshot.BrightnessPercent is null ? Theme.Dim : color, flags);
                break;
            case Item.Volume:
                DrawGlyph(graphics, Icons.Volume(snapshot.VolumePercent, snapshot.Muted), area, color, flags);
                break;
            case Item.Cpu:
                DrawGlyph(graphics, Icons.Cpu, area, color, flags);
                break;
            case Item.Bluetooth:
                DrawGlyph(graphics, Icons.Bluetooth, area, status.BluetoothOn == true ? color : Theme.Dim, flags);
                break;
            case Item.Wifi:
                if (status.WifiConnected)
                    DrawGlyph(graphics, Icons.Wifi(status.WifiQuality), area, color, flags);
                else if (status.EthernetConnected)
                    DrawGlyph(graphics, Icons.Ethernet, area, color, flags);
                else
                    DrawGlyph(graphics, Icons.Wifi(null), area, Theme.Dim, flags);
                break;
            case Item.Input:
                DrawInputBadge(graphics, area, color);
                break;
            case Item.Privacy:
                DrawPrivacyDots(graphics, area);
                break;
            case Item.Clock:
                BarText.Draw(graphics, clockText, font, area, color, StringAlignment.Center);
                break;
        }
    }

    private static void DrawGlyph(Graphics graphics, string glyph, Rectangle area, Color color, TextFormatFlags flags) =>
        Icons.DrawBold(graphics, glyph, area, color, 11);

    // 입력 소스를 무채색 스위치로 표시한다. 한국어 K와 영문 A는 같은 색을 사용한다.
    private void DrawInputBadge(Graphics graphics, Rectangle area, Color color)
    {
        var track = new Rectangle(area.Left + (area.Width - 32) / 2, area.Top + (area.Height - 18) / 2, 32, 18);
        SmoothingMode previous = graphics.SmoothingMode;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var trackBrush = new SolidBrush(Theme.Track))
        using (GraphicsPath path = Theme.RoundedRectangle(track, track.Height / 2))
            graphics.FillPath(trackBrush, path);
        const int knob = 14;
        int knobLeft = (int)Math.Round(track.Left + 2 + (track.Width - knob - 4) * inputPosition);
        using (var knobBrush = new SolidBrush(Color.FromArgb(250, 250, 252)))
            graphics.FillEllipse(knobBrush, knobLeft, track.Top + 2, knob, knob);
        graphics.SmoothingMode = previous;

        var alternativeLabel = new Rectangle(track.Left + 2, track.Top, track.Width - knob - 4, track.Height);
        var englishLabel = new Rectangle(track.Left + knob + 2, track.Top, track.Width - knob - 4, track.Height);
        int alternativeAlpha = (int)Math.Round(color.A * inputPosition);
        int englishAlpha = (int)Math.Round(color.A * (1 - inputPosition));
        if (alternativeAlpha > 0)
            BarText.Draw(graphics, status.InputLabel == "A" ? "K" : status.InputLabel, badgeFont,
                alternativeLabel, Color.FromArgb(alternativeAlpha, color), StringAlignment.Center);
        if (englishAlpha > 0)
            BarText.Draw(graphics, "A", badgeFont, englishLabel,
                Color.FromArgb(englishAlpha, color), StringAlignment.Center);
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
        // macOS처럼 반투명 흰색으로 눌린 항목을 표시한다.
        using var highlight = new SolidBrush(Color.FromArgb(46, 255, 255, 255));
        using GraphicsPath path = Theme.RoundedRectangle(area, 6);
        graphics.FillPath(highlight, path);
        graphics.SmoothingMode = previous;
    }

    // macOS 한국어 메뉴바 형식: "10월 1일 (목) 오후 1:12"
    private static string FormatDateTime(DateTime value, bool use24Hour)
    {
        string[] days = ["일", "월", "화", "수", "목", "금", "토"];
        string date = $"{value.Month}월 {value.Day}일 ({days[(int)value.DayOfWeek]})";
        if (use24Hour) return $"{date} {value:HH}:{value:mm}";
        string period = value.Hour < 12 ? "오전" : "오후";
        int hour = value.Hour % 12;
        if (hour == 0) hour = 12;
        return $"{date} {period} {hour}:{value:mm}";
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

    // 메뉴 바깥(로고 포함)을 눌러 닫힌 직후의 클릭은 다시 열지 않는다.
    public bool RecentlyHidden => Environment.TickCount64 - hiddenAt < 300;

    public void HideMenu()
    {
        if (!Visible) return;
        Hide();
        hiddenAt = Environment.TickCount64;
    }

    // 다른 곳을 클릭해 포커스를 잃으면 자동으로 닫는다.
    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        HideMenu();
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
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        hovered = Rectangle.Empty;
        Cursor = Cursors.Default;
        Invalidate();
    }

    protected override void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        if (e.Button != MouseButtons.Left) return;
        if (settingsArea.Contains(e.Location))
        {
            HideMenu();
            SettingsForm.ShowModal(screen, requestExit);
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

        DrawItem(e.Graphics, settingsArea, Icons.Settings, "설정", showChevron: true);
        DrawItem(e.Graphics, exitArea, Icons.Power, "WinBar 종료", showChevron: false);
    }

    private void DrawItem(Graphics graphics, Rectangle area, string glyph, string label, bool showChevron)
    {
        if (hovered == area)
        {
            using var hover = new SolidBrush(Theme.Hover);
            using GraphicsPath itemPath = Theme.RoundedRectangle(area, 9);
            graphics.FillPath(hover, itemPath);
        }
        TextRenderer.DrawText(graphics, glyph, iconFont,
            new Rectangle(area.Left + 10, area.Top, 24, area.Height), Theme.Secondary,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        TextRenderer.DrawText(graphics, label, itemFont,
            new Rectangle(area.Left + 43, area.Top, 130, area.Height), Theme.Primary,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        if (showChevron)
            TextRenderer.DrawText(graphics, Icons.Chevron, iconFont,
                new Rectangle(area.Right - 30, area.Top, 20, area.Height), Theme.Secondary,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
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
