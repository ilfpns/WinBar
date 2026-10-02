using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Reflection;
using System.Runtime.InteropServices;

namespace WinBar;

// macOS 메뉴바 드롭다운(제어 센터·메뉴)처럼 생긴 설정 창. 설정을 누른 WinBar 메뉴 바로 옆에 붙어 뜬다.
// - 반투명 유리 바탕, 30px 높이의 촘촘한 줄, 작은 단색 아이콘, 회색 소제목과 얇은 구분선
// - 이동·실행 줄은 macOS 메뉴처럼 파란 강조 막대 + 흰 글자, 스위치 줄은 옅은 회색으로 호버
// - macOS식 작은 파란 스위치, 제어 센터식 캡슐 슬라이더(안에 아이콘)
// 첫 화면은 분류 목록, 분류를 누르면 세부 페이지가 옆에서 밀려 들어온다. 바깥 클릭·Esc·닫기로 닫힌다.
internal sealed class SettingsForm : Form
{
    // IsLink: 스위치 대신 › 를 그리고 누르면 Set(true)로 동작한다. Text·Glyph가 있으면 그때그때 읽어 표시한다.
    private sealed record Option(string Label, string Glyph, Func<bool> Get, Action<bool> Set, bool IsLink = false,
        Func<string>? Text = null, Func<string>? DynamicGlyph = null, bool IsChoice = false, string? Badge = null);
    private sealed record Slider(string Label, string Glyph, int Min, int Max, string Unit, Func<int> Get, Action<int> Preview, Action Commit);
    private sealed record Section(string Header, Option[] Options, Slider? Slider = null, string? Note = null);
    private sealed record Page(string Title, string Glyph, Section[] Sections, bool About = false);

    private static SettingsForm? instance;

    private readonly Rectangle anchor;
    private readonly Page[] pages;
    private readonly Font titleFont = new("Segoe UI Semibold", 10.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font rowFont = new("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font headerFont = new("Segoe UI Semibold", 8f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font smallFont = new("Segoe UI", 8f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly List<(Rectangle Bounds, Option Option)> optionRows = [];
    private readonly List<(Rectangle Bounds, Page Page)> pageRows = [];
    private readonly List<(Rectangle Area, Rectangle Track, Slider Slider)> sliders = [];
    private Page? current;
    private Rectangle closeArea, backArea, hovered, pressed;
    private bool autoStart = AppSettings.IsAutoStartEnabled();
    private Slider? activeSlider;
    private int? dragValue;
    private bool glassApplied;
    private bool dwmRounded;
    // Windows 11 둥근 모서리를 못 쓸 때만 창 모양(영역)을 직접 잘라 둥글게 만든다. 창을 만드는 도중의 크기 변경에서는 쓰지 않는다.
    private bool useRegion;
    private bool? appliedLight;

    // ── 애니메이션 상태(움직이는 동안에만 타이머가 돈다) ──
    private readonly System.Windows.Forms.Timer animationTimer = new() { Interval = 15 };
    private readonly Dictionary<Rectangle, float> hoverLevels = [];  // 0(보통) → 1(마우스 올림)
    private readonly Dictionary<Option, (float From, long Start)> switchAnimations = []; // 스위치가 움직이기 시작한 위치·시각
    private float dragLevel;                                          // 슬라이더를 잡은 정도
    private float pageLevel = 1;                                      // 페이지 전환 진행(0 → 1)
    private int pageDirection = 1;                                    // 1: 앞으로(오른쪽에서), -1: 뒤로

    private const int PanelWidth = 320;
    private const int Edge = 6;        // 강조 막대와 창 테두리 사이 여백(macOS 메뉴)
    private const int TextLeft = 38;   // 아이콘 다음 글자 시작 위치
    private const int RowHeight = 30;
    private const int SliderRowHeight = 36;
    private const int HeaderHeight = 44;

    // anchor: 설정을 누른 메뉴 창의 화면 위치. 그 오른쪽(자리가 없으면 왼쪽)에 붙여 연다.
    public static void ShowBeside(Rectangle anchor)
    {
        if (instance is { IsDisposed: false })
        {
            Topmost.Raise(instance);
            return;
        }
        instance = new SettingsForm(anchor);
        instance.Show();
        Topmost.Raise(instance);
    }

    public static void CloseIfOpen()
    {
        if (instance is { IsDisposed: false }) instance.Close();
    }

    public static bool IsOpen => instance is { IsDisposed: false, Visible: true };

    public static bool ContainsScreenPoint(Point point) =>
        instance is { IsDisposed: false, Visible: true } && instance.Bounds.Contains(point);

    // 포커스를 가져가지 않아 사용 중인 앱의 한/영 상태가 바뀌지 않는다.
    protected override bool ShowWithoutActivation => true;

    private SettingsForm(Rectangle anchor)
    {
        this.anchor = anchor;
        AppSettings settings = AppSettings.Current;
        Option Toggle(string label, string glyph, Func<AppSettings, bool> get, Action<AppSettings, bool> set) =>
            new(label, glyph, () => get(settings), value => { set(settings, value); settings.Save(); });

        Option autoStartOption = AppSettings.IsPackaged
            // 스토어 설치본: 사용자가 Windows 설정 > 앱 > 시작 프로그램에서 직접 켠다.
            ? new("로그인 시 자동 실행 (Windows 설정)", Icons.Power, () => false, _ =>
            {
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:startupapps") { UseShellExecute = true }); }
                catch (Exception) { }
            }, IsLink: true)
            : new("로그인 시 자동 실행", Icons.Power, () => autoStart, value =>
            {
                if (AppSettings.SetAutoStart(value)) autoStart = value;
            });

        pages =
        [
            new("일반", "",
            [
                new("시작", [autoStartOption]),
                new("시계", [Toggle("24시간 형식", "", s => s.Use24HourClock, (s, v) => s.Use24HourClock = v)])
            ]),
            new("모양", "",
            [
                new("테마", [new("테마 전환", "", () => false, _ => { settings.LightMode = !settings.LightMode; settings.Save(); },
                    IsLink: true, Text: () => L.T(settings.LightMode ? "다크 모드 전환" : "화이트 모드 전환"),
                    DynamicGlyph: () => settings.LightMode ? "" : "")]),
                new("메뉴바 불투명도", [],
                    new Slider("메뉴바 불투명도", "", 0, 100, "%", () => settings.BarOpacity,
                        value => { settings.BarOpacity = value; settings.Preview(); }, settings.Save),
                    Note: "0% 배경 없음 · 100% 불투명")
            ]),
            new("메뉴바", "",
            [
                new("표시할 항목",
                [
                    Toggle("카메라·마이크 사용 표시", "", s => s.ShowPrivacy, (s, v) => s.ShowPrivacy = v),
                    Toggle("배터리", "", s => s.ShowBattery, (s, v) => s.ShowBattery = v),
                    Toggle("네트워크", "", s => s.ShowWifi, (s, v) => s.ShowWifi = v),
                    Toggle("소리", "", s => s.ShowVolume, (s, v) => s.ShowVolume = v)
                ], Note: "제어 센터·날짜·시간은 항상 표시"),
                new("아이콘 간격", [],
                    new Slider("아이콘 사이 간격", "", AppSettings.MinIconSpacing, AppSettings.MaxIconSpacing, "px",
                        () => settings.IconSpacing,
                        value => { settings.IconSpacing = value; settings.Preview(); }, settings.Save))
            ]),
            new("언어", "\uE774",
            [
                // 언어 이름은 그 언어로 쓰고, 앞에 한·中·日·E 표시를 붙인다. 누르면 바로 바뀐다.
                new("표시 언어", [.. L.Languages.Select(language => new Option(language.Name, "", () => L.Code == language.Code,
                    _ => { settings.Language = language.Code; settings.Save(); }, IsChoice: true, Badge: language.Badge))])
            ]),
            new("정보", "", [], About: true)
        ];

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        // 페이지를 바꿔 창이 커져도 늘어난 부분까지 전부 다시 그린다.
        ResizeRedraw = true;
        KeyPreview = true;
        BackColor = Theme.PopupBackground;
        Text = "WinBar 설정";
        AccessibleName = "WinBar 설정";
        Width = PanelWidth;
        PlaceBesideAnchor();

        animationTimer.Tick += (_, _) => AnimateStep();
        settings.Changed += ApplyAppearance;
        FormClosed += (_, _) =>
        {
            if (instance == this) instance = null;
            MemoryTrim.Request();
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int round = 2;
        dwmRounded = DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int)) == 0;
        useRegion = !dwmRounded;
        if (useRegion) Theme.ApplyRoundedRegion(this, 12);
        else Region = null; // 만드는 도중 잘못 잘린 영역이 남아 있으면 지운다.
        ApplyAppearance();
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (IsHandleCreated && useRegion) Theme.ApplyRoundedRegion(this, 12);
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (glassApplied) e.Graphics.Clear(Color.Transparent);
        else base.OnPaintBackground(e);
    }

    // 메뉴바 호버 모달과 같은 옅은 유리(뒤 화면이 흐리게 비침)
    private void ApplyAppearance()
    {
        if (IsDisposed) return;
        // 테마가 그대로면 유리 효과를 다시 걸지 않고 다시 그리기만 한다(스위치 애니메이션이 끊기지 않게).
        if (appliedLight == Theme.IsLight && IsHandleCreated)
        {
            Invalidate();
            return;
        }
        if (IsHandleCreated) appliedLight = Theme.IsLight;
        BackColor = Theme.PopupBackground;
        if (IsHandleCreated)
            glassApplied = BarBackdrop.Apply(Handle, Theme.PopupBackground, Theme.IsLight ? 40 : 46);
        Invalidate();
    }

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

    // 메뉴 오른쪽에 위쪽을 맞춰 붙이고, 화면 밖으로 나가면 왼쪽으로 옮기거나 안쪽으로 당긴다.
    private void PlaceBesideAnchor()
    {
        Rectangle work = Screen.FromPoint(anchor.Location).WorkingArea;
        int height = Math.Min(MeasureHeight(), work.Height - 16);
        int x = anchor.Right + 6;
        if (x + PanelWidth > work.Right - 8) x = anchor.Left - 6 - PanelWidth;
        x = Math.Clamp(x, work.Left + 8, Math.Max(work.Left + 8, work.Right - PanelWidth - 8));
        int y = Math.Clamp(anchor.Top, work.Top + 8, Math.Max(work.Top + 8, work.Bottom - height - 8));
        Bounds = new Rectangle(x, y, PanelWidth, height);
    }

    private int MeasureHeight()
    {
        using var scratch = new Bitmap(1, 1);
        using Graphics graphics = Graphics.FromImage(scratch);
        return PaintContent(graphics);
    }

    private void Navigate(Page? page)
    {
        pageDirection = page is null ? -1 : 1;
        current = page;
        hovered = pressed = Rectangle.Empty;
        hoverLevels.Clear();
        switchAnimations.Clear();
        pageLevel = 0;
        PlaceBesideAnchor();
        StartAnimation();
        Refresh();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) Close();
        else if (e.KeyCode == Keys.Back && current is not null) Navigate(null);
    }

    // ── 애니메이션 ──────────────────────────────────────────────
    private void StartAnimation()
    {
        if (!animationTimer.Enabled) animationTimer.Start();
    }

    // 목표값으로 매 프레임 일정 비율씩 다가간다(약 120~150ms에 거의 도착).
    private static float Approach(float value, float target, float rate = 0.3f)
    {
        float next = value + (target - value) * rate;
        return Math.Abs(target - next) < 0.01f ? target : next;
    }

    private void AnimateStep()
    {
        bool moving = false;
        foreach (Rectangle area in hoverLevels.Keys.ToList())
        {
            float target = area == hovered ? 1 : 0;
            // macOS 메뉴처럼 강조는 빠르게 켜지고 조금 더 천천히 꺼진다.
            float level = Approach(hoverLevels[area], target, target > 0 ? 0.45f : 0.25f);
            if (level == 0 && target == 0) hoverLevels.Remove(area);
            else hoverLevels[area] = level;
            moving |= level != target;
        }
        foreach ((Option option, (float From, long Start) animation) in switchAnimations.ToList())
        {
            if (Environment.TickCount64 - animation.Start >= SwitchMilliseconds) switchAnimations.Remove(option);
            else moving = true;
        }
        dragLevel = Approach(dragLevel, activeSlider is null ? 0 : 1, 0.35f);
        moving |= dragLevel != (activeSlider is null ? 0 : 1);
        pageLevel = Approach(pageLevel, 1, 0.22f);
        moving |= pageLevel != 1;

        if (!moving) animationTimer.Stop();
        Invalidate();
    }

    private float HoverLevel(Rectangle area) => hoverLevels.TryGetValue(area, out float level) ? level : 0;

    // 스위치는 시간 기준으로 180ms 동안 미끄러진다(다시 그리는 횟수와 상관없이 일정한 속도, 빠르게 출발해 부드럽게 멈춤).
    private const int SwitchMilliseconds = 180;

    private float SwitchLevel(Option option)
    {
        float to = option.Get() ? 1 : 0;
        if (!switchAnimations.TryGetValue(option, out (float From, long Start) animation)) return to;
        float t = Math.Clamp((Environment.TickCount64 - animation.Start) / (float)SwitchMilliseconds, 0, 1);
        float eased = 1 - (1 - t) * (1 - t) * (1 - t);
        return animation.From + (to - animation.From) * eased;
    }

    private void SetHovered(Rectangle next)
    {
        if (next == hovered) return;
        if (!next.IsEmpty && !hoverLevels.ContainsKey(next)) hoverLevels[next] = 0;
        hovered = next;
        StartAnimation();
    }

    // ── 그리기 ──────────────────────────────────────────────────
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        PaintGlass(graphics);
        if (pageLevel >= 1)
        {
            PaintContent(graphics);
            return;
        }

        // 페이지 전환: 새 페이지가 옆에서 살짝 밀려 들어오며 서서히 나타난다.
        using var frame = new Bitmap(Math.Max(1, ClientSize.Width), Math.Max(1, ClientSize.Height), PixelFormat.Format32bppPArgb);
        using (Graphics layer = Graphics.FromImage(frame))
        {
            layer.SmoothingMode = SmoothingMode.AntiAlias;
            layer.Clear(Color.Transparent);
            PaintContent(layer);
        }
        float eased = 1 - (1 - pageLevel) * (1 - pageLevel) * (1 - pageLevel);
        int offset = (int)Math.Round((1 - eased) * 24 * pageDirection);
        using var attributes = new ImageAttributes();
        attributes.SetColorMatrix(new ColorMatrix { Matrix33 = eased });
        graphics.DrawImage(frame, new Rectangle(offset, 0, frame.Width, frame.Height),
            0, 0, frame.Width, frame.Height, GraphicsUnit.Pixel, attributes);
    }

    // 메뉴바 호버 모달과 같은 유리: 위가 살짝 밝은 광택, 안쪽 흰 빛 테두리, 바깥 얇은 테두리
    private void PaintGlass(Graphics graphics)
    {
        int radius = dwmRounded ? 8 : 12;
        var bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath body = Theme.RoundedRectangle(bounds, radius))
        using (var sheen = new LinearGradientBrush(bounds,
                   Color.FromArgb(Theme.IsLight ? 110 : 30, Color.White),
                   Color.FromArgb(Theme.IsLight ? 50 : 8, Color.White), LinearGradientMode.Vertical))
        using (var outer = new Pen(Theme.IsLight ? Color.FromArgb(46, 0, 0, 0) : Color.FromArgb(60, 255, 255, 255)))
        {
            graphics.FillPath(sheen, body);
            graphics.DrawPath(outer, body);
        }
        using GraphicsPath inner = Theme.RoundedRectangle(Rectangle.Inflate(bounds, -1, -1), radius - 1);
        using var light = new Pen(Color.FromArgb(Theme.IsLight ? 150 : 34, Color.White));
        graphics.DrawPath(light, inner);
    }

    // 내용을 그리고 맨 아래 위치(창 높이)를 돌려준다.
    private int PaintContent(Graphics graphics)
    {
        optionRows.Clear();
        pageRows.Clear();
        sliders.Clear();
        int y = PaintHeader(graphics);
        if (current is null) return PaintHome(graphics, y);
        return current.About ? PaintAbout(graphics, y) : PaintSections(graphics, current, y);
    }

    // 맨 위: 첫 화면은 "WinBar 설정", 세부 페이지는 "‹ 제목". 오른쪽에 둥근 닫기 단추.
    private int PaintHeader(Graphics graphics)
    {
        closeArea = new Rectangle(Width - 34, 12, 22, 22);
        float closeLevel = HoverLevel(closeArea);
        FillRounded(graphics, closeArea, Theme.IsLight ? Color.FromArgb((int)(18 + 30 * closeLevel), 0, 0, 0)
            : Color.FromArgb((int)(26 + 34 * closeLevel), 255, 255, 255), 11);
        Icons.DrawMoved(graphics, Icons.Close, closeArea, Mix(Theme.Secondary, Theme.Primary, closeLevel), 6, angle: 90 * Icons.Ease(closeLevel));

        if (current is null)
        {
            backArea = Rectangle.Empty;
            DrawText(graphics, L.T("WinBar 설정"), titleFont, new Rectangle(14, 10, Width - 60, 26), Theme.Primary);
        }
        else
        {
            // 뒤로: macOS 메뉴처럼 마우스를 올리면 파란 막대 + 흰 글자
            backArea = new Rectangle(Edge, 9, Width - 46 - Edge, 28);
            float level = HoverLevel(backArea);
            PaintHighlight(graphics, backArea, level, accent: true);
            Color color = Mix(Theme.Primary, Color.White, level);
            Icons.DrawMoved(graphics, "", new Rectangle(backArea.Left + 4, backArea.Top, 20, backArea.Height), color, 8, dx: -2 * Icons.Ease(level));
            DrawText(graphics, L.T(current.Title), titleFont, new Rectangle(backArea.Left + 26, backArea.Top, backArea.Width - 30, backArea.Height), color);
        }
        int y = HeaderHeight;
        Separator(graphics, ref y);
        return y;
    }

    private int PaintHome(Graphics graphics, int y)
    {
        for (int index = 0; index < pages.Length; index++)
        {
            Page page = pages[index];
            var row = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
            pageRows.Add((row, page));
            float level = HoverLevel(row);
            PaintHighlight(graphics, row, level, accent: true);
            Color color = Mix(Theme.Primary, Color.White, level);
            PaintPageIcon(graphics, page, index, new Rectangle(row.Left + 6, row.Top, 20, row.Height), Mix(Theme.Secondary, Color.White, level), level);
            DrawText(graphics, L.T(page.Title), rowFont, new Rectangle(TextLeft, row.Top, row.Width - 70, row.Height), color);
            Icons.DrawMoved(graphics, Icons.Chevron, new Rectangle(row.Right - 24, row.Top, 16, row.Height),
                Mix(Theme.Secondary, Color.White, level), 7, dx: 2 * Icons.Ease(level));
            y += RowHeight;
            if (index == pages.Length - 2) Separator(graphics, ref y); // 정보는 아래에 따로
        }
        y += 4;
        string version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0";
        DrawText(graphics, L.F("WinBar {0} (프로토타입)", version), smallFont, new Rectangle(14, y, Width - 28, 18), Theme.Secondary);
        return y + 18 + 10;
    }

    // 일반: 톱니바퀴 회전 · 모양: 붓이 기울며 커짐 · 메뉴바: 화면이 위로 뜸 · 정보: 커졌다가 제자리
    private static void PaintPageIcon(Graphics graphics, Page page, int index, Rectangle area, Color color, float level)
    {
        float t = Icons.Ease(level);
        switch (index)
        {
            case 0: Icons.DrawMoved(graphics, page.Glyph, area, color, 9.5f, angle: 90 * t); break;
            case 1: Icons.DrawMoved(graphics, page.Glyph, area, color, 9.5f, angle: -14 * t, scale: 1 + 0.08f * t); break;
            case 2: Icons.DrawMoved(graphics, page.Glyph, area, color, 9.5f, dy: -1.5f * t, scale: 1 + 0.06f * t); break;
            case 3: Icons.DrawMoved(graphics, page.Glyph, area, color, 9.5f, angle: 25 * t, scale: 1 + 0.06f * t); break; // 언어: 지구본이 살짝 돈다
            default: Icons.DrawMoved(graphics, page.Glyph, area, color, 9.5f, scale: 1 + 0.14f * (float)Math.Sin(Math.PI * t) + 0.04f * t); break;
        }
    }

    // 소제목 → 줄(스위치·실행) → 캡슐 슬라이더 → 설명, 소제목 사이는 얇은 구분선.
    private int PaintSections(Graphics graphics, Page page, int y)
    {
        for (int sectionIndex = 0; sectionIndex < page.Sections.Length; sectionIndex++)
        {
            Section section = page.Sections[sectionIndex];
            if (sectionIndex > 0) Separator(graphics, ref y);
            DrawText(graphics, L.T(section.Header), headerFont, new Rectangle(14, y, Width - 28, 20), Theme.Secondary);
            y += 22;
            foreach (Option option in section.Options)
            {
                var row = new Rectangle(Edge, y, Width - Edge * 2, RowHeight);
                optionRows.Add((row, option));
                float level = HoverLevel(row);
                // 실행·선택 줄은 파란 강조 + 흰 글자, 스위치 줄은 옅은 회색
                bool accent = option.IsLink || option.IsChoice;
                PaintHighlight(graphics, row, level, accent);
                Color text = accent ? Mix(Theme.Primary, Color.White, level) : Theme.Primary;
                Color iconColor = accent ? Mix(Theme.Secondary, Color.White, level) : Theme.Secondary;
                if (option.Badge is string badge)
                    PaintBadge(graphics, badge, new Rectangle(row.Left + 6, row.Top, 22, row.Height), iconColor, level);
                else
                    Icons.DrawMoved(graphics, option.DynamicGlyph?.Invoke() ?? option.Glyph, new Rectangle(row.Left + 6, row.Top, 20, row.Height), iconColor, 9,
                        scale: 1 + 0.1f * Icons.Ease(level));
                DrawText(graphics, option.Text?.Invoke() ?? L.T(option.Label), rowFont, new Rectangle(TextLeft, row.Top, row.Width - 90, row.Height), text);
                if (option.IsChoice)
                {
                    // 지금 쓰는 언어에 파란 체크(강조 중에는 흰색)
                    if (option.Get())
                        Icons.DrawBold(graphics, "", new Rectangle(row.Right - 26, row.Top, 18, row.Height), Mix(Theme.HoverAccent, Color.White, level), 8);
                }
                else if (option.IsLink)
                    Icons.DrawMoved(graphics, Icons.Chevron, new Rectangle(row.Right - 24, row.Top, 16, row.Height),
                        Mix(Theme.Secondary, Color.White, level), 7, dx: 2 * Icons.Ease(level));
                else
                    DrawSwitch(graphics, new Rectangle(row.Right - 44, row.Top + (RowHeight - 18) / 2, 32, 18), SwitchLevel(option), pressed == row);
                y += RowHeight;
            }
            if (section.Slider is Slider slider)
            {
                PaintSlider(graphics, new Rectangle(Edge, y, Width - Edge * 2, SliderRowHeight), slider);
                y += SliderRowHeight;
            }
            if (section.Note is string note)
            {
                DrawText(graphics, L.T(note), smallFont, new Rectangle(14, y + 1, Width - 28, 18), Theme.Secondary);
                y += 22;
            }
        }
        return y + 8;
    }

    // macOS 제어 센터 슬라이더: 둥근 캡슐 바탕 위로 흰 부분이 값만큼 차오르고, 왼쪽 끝에 아이콘이 있다.
    // 마우스를 올리거나 잡으면 캡슐이 살짝 커진다.
    private void PaintSlider(Graphics graphics, Rectangle area, Slider slider)
    {
        bool dragging = activeSlider == slider;
        int value = dragging && dragValue is int moving ? moving : slider.Get();
        float grow = Math.Max(HoverLevel(area) * 0.5f, dragging ? dragLevel : 0);
        var capsule = Rectangle.Inflate(new Rectangle(area.Left + 8, area.Top + 6, area.Width - 16 - 48, 24), (int)Math.Round(grow), (int)Math.Round(grow));
        int radius = capsule.Height / 2;
        FillRounded(graphics, capsule, Theme.IsLight ? Color.FromArgb(26, 0, 0, 0) : Color.FromArgb(34, 255, 255, 255), radius);
        double ratio = (value - slider.Min) / (double)Math.Max(1, slider.Max - slider.Min);
        int fill = Math.Max(capsule.Height, (int)Math.Round(capsule.Width * ratio));
        var filled = new Rectangle(capsule.Left, capsule.Top, Math.Min(fill, capsule.Width), capsule.Height);
        FillRounded(graphics, filled, Theme.IsLight ? Color.White : Color.FromArgb(236, 236, 240), radius);
        using (GraphicsPath edge = Theme.RoundedRectangle(filled, radius))
        using (var pen = new Pen(Theme.IsLight ? Color.FromArgb(28, 0, 0, 0) : Color.FromArgb(40, 0, 0, 0)))
            graphics.DrawPath(pen, edge);
        Icons.DrawBold(graphics, slider.Glyph, new Rectangle(capsule.Left + 4, capsule.Top, capsule.Height - 4, capsule.Height),
            Color.FromArgb(120, 120, 126), 8);
        DrawText(graphics, $"{value}{slider.Unit}", dragging ? headerFont : smallFont,
            new Rectangle(capsule.Right + 6, area.Top, area.Right - capsule.Right - 12, area.Height),
            Mix(Theme.Secondary, Theme.Primary, dragging ? dragLevel : HoverLevel(area)), StringAlignment.Far);
        sliders.Add((area, capsule, slider));
    }

    private int PaintAbout(Graphics graphics, int y)
    {
        string version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0";
        (string Label, string Value)[] rows =
        [
            (L.T("버전"), L.F("{0} (프로토타입)", version)),
            (L.T("지원 OS"), "Windows 10/11 (x64)"),
            (L.T("아이콘"), Icons.Family),
            (L.T("설정 파일"), AppSettings.FilePath)
        ];
        DrawText(graphics, L.T("앱 정보"), headerFont, new Rectangle(14, y, Width - 28, 20), Theme.Secondary);
        y += 22;
        foreach ((string label, string value) in rows)
        {
            DrawText(graphics, label, rowFont, new Rectangle(14, y, 80, RowHeight), Theme.Primary);
            DrawText(graphics, value, smallFont, new Rectangle(96, y, Width - 110, RowHeight), Theme.Secondary, StringAlignment.Far);
            y += RowHeight;
        }
        Separator(graphics, ref y);
        DrawText(graphics, L.T("설정은 이 PC에만 저장 · 외부 전송 없음"), smallFont, new Rectangle(14, y, Width - 28, 18), Theme.Secondary);
        return y + 18 + 10;
    }

    // 호버 강조. accent: macOS 메뉴처럼 꽉 찬 파란 막대(누르면 더 진함), 아니면 옅은 회색.
    private void PaintHighlight(Graphics graphics, Rectangle row, float level, bool accent)
    {
        bool down = pressed == row;
        if (level <= 0 && !down) return;
        if (accent)
        {
            Color blue = down ? Mix(Theme.HoverAccent, Color.Black, 0.15f) : Theme.HoverAccent;
            FillRounded(graphics, row, Color.FromArgb((int)Math.Round(255 * Math.Max(level, down ? 1 : 0)), blue), 6);
        }
        else
        {
            int alpha = (int)Math.Round((down ? 1.8f : 1f) * Math.Max(level, down ? 1 : 0) * (Theme.IsLight ? 16 : 22));
            FillRounded(graphics, row, Theme.IsLight ? Color.FromArgb(alpha, 0, 0, 0) : Color.FromArgb(alpha, 255, 255, 255), 6);
        }
    }

    // 언어 앞 표시(한·中·日·E): macOS 입력 소스 아이콘처럼 둥근 테두리 안의 글자. 마우스를 올리면 살짝 커진다.
    private void PaintBadge(Graphics graphics, string badge, Rectangle area, Color color, float level)
    {
        float grow = 1 * Icons.Ease(level);
        var box = RectangleF.Inflate(new RectangleF(area.Left + (area.Width - 20) / 2f, area.Top + (area.Height - 16) / 2f, 20, 16), grow, grow);
        using (GraphicsPath path = Theme.RoundedRectangle(Rectangle.Round(box), 4))
        using (var pen = new Pen(color, Icons.Stroke(graphics) * 0.8f))
            graphics.DrawPath(pen, path);
        BarText.Draw(graphics, badge, headerFont, Rectangle.Round(box), color, StringAlignment.Center);
    }

    // macOS 스위치: 켜면 파랑, 손잡이가 미끄러지고 바탕색이 서서히 바뀐다. 누르는 동안 손잡이가 옆으로 늘어난다.
    private static void DrawSwitch(Graphics graphics, Rectangle bounds, float on, bool press)
    {
        Color off = Theme.IsLight ? Color.FromArgb(214, 214, 218) : Color.FromArgb(84, 84, 90);
        FillRounded(graphics, bounds, Mix(off, Theme.HoverAccent, on), bounds.Height / 2);
        int knob = bounds.Height - 4;
        int stretch = press ? 5 : 0;
        float travel = bounds.Width - knob - 4 - stretch;
        float x = bounds.Left + 2 + travel * on;
        var knobBounds = new Rectangle((int)Math.Round(x), bounds.Top + 2, knob + stretch, knob);
        using (GraphicsPath shadow = Theme.RoundedRectangle(new Rectangle(knobBounds.Left, knobBounds.Top + 1, knobBounds.Width, knobBounds.Height), knob / 2))
        using (var shade = new SolidBrush(Color.FromArgb(40, 0, 0, 0)))
            graphics.FillPath(shade, shadow);
        using GraphicsPath path = Theme.RoundedRectangle(knobBounds, knob / 2);
        using var knobBrush = new SolidBrush(Color.White);
        graphics.FillPath(knobBrush, path);
    }

    private void Separator(Graphics graphics, ref int y)
    {
        y += 5;
        using var pen = new Pen(Theme.IsLight ? Color.FromArgb(30, 0, 0, 0) : Color.FromArgb(34, 255, 255, 255));
        graphics.DrawLine(pen, 14, y, Width - 14, y);
        y += 6;
    }

    private static Color Mix(Color from, Color to, float amount)
    {
        amount = Math.Clamp(amount, 0, 1);
        return Color.FromArgb(
            (int)Math.Round(from.A + (to.A - from.A) * amount),
            (int)Math.Round(from.R + (to.R - from.R) * amount),
            (int)Math.Round(from.G + (to.G - from.G) * amount),
            (int)Math.Round(from.B + (to.B - from.B) * amount));
    }

    private static void FillRounded(Graphics graphics, Rectangle bounds, Color color, int radius)
    {
        using var brush = new SolidBrush(color);
        using GraphicsPath path = Theme.RoundedRectangle(bounds, radius);
        graphics.FillPath(brush, path);
    }

    // 유리(투명) 배경 위에서도 글자가 비치지 않도록 GDI+로 그린다.
    private static void DrawText(Graphics graphics, string text, Font font, Rectangle area, Color color, StringAlignment alignment = StringAlignment.Near) =>
        BarText.Draw(graphics, text, font, area, color, alignment);

    // ── 마우스 ─────────────────────────────────────────────────
    private Rectangle HitTarget(Point location)
    {
        foreach (Rectangle area in new[] { closeArea, backArea })
            if (!area.IsEmpty && area.Contains(location)) return area;
        foreach ((Rectangle bounds, _) in pageRows)
            if (bounds.Contains(location)) return bounds;
        foreach ((Rectangle bounds, _) in optionRows)
            if (bounds.Contains(location)) return bounds;
        foreach ((Rectangle area, _, _) in sliders)
            if (area.Contains(location)) return area;
        return Rectangle.Empty;
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        foreach ((Rectangle area, Rectangle track, Slider slider) in sliders)
        {
            if (!area.Contains(e.Location)) continue;
            activeSlider = slider;
            Capture = true;
            ApplySlider(e.X);
            StartAnimation();
            return;
        }
        pressed = HitTarget(e.Location);
        if (!pressed.IsEmpty) Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (!pressed.IsEmpty)
        {
            pressed = Rectangle.Empty;
            Invalidate();
        }
        if (activeSlider is not Slider slider) return;
        Capture = false;
        activeSlider = null;
        dragValue = null;
        slider.Commit();
        StartAnimation();
    }

    private void ApplySlider(int x)
    {
        if (activeSlider is not Slider slider) return;
        Rectangle track = sliders.FirstOrDefault(entry => entry.Slider == slider).Track;
        if (track.IsEmpty) return;
        double ratio = Math.Clamp((x - track.Left) / (double)track.Width, 0, 1);
        int value = (int)Math.Round(slider.Min + ratio * (slider.Max - slider.Min));
        if (dragValue == value) return;
        dragValue = value;
        slider.Preview(value);
        Invalidate();
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (activeSlider is not null && e.Button == MouseButtons.Left)
        {
            ApplySlider(e.X);
            return;
        }
        Rectangle next = HitTarget(e.Location);
        Cursor = next.IsEmpty ? Cursors.Default : Cursors.Hand;
        if (!pressed.IsEmpty && pressed != next) { pressed = Rectangle.Empty; Invalidate(); }
        SetHovered(next);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        if (!pressed.IsEmpty) { pressed = Rectangle.Empty; Invalidate(); }
        SetHovered(Rectangle.Empty);
    }

    protected override void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        if (e.Button != MouseButtons.Left) return;
        if (closeArea.Contains(e.Location)) { Close(); return; }
        if (!backArea.IsEmpty && backArea.Contains(e.Location)) { Navigate(null); return; }
        foreach ((Rectangle bounds, Page page) in pageRows)
        {
            if (!bounds.Contains(e.Location)) continue;
            Navigate(page);
            return;
        }
        foreach ((Rectangle bounds, Option option) in optionRows)
        {
            if (!bounds.Contains(e.Location)) continue;
            // 바꾸기 전 위치에서 출발해 새 위치로 미끄러지게 한다.
            float before = SwitchLevel(option);
            option.Set(!option.Get());
            if (!option.IsLink && !option.IsChoice) switchAnimations[option] = (before, Environment.TickCount64);
            StartAnimation();
            Invalidate();
            return;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            animationTimer.Dispose();
            titleFont.Dispose();
            rowFont.Dispose();
            headerFont.Dispose();
            smallFont.Dispose();
            AppSettings.Current.Changed -= ApplyAppearance;
        }
        base.Dispose(disposing);
    }

    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}
