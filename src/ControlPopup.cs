using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace WinBar;

// macOS 메뉴바처럼 항목에 마우스를 올리거나 누르면 뜨는 반투명(글래스) 모달.
// 배터리 · 네트워크 · 소리 · 제어 센터(스위치) · 날짜시간 · … · 카메라/마이크 내용을 그린다.
// 포커스를 가져가지 않아 사용 중인 앱의 한/영 상태가 바뀌지 않는다.
internal sealed class GlassPanel : Form
{
    internal enum Kind { Battery, Network, Sound, Control, Clock, Privacy, More, Bluetooth, Cat, Media }

    // 설정 창과 같은 macOS 메뉴 디자인 수치
    private const int PanelWidth = 320;
    private const int Edge = 6;        // 강조 막대와 창 테두리 사이 여백
    private const int TextLeft = 38;   // 아이콘 다음 글자 시작 위치
    private const int RowHeight = 30;
    private const int BottomGap = 6;
    private const int Radius = 8;      // Windows 11 DWM 둥근 모서리와 같은 반지름

    private readonly SystemMetrics metrics;
    private readonly StatusSensors sensors;
    private readonly Action toggleInput;
    private readonly Font titleFont = new("Segoe UI Semibold", 10.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font bigFont = new("Segoe UI Semibold", 15, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font rowFont = new("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font boldFont = new("Segoe UI Semibold", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font headerFont = new("Segoe UI Semibold", 8f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font smallFont = new("Segoe UI", 8, FontStyle.Regular, GraphicsUnit.Point);
    private readonly System.Windows.Forms.Timer trafficTimer = new() { Interval = 1000 };
    // 호버 강조 애니메이션(움직이는 동안에만 돈다)
    private readonly Dictionary<Rectangle, float> hoverLevels = [];
    private readonly System.Windows.Forms.Timer hoverTimer = new() { Interval = 15 };
    private Rectangle muteArea;
    // Bluetooth 스위치 애니메이션 상태(btTarget: 바꾸는 중일 때 바뀔 상태)
    private bool? btTarget;
    private bool radioMissing;
    private float btFrom, btSwitchTo;
    private long btStart;
    private readonly System.Windows.Forms.Timer switchTimer = new() { Interval = 15 };
    // 제어 센터의 Bluetooth 줄에 마우스를 올리면 왼쪽에 뜨는 세부 창
    private GlassPanel? side;
    private Rectangle bluetoothRow;
    private readonly System.Windows.Forms.Timer sideTimer = new() { Interval = 40 };
    private long sideLeftAt;
    private BluetoothDevice[] pairedDevices = [];
    // 등록된 기기 연결: 연결할 수 있는 오디오 기기 이름, 연결 중인 기기, 실패한 기기
    private HashSet<string> connectable = [];
    private string? connectingName, connectFailed;
    private long connectStart;
    private readonly System.Windows.Forms.Timer connectTimer = new() { Interval = 1000 };
    // 지금 재생 중 모달이 열려 있는 동안만 진행 막대를 0.5초마다 다시 그린다.
    private readonly System.Windows.Forms.Timer mediaTimer = new() { Interval = 500 };
    private long seekHoldUntil;
    private bool pairedExpanded;
    private float pairedLevel;
    // 날짜 달력에서 보고 있는 달(열 때마다 이번 달로)
    private DateTime calendarMonth;
    // 더 보기: 드라이브(이름, 전체, 남은 용량), 다운로드 폴더 최근 파일
    private (string Name, long Total, long Free)[] drives = [];
    private FileInfo[] downloads = [];
    private string? downloadsFolder;
    // 제어 센터 방해 금지: Windows 알림이 꺼져 있으면 켜짐으로 본다
    private bool doNotDisturb;

    private readonly List<(Rectangle Bounds, Action Click)> targets = [];
    private SystemSnapshot snapshot = new();
    private StatusSnapshot status = new();
    private IReadOnlyList<AudioDevice> outputs = [];
    private string[] savedNetworks = [];
    private (long Received, long Sent)? lastTraffic;
    private long lastTrafficAt;
    private double? downMbps, upMbps;
    private bool? radioOn;
    private bool radioBusy;
    private Rectangle sliderTrack, hovered;
    private bool dragging;
    private double? dragValue;
    private bool glass;
    // 나타날 때 메뉴바 아래에서 흘러나오는 애니메이션(위쪽 가장자리에서 아래로 펼쳐지며 내용이 함께 내려온다)
    private const double RevealMs = 240;
    private readonly Action revealFrame;
    private bool revealing;
    private Bitmap? revealImage;       // 펼치는 동안 쓸, 한 번 그려 둔 모달 그림
    private readonly System.Diagnostics.Stopwatch revealClock = new();
    private float reveal = 1;          // 0(안 보임) → 1(다 펼쳐짐)
    private bool systemRounded;        // Windows 11처럼 시스템이 모서리를 둥글게 그리는지
    private long hiddenAt;
    // 네트워크 모달의 저장된 네트워크 펼침(0 접힘 → 1 펼침). 움직이는 동안에만 타이머가 돈다.
    private bool savedExpanded;
    private float savedLevel;
    private readonly System.Windows.Forms.Timer expandTimer = new() { Interval = 15 };

    public Kind Current { get; private set; }

    // 누른 경우(고정): 바깥 클릭·Esc로만 닫힘. 마우스만 올린 경우: 벗어나면 닫힘.
    public bool Pinned { get; private set; }

    public bool RecentlyHidden => Environment.TickCount64 - hiddenAt < 300;

    public GlassPanel(SystemMetrics metrics, StatusSensors sensors, Action toggleInput)
    {
        this.metrics = metrics;
        this.sensors = sensors;
        this.toggleInput = toggleInput;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        ResizeRedraw = true;
        BackColor = Theme.PopupBackground;
        Width = PanelWidth;
        trafficTimer.Tick += (_, _) => SampleTraffic();
        hoverTimer.Tick += (_, _) => AnimateHover();
        switchTimer.Tick += (_, _) =>
        {
            if (Environment.TickCount64 - btStart >= 180) switchTimer.Stop();
            Invalidate();
        };
        sideTimer.Tick += (_, _) => WatchSide();
        connectTimer.Tick += (_, _) => CheckConnect();
        revealFrame = StepReveal;
        mediaTimer.Tick += (_, _) =>
        {
            if (!Visible || Current != Kind.Media) { mediaTimer.Stop(); return; }
            if (NowPlaying.Current is { Playing: true }) Invalidate();
        };
        expandTimer.Tick += (_, _) =>
        {
            static float Step(float value, float target)
            {
                float next = value + (target - value) * 0.3f;
                return Math.Abs(target - next) < 0.01f ? target : next;
            }
            savedLevel = Step(savedLevel, savedExpanded ? 1 : 0);
            pairedLevel = Step(pairedLevel, pairedExpanded ? 1 : 0);
            if (savedLevel == (savedExpanded ? 1 : 0) && pairedLevel == (pairedExpanded ? 1 : 0)) expandTimer.Stop();
            Invalidate();
        };
    }

    // 등록된 기기를 누르면 연결: 요청은 UI 밖 스레드에서 보내고, 1초마다 다시 읽어 10초 안에 연결되면 완료, 아니면 "연결 실패"
    private void ConnectDevice(string name)
    {
        connectingName = name;
        connectFailed = null;
        connectStart = Environment.TickCount64;
        Pinned = true;
        Task.Run(() => SystemMetrics.ConnectBluetoothAudio(name)).ContinueWith(request =>
        {
            if (request.Result || IsDisposed) return;
            // 요청을 보낼 오디오 장치를 찾지 못함: 바로 실패로 표시
            try { BeginInvoke(() => FinishConnect(connected: false)); } catch (Exception) { }
        }, TaskScheduler.Default);
        connectTimer.Start();
        Invalidate();
    }

    private void CheckConnect()
    {
        if (connectingName is not string name) { connectTimer.Stop(); return; }
        pairedDevices = sensors.GetPairedBluetoothDevices();
        if (pairedDevices.Any(device => device.Name == name && device.Connected)) FinishConnect(connected: true);
        else if (Environment.TickCount64 - connectStart > 10_000) FinishConnect(connected: false);
        else Invalidate();
    }

    private void FinishConnect(bool connected)
    {
        if (!connected) connectFailed = connectingName;
        connectingName = null;
        connectTimer.Stop();
        pairedDevices = sensors.GetPairedBluetoothDevices();
        if (Visible) { Height = MeasureHeight(); Invalidate(); }
    }

    private void TogglePairedDevices()
    {
        pairedExpanded = !pairedExpanded;
        if (pairedExpanded)
        {
            pairedDevices = sensors.GetPairedBluetoothDevices();
            connectable = SystemMetrics.FindBluetoothAudioNames(pairedDevices.Select(device => device.Name));
        }
        Height = MeasureHeight();
        expandTimer.Start();
        Invalidate();
    }

    // 이 모달(과 Bluetooth 세부 창) 안에 있는 화면 좌표인지
    public bool ContainsScreenPoint(Point point) =>
        (Visible && Bounds.Contains(point)) || (side is { Visible: true } && side.Bounds.Contains(point));

    private void ShowBluetoothSide()
    {
        if (!Visible || Current != Kind.Control || bluetoothRow.IsEmpty) return;
        side ??= new GlassPanel(metrics, sensors, toggleInput);
        side.ShowSide(Bounds, RectangleToScreen(bluetoothRow).Top - 10, snapshot, status, radioOn);
        sideLeftAt = 0;
        sideTimer.Start();
    }

    // 세부 창으로 열기: 주인 모달의 왼쪽(자리가 없으면 오른쪽)에 위쪽을 Bluetooth 줄에 맞춰 붙인다.
    private void ShowSide(Rectangle owner, int top, SystemSnapshot nextSnapshot, StatusSnapshot nextStatus, bool? radio)
    {
        bool reopen = !Visible || Current != Kind.Bluetooth;
        Current = Kind.Bluetooth;
        snapshot = nextSnapshot;
        status = nextStatus;
        radioOn = radio;
        if (reopen)
        {
            Pinned = false;
            hovered = Rectangle.Empty;
            hoverLevels.Clear();
            pairedExpanded = false;
            pairedLevel = 0;
            pairedDevices = sensors.GetPairedBluetoothDevices();
            connectable = SystemMetrics.FindBluetoothAudioNames(pairedDevices.Select(device => device.Name));
            if (connectingName is null) connectFailed = null;
        }
        Height = MeasureHeight();
        Rectangle work = Screen.FromPoint(owner.Location).WorkingArea;
        int x = owner.Left - 8 - Width;
        if (x < work.Left + 8) x = owner.Right + 8;
        int y = Math.Clamp(top, work.Top + 8, Math.Max(work.Top + 8, work.Bottom - Height - 8));
        Location = new Point(x, y);
        if (!Visible) Show();
        Topmost.Raise(this);
        Invalidate();
    }

    // 세부 창은 마우스가 Bluetooth 줄과 세부 창을 모두 벗어나고 150ms가 지나면 닫는다(사이 틈을 지나는 동안은 유지).
    // 세부 창 안을 누르면 고정되어 주인 모달이 닫힐 때까지 남는다.
    private void WatchSide()
    {
        if (side is not { Visible: true }) { sideTimer.Stop(); return; }
        if (side.Pinned) { sideLeftAt = 0; return; }
        Point cursor = Cursor.Position;
        if (side.Bounds.Contains(cursor) || RectangleToScreen(bluetoothRow).Contains(cursor)) { sideLeftAt = 0; return; }
        long now = Environment.TickCount64;
        if (sideLeftAt == 0) sideLeftAt = now;
        else if (now - sideLeftAt > 150) { side.HidePanel(); sideTimer.Stop(); }
    }

    private void ToggleSavedNetworks()
    {
        savedExpanded = !savedExpanded;
        if (savedExpanded) savedNetworks = sensors.GetSavedNetworks();
        Height = MeasureHeight();
        expandTimer.Start();
        Invalidate();
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            const int WsExToolWindow = 0x80, WsExNoActivate = 0x08000000, CsDropShadow = 0x00020000;
            CreateParams value = base.CreateParams;
            value.ExStyle |= WsExToolWindow | WsExNoActivate;
            value.ClassStyle |= CsDropShadow;
            return value;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Windows 11은 창 모서리를 시스템이 둥글게 그린다. 지원하지 않으면 영역을 잘라 둥글게 만든다.
        int round = 2;
        bool rounded = DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int)) == 0;
        systemRounded = rounded;
        if (!rounded) Theme.ApplyRoundedRegion(this, 14);
        ApplyGlass();
    }

    public void ApplyGlass()
    {
        BackColor = Theme.PopupBackground;
        // 색을 옅게 깔아야 뒤 화면이 흐리게 비친다(macOS 메뉴 모달의 반투명 유리).
        if (IsHandleCreated) glass = BarBackdrop.Apply(Handle, Theme.PopupBackground, Theme.IsLight ? 34 : 42);
        Invalidate();
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (glass) e.Graphics.Clear(Color.Transparent);
        else base.OnPaintBackground(e);
    }

    public void ShowPanel(Kind kind, Rectangle itemScreenBounds, SystemSnapshot nextSnapshot, StatusSnapshot nextStatus, bool pinned)
    {
        bool reopen = !Visible || Current != kind;
        Current = kind;
        Pinned = pinned;
        snapshot = nextSnapshot;
        status = nextStatus;
        if (reopen)
        {
            dragValue = null;
            dragging = false;
            hovered = Rectangle.Empty;
            hoverLevels.Clear();
            calendarMonth = default;
            if (kind != Kind.Control) { side?.HidePanel(); sideTimer.Stop(); }
            if (kind == Kind.Sound) outputs = metrics.GetOutputDevices();
            if (kind == Kind.Network)
            {
                savedExpanded = false;
                savedLevel = 0;
                savedNetworks = sensors.GetSavedNetworks();
                lastTraffic = sensors.ReadTraffic();
                lastTrafficAt = Environment.TickCount64;
                downMbps = upMbps = null;
            }
            if (kind == Kind.Control)
            {
                _ = RefreshRadioAsync();
                doNotDisturb = ReadDoNotDisturb();
            }
            if (kind == Kind.More) LoadMore();
        }
        if (kind == Kind.Cat) ReadTemperatures();
        trafficTimer.Enabled = kind == Kind.Network;
        mediaTimer.Enabled = kind == Kind.Media;

        Height = MeasureHeight();
        // macOS처럼 항목 오른쪽 끝에 맞추되 화면 밖으로 나가지 않게 한다.
        Rectangle work = Screen.FromPoint(itemScreenBounds.Location).WorkingArea;
        Rectangle monitor = Screen.FromPoint(itemScreenBounds.Location).Bounds;
        // 가운데 '지금 재생 중'은 항목 가운데 아래에, 나머지는 macOS처럼 항목 오른쪽 끝에 맞춘다.
        int anchorX = kind == Kind.Media ? itemScreenBounds.Left + itemScreenBounds.Width / 2 + Width / 2 : itemScreenBounds.Right;
        int x = Math.Clamp(anchorX - Width, monitor.Left + 8, monitor.Right - Width - 8);
        int y = itemScreenBounds.Bottom + 6;
        if (y + Height > work.Bottom - 8) y = Math.Max(monitor.Top + 8, work.Bottom - 8 - Height);
        Location = new Point(x, y);
        if (reopen) StartReveal();
        if (!Visible) Show();
        Topmost.Raise(this);
        Invalidate();
    }

    // 펼침 시작: 처음에는 높이 0으로 잘라 두고, 시간 기준(0.24초, 빨리 나와서 천천히 멈춤)으로 아래로 펼친다.
    // 화면 새로 고침마다 한 장면(FrameClock)이고, 내용은 처음 한 번만 그려 두고 옮겨 붙이기만 해 가볍다.
    private void StartReveal()
    {
        reveal = 0;
        revealClock.Restart();
        DropRevealImage();
        ApplyRevealRegion();
        if (!revealing) { revealing = true; FrameClock.Add(revealFrame); }
    }

    private void StepReveal()
    {
        double p = Math.Clamp(revealClock.Elapsed.TotalMilliseconds / RevealMs, 0, 1);
        reveal = (float)(1 - Math.Pow(1 - p, 3));
        if (p >= 1 || !Visible || IsDisposed) StopReveal();
        if (IsDisposed) return;
        ApplyRevealRegion();
        Invalidate();
        Update();
    }

    private void StopReveal()
    {
        reveal = 1;
        revealing = false;
        FrameClock.Remove(revealFrame);
        DropRevealImage();
    }

    private void DropRevealImage()
    {
        revealImage?.Dispose();
        revealImage = null;
    }

    // 보이는 부분만 남기는 창 영역. 다 펼쳐지면 원래대로(시스템 둥근 모서리, 또는 직접 자른 둥근 영역) 돌린다.
    private void ApplyRevealRegion()
    {
        if (!IsHandleCreated) return;
        Region? previous = Region;
        if (reveal >= 1)
        {
            if (systemRounded) Region = null;
            else { Theme.ApplyRoundedRegion(this, 14); return; }
        }
        else
        {
            int shown = Math.Max(1, (int)Math.Round(Height * reveal));
            using GraphicsPath path = Theme.RoundedRectangle(new Rectangle(0, 0, Width, shown), Math.Min(Radius, shown / 2));
            Region = new Region(path);
        }
        previous?.Dispose();
    }

    public void UpdateData(SystemSnapshot nextSnapshot, StatusSnapshot nextStatus)
    {
        snapshot = nextSnapshot;
        status = nextStatus;
        if (!Visible) return;
        // 드래그를 끝낸 뒤 실제 값(사운드: 음량, 제어 센터: 밝기)이 따라오면 임시 값을 버린다.
        double? actualValue = Current == Kind.Control ? snapshot.BrightnessPercent : snapshot.VolumePercent;
        if (Current != Kind.Media && !dragging && dragValue is double pending && actualValue is double actual && Math.Abs(actual - pending) < 1.5)
            dragValue = null;
        if (Current == Kind.Cat) ReadTemperatures();
        int height = MeasureHeight();
        if (Height != height) Height = height;
        Invalidate();
        if (side is { Visible: true }) side.UpdateData(nextSnapshot, nextStatus);
    }

    // 출력 장치가 바뀌었을 때(소리 모달이 열려 있으면 목록을 다시 읽는다)
    public void RefreshOutputs()
    {
        if (!Visible || Current != Kind.Sound) return;
        outputs = metrics.GetOutputDevices();
        Height = MeasureHeight();
        Invalidate();
    }

    public void HidePanel()
    {
        if (!Visible) return;
        dragging = false;
        Capture = false;
        trafficTimer.Stop();
        sideTimer.Stop();
        side?.HidePanel();
        Hide();
        StopReveal();
        MemoryTrim.Request();
        hiddenAt = Environment.TickCount64;
    }

    private async Task RefreshRadioAsync()
    {
        radioOn = await sensors.ReadBluetoothRadioAsync();
        // 다 읽었는데도 라디오가 없으면(Bluetooth 장치가 없는 PC 등) 켜고 끌 수 없음을 알리고 설정으로 안내한다.
        radioMissing = radioOn is null && status.BluetoothOn != true;
        if (Visible) Invalidate();
    }

    // 누르는 즉시 스위치·원 색을 바꿀 상태로 부드럽게 옮기고(Windows가 실제로 바꿀 때까지 기다리지 않음),
    // 실패하면 실제 상태로 다시 미끄러져 돌아간다.
    private async Task ToggleBluetoothAsync()
    {
        if (radioBusy || radioOn is null) return;
        bool target = radioOn != true;
        StartSwitch(target);
        radioBusy = true;
        await sensors.SetBluetoothAsync(target);
        radioOn = await sensors.ReadBluetoothRadioAsync();
        radioBusy = false;
        btTarget = null;
        if ((radioOn == true) != target) StartSwitch(radioOn == true);
        if (Visible) Invalidate();
    }

    // 스위치 애니메이션: 180ms 동안 시간 기준으로 움직인다(화면을 다시 그리는 횟수와 상관없이 일정한 속도).
    private void StartSwitch(bool on)
    {
        btFrom = SwitchPosition();
        btTarget = on;
        btSwitchTo = on ? 1 : 0;
        btStart = Environment.TickCount64;
        switchTimer.Start();
        Invalidate();
    }

    private float SwitchPosition()
    {
        float elapsed = Math.Clamp((Environment.TickCount64 - btStart) / 180f, 0, 1);
        float eased = 1 - (1 - elapsed) * (1 - elapsed) * (1 - elapsed);
        return btFrom + (btSwitchTo - btFrom) * eased;
    }

    private void SampleTraffic()
    {
        if (!Visible || Current != Kind.Network) { trafficTimer.Stop(); return; }
        (long Received, long Sent)? now = sensors.ReadTraffic();
        long at = Environment.TickCount64;
        if (now is { } current && lastTraffic is { } previous && at > lastTrafficAt)
        {
            double seconds = (at - lastTrafficAt) / 1000.0;
            downMbps = Math.Max(0, current.Received - previous.Received) * 8 / 1_000_000.0 / seconds;
            upMbps = Math.Max(0, current.Sent - previous.Sent) * 8 / 1_000_000.0 / seconds;
        }
        lastTraffic = now;
        lastTrafficAt = at;
        Invalidate();
    }

    // ── 높이 계산: 같은 그리기 코드를 작은 그림판에 한 번 돌려 끝 위치를 잰다 ──
    // 시작 직후 한 번, 보이지 않는 그림에 '지금 재생 중' 모달을 실제 크기로 그려 둔다(그리기 코드 준비·글꼴 불러오기).
    // 처음 마우스를 올렸을 때 이 준비가 한꺼번에 몰려 애니메이션이 0.2초 멈추던 것을 막는다.
    public void WarmUp()
    {
        if (Visible || IsDisposed) return;
        Kind saved = Current;
        try
        {
            Current = Kind.Media;
            int height = Math.Max(1, MeasureHeight());
            using var image = new Bitmap(Math.Max(1, Width), height, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
            using Graphics g = Graphics.FromImage(image);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            PaintGlass(g);
            PaintContent(g);
        }
        catch (Exception) { }
        finally { Current = saved; }
    }

    private int MeasureHeight()
    {
        using var scratch = new Bitmap(1, 1);
        using Graphics g = Graphics.FromImage(scratch);
        return PaintContent(g) + BottomGap;
    }

    // ── 호버 애니메이션(설정 창과 같은 방식, 움직이는 동안에만 타이머가 돈다) ──
    private float HoverLevel(Rectangle area) => hoverLevels.TryGetValue(area, out float level) ? level : 0;

    private void SetHovered(Rectangle next)
    {
        if (next == hovered) return;
        if (!next.IsEmpty && !hoverLevels.ContainsKey(next)) hoverLevels[next] = 0;
        hovered = next;
        hoverTimer.Start();
    }

    private void AnimateHover()
    {
        bool moving = false;
        foreach (Rectangle area in hoverLevels.Keys.ToList())
        {
            float target = area == hovered ? 1 : 0;
            float value = hoverLevels[area];
            // macOS 메뉴처럼 강조는 빠르게 켜지고 조금 더 천천히 꺼진다.
            float next = value + (target - value) * (target > 0 ? 0.45f : 0.25f);
            if (Math.Abs(target - next) < 0.01f) next = target;
            if (next == 0 && target == 0) hoverLevels.Remove(area);
            else hoverLevels[area] = next;
            moving |= next != target;
        }
        if (!moving) hoverTimer.Stop();
        Invalidate();
    }

    // ── 그리기 ──────────────────────────────────────────────────
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        // 펼치는 동안 내용은 위(메뉴바 쪽)에서 미끄러져 내려온다. 처음 한 장면에만 내용을 그려 두고 이후에는 옮겨 붙인다.
        if (reveal < 1 && Width > 0 && Height > 0)
        {
            if (revealImage is null || revealImage.Size != Size)
            {
                DropRevealImage();
                revealImage = new Bitmap(Width, Height, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                using Graphics layer = Graphics.FromImage(revealImage);
                layer.SmoothingMode = SmoothingMode.AntiAlias;
                layer.TextRenderingHint = g.TextRenderingHint;
                layer.Clear(glass ? Color.Transparent : BackColor);
                PaintGlass(layer);
                PaintContent(layer);
            }
            g.DrawImageUnscaled(revealImage, 0, -(int)Math.Round(Height * (1 - reveal) * 0.35));
            return;
        }
        PaintGlass(g);
        PaintContent(g);
    }

    // macOS 유리 느낌: 옅은 흐림 위에 위쪽이 살짝 밝은 광택, 안쪽 흰 테두리(빛 반사), 바깥 얇은 테두리.
    private void PaintGlass(Graphics g)
    {
        var bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath body = Theme.RoundedRectangle(bounds, Radius))
        using (var sheen = new LinearGradientBrush(bounds,
                   Color.FromArgb(Theme.IsLight ? 110 : 30, Color.White),
                   Color.FromArgb(Theme.IsLight ? 50 : 8, Color.White), LinearGradientMode.Vertical))
        using (var outer = new Pen(Theme.IsLight ? Color.FromArgb(46, 0, 0, 0) : Color.FromArgb(60, 255, 255, 255)))
        {
            g.FillPath(sheen, body);
            g.DrawPath(outer, body);
        }
        using GraphicsPath inner = Theme.RoundedRectangle(Rectangle.Inflate(bounds, -1, -1), Radius - 1);
        using var light = new Pen(Color.FromArgb(Theme.IsLight ? 150 : 34, Color.White));
        g.DrawPath(light, inner);
    }

    private int PaintContent(Graphics g)
    {
        targets.Clear();
        sliderTrack = muteArea = Rectangle.Empty;
        int y = 0;
        switch (Current)
        {
            case Kind.Battery: PaintBattery(g, ref y); break;
            case Kind.Network: PaintNetwork(g, ref y); break;
            case Kind.Sound: PaintSound(g, ref y); break;
            case Kind.Control: PaintControl(g, ref y); break;
            case Kind.Clock: PaintCalendar(g, ref y); break;
            case Kind.Bluetooth: PaintBluetooth(g, ref y); break;
            case Kind.Cat: PaintCat(g, ref y); break;
            case Kind.Media: PaintMedia(g, ref y); break;
            case Kind.Privacy:
                Header(g, ref y, L.T("개인 정보 표시"), null);
                if (status.CameraInUse) DotRow(g, ref y, Theme.CameraDot, L.T("카메라 사용 중"));
                if (status.MicrophoneInUse) DotRow(g, ref y, Theme.MicrophoneDot, L.T("마이크 사용 중"));
                if (!status.CameraInUse && !status.MicrophoneInUse) InfoRow(g, ref y, "", L.T("사용 중인 장치 없음"), null);
                break;
            default: PaintMore(g, ref y); break;
        }
        return y;
    }

    private void PaintBattery(Graphics g, ref int y)
    {
        string state = snapshot.Charging ? L.T("전원 연결됨 · 충전 중") : L.T("배터리 사용 중");
        if (snapshot.SaverOn) state += L.T(" · 절전 모드 켜짐");
        Header(g, ref y, L.T("배터리"), state);
        // 큰 숫자는 잔량 구간별 색(메뉴바 배터리 채움 색과 같음)
        string percent = snapshot.BatteryPercent is byte p ? $"{p}%" : "--";
        Color percentColor = snapshot.BatteryPercent is byte current ? Theme.BatteryLevel(current, snapshot.SaverThreshold) : Theme.Primary;
        DrawText(g, percent, bigFont, new Rectangle(Width - 120 - 14, 8, 120, 40), percentColor, StringAlignment.Far);

        // Windows 전원 관리자가 내는 남은 사용 예측 시간(직접 계산하지 않음)
        string remaining = snapshot.BatteryMinutes is int minutes
            ? L.Duration(minutes)
            : snapshot.Charging ? L.T("충전 중") : L.T("예측 중");
        InfoRow(g, ref y, "", L.T("남은 사용 예측 시간"), remaining);
        Separator(g, ref y);

        // 절전 모드까지: 막대는 왼쪽 100% → 오른쪽 0%, ▼가 현재 위치, 세로선이 절전 기준
        string remainText = snapshot.SaverOn ? L.T("절전 모드 켜짐")
            : snapshot.BatteryPercent is byte b && snapshot.SaverThreshold is int t ? (b > t ? L.F("절전까지 {0}% 남음", b - t) : L.T("곧 켜짐"))
            : L.T("기준을 읽을 수 없음");
        SectionHeader(g, ref y, L.T("절전 모드"), remainText);
        var track = new Rectangle(16, y + 14, Width - 32, 6);
        int XOf(int value) => track.Left + (int)Math.Round(track.Width * (100 - Math.Clamp(value, 0, 100)) / 100.0);
        Fill(g, track, Theme.IsLight ? Color.FromArgb(30, 0, 0, 0) : Color.FromArgb(40, 255, 255, 255), 3);
        if (snapshot.BatteryPercent is byte level)
        {
            int x = XOf(level);
            Fill(g, Rectangle.FromLTRB(Math.Min(x, track.Right - 6), track.Top, track.Right, track.Bottom),
                Theme.BatteryLevel(level, snapshot.SaverThreshold), 3);
            using var marker = new SolidBrush(Theme.Primary);
            g.FillPolygon(marker, new PointF[] { new(x - 5, track.Top - 11), new(x + 5, track.Top - 11), new(x, track.Top - 3) });
        }
        if (snapshot.SaverThreshold is int threshold)
        {
            int x = XOf(threshold);
            using var pen = new Pen(Theme.Primary, Icons.Stroke(g));
            g.DrawLine(pen, x, track.Top - 4, x, track.Bottom + 4);
            DrawText(g, $"{threshold}%", smallFont, new Rectangle(x - 22, track.Bottom + 5, 44, 16), Theme.Secondary, StringAlignment.Center);
        }
        DrawText(g, "100%", smallFont, new Rectangle(track.Left, track.Bottom + 5, 44, 16), Theme.Secondary);
        DrawText(g, "0%", smallFont, new Rectangle(track.Right - 44, track.Bottom + 5, 44, 16), Theme.Secondary, StringAlignment.Far);
        y += 48;
        Separator(g, ref y);

        ActionRow(g, ref y, Icons.Power, L.T("전원 모드"), L.T(snapshot.PowerMode ?? "알 수 없음"), () => OpenSettings("ms-settings:powersleep"));
        ActionRow(g, ref y, Icons.Settings, L.T("배터리 설정…"), null, () => OpenSettings("ms-settings:batterysaver"));
    }

    private void PaintNetwork(Graphics g, ref int y)
    {
        string state = status.WifiConnecting ? L.T("연결 중…") : status.WifiConnected ? L.T("연결됨") : status.EthernetConnected ? L.T("유선 연결") : L.T("연결 안 됨");
        Header(g, ref y, "Wi-Fi", null, state);

        // 현재 네트워크: macOS처럼 연결되면 파란 원 안의 흰 Wi-Fi 아이콘
        var row = new Rectangle(Edge, y, Width - Edge * 2, 40);
        var circle = new Rectangle(row.Left + 6, row.Top + 6, 28, 28);
        bool on = status.WifiConnected;
        using (var brush = new SolidBrush(on ? Theme.HoverAccent : CircleOff))
            g.FillEllipse(brush, circle);
        Color mark = on ? Color.White : Theme.Primary;
        WifiIcon.Draw(g, Rectangle.Inflate(circle, -6, -7), on ? 5 : 0, mark, Color.FromArgb(110, mark),
            disconnected: !on && !status.WifiConnecting);
        DrawText(g, status.WifiName ?? (status.EthernetConnected ? L.T("유선 네트워크") : L.T("연결된 네트워크 없음")), boldFont,
            new Rectangle(circle.Right + 10, row.Top, row.Width - 50, row.Height), Theme.Primary);
        y += 40;

        InfoRow(g, ref y, "", L.T("현재 속도"), !status.WifiConnected && !status.EthernetConnected ? "--" // 연결이 없으면 잴 것이 없다
            : downMbps is double down && upMbps is double up ? FormatMbps(down + up) : L.T("측정 중…"));
        if (status.EthernetConnected) InfoRow(g, ref y, Icons.Ethernet, L.T("유선 네트워크"), L.T("연결됨"));
        Separator(g, ref y);

        // 저장된 네트워크: 평소에는 접어 두고, 누르면 › 가 아래로 돌면서 목록이 서서히 나타난다.
        var toggle = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
        float level = HoverLevel(toggle);
        Highlight(g, toggle, level, accent: false);
        Icons.DrawBold(g, "", new Rectangle(toggle.Left + 6, toggle.Top, 20, toggle.Height), Theme.Secondary, 9);
        DrawText(g, L.T("저장된 네트워크"), rowFont, new Rectangle(TextLeft, toggle.Top, 160, toggle.Height), Theme.Primary);
        DrawText(g, L.F("{0}개", savedNetworks.Length), smallFont, new Rectangle(toggle.Right - 30 - 80, toggle.Top, 80, toggle.Height), Theme.Secondary, StringAlignment.Far);
        Icons.DrawMoved(g, Icons.Chevron, new Rectangle(toggle.Right - 24, toggle.Top, 16, toggle.Height), Theme.Secondary, 7,
            angle: 90 * Icons.Ease(savedLevel));
        targets.Add((toggle, ToggleSavedNetworks));
        y += RowHeight;
        if (savedExpanded)
        {
            int alpha = (int)Math.Round(255 * savedLevel);
            int slide = (int)Math.Round((1 - savedLevel) * -6);
            if (savedNetworks.Length == 0)
            {
                DrawText(g, L.T("저장된 네트워크 없음"), rowFont, new Rectangle(TextLeft, y + slide, Width - TextLeft - 14, 24), Color.FromArgb(alpha, Theme.Secondary));
                y += 24;
            }
            // 펼치면 전부 보여 준다. 화면 높이에 다 들어가지 않을 때만 "외 N개"로 줄인다.
            int fit = Math.Max(4, (Screen.FromControl(this).WorkingArea.Height - 320) / 24);
            int shown = savedNetworks.Length <= fit ? savedNetworks.Length : fit - 1;
            foreach (string name in savedNetworks.Take(shown))
            {
                bool current = name == status.WifiName;
                DrawText(g, name, current ? boldFont : rowFont, new Rectangle(TextLeft, y + slide, Width - TextLeft - 40, 24), Color.FromArgb(alpha, Theme.Primary));
                if (current) Icons.DrawBold(g, "", new Rectangle(Width - 34, y + slide, 16, 24), Color.FromArgb(alpha, Theme.HoverAccent), 8);
                y += 24;
            }
            if (shown < savedNetworks.Length)
            {
                DrawText(g, L.F("외 {0}개", savedNetworks.Length - shown), smallFont, new Rectangle(TextLeft, y + slide, Width - TextLeft - 14, 24), Color.FromArgb(alpha, Theme.Secondary));
                y += 24;
            }
        }
        Separator(g, ref y);
        string uri = status.WifiAvailable ? "ms-settings:network-wifi" : "ms-settings:network-status";
        ActionRow(g, ref y, Icons.Settings, L.T("네트워크 설정…"), null, () => OpenSettings(uri));
    }

    private void PaintSound(Graphics g, ref int y)
    {
        Header(g, ref y, L.T("사운드"), snapshot.OutputName is string output ? L.T(output) : L.T("출력 장치 없음"));

        // 제어 센터 음량 슬라이더: 캡슐 안 흰 부분이 음량만큼 차오르고, 왼쪽 스피커 아이콘을 누르면 음소거
        double? value = dragValue ?? snapshot.VolumePercent;
        var area = new Rectangle(Edge, y, Width - Edge * 2, 36);
        if (value is double volume)
        {
            double shown = snapshot.Muted && dragValue is null ? 0 : volume;
            float grow = Math.Max(HoverLevel(area) * 0.5f, dragging ? 1 : 0);
            var capsule = Rectangle.Inflate(new Rectangle(area.Left + 8, area.Top + 6, area.Width - 16 - 48, 24), (int)Math.Round(grow), (int)Math.Round(grow));
            int radius = capsule.Height / 2;
            Fill(g, capsule, Theme.IsLight ? Color.FromArgb(26, 0, 0, 0) : Color.FromArgb(34, 255, 255, 255), radius);
            int fill = Math.Max(capsule.Height, (int)Math.Round(capsule.Width * Math.Clamp(shown, 0, 100) / 100));
            var filled = new Rectangle(capsule.Left, capsule.Top, Math.Min(fill, capsule.Width), capsule.Height);
            Fill(g, filled, Theme.IsLight ? Color.White : Color.FromArgb(236, 236, 240), radius);
            using (GraphicsPath edge = Theme.RoundedRectangle(filled, radius))
            using (var pen = new Pen(Theme.IsLight ? Color.FromArgb(28, 0, 0, 0) : Color.FromArgb(40, 0, 0, 0)))
                g.DrawPath(pen, edge);
            muteArea = new Rectangle(capsule.Left, capsule.Top, capsule.Height, capsule.Height);
            Icons.DrawBold(g, Icons.Volume(snapshot.Muted ? 0 : value, snapshot.Muted), Rectangle.Inflate(muteArea, -2, 0),
                Color.FromArgb(110, 110, 116), 8);
            sliderTrack = capsule;
            DrawText(g, snapshot.Muted && dragValue is null ? L.T("음소거") : $"{shown:0}%", smallFont,
                new Rectangle(capsule.Right + 6, area.Top, area.Right - capsule.Right - 12, area.Height),
                Mix(Theme.Secondary, Theme.Primary, Math.Max(HoverLevel(area), dragging ? 1 : 0)), StringAlignment.Far);
            targets.Add((area, () => { }));
        }
        else DrawText(g, L.T("출력 장치 없음"), rowFont, new Rectangle(TextLeft, area.Top, area.Width - TextLeft, area.Height), Theme.Secondary);
        y += 36;
        Separator(g, ref y);

        SectionHeader(g, ref y, L.T("출력 장치"), null);
        if (outputs.Count == 0) InfoRow(g, ref y, "", L.T("사용할 수 있는 장치 없음"), null);
        foreach (AudioDevice device in outputs.Take(8))
        {
            // macOS처럼 선택된 장치는 파란 원, 나머지는 회색 원. 다른 장치에 올리면 파란 강조, 누르면 그 장치로 바꾼다.
            var row = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
            float level = device.IsDefault ? 0 : HoverLevel(row);
            Highlight(g, row, level, accent: true);
            var circle = new Rectangle(row.Left + 6, row.Top + 4, 22, 22);
            using (var brush = new SolidBrush(device.IsDefault ? Theme.HoverAccent : Mix(CircleOff, Color.White, level * 0.3f)))
                g.FillEllipse(brush, circle);
            string glyph = IsHeadphones(device.Name) ? "" : "";
            Icons.DrawBold(g, glyph, Rectangle.Inflate(circle, -4, -4), device.IsDefault ? Color.White : Theme.Primary, 7);
            DrawText(g, L.T(device.Name), device.IsDefault ? boldFont : rowFont, new Rectangle(TextLeft, row.Top, row.Width - TextLeft - 8, row.Height),
                Mix(Theme.Primary, Color.White, level));
            string id = device.Id;
            if (!device.IsDefault) targets.Add((row, () => { metrics.SetDefaultOutput(id); }));
            y += RowHeight;
        }
        Separator(g, ref y);
        ActionRow(g, ref y, "", L.T("볼륨 믹서 열기"), null, OpenVolumeMixer);
        ActionRow(g, ref y, Icons.Settings, L.T("사운드 설정…"), null, () => OpenSettings("ms-settings:sound"));
    }

    private void PaintControl(Graphics g, ref int y)
    {
        Header(g, ref y, L.T("제어 센터"), null);

        // Bluetooth: 파란 원(켜짐) + 이름·상태 + macOS 스위치. 줄을 누르면 켜고 끄고, 마우스를 올리면 왼쪽에 세부 창이 뜬다.
        bool btOn = btTarget ?? (radioOn ?? status.BluetoothOn) == true;
        // 애니메이션 중이 아니면 스위치를 실제 상태에 맞춰 둔다(다른 곳에서 켜고 꺼도 따라감).
        if (!switchTimer.Enabled && btSwitchTo != (btOn ? 1 : 0)) { btFrom = btSwitchTo = btOn ? 1 : 0; }
        string btSub = radioMissing ? L.T("Bluetooth 없음")
            : radioBusy ? (btOn ? L.T("켜는 중…") : L.T("끄는 중…")) : radioOn is null && status.BluetoothOn is null ? L.T("확인 중…")
            : btOn ? L.F("켜짐 · 연결 {0}개", status.BluetoothDevices?.Length ?? 0) : L.T("꺼짐");
        bluetoothRow = ModuleRow(g, ref y, btOn, (gr, circle, color) => Icons.DrawBold(gr, Icons.Bluetooth, Rectangle.Inflate(circle, -6, -6), color, 8),
            "Bluetooth", btSub, () =>
            {
                if (radioMissing) OpenSettings("ms-settings:bluetooth");
                else _ = ToggleBluetoothAsync();
            });
        Icons.DrawMoved(g, Icons.Chevron, new Rectangle(bluetoothRow.Right - 66, bluetoothRow.Top, 14, bluetoothRow.Height), Theme.Secondary, 6,
            dx: -2 * Icons.Ease(HoverLevel(bluetoothRow)), angle: 180);
        DrawSwitch(g, new Rectangle(bluetoothRow.Right - 44, bluetoothRow.Top + (bluetoothRow.Height - 18) / 2, 32, 18), SwitchPosition());

        // 입력 소스: 파란 원(K) + 오른쪽에 K/A 선택 표시. 누르면 전환.
        bool korean = status.InputLabel != "A";
        var inputRow = ModuleRow(g, ref y, korean, (gr, circle, color) => DrawText(gr, korean ? "K" : "A", boldFont, circle, color, StringAlignment.Center),
            L.T("입력 소스"), korean ? "Korea" : "English", () => toggleInput());
        DrawSegment(g, new Rectangle(inputRow.Right - 64, inputRow.Top + (inputRow.Height - 22) / 2, 52, 22), korean);

        // 방해 금지: Windows 알림이 꺼져 있으면 켜짐(파란 달). 켜고 끄는 공식 방법이 없어 누르면 Windows 알림 설정을 연다.
        var dndRow = ModuleRow(g, ref y, doNotDisturb, (gr, circle, color) => Icons.DrawBold(gr, "", Rectangle.Inflate(circle, -7, -7), color, 8),
            L.T("방해 금지"), doNotDisturb ? L.T("켜짐 · 알림 꺼짐") : L.T("꺼짐"), () => OpenSettings("ms-settings:notifications"));
        Icons.DrawMoved(g, Icons.Chevron, new Rectangle(dndRow.Right - 26, dndRow.Top, 16, dndRow.Height), Theme.Secondary, 7,
            dx: 2 * Icons.Ease(HoverLevel(dndRow)));
        Separator(g, ref y);

        // 디스플레이 밝기: macOS 제어 센터처럼 캡슐 슬라이더. 밝기를 바꿀 수 없는 화면(외부 모니터 등)은 디스플레이 설정으로 이동.
        SectionHeader(g, ref y, L.T("디스플레이"), null);
        double? brightness = dragValue ?? snapshot.BrightnessPercent;
        if (brightness is double level)
        {
            var area = new Rectangle(Edge, y, Width - Edge * 2, 36);
            sliderTrack = DrawCapsule(g, area, level, Icons.Brightness, $"{level:0}%");
            y += 36;
        }
        else ActionRow(g, ref y, Icons.Brightness, L.T("디스플레이 설정…"), null, () => OpenSettings("ms-settings:display"));
        Separator(g, ref y);

        // 시스템 사용량: 아이콘 + 이름 + 얇은 막대 + 퍼센트
        SectionHeader(g, ref y, L.T("시스템 사용량"), null);
        PaintUsage(g, ref y);
        y += 4;
    }

    // 시스템 사용량 줄(CPU·GPU·메모리): 아이콘 + 이름 + 얇은 막대 + 퍼센트. 제어 센터와 달리는 고양이 모달이 같이 쓴다.
    private void PaintUsage(Graphics g, ref int y)
    {
        foreach ((string glyph, string label, double? value) in new[]
                 { (Icons.Cpu, "CPU", snapshot.CpuPercent), ("", "GPU", snapshot.GpuPercent), ("", L.T("메모리"), snapshot.RamPercent) })
        {
            var row = new Rectangle(Edge, y, Width - Edge * 2, 26);
            Icons.DrawBold(g, glyph, new Rectangle(row.Left + 6, row.Top, 20, row.Height), Theme.Secondary, 8.5f);
            DrawText(g, label, rowFont, new Rectangle(TextLeft, row.Top, 60, row.Height), Theme.Primary);
            var bar = new Rectangle(TextLeft + 62, row.Top + row.Height / 2 - 3, row.Width - TextLeft - 62 - 46, 6);
            Fill(g, bar, Theme.IsLight ? Color.FromArgb(30, 0, 0, 0) : Color.FromArgb(40, 255, 255, 255), 3);
            if (value is double v && v > 0)
                Fill(g, new Rectangle(bar.Left, bar.Top, Math.Max(6, (int)(bar.Width * Math.Clamp(v, 0, 100) / 100)), bar.Height), Theme.UsageFill(), 3);
            DrawText(g, value is double shownValue ? $"{shownValue:0}%" : "--", smallFont, new Rectangle(bar.Right + 4, row.Top, row.Right - bar.Right - 10, row.Height),
                Theme.Secondary, StringAlignment.Far);
            y += 26;
        }
    }

    // 지금 재생 중 모달: 큰 앨범 그림 · 제목 · 가수 · 앨범, 진행 막대와 시간, 이전·재생/일시정지·다음
    private void PaintMedia(Graphics g, ref int y)
    {
        if (NowPlaying.Current is not NowPlayingInfo media)
        {
            Header(g, ref y, L.T("지금 재생 중"), null);
            InfoRow(g, ref y, "", L.T("재생 중인 곡 없음"), null);
            return;
        }

        // 맨 위: 앱 로고 + 앱 이름(Spotify / YouTube …), 오른쪽에 재생 상태
        MediaLogo.Draw(g, new Rectangle(14, 12, 20, 20), media, Theme.Secondary);
        DrawText(g, media.App, titleFont, new Rectangle(42, 10, Width - 150, 24), Theme.Primary);
        DrawText(g, L.T(media.Playing ? "재생 중" : "일시정지됨"), smallFont, new Rectangle(Width - 14 - 100, 10, 100, 24), Theme.Secondary, StringAlignment.Far);
        y = 42;
        Separator(g, ref y);

        // 앨범 그림 + 제목(굵게) · 가수 · 앨범
        var art = new Rectangle(Edge + 8, y + 4, 76, 76);
        if (media.Art is Bitmap image)
        {
            GraphicsState state = g.Save();
            using GraphicsPath clip = Theme.RoundedRectangle(art, 8);
            g.SetClip(clip);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(image, art);
            g.Restore(state);
        }
        else
        {
            Fill(g, art, Theme.IsLight ? Color.FromArgb(26, 0, 0, 0) : Color.FromArgb(34, 255, 255, 255), 8);
            Icons.DrawBold(g, "", art, Theme.Secondary, 18);
        }
        int textLeft = art.Right + 12, textWidth = Width - textLeft - 14;
        DrawText(g, media.Title, boldFont, new Rectangle(textLeft, art.Top + 6, textWidth, 22), Theme.Primary);
        DrawText(g, media.Artist, rowFont, new Rectangle(textLeft, art.Top + 29, textWidth, 20), Theme.Secondary);
        DrawText(g, media.Album, smallFont, new Rectangle(textLeft, art.Top + 51, textWidth, 18), Theme.Secondary);
        y += 90;

        // 재생 위치 막대: 누르거나 끌면 그 위치로 이동(손을 뗄 때 이동 요청). 마우스를 올리면 손잡이가 커진다.
        if (media.Duration > TimeSpan.Zero)
        {
            var area = new Rectangle(Edge, y, Width - Edge * 2, 22);
            var bar = new Rectangle(Edge + 10, y + 8, Width - (Edge + 10) * 2, 5);
            double actual = Math.Clamp(media.CurrentPosition.TotalSeconds / media.Duration.TotalSeconds, 0, 1);
            bool holding = dragValue is double && (dragging || Environment.TickCount64 < seekHoldUntil);
            double fraction = holding ? Math.Clamp(dragValue!.Value / 100, 0, 1) : actual;
            float hover = Math.Max(HoverLevel(area), dragging ? 1 : 0);
            Fill(g, bar, Theme.IsLight ? Color.FromArgb(30, 0, 0, 0) : Color.FromArgb(40, 255, 255, 255), 3);
            int fill = (int)Math.Round(bar.Width * fraction);
            if (fill > 0) Fill(g, new Rectangle(bar.Left, bar.Top, Math.Max(5, fill), bar.Height), Theme.Primary, 3);
            if (media.CanSeek)
            {
                float radius = 4 + 3 * hover;
                using var knob = new SolidBrush(Theme.Primary);
                g.FillEllipse(knob, bar.Left + fill - radius, bar.Top + bar.Height / 2f - radius, radius * 2, radius * 2);
                sliderTrack = bar;
                targets.Add((area, () => { }));
            }
            TimeSpan shown = TimeSpan.FromSeconds(media.Duration.TotalSeconds * fraction);
            DrawText(g, Clock(shown), smallFont, new Rectangle(bar.Left, bar.Bottom + 4, 70, 16), Theme.Secondary);
            DrawText(g, Clock(media.Duration), smallFont, new Rectangle(bar.Right - 70, bar.Bottom + 4, 70, 16), Theme.Secondary, StringAlignment.Far);
            y += 40;
        }

        // 이전 곡 · 재생/일시정지(가운데, 조금 크게) · 다음 곡
        int center = Width / 2;
        MediaButton(g, new Rectangle(center - 80, y + 4, 38, 38), "", media.CanPrevious, 10, NowPlaying.Previous);
        MediaButton(g, new Rectangle(center - 23, y, 46, 46), media.Playing ? "" : "", media.CanToggle, 14, NowPlaying.TogglePlayPause);
        MediaButton(g, new Rectangle(center + 42, y + 4, 38, 38), "", media.CanNext, 10, NowPlaying.Next);
        y += 54;
    }

    private void MediaButton(Graphics g, Rectangle bounds, string glyph, bool enabled, float points, Action action)
    {
        float level = enabled ? HoverLevel(bounds) : 0;
        if (level > 0)
            using (var brush = new SolidBrush(Theme.HoverTint(Theme.HoverAccent, level * 1.6f)))
                g.FillEllipse(brush, bounds);
        Color color = enabled ? Mix(Theme.Primary, Theme.HoverAccent, level) : Color.FromArgb(90, Theme.Primary);
        Icons.DrawMoved(g, glyph, bounds, color, points, scale: 1 + 0.1f * Icons.Ease(level));
        if (enabled) targets.Add((bounds, () => { action(); Pinned = true; }));
    }

    private static string Clock(TimeSpan time) =>
        time.TotalHours >= 1 ? $"{(int)time.TotalHours}:{time.Minutes:00}:{time.Seconds:00}" : $"{time.Minutes}:{time.Seconds:00}";

    // 달리는 고양이 모달: 지금 CPU와 고양이 속도, 그 아래 시스템 사용량
    private void PaintCat(Graphics g, ref int y)
    {
        double cpu = Math.Clamp(snapshot.CpuPercent ?? 0, 0, 100);
        if (AppSettings.Current.RunCatStyle == "cat")
            Header(g, ref y, L.T("달리는 고양이"), L.F("CPU {0}% · 초당 {1}걸음", Math.Round(cpu), Math.Round(2 + cpu / 100 * 13)));
        else
            // 불꽃 크기 40단계(메뉴바 불꽃과 같은 계산)
            Header(g, ref y, L.T("타오르는 불꽃"), L.F("CPU {0}% · 불꽃 {1}/{2}단계", Math.Round(cpu), FlameIcon.LevelFor(cpu), FlameIcon.Levels));
        SectionHeader(g, ref y, L.T("시스템 사용량"), null);
        PaintUsage(g, ref y);
        // 온도(읽을 수 있는 것만): 막대는 30~100°C 범위
        if (cpuTemperature is not null || gpuTemperature is not null)
        {
            y += 4;
            SectionHeader(g, ref y, L.T("온도"), null);
            if (cpuTemperature is double cpuValue) PaintTemperature(g, ref y, Icons.Cpu, L.T("CPU (본체)"), cpuValue);
            if (gpuTemperature is double gpuValue) PaintTemperature(g, ref y, "\ue7f4", "GPU", gpuValue);
        }
        y += 4;
    }

    private double? cpuTemperature, gpuTemperature;

    private void ReadTemperatures()
    {
        try { (cpuTemperature, gpuTemperature) = metrics.ReadTemperatures(); }
        catch (Exception) { cpuTemperature = gpuTemperature = null; }
    }

    private void PaintTemperature(Graphics g, ref int y, string glyph, string label, double celsius)
    {
        var row = new Rectangle(Edge, y, Width - Edge * 2, 26);
        Icons.DrawBold(g, glyph, new Rectangle(row.Left + 6, row.Top, 20, row.Height), Theme.Secondary, 8.5f);
        DrawText(g, label, rowFont, new Rectangle(TextLeft, row.Top, 90, row.Height), Theme.Primary);
        var bar = new Rectangle(TextLeft + 92, row.Top + row.Height / 2 - 3, row.Width - TextLeft - 92 - 52, 6);
        Fill(g, bar, Theme.IsLight ? Color.FromArgb(30, 0, 0, 0) : Color.FromArgb(40, 255, 255, 255), 3);
        Color color = Theme.TemperatureColor(celsius);
        Fill(g, new Rectangle(bar.Left, bar.Top, Math.Max(6, (int)(bar.Width * Math.Clamp((celsius - 30) / 70, 0, 1))), bar.Height), color, 3);
        // 숫자는 뜨거울 때(75°C 이상)만 색을 입힌다
        bool hot = celsius >= 75 && !AppSettings.Current.MonochromeTemperature;
        DrawText(g, $"{celsius:0}°C", smallFont, new Rectangle(bar.Right + 4, row.Top, row.Right - bar.Right - 10, row.Height),
            hot ? color : Theme.Secondary, StringAlignment.Far);
        y += 26;
    }

    // Bluetooth 세부 창(제어 센터 왼쪽): 연결된 기기, 등록된 기기(접었다 펴기), 새 기기 찾기
    private void PaintBluetooth(Graphics g, ref int y)
    {
        bool btOn = (status.BluetoothOn ?? false) || radioOn == true;
        Header(g, ref y, "Bluetooth", null, btOn ? L.T("켜짐") : L.T("꺼짐"));

        SectionHeader(g, ref y, L.T("연결된 기기"), null);
        BluetoothDevice[] connected = pairedDevices.Where(device => device.Connected).ToArray();
        if (connected.Length == 0 && status.BluetoothDevices is { Length: > 0 } names)
            connected = names.Select(name => new BluetoothDevice(name, true)).ToArray();
        if (connected.Length == 0) InfoRow(g, ref y, Icons.Bluetooth, btOn ? L.T("연결된 기기 없음") : L.T("Bluetooth 꺼짐"), null);
        foreach (BluetoothDevice device in connected)
        {
            var row = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
            var circle = new Rectangle(row.Left + 6, row.Top + 4, 22, 22);
            using (var brush = new SolidBrush(Theme.HoverAccent)) g.FillEllipse(brush, circle);
            Icons.DrawBold(g, Icons.Bluetooth, Rectangle.Inflate(circle, -5, -5), Color.White, 7);
            DrawText(g, device.Name, boldFont, new Rectangle(TextLeft, row.Top, row.Width - TextLeft - 90, row.Height), Theme.Primary);
            DrawDeviceState(g, new Rectangle(row.Right - 96, row.Top, 88, row.Height), device, 255);
            y += RowHeight;
        }
        Separator(g, ref y);

        // 등록된 기기: 평소에는 접어 두고 누르면 펼친다(저장된 네트워크와 같은 방식)
        var toggle = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
        Highlight(g, toggle, HoverLevel(toggle), accent: false);
        Icons.DrawBold(g, "", new Rectangle(toggle.Left + 6, toggle.Top, 20, toggle.Height), Theme.Secondary, 9);
        DrawText(g, L.T("등록된 기기"), rowFont, new Rectangle(TextLeft, toggle.Top, 160, toggle.Height), Theme.Primary);
        DrawText(g, L.F("{0}개", pairedDevices.Length), smallFont, new Rectangle(toggle.Right - 30 - 80, toggle.Top, 80, toggle.Height), Theme.Secondary, StringAlignment.Far);
        Icons.DrawMoved(g, Icons.Chevron, new Rectangle(toggle.Right - 24, toggle.Top, 16, toggle.Height), Theme.Secondary, 7,
            angle: 90 * Icons.Ease(pairedLevel));
        targets.Add((toggle, TogglePairedDevices));
        y += RowHeight;
        if (pairedExpanded)
        {
            int alpha = (int)Math.Round(255 * pairedLevel);
            int slide = (int)Math.Round((1 - pairedLevel) * -6);
            if (pairedDevices.Length == 0)
            {
                DrawText(g, L.T("등록된 기기 없음"), rowFont, new Rectangle(TextLeft, y + slide, Width - TextLeft - 14, 24), Color.FromArgb(alpha, Theme.Secondary));
                y += 24;
            }
            foreach (BluetoothDevice device in pairedDevices.Take(20))
            {
                // 연결이 끊긴 오디오 기기는 누르면 연결한다(파란 강조 + "연결"). 다른 기기는 Windows가 스스로 연결하므로 표시만 한다.
                var row = new Rectangle(Edge, y + slide, Width - Edge * 2, 28);
                bool canConnect = !device.Connected && connectable.Contains(device.Name) && connectingName is null;
                float level = canConnect ? HoverLevel(row) : 0;
                if (canConnect)
                {
                    Highlight(g, row, level, accent: true);
                    string name = device.Name;
                    targets.Add((row, () => ConnectDevice(name)));
                }
                Color text = Mix(Color.FromArgb(alpha, Theme.Primary), Color.White, level);
                DrawText(g, device.Name, device.Connected ? boldFont : rowFont, new Rectangle(TextLeft, row.Top, row.Width - TextLeft - 96, row.Height), text);
                var state = new Rectangle(row.Right - 98, row.Top, 90, row.Height);
                if (device.Connected) DrawDeviceState(g, state, device, alpha);
                else if (connectingName == device.Name) DrawText(g, L.T("연결 중…"), smallFont, state, Color.FromArgb(alpha, Theme.Secondary), StringAlignment.Far);
                else if (connectFailed == device.Name) DrawText(g, L.T("연결 실패"), smallFont, state, Color.FromArgb(alpha, Theme.HoverDanger), StringAlignment.Far);
                else if (canConnect) DrawText(g, L.T("연결"), smallFont, state, Mix(Color.FromArgb(alpha, Theme.HoverAccent), Color.White, level), StringAlignment.Far);
                y += 28;
            }
        }
        Separator(g, ref y);
        ActionRow(g, ref y, "", L.T("새 블루투스 기기 찾기…"), null, () => OpenSettings("ms-settings:bluetooth"));
    }

    // 연결된 기기 오른쪽: 배터리 잔량을 알면 작은 배터리 아이콘 + %(잔량 구간별 색), 모르면 "연결됨"
    private void DrawDeviceState(Graphics g, Rectangle area, BluetoothDevice device, int alpha)
    {
        if (device.Battery is int level)
        {
            // 아이콘 안 채움 색은 메뉴바 배터리와 같은 잔량 구간별 색(DrawBattery가 정한다)
            DrawText(g, $"{level}%", smallFont, new Rectangle(area.Right - 34, area.Top, 34, area.Height), Color.FromArgb(alpha, Theme.Secondary), StringAlignment.Far);
            Icons.DrawBattery(g, new Rectangle(area.Right - 34 - 36, area.Top, 34, area.Height), (byte)Math.Clamp(level, 0, 100), false,
                Color.FromArgb(alpha, Theme.Primary), null);
        }
        else
            DrawText(g, L.T("연결됨"), smallFont, area, Color.FromArgb(alpha, Theme.HoverAccent), StringAlignment.Far);
    }

    // 날짜 달력: 이번 달(‹ › 로 달 이동), 오늘은 파란 원, 일요일은 빨강, 다른 달 날짜는 흐리게
    private void PaintCalendar(Graphics g, ref int y)
    {
        DateTime today = DateTime.Today;
        DateTime month = calendarMonth == default ? new DateTime(today.Year, today.Month, 1) : calendarMonth;
        Header(g, ref y, L.MonthTitle(month), L.TodayLine(today));
        // 달 이동 단추(제목 오른쪽)
        var previous = new Rectangle(Width - 14 - 60, 10, 28, 24);
        var next = new Rectangle(Width - 14 - 28, 10, 28, 24);
        foreach ((Rectangle button, string glyph, int step) in new[] { (previous, "", -1), (next, Icons.Chevron, 1) })
        {
            float level = HoverLevel(button);
            Highlight(g, button, level, accent: true);
            Icons.DrawBold(g, glyph, button, Mix(Theme.Primary, Color.White, level), 7);
            targets.Add((button, () => { calendarMonth = month.AddMonths(step); Height = MeasureHeight(); }));
        }

        const int cell = 40;
        int left = (Width - cell * 7) / 2;
        string[] weekdays = L.WeekdayHeads;
        for (int column = 0; column < 7; column++)
            DrawText(g, weekdays[column], headerFont, new Rectangle(left + column * cell, y, cell, 20),
                column == 0 ? Theme.HoverDanger : Theme.Secondary, StringAlignment.Center);
        y += 24;
        DateTime first = month.AddDays(-(int)month.DayOfWeek);
        int weeks = (int)Math.Ceiling(((int)month.DayOfWeek + DateTime.DaysInMonth(month.Year, month.Month)) / 7.0);
        for (int week = 0; week < weeks; week++)
        {
            for (int column = 0; column < 7; column++)
            {
                DateTime day = first.AddDays(week * 7 + column);
                var box = new Rectangle(left + column * cell, y, cell, 30);
                bool inMonth = day.Month == month.Month;
                bool isToday = day == today;
                if (isToday)
                    using (var brush = new SolidBrush(Theme.HoverAccent))
                        g.FillEllipse(brush, box.Left + (cell - 26) / 2, box.Top + 2, 26, 26);
                Color color = isToday ? Color.White : column == 0 ? Theme.HoverDanger : Theme.Primary;
                if (!inMonth) color = Color.FromArgb(90, color);
                DrawText(g, day.Day.ToString(), isToday ? boldFont : rowFont, box, color, StringAlignment.Center);
            }
            y += 32;
        }
        y += 4;
    }

    // 더 보기: 저장 공간 · 최근 다운로드 · 빠른 동작(모두 이 PC 안에서만 동작)
    private void PaintMore(Graphics g, ref int y)
    {
        Header(g, ref y, L.T("더 보기"), null);

        // 저장 공간: 드라이브별 사용량 막대와 남은 용량. 누르면 Windows 저장소 설정
        SectionHeader(g, ref y, L.T("저장 공간"), null);
        if (drives.Length == 0) InfoRow(g, ref y, "", L.T("드라이브 정보를 읽을 수 없음"), null);
        foreach ((string name, long total, long free) in drives)
        {
            var row = new Rectangle(Edge, y, Width - Edge * 2, 40);
            float level = HoverLevel(row);
            Highlight(g, row, level, accent: false);
            Icons.DrawBold(g, "", new Rectangle(row.Left + 6, row.Top, 20, row.Height), Theme.Secondary, 9);
            DrawText(g, name, rowFont, new Rectangle(TextLeft, row.Top + 3, 150, 20), Theme.Primary);
            DrawText(g, L.F("{0} 남음 / {1}", FormatSize(free), FormatSize(total)), smallFont, new Rectangle(row.Right - 8 - 160, row.Top + 3, 160, 20), Theme.Secondary, StringAlignment.Far);
            var bar = new Rectangle(TextLeft, row.Top + 26, row.Right - 8 - TextLeft, 6);
            Fill(g, bar, Theme.IsLight ? Color.FromArgb(30, 0, 0, 0) : Color.FromArgb(40, 255, 255, 255), 3);
            double used = total > 0 ? (total - free) / (double)total : 0;
            // 거의 가득 차면(90% 이상) 빨강으로 알린다.
            Fill(g, new Rectangle(bar.Left, bar.Top, Math.Max(6, (int)(bar.Width * used)), bar.Height), Theme.UsageFill(used >= 0.9), 3);
            targets.Add((row, () => OpenSettings("ms-settings:storagesense")));
            y += 40;
        }
        Separator(g, ref y);

        // 최근 다운로드: 다운로드 폴더의 최근 파일 5개. 누르면 파일 열기
        SectionHeader(g, ref y, L.T("최근 다운로드"), null);
        if (downloads.Length == 0) InfoRow(g, ref y, "", L.T("최근 다운로드한 파일 없음"), null);
        foreach (FileInfo file in downloads)
        {
            var row = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
            float level = HoverLevel(row);
            Highlight(g, row, level, accent: true);
            Color text = Mix(Theme.Primary, Color.White, level), soft = Mix(Theme.Secondary, Color.White, level);
            Icons.DrawBold(g, "", new Rectangle(row.Left + 6, row.Top, 20, row.Height), soft, 9);
            DrawText(g, file.Name, rowFont, new Rectangle(TextLeft, row.Top, row.Width - TextLeft - 76, row.Height), text);
            DrawText(g, L.Ago(file.LastWriteTime), smallFont, new Rectangle(row.Right - 74, row.Top, 66, row.Height), soft, StringAlignment.Far);
            string path = file.FullName;
            targets.Add((row, () => OpenSettings(path)));
            y += RowHeight;
        }
        if (downloadsFolder is string folder)
            ActionRow(g, ref y, "", L.T("다운로드 폴더 열기"), null, () => OpenSettings(folder));
        Separator(g, ref y);

        // 빠른 동작
        SectionHeader(g, ref y, L.T("빠른 동작"), null);
        ActionRow(g, ref y, "", L.T("화면 캡처"), null, () => { HidePanel(); OpenSettings("ms-screenclip:"); });
        ActionRow(g, ref y, "", L.T("화면 잠금"), null, () => { HidePanel(); LockWorkStation(); });
        ActionRow(g, ref y, "", L.T("절전"), null, () => { HidePanel(); SetSuspendState(false, false, false); });
        // 휴지통 비우기는 Windows가 직접 한 번 더 확인한다.
        ActionRow(g, ref y, "", L.T("휴지통 비우기"), null, () => { HidePanel(); _ = SHEmptyRecycleBin(IntPtr.Zero, null, 0); });
    }

    // 더 보기를 열 때만 드라이브·다운로드 폴더를 읽는다.
    private void LoadMore()
    {
        try
        {
            drives = DriveInfo.GetDrives()
                .Where(drive => drive.DriveType == DriveType.Fixed && drive.IsReady)
                .Take(4)
                .Select(drive => ($"{(string.IsNullOrWhiteSpace(drive.VolumeLabel) ? L.T("로컬 디스크") : drive.VolumeLabel)} ({drive.Name.TrimEnd('\\')})",
                    drive.TotalSize, drive.AvailableFreeSpace))
                .ToArray();
        }
        catch (Exception) { drives = []; }
        try
        {
            // 다운로드 폴더를 지웠거나 옮겨서 없으면 "폴더 열기" 줄도 보이지 않게 한다.
            downloadsFolder = SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"), 0, IntPtr.Zero, out string path) == 0
                && Directory.Exists(path) ? path : null;
            string[] partial = [".crdownload", ".part", ".tmp", ".partial", ".download"];
            downloads = downloadsFolder is null ? [] : new DirectoryInfo(downloadsFolder).EnumerateFiles()
                .Where(file => !partial.Contains(file.Extension.ToLowerInvariant()) && !file.Attributes.HasFlag(FileAttributes.Hidden))
                .OrderByDescending(file => file.LastWriteTime)
                .Take(5)
                .ToArray();
        }
        catch (Exception) { downloads = []; }
    }

    // Windows 설정 > 알림의 전체 알림 켜기/끄기(사용자 레지스트리에서 읽기만 함)
    private static bool ReadDoNotDisturb()
    {
        try
        {
            using Microsoft.Win32.RegistryKey? key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings");
            return key?.GetValue("NOC_GLOBAL_SETTING_TOASTS_ENABLED") is int enabled && enabled == 0;
        }
        catch (Exception) { return false; }
    }

    // 처리 속도 표시: 정수로만 쓰면 웹 서핑 정도의 적은 사용량(1Mbps 미만)이 늘 "0 Mbps"로 보여서
    // 1 미만은 소수 둘째 자리, 10 미만은 첫째 자리, 그 이상은 정수로 쓴다. 예) 0.41 / 3.2 / 59 Mbps
    private static string FormatMbps(double mbps) =>
        mbps < 1 ? $"{mbps:0.00} Mbps" : mbps < 10 ? $"{mbps:0.0} Mbps" : $"{mbps:0} Mbps";

    private static string FormatSize(long bytes) =>        bytes >= 1L << 40 ? $"{bytes / (double)(1L << 40):0.0}TB" : $"{bytes / (double)(1L << 30):0}GB";


    [DllImport("user32.dll")] private static extern bool LockWorkStation();
    [DllImport("powrprof.dll")] private static extern bool SetSuspendState(bool hibernate, bool force, bool disableWakeEvent);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern int SHEmptyRecycleBin(IntPtr window, string? root, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out string path);

    // ── 작은 그리기 도우미(설정 창과 같은 모양) ──────────────────────
    private static Color CircleOff => Theme.IsLight ? Color.FromArgb(222, 222, 226) : Color.FromArgb(78, 78, 84);

    private static float Approach(float value, float target)
    {
        float next = value + (target - value) * 0.3f;
        return Math.Abs(target - next) < 0.02f ? target : next;
    }

    // 맨 위 제목(+ 아래 회색 부제목, + 오른쪽 회색 상태) 다음 얇은 구분선
    private void Header(Graphics g, ref int y, string title, string? subtitle, string? rightText = null)
    {
        DrawText(g, title, titleFont, new Rectangle(14, 10, Width - 150, 24), Theme.Primary);
        if (rightText is not null)
            DrawText(g, rightText, smallFont, new Rectangle(Width - 14 - 140, 10, 140, 24), Theme.Secondary, StringAlignment.Far);
        y = 38;
        if (subtitle is not null)
        {
            DrawText(g, subtitle, smallFont, new Rectangle(14, 31, Width - 150, 18), Theme.Secondary);
            y = 52;
        }
        Separator(g, ref y);
    }

    private void SectionHeader(Graphics g, ref int y, string text, string? rightText)
    {
        DrawText(g, text, headerFont, new Rectangle(14, y, Width - 28, 20), Theme.Secondary);
        if (rightText is not null)
            DrawText(g, rightText, smallFont, new Rectangle(Width - 14 - 170, y, 170, 20), Theme.Secondary, StringAlignment.Far);
        y += 22;
    }

    // 정보 줄: 작은 회색 아이콘 + 이름 + 오른쪽 회색 값(누를 수 없음)
    private void InfoRow(Graphics g, ref int y, string glyph, string label, string? value)
    {
        var row = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
        Icons.DrawBold(g, glyph, new Rectangle(row.Left + 6, row.Top, 20, row.Height), Theme.Secondary, 9);
        DrawText(g, label, rowFont, new Rectangle(TextLeft, row.Top, value is null ? row.Width - TextLeft : 150, row.Height), Theme.Primary);
        if (value is not null)
            DrawText(g, value, rowFont, new Rectangle(TextLeft + 120, row.Top, row.Right - TextLeft - 120 - 8, row.Height), Theme.Secondary, StringAlignment.Far);
        y += RowHeight;
    }

    // 실행 줄: macOS 메뉴처럼 마우스를 올리면 파란 막대 + 흰 글자, › 가 살짝 밀린다.
    private void ActionRow(Graphics g, ref int y, string glyph, string label, string? value, Action action)
    {
        var row = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
        float level = HoverLevel(row);
        Highlight(g, row, level, accent: true);
        Color text = Mix(Theme.Primary, Color.White, level);
        Color soft = Mix(Theme.Secondary, Color.White, level);
        Icons.DrawMoved(g, glyph, new Rectangle(row.Left + 6, row.Top, 20, row.Height), soft, 9, scale: 1 + 0.1f * Icons.Ease(level));
        DrawText(g, label, rowFont, new Rectangle(TextLeft, row.Top, value is null ? row.Width - TextLeft - 30 : 150, row.Height), text);
        if (value is not null)
            DrawText(g, value, rowFont, new Rectangle(row.Right - 26 - 140, row.Top, 140, row.Height), soft, StringAlignment.Far);
        Icons.DrawMoved(g, Icons.Chevron, new Rectangle(row.Right - 24, row.Top, 16, row.Height), soft, 7, dx: 2 * Icons.Ease(level));
        targets.Add((row, action));
        y += RowHeight;
    }

    // 제어 센터 모듈 줄(높이 44): 파란/회색 원 아이콘 + 이름 + 아래 회색 상태. 옅은 회색으로 호버.
    private Rectangle ModuleRow(Graphics g, ref int y, bool on, Action<Graphics, Rectangle, Color> drawMark, string title, string sub, Action action)
    {
        var row = new Rectangle(Edge, y, Width - Edge * 2, 44);
        Highlight(g, row, HoverLevel(row), accent: false);
        var circle = new Rectangle(row.Left + 6, row.Top + 8, 28, 28);
        using (var brush = new SolidBrush(on ? Theme.HoverAccent : CircleOff))
            g.FillEllipse(brush, circle);
        drawMark(g, circle, on ? Color.White : Theme.Primary);
        DrawText(g, title, boldFont, new Rectangle(circle.Right + 10, row.Top + 5, row.Width - 120, 20), Theme.Primary);
        DrawText(g, sub, smallFont, new Rectangle(circle.Right + 10, row.Top + 23, row.Width - 120, 16), Theme.Secondary);
        targets.Add((row, action));
        y += 46;
        return row;
    }

    // 호버 강조. accent: 꽉 찬 파란 막대, 아니면 옅은 회색.
    private static void Highlight(Graphics g, Rectangle row, float level, bool accent)
    {
        if (level <= 0) return;
        Color color = accent
            ? Color.FromArgb((int)Math.Round(255 * level), Theme.HoverAccent)
            : Theme.IsLight ? Color.FromArgb((int)Math.Round(16 * level), 0, 0, 0) : Color.FromArgb((int)Math.Round(22 * level), 255, 255, 255);
        Fill(g, row, color, 6);
    }

    // macOS 스위치(켜면 파랑, 흰 손잡이)
    private static void DrawSwitch(Graphics g, Rectangle bounds, float on)
    {
        Color off = Theme.IsLight ? Color.FromArgb(214, 214, 218) : Color.FromArgb(84, 84, 90);
        Fill(g, bounds, Mix(off, Theme.HoverAccent, on), bounds.Height / 2);
        int knob = bounds.Height - 4;
        float x = bounds.Left + 2 + (bounds.Width - knob - 4) * on;
        using (var shade = new SolidBrush(Color.FromArgb(40, 0, 0, 0)))
            g.FillEllipse(shade, x, bounds.Top + 3, knob, knob);
        using var knobBrush = new SolidBrush(Color.White);
        g.FillEllipse(knobBrush, x, bounds.Top + 2, knob, knob);
    }

    // K / A 두 칸 선택 표시(지금 쓰는 쪽이 흰 바탕)
    private void DrawSegment(Graphics g, Rectangle bounds, bool korean)
    {
        Fill(g, bounds, Theme.IsLight ? Color.FromArgb(26, 0, 0, 0) : Color.FromArgb(34, 255, 255, 255), bounds.Height / 2);
        int half = bounds.Width / 2;
        var active = new Rectangle(korean ? bounds.Left + 2 : bounds.Left + half, bounds.Top + 2, half - 2, bounds.Height - 4);
        Fill(g, active, Theme.IsLight ? Color.White : Color.FromArgb(110, 110, 116), (bounds.Height - 4) / 2);
        DrawText(g, "K", smallFont, new Rectangle(bounds.Left, bounds.Top, half, bounds.Height), korean ? Theme.Primary : Theme.Secondary, StringAlignment.Center);
        DrawText(g, "A", smallFont, new Rectangle(bounds.Left + half, bounds.Top, half, bounds.Height), korean ? Theme.Secondary : Theme.Primary, StringAlignment.Center);
    }

    private void DotRow(Graphics g, ref int y, Color color, string label)
    {
        var row = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
        using (var brush = new SolidBrush(color))
            g.FillEllipse(brush, row.Left + 11, row.Top + 10, 10, 10);
        DrawText(g, label, rowFont, new Rectangle(TextLeft, row.Top, row.Width - TextLeft, row.Height), Theme.Primary);
        y += RowHeight;
    }

    private void Separator(Graphics g, ref int y)
    {
        y += 5;
        using var pen = new Pen(Theme.IsLight ? Color.FromArgb(30, 0, 0, 0) : Color.FromArgb(34, 255, 255, 255));
        g.DrawLine(pen, 14, y, Width - 14, y);
        y += 6;
    }

    private static bool IsHeadphones(string name) =>
        name.Contains("Headphone", StringComparison.OrdinalIgnoreCase) || name.Contains("Headset", StringComparison.OrdinalIgnoreCase)
        || name.Contains("헤드폰") || name.Contains("헤드셋") || name.Contains("Buds", StringComparison.OrdinalIgnoreCase)
        || name.Contains("AirPods", StringComparison.OrdinalIgnoreCase);

    private static Color Mix(Color from, Color to, float amount)
    {
        amount = Math.Clamp(amount, 0, 1);
        return Color.FromArgb(
            (int)Math.Round(from.A + (to.A - from.A) * amount),
            (int)Math.Round(from.R + (to.R - from.R) * amount),
            (int)Math.Round(from.G + (to.G - from.G) * amount),
            (int)Math.Round(from.B + (to.B - from.B) * amount));
    }

    private static void Fill(Graphics g, Rectangle area, Color color, int radius)
    {
        using var brush = new SolidBrush(color);
        using GraphicsPath path = Theme.RoundedRectangle(area, radius);
        g.FillPath(brush, path);
    }

    private static void DrawText(Graphics g, string text, Font font, Rectangle area, Color color, StringAlignment alignment = StringAlignment.Near) =>
        BarText.Draw(g, text, font, area, color, alignment);

    // ── 마우스 ─────────────────────────────────────────────────
    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (dragging) { ApplySlider(e.X); return; }
        Rectangle next = Rectangle.Empty;
        foreach ((Rectangle bounds, _) in targets)
            if (bounds.Contains(e.Location)) { next = bounds; break; }
        Cursor = next.IsEmpty ? Cursors.Default : Cursors.Hand;
        SetHovered(next);
        if (Current == Kind.Control && !bluetoothRow.IsEmpty && next == bluetoothRow) ShowBluetoothSide();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        SetHovered(Rectangle.Empty);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        Pinned = true; // 모달 안을 누르면 고정해서 마우스가 잠깐 벗어나도 닫히지 않게 한다.
        if (!muteArea.IsEmpty && muteArea.Contains(e.Location))
        {
            metrics.SetMute(!snapshot.Muted);
            Invalidate();
            return;
        }
        if (!sliderTrack.IsEmpty && Rectangle.Inflate(sliderTrack, 4, 8).Contains(e.Location))
        {
            dragging = true;
            Capture = true;
            ApplySlider(e.X);
            return;
        }
        foreach ((Rectangle bounds, Action click) in targets.ToArray())
        {
            if (!bounds.Contains(e.Location)) continue;
            try { click(); } catch (Exception) { }
            Invalidate();
            return;
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        // 재생 위치 막대를 놓으면 그 위치로 이동을 요청하고, 앱이 새 위치를 알려 줄 때까지(최대 1.5초) 놓은 위치를 보여 준다.
        if (dragging && Current == Kind.Media && dragValue is double fraction && NowPlaying.Current is NowPlayingInfo media)
        {
            NowPlaying.Seek(TimeSpan.FromSeconds(media.Duration.TotalSeconds * fraction / 100));
            seekHoldUntil = Environment.TickCount64 + 1500;
        }
        dragging = false;
        Capture = false;
    }

    // 사운드 모달은 음량, 제어 센터는 화면 밝기를 바꾼다.
    private void ApplySlider(int x)
    {
        double value = Math.Clamp((x - sliderTrack.Left) * 100.0 / sliderTrack.Width, 0, 100);
        dragValue = value;
        if (Current == Kind.Media) { Invalidate(); return; } // 재생 위치는 손을 뗄 때 한 번만 이동 요청(OnMouseUp)
        if (Current == Kind.Control) metrics.SetBrightness(value);
        else metrics.SetVolume(value);
        Invalidate();
    }

    // 제어 센터식 캡슐 슬라이더(값만큼 흰 부분이 차오르고 왼쪽 끝에 아이콘). 캡슐 영역을 돌려준다.
    private Rectangle DrawCapsule(Graphics g, Rectangle area, double value, string glyph, string valueText)
    {
        float grow = Math.Max(HoverLevel(area) * 0.5f, dragging ? 1 : 0);
        var capsule = Rectangle.Inflate(new Rectangle(area.Left + 8, area.Top + 6, area.Width - 16 - 48, 24), (int)Math.Round(grow), (int)Math.Round(grow));
        int radius = capsule.Height / 2;
        Fill(g, capsule, Theme.IsLight ? Color.FromArgb(26, 0, 0, 0) : Color.FromArgb(34, 255, 255, 255), radius);
        int fill = Math.Max(capsule.Height, (int)Math.Round(capsule.Width * Math.Clamp(value, 0, 100) / 100));
        var filled = new Rectangle(capsule.Left, capsule.Top, Math.Min(fill, capsule.Width), capsule.Height);
        Fill(g, filled, Theme.IsLight ? Color.White : Color.FromArgb(236, 236, 240), radius);
        using (GraphicsPath edge = Theme.RoundedRectangle(filled, radius))
        using (var pen = new Pen(Theme.IsLight ? Color.FromArgb(28, 0, 0, 0) : Color.FromArgb(40, 0, 0, 0)))
            g.DrawPath(pen, edge);
        Icons.DrawBold(g, glyph, new Rectangle(capsule.Left + 2, capsule.Top, capsule.Height - 4, capsule.Height), Color.FromArgb(110, 110, 116), 8);
        DrawText(g, valueText, smallFont, new Rectangle(capsule.Right + 6, area.Top, area.Right - capsule.Right - 12, area.Height),
            Mix(Theme.Secondary, Theme.Primary, Math.Max(HoverLevel(area), dragging ? 1 : 0)), StringAlignment.Far);
        targets.Add((area, () => { }));
        return capsule;
    }

    private void OpenVolumeMixer()
    {
        // Windows 11은 설정의 볼륨 믹서, Windows 10은 기존 볼륨 믹서 창을 연다.
        if (Environment.OSVersion.Version.Build >= 22000) OpenSettings("ms-settings:apps-volume");
        else
            try { Process.Start(new ProcessStartInfo("sndvol.exe") { UseShellExecute = true }); } catch (Exception) { }
    }

    private static void OpenSettings(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch (Exception) { }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            trafficTimer.Dispose();
            expandTimer.Dispose();
            hoverTimer.Dispose();
            switchTimer.Dispose();
            connectTimer.Dispose();
            mediaTimer.Dispose();
            FrameClock.Remove(revealFrame);
            revealImage?.Dispose();
            sideTimer.Dispose();
            side?.Dispose();
            titleFont.Dispose();
            bigFont.Dispose();
            rowFont.Dispose();
            boldFont.Dispose();
            headerFont.Dispose();
            smallFont.Dispose();
        }
        base.Dispose(disposing);
    }

    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}

// macOS처럼 점 + 호 4개로 된 Wi-Fi 아이콘. 1~5칸만큼 진하게, 나머지는 흐리게 그린다.
internal static class WifiIcon
{
    public static void Draw(Graphics g, Rectangle area, int bars, Color on, Color off, bool disconnected = false)
    {
        SmoothingMode previous = g.SmoothingMode;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float size = Math.Min(area.Width, area.Height * 1.25f);
        float cx = area.Left + area.Width / 2f;
        float bottom = area.Top + area.Height / 2f + size * 0.38f;
        float dot = Math.Max(2.5f, size * 0.14f);
        using (var brush = new SolidBrush(bars >= 1 ? on : off))
            g.FillEllipse(brush, cx - dot / 2, bottom - dot, dot, dot);
        // 다른 아이콘과 같은 선 굵기. 아이콘이 아주 작을 때만(호 사이가 붙지 않게) 조금 줄인다.
        float stroke = Math.Min(Icons.Stroke(g), size * 0.1f);
        for (int arc = 1; arc <= 4; arc++)
        {
            float radius = size * (0.16f + arc * 0.14f);
            using var pen = new Pen(bars >= arc + 1 ? on : off, stroke) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawArc(pen, cx - radius, bottom - dot / 2 - radius, radius * 2, radius * 2, 225, 90);
        }
        if (disconnected)
        {
            // macOS처럼 연결이 끊기면 흐린 아이콘 위로 대각선을 긋는다.
            using var slash = new Pen(on, stroke) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawLine(slash, cx - size * 0.42f, bottom - size * 0.86f, cx + size * 0.42f, bottom - size * 0.04f);
        }
        g.SmoothingMode = previous;
    }
}
