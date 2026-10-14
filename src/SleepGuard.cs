using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace WinBar;

// 초절전 모드: 화면은 검게 가리고 밝기를 최저로 내리되, 컴퓨터는 깨어 있게 해 실행 중인 작업(코랩·다운로드·원격 세션)이 끊기지 않게 한다.
// - Windows 전원 설정은 바꾸지 않고, 켜져 있는 동안 "자동 절전으로 넘어가지 않기" 요청만 건다(powercfg /requests 에 보임).
// - 아무 입력이 오면 Windows 기본 잠금 화면으로 넘긴다. 사용자가 평소 비밀번호·PIN·지문으로 풀면 가림막을 닫고 밝기를 되돌린다.
// - WinBar는 비밀번호를 받거나 저장하지 않는다. 시작 → 절전, 덮개 닫기, 전원 단추 같은 사용자의 직접 동작은 막지 않는다.
internal static class SleepGuard
{
    public const int MaxMessageLength = 60;

    private const uint EsContinuous = 0x80000000, EsSystemRequired = 0x00000001, EsDisplayRequired = 0x00000002;
    // 누른 직후 손을 떼며 생기는 마우스 움직임은 깨우는 입력으로 세지 않는다.
    private const int GraceMilliseconds = 1000;

    private static readonly List<CoverForm> covers = [];
    private static readonly System.Windows.Forms.Timer inputTimer = new() { Interval = 250 };
    private static SystemMetrics? metrics;
    private static double? savedBrightness;
    private static long startedAt;
    private static uint baselineInput;
    private static bool locked;

    public static bool Active => covers.Count > 0;

    // 꺼지지 않기(제어 센터): 화면도 컴퓨터도 자동으로 꺼지거나 절전으로 넘어가지 않는다.
    // 전원 설정은 그대로 두며, WinBar를 다시 켜면 꺼진 상태로 시작한다(배터리 소모 방지).
    public static bool KeepAwake { get; private set; }

    public static void SetKeepAwake(bool on)
    {
        KeepAwake = on;
        ApplyExecutionState();
    }

    // 꺼지지 않기와 초절전 모드의 요청을 합쳐 Windows에 한 번에 알린다(같은 UI 스레드에서만 부른다).
    private static void ApplyExecutionState()
    {
        uint flags = EsContinuous;
        if (KeepAwake) flags |= EsSystemRequired | EsDisplayRequired;
        else if (Active) flags |= EsSystemRequired;
        SetThreadExecutionState(flags);
    }

    static SleepGuard() => inputTimer.Tick += (_, _) => CheckInput();

    public static void Start(SystemMetrics systemMetrics, double? currentBrightness)
    {
        if (Active) return;
        try
        {
            metrics = systemMetrics;
            savedBrightness = currentBrightness;
            locked = false;
            startedAt = Environment.TickCount64;
            baselineInput = 0;
            foreach (Screen screen in Screen.AllScreens)
            {
                var cover = new CoverForm(screen.Bounds);
                covers.Add(cover);
                cover.Show();
                Topmost.Raise(cover);
            }
            ApplyExecutionState();
            covers[0].Activate();
            Cursor.Hide();
            SystemEvents.SessionSwitch += OnSessionSwitch;
            if (savedBrightness is not null) metrics.SetBrightness(0);
            inputTimer.Start();
        }
        catch (Exception) { Stop(); }
    }

    // 가림막을 닫고 절전 방지를 풀고 밝기를 되돌린다. 여러 번 불려도 안전하다.
    public static void Stop()
    {
        inputTimer.Stop();
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        // 목록을 먼저 비워, 닫히는 창이 다시 Stop을 부르지 않게 한다.
        CoverForm[] closing = [.. covers];
        covers.Clear();
        bool wasActive = closing.Length > 0;
        foreach (CoverForm cover in closing)
        {
            try { cover.Close(); } catch (Exception) { }
        }
        ApplyExecutionState(); // 꺼지지 않기가 켜져 있으면 그 요청은 유지된다.
        if (wasActive) Cursor.Show();
        if (wasActive && savedBrightness is double brightness) metrics?.SetBrightness(brightness);
        savedBrightness = null;
        locked = false;
        if (wasActive) MemoryTrim.Request();
    }

    // 마지막 입력 시각이 바뀌었으면(키·마우스·터치패드 무엇이든) 잠금 화면으로 넘긴다.
    private static void CheckInput()
    {
        if (locked) return;
        uint last = LastInputTick();
        if (Environment.TickCount64 - startedAt < GraceMilliseconds || baselineInput == 0)
        {
            baselineInput = last;
            return;
        }
        if (last != baselineInput) Wake();
    }

    private static void Wake()
    {
        if (locked) return;
        locked = true;
        // 밝기 0인 채로 잠금 화면이 뜨면 꺼진 것처럼 보이므로, 입력이 오는 즉시 원래 밝기로 되돌린다.
        if (savedBrightness is double brightness) metrics?.SetBrightness(brightness);
        savedBrightness = null;
        // 잠금이 정책으로 막혀 있으면 가림막만 닫는다.
        if (!LockWorkStation()) Stop();
    }

    // SessionSwitch는 UI 스레드가 아닐 수 있어 가림막 창의 스레드로 넘겨 처리한다.
    private static void OnSessionSwitch(object? sender, SessionSwitchEventArgs e)
    {
        if (e.Reason != SessionSwitchReason.SessionUnlock) return;
        CoverForm? owner = covers.FirstOrDefault(cover => cover.IsHandleCreated);
        if (owner is null) return;
        try { owner.BeginInvoke(Stop); } catch (Exception) { }
    }

    private static uint LastInputTick()
    {
        var info = new LastInputInfo { Size = (uint)Marshal.SizeOf<LastInputInfo>() };
        return GetLastInputInfo(ref info) ? info.Time : 0;
    }

    // 설정 > 일반 > 초절전 모드의 화면 문구 입력 창(한 줄, 비워 두면 문구 없음)
    public static void EditMessage()
    {
        AppSettings settings = AppSettings.Current;
        using var font = new Font("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
        using var form = new Form
        {
            Text = L.T("초절전 화면 문구"),
            FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterScreen,
            MinimizeBox = false,
            MaximizeBox = false,
            ShowInTaskbar = false,
            TopMost = true,
            ClientSize = new Size(360, 108),
            Font = font
        };
        var note = new Label { Text = L.T("가운데에 보일 문구 (비워 두면 표시 안 함)"), AutoSize = false };
        note.SetBounds(12, 10, 336, 22);
        var input = new TextBox { Text = settings.SleepMessage, MaxLength = MaxMessageLength };
        input.SetBounds(12, 36, 336, 26);
        var ok = new Button { Text = L.T("저장"), DialogResult = DialogResult.OK };
        ok.SetBounds(186, 72, 78, 28);
        var cancel = new Button { Text = L.T("취소"), DialogResult = DialogResult.Cancel };
        cancel.SetBounds(270, 72, 78, 28);
        form.Controls.AddRange([note, input, ok, cancel]);
        form.AcceptButton = ok;
        form.CancelButton = cancel;
        if (form.ShowDialog() != DialogResult.OK) return;
        settings.SleepMessage = input.Text.Replace("\r", "").Replace("\n", " ").Trim();
        settings.Save();
    }

    // 한 모니터를 덮는 검은 창. 가운데에 설정한 문구를 어둡게 쓴다.
    private sealed class CoverForm : Form
    {
        private readonly Font messageFont = new("Segoe UI", 20f, FontStyle.Regular, GraphicsUnit.Point);

        public CoverForm(Rectangle bounds)
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
            BackColor = Color.Black;
            DoubleBuffered = true;
            Text = "WinBar";
        }

        // 키 입력은 타이머가 마지막 입력 시각으로 감지한다. Alt+F4로 가림막만 닫히는 것은 막지 않는다.
        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            if (covers.Remove(this) && covers.Count == 0) Stop();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            string message = AppSettings.Current.SleepMessage;
            if (message.Length == 0) return;
            TextRenderer.DrawText(e.Graphics, message, messageFont, ClientRectangle, Color.FromArgb(110, 110, 110),
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) messageFont.Dispose();
            base.Dispose(disposing);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo
    {
        public uint Size;
        public uint Time;
    }

    [DllImport("kernel32.dll")] private static extern uint SetThreadExecutionState(uint flags);
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("user32.dll")] private static extern bool LockWorkStation();
}
