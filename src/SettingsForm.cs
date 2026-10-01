using System.Drawing.Drawing2D;
using System.Reflection;

namespace WinBar;

// 별도 프로그램 창이 아니라, 화면을 어둡게 덮은 배경 위에 뜨는 모달 설정 패널.
// macOS 시스템 설정처럼 첫 화면은 항목 목록이고, 항목을 눌러야 세부 페이지로 들어간다.
// 바깥을 누르거나 Esc·닫기 단추로 닫히며 작업 표시줄에 나타나지 않는다.
internal sealed class SettingsForm : Form
{
    // IsLink가 true면 스위치 대신 › 표시를 그리고, 누르면 Set(true)로 다른 화면을 연다.
    private sealed record Option(string Label, Func<bool> Get, Action<bool> Set, bool IsLink = false);
    private sealed record Slider(string Label, int Min, int Max, Func<int> Get, Action<int> Preview, Action Commit);
    private sealed record Page(string Title, string Summary, string Glyph, Option[] Options,
        Slider? Slider = null, bool About = false);

    private static SettingsForm? instance;

    private readonly Backdrop backdrop;
    private readonly Action requestExit;
    private readonly Page[] pages;
    private readonly Font titleFont = new("Segoe UI Semibold", 13, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font rowFont = new("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font smallFont = new("Segoe UI", 8.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font iconFont = Icons.Create(10);
    private readonly List<(Rectangle Bounds, Option Option)> optionRows = [];
    private readonly List<(Rectangle Bounds, Page Page)> pageRows = [];
    private Page? current;
    private Rectangle closeArea, backArea, exitArea;
    private Rectangle hovered;
    private bool autoStart = AppSettings.IsAutoStartEnabled();
    private bool closed;
    private Rectangle sliderTrack;
    private int? dragValue;

    private const int RowHeight = 38;
    private const int PageRowHeight = 52;
    private const int PanelWidth = 440;
    private const int PanelHeight = 500;

    public static void ShowModal(Screen screen, Action requestExit)
    {
        if (instance is { IsDisposed: false }) return;
        instance = new SettingsForm(screen, requestExit);
        instance.backdrop.Show();
        instance.Show(instance.backdrop);
    }

    // Esc를 누르면 닫는다. 설정 창은 포커스를 가져가지 않으므로 SystemEventWatcher가 알려 준다.
    public static void CloseIfOpen()
    {
        if (instance is { IsDisposed: false }) instance.Close();
    }

    public static bool ContainsScreenPoint(Point point) =>
        instance is { IsDisposed: false, Visible: true } && instance.backdrop.Bounds.Contains(point);

    // 포커스를 가져가지 않아 사용 중인 앱의 한/영 상태가 바뀌지 않는다.
    protected override bool ShowWithoutActivation => true;

    private SettingsForm(Screen screen, Action requestExit)
    {
        this.requestExit = requestExit;
        AppSettings settings = AppSettings.Current;
        Option Toggle(string label, Func<AppSettings, bool> get, Action<AppSettings, bool> set) =>
            new(label, () => get(settings), value => { set(settings, value); settings.Save(); });

        pages =
        [
            new("일반", "로그인 시 자동 실행, 시계 형식", Icons.Settings,
            [
                AppSettings.IsPackaged
                    // 스토어 설치본: 사용자가 Windows 설정 > 앱 > 시작 프로그램에서 직접 켠다.
                    ? new("로그인 시 자동 실행 (Windows 설정에서 켜기)", () => false, _ =>
                    {
                        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:startupapps") { UseShellExecute = true }); }
                        catch (Exception) { }
                    }, IsLink: true)
                    : new("로그인 시 자동 실행", () => autoStart, value =>
                    {
                        if (AppSettings.SetAutoStart(value)) autoStart = value;
                    }),
                Toggle("24시간 형식 시계", s => s.Use24HourClock, (s, v) => s.Use24HourClock = v)
            ]),
            new("모양", "메뉴바 배경 불투명도", "", [],
                new Slider("배경 불투명도", 20, 100, () => settings.BarOpacity,
                    value => { settings.BarOpacity = value; settings.Preview(); },
                    settings.Save)),
            new("메뉴바 항목", "메뉴바에 표시할 상태 선택", "",
            [
                Toggle("카메라·마이크 사용 표시", s => s.ShowPrivacy, (s, v) => s.ShowPrivacy = v),
                Toggle("입력 소스 (한/A)", s => s.ShowInputSource, (s, v) => s.ShowInputSource = v),
                Toggle("Wi-Fi", s => s.ShowWifi, (s, v) => s.ShowWifi = v),
                Toggle("Bluetooth", s => s.ShowBluetooth, (s, v) => s.ShowBluetooth = v),
                Toggle("시스템 사용량 (CPU·GPU·메모리)", s => s.ShowSystemUsage, (s, v) => s.ShowSystemUsage = v),
                Toggle("음량", s => s.ShowVolume, (s, v) => s.ShowVolume = v),
                Toggle("화면 밝기", s => s.ShowBrightness, (s, v) => s.ShowBrightness = v),
                Toggle("배터리", s => s.ShowBattery, (s, v) => s.ShowBattery = v),
                Toggle("배터리 퍼센트", s => s.ShowBatteryPercent, (s, v) => s.ShowBatteryPercent = v)
            ]),
            new("정보", "버전, 설정 저장 위치, 종료", "", [], About: true)
        ];

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        KeyPreview = true;
        BackColor = Theme.PopupBackground;
        Text = "WinBar 설정";
        AccessibleName = "WinBar 설정";

        Rectangle area = screen.WorkingArea;
        int height = Math.Min(PanelHeight, area.Height - 40);
        Bounds = new Rectangle(area.Left + (area.Width - PanelWidth) / 2, area.Top + (area.Height - height) / 2,
            PanelWidth, height);

        backdrop = new Backdrop(screen.Bounds);
        backdrop.Clicked += Close;
        // 배경 창은 설정 창의 소유자라, 배경을 닫으면 설정 창의 닫힘 이벤트가 다시 온다. 한 번만 처리한다.
        FormClosed += (_, _) =>
        {
            if (closed) return;
            closed = true;
            if (instance == this) instance = null;
            backdrop.BeginInvoke(() =>
            {
                if (backdrop.IsDisposed) return;
                backdrop.Close();
                backdrop.Dispose();
            });
        };
    }

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

    private void Navigate(Page? page)
    {
        current = page;
        hovered = Rectangle.Empty;
        Invalidate();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) Close();
        else if (e.KeyCode == Keys.Back && current is not null) Navigate(null);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Theme.DrawPopupBackground(graphics, ClientSize, 16);
        optionRows.Clear();
        pageRows.Clear();

        closeArea = new Rectangle(Width - 50, 18, 32, 32);
        if (hovered == closeArea) FillRounded(graphics, closeArea, Theme.Hover, 16);
        TextRenderer.DrawText(graphics, Icons.Close, iconFont, closeArea, Theme.Secondary,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        if (current is null) PaintHome(graphics);
        else PaintPage(graphics, current);
    }

    private void PaintHome(Graphics graphics)
    {
        backArea = Rectangle.Empty;
        TextRenderer.DrawText(graphics, "설정", titleFont, new Rectangle(24, 20, 200, 30), Theme.Primary,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        var card = new Rectangle(16, 70, Width - 32, pages.Length * PageRowHeight);
        FillRounded(graphics, card, Theme.Card, 10);
        for (int index = 0; index < pages.Length; index++)
        {
            Page page = pages[index];
            var row = new Rectangle(card.Left, card.Top + index * PageRowHeight, card.Width, PageRowHeight);
            pageRows.Add((row, page));
            if (hovered == row) FillRounded(graphics, row, Theme.Hover, 10);
            if (index > 0)
            {
                using var separator = new Pen(Theme.Separator);
                graphics.DrawLine(separator, row.Left + 52, row.Top, row.Right - 14, row.Top);
            }
            var badge = new Rectangle(row.Left + 12, row.Top + (PageRowHeight - 28) / 2, 28, 28);
            FillRounded(graphics, badge, Theme.Accent, 7);
            Icons.DrawBold(graphics, page.Glyph, badge, Color.White, 9);
            TextRenderer.DrawText(graphics, page.Title, rowFont, new Rectangle(row.Left + 52, row.Top + 7, row.Width - 100, 20),
                Theme.Primary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(graphics, page.Summary, smallFont, new Rectangle(row.Left + 52, row.Top + 27, row.Width - 100, 18),
                Theme.Secondary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(graphics, Icons.Chevron, iconFont, new Rectangle(row.Right - 36, row.Top, 24, row.Height),
                Theme.Secondary, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
        PaintFooter(graphics);
    }

    private void PaintPage(Graphics graphics, Page page)
    {
        backArea = new Rectangle(14, 20, 90, 30);
        if (hovered == backArea) FillRounded(graphics, backArea, Theme.Hover, 8);
        TextRenderer.DrawText(graphics, "", iconFont, new Rectangle(backArea.Left + 4, backArea.Top, 20, backArea.Height),
            Theme.Accent, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        TextRenderer.DrawText(graphics, "설정", rowFont, new Rectangle(backArea.Left + 26, backArea.Top, 60, backArea.Height),
            Theme.Accent, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        TextRenderer.DrawText(graphics, page.Title, titleFont, new Rectangle(110, 20, Width - 220, 30), Theme.Primary,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        if (page.About)
        {
            PaintAbout(graphics);
            return;
        }

        exitArea = Rectangle.Empty;
        sliderTrack = Rectangle.Empty;
        if (page.Slider is Slider slider)
        {
            var sliderCard = new Rectangle(16, 70, Width - 32, 84);
            FillRounded(graphics, sliderCard, Theme.Card, 10);
            int value = dragValue ?? slider.Get();
            TextRenderer.DrawText(graphics, slider.Label, rowFont, new Rectangle(sliderCard.Left + 14, sliderCard.Top + 8, 200, 28),
                Theme.Primary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(graphics, $"{value}%", rowFont, new Rectangle(sliderCard.Right - 74, sliderCard.Top + 8, 60, 28),
                Theme.Secondary, TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            sliderTrack = new Rectangle(sliderCard.Left + 20, sliderCard.Top + 52, sliderCard.Width - 40, 5);
            int fill = (int)Math.Round(sliderTrack.Width * (value - slider.Min) / (double)(slider.Max - slider.Min));
            FillRounded(graphics, sliderTrack, Theme.Track, 2);
            if (fill > 0) FillRounded(graphics, new Rectangle(sliderTrack.Left, sliderTrack.Top, Math.Max(fill, 5), sliderTrack.Height), Theme.Accent, 2);
            using (var knob = new SolidBrush(Color.FromArgb(246, 246, 248)))
                graphics.FillEllipse(knob, sliderTrack.Left + fill - 9, sliderTrack.Top + 2 - 9, 18, 18);
            TextRenderer.DrawText(graphics, "낮을수록 뒤 배경화면이 더 비쳐 보입니다.", smallFont,
                new Rectangle(28, sliderCard.Bottom + 8, Width - 56, 22), Theme.Secondary,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
        if (page.Options.Length == 0) return;

        var card = new Rectangle(16, 70, Width - 32, page.Options.Length * RowHeight);
        FillRounded(graphics, card, Theme.Card, 10);
        for (int index = 0; index < page.Options.Length; index++)
        {
            Option option = page.Options[index];
            var row = new Rectangle(card.Left, card.Top + index * RowHeight, card.Width, RowHeight);
            optionRows.Add((row, option));
            if (index > 0)
            {
                using var separator = new Pen(Theme.Separator);
                graphics.DrawLine(separator, row.Left + 14, row.Top, row.Right - 14, row.Top);
            }
            TextRenderer.DrawText(graphics, option.Label, rowFont, new Rectangle(row.Left + 14, row.Top, row.Width - 90, row.Height),
                Theme.Primary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            if (option.IsLink)
                TextRenderer.DrawText(graphics, Icons.Chevron, iconFont, new Rectangle(row.Right - 40, row.Top, 24, row.Height),
                    Theme.Secondary, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            else
                DrawSwitch(graphics, new Rectangle(row.Right - 54, row.Top + (RowHeight - 22) / 2, 40, 22), option.Get());
        }
    }

    private void PaintAbout(Graphics graphics)
    {
        string version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0";
        (string Label, string Value)[] rows =
        [
            ("버전", $"{version} (프로토타입)"),
            ("지원 OS", "Windows 10/11 (x64) 전용"),
            ("아이콘", Icons.Family),
            ("설정 파일", AppSettings.FilePath)
        ];
        var card = new Rectangle(16, 70, Width - 32, rows.Length * RowHeight);
        FillRounded(graphics, card, Theme.Card, 10);
        for (int index = 0; index < rows.Length; index++)
        {
            var row = new Rectangle(card.Left, card.Top + index * RowHeight, card.Width, RowHeight);
            if (index > 0)
            {
                using var separator = new Pen(Theme.Separator);
                graphics.DrawLine(separator, row.Left + 14, row.Top, row.Right - 14, row.Top);
            }
            TextRenderer.DrawText(graphics, rows[index].Label, rowFont, new Rectangle(row.Left + 14, row.Top, 90, row.Height),
                Theme.Primary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(graphics, rows[index].Value, smallFont, new Rectangle(row.Left + 100, row.Top, row.Width - 114, row.Height),
                Theme.Secondary, TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.PathEllipsis | TextFormatFlags.NoPadding);
        }
        TextRenderer.DrawText(graphics, "설정은 이 PC에만 저장되며 외부로 보내지 않습니다.", smallFont,
            new Rectangle(28, card.Bottom + 10, Width - 56, 24), Theme.Secondary,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        PaintFooter(graphics);
    }

    private void PaintFooter(Graphics graphics)
    {
        exitArea = new Rectangle(Width - 136, Height - 54, 112, 34);
        FillRounded(graphics, exitArea, hovered == exitArea ? Theme.Hover : Theme.Card, 8);
        TextRenderer.DrawText(graphics, "WinBar 종료", rowFont, exitArea, Color.FromArgb(255, 105, 97),
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    private static void DrawSwitch(Graphics graphics, Rectangle bounds, bool on)
    {
        FillRounded(graphics, bounds, on ? Theme.Accent : Theme.Track, bounds.Height / 2);
        int knob = bounds.Height - 4;
        int x = on ? bounds.Right - knob - 2 : bounds.Left + 2;
        using var knobBrush = new SolidBrush(Color.FromArgb(250, 250, 252));
        graphics.FillEllipse(knobBrush, x, bounds.Top + 2, knob, knob);
    }

    private static void FillRounded(Graphics graphics, Rectangle bounds, Color color, int radius)
    {
        using var brush = new SolidBrush(color);
        using GraphicsPath path = Theme.RoundedRectangle(bounds, radius);
        graphics.FillPath(brush, path);
    }

    private Rectangle HitTarget(Point location)
    {
        foreach (Rectangle area in new[] { closeArea, backArea, exitArea })
            if (!area.IsEmpty && area.Contains(location)) return area;
        foreach ((Rectangle bounds, _) in pageRows)
            if (bounds.Contains(location)) return bounds;
        return Rectangle.Empty;
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left || current?.Slider is null || sliderTrack.IsEmpty
            || !Rectangle.Inflate(sliderTrack, 12, 14).Contains(e.Location)) return;
        Capture = true;
        ApplySlider(e.X);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (dragValue is null) return;
        Capture = false;
        dragValue = null;
        current?.Slider?.Commit();
        Invalidate();
    }

    private void ApplySlider(int x)
    {
        if (current?.Slider is not Slider slider) return;
        double ratio = Math.Clamp((x - sliderTrack.Left) / (double)sliderTrack.Width, 0, 1);
        int value = (int)Math.Round(slider.Min + ratio * (slider.Max - slider.Min));
        dragValue = value;
        slider.Preview(value);
        Invalidate();
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (dragValue is not null && e.Button == MouseButtons.Left)
        {
            ApplySlider(e.X);
            return;
        }
        Rectangle next = HitTarget(e.Location);
        bool overOption = optionRows.Any(row => row.Bounds.Contains(e.Location));
        Cursor = !next.IsEmpty || overOption ? Cursors.Hand : Cursors.Default;
        if (next == hovered) return;
        hovered = next;
        Invalidate();
    }

    protected override void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        if (e.Button != MouseButtons.Left) return;
        if (closeArea.Contains(e.Location)) { Close(); return; }
        if (!exitArea.IsEmpty && exitArea.Contains(e.Location)) { Close(); requestExit(); return; }
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
            option.Set(!option.Get());
            Invalidate();
            return;
        }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        Theme.ApplyRoundedRegion(this, 16);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            titleFont.Dispose();
            rowFont.Dispose();
            smallFont.Dispose();
            iconFont.Dispose();
        }
        base.Dispose(disposing);
    }

    // 모달 뒤의 화면을 어둡게 덮고, 누르면 설정을 닫는다.
    private sealed class Backdrop : Form
    {
        public event Action? Clicked;

        public Backdrop(Rectangle bounds)
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.Black;
            Opacity = 0.4;
            Bounds = bounds;
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                const int WsExToolWindow = 0x80;
                const int WsExNoActivate = 0x08000000;
                CreateParams value = base.CreateParams;
                value.ExStyle |= WsExToolWindow | WsExNoActivate;
                return value;
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            Clicked?.Invoke();
        }
    }
}
