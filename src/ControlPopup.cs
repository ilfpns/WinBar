using System.Diagnostics;
using System.Drawing.Drawing2D;

namespace WinBar;

// 메뉴바 항목을 클릭하면 뜨는 macOS 제어 센터 스타일 팝업.
// 음량·밝기는 직접 조절하고, Wi-Fi·Bluetooth는 상태를 보여 준 뒤 Windows 설정으로 연결한다.
internal sealed class ControlPopup : Form
{
    internal enum Kind { Volume, Brightness, Wifi, Bluetooth }

    private readonly SystemMetrics metrics;
    private readonly Font titleFont = new("Segoe UI Semibold", 10, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font rowFont = new("Segoe UI", 9, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font iconFont = Icons.Create(12);
    private SystemSnapshot snapshot = new();
    private StatusSnapshot status = new();
    private Rectangle sliderTrack, iconArea, linkArea;
    private bool dragging, linkHovered;
    private double? dragValue;
    private long hiddenAt;

    public Kind Current { get; private set; }

    public ControlPopup(SystemMetrics metrics)
    {
        this.metrics = metrics;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        KeyPreview = true;
        BackColor = Theme.PopupBackground;
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

    // 팝업 바깥(메뉴바 아이콘 포함)을 눌러 닫힌 직후의 클릭은 다시 열지 않는다.
    public bool RecentlyHidden => Environment.TickCount64 - hiddenAt < 300;

    public void ShowControl(Kind kind, Point anchor, SystemSnapshot nextSnapshot, StatusSnapshot nextStatus)
    {
        Current = kind;
        snapshot = nextSnapshot;
        status = nextStatus;
        dragValue = null;
        dragging = false;
        Size = new Size(280, HeightFor(kind));
        Rectangle workArea = Screen.FromPoint(anchor).WorkingArea;
        int x = Math.Clamp(anchor.X, workArea.Left + 8, Math.Max(workArea.Left + 8, workArea.Right - Width - 8));
        int y = Math.Max(workArea.Top + 6, Math.Min(anchor.Y, workArea.Bottom - Height - 8));
        Location = new Point(x, y);
        Show();
        Topmost.Raise(this);
        Invalidate();
    }

    public void UpdateData(SystemSnapshot nextSnapshot, StatusSnapshot nextStatus)
    {
        snapshot = nextSnapshot;
        status = nextStatus;
        if (!Visible) return;
        if (!dragging && dragValue is double pending && CurrentValue() is double actual
            && Math.Abs(actual - pending) < 1.5) dragValue = null;
        int height = HeightFor(Current);
        if (Height != height) Height = height;
        Invalidate();
    }

    public void HidePopup()
    {
        if (!Visible) return;
        dragging = false;
        Capture = false;
        Hide();
        hiddenAt = Environment.TickCount64;
    }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        HidePopup();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) HidePopup();
    }

    private double? CurrentValue() => Current switch
    {
        Kind.Volume => snapshot.VolumePercent,
        Kind.Brightness => snapshot.BrightnessPercent,
        _ => null
    };

    private string[] InfoRows() => Current switch
    {
        Kind.Wifi => WifiRows(),
        Kind.Bluetooth => BluetoothRows(),
        _ => []
    };

    private string[] WifiRows()
    {
        var rows = new List<string>();
        if (status.WifiConnected)
            rows.Add($"{status.WifiName}\t신호 {status.WifiQuality}%");
        else
            rows.Add(status.WifiAvailable ? "Wi-Fi 연결 안 됨" : "Wi-Fi 장치 없음 또는 꺼짐");
        if (status.EthernetConnected) rows.Add("유선 네트워크\t연결됨");
        return [.. rows];
    }

    private string[] BluetoothRows()
    {
        if (status.BluetoothOn != true) return ["Bluetooth 꺼짐 또는 장치 없음"];
        string[] devices = status.BluetoothDevices ?? [];
        if (devices.Length == 0) return ["켜짐\t연결된 기기 없음"];
        return [.. devices.Take(4).Select(name => $"{name}\t연결됨")];
    }

    private int HeightFor(Kind kind) => kind switch
    {
        Kind.Volume or Kind.Brightness => 138,
        _ => 96 + InfoRows().Length * 28
    };

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Theme.DrawPopupBackground(graphics, ClientSize);

        string title = Current switch
        {
            Kind.Volume => "음량",
            Kind.Brightness => "화면 밝기",
            Kind.Wifi => "Wi-Fi",
            _ => "Bluetooth"
        };
        TextRenderer.DrawText(graphics, title, titleFont, new Rectangle(18, 12, Width - 36, 22),
            Theme.Primary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        int y = 44;
        sliderTrack = Rectangle.Empty;
        iconArea = Rectangle.Empty;
        if (Current is Kind.Volume or Kind.Brightness)
        {
            DrawSlider(graphics, y);
            y += 46;
        }
        else
        {
            foreach (string row in InfoRows())
            {
                string[] parts = row.Split('\t');
                TextRenderer.DrawText(graphics, parts[0], rowFont, new Rectangle(18, y, 150, 24),
                    Theme.Primary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter
                    | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
                if (parts.Length > 1)
                    TextRenderer.DrawText(graphics, parts[1], rowFont, new Rectangle(150, y, Width - 168, 24),
                        Theme.Secondary, TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                y += 28;
            }
            y += 6;
        }

        using (var separator = new Pen(Theme.Separator))
            graphics.DrawLine(separator, 14, y, Width - 14, y);
        linkArea = new Rectangle(8, y + 6, Width - 16, 32);
        if (linkHovered)
        {
            using var hover = new SolidBrush(Theme.Hover);
            using GraphicsPath linkPath = Theme.RoundedRectangle(linkArea, 8);
            graphics.FillPath(hover, linkPath);
        }
        string link = Current switch
        {
            Kind.Volume => "사운드 설정…",
            Kind.Brightness => "디스플레이 설정…",
            Kind.Wifi => "네트워크 설정…",
            _ => "Bluetooth 설정…"
        };
        TextRenderer.DrawText(graphics, link, rowFont, new Rectangle(linkArea.Left + 10, linkArea.Top, linkArea.Width - 20, linkArea.Height),
            Theme.Primary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    private void DrawSlider(Graphics graphics, int y)
    {
        double? value = dragValue ?? CurrentValue();
        string glyph = Current == Kind.Volume
            ? Icons.Volume(value, snapshot.Muted)
            : Icons.Brightness;
        iconArea = new Rectangle(14, y, 30, 30);
        TextRenderer.DrawText(graphics, glyph, iconFont, iconArea, Theme.Primary,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        if (value is null)
        {
            string message = Current == Kind.Volume ? "출력 장치를 찾을 수 없습니다" : "이 화면은 밝기 조절을 지원하지 않습니다";
            TextRenderer.DrawText(graphics, message, rowFont, new Rectangle(52, y, Width - 70, 30),
                Theme.Secondary, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            return;
        }

        sliderTrack = new Rectangle(54, y + 13, Width - 54 - 76, 5);
        double shown = Current == Kind.Volume && snapshot.Muted && dragValue is null ? 0 : value.Value;
        int fill = (int)Math.Round(sliderTrack.Width * Math.Clamp(shown, 0, 100) / 100);
        using (var trackBrush = new SolidBrush(Theme.Track))
        using (GraphicsPath trackPath = Theme.RoundedRectangle(sliderTrack, 2))
            graphics.FillPath(trackBrush, trackPath);
        if (fill > 0)
        {
            using var fillBrush = new SolidBrush(Theme.Primary);
            using GraphicsPath fillPath = Theme.RoundedRectangle(new Rectangle(sliderTrack.Left, sliderTrack.Top, Math.Max(fill, 5), sliderTrack.Height), 2);
            graphics.FillPath(fillBrush, fillPath);
        }
        var knob = new RectangleF(sliderTrack.Left + fill - 8, sliderTrack.Top + sliderTrack.Height / 2f - 8, 16, 16);
        using (var knobBrush = new SolidBrush(Color.FromArgb(246, 246, 248)))
            graphics.FillEllipse(knobBrush, knob);
        using (var knobEdge = new Pen(Color.FromArgb(90, 0, 0, 0)))
            graphics.DrawEllipse(knobEdge, knob);

        string text = Current == Kind.Volume && snapshot.Muted && dragValue is null ? "음소거" : $"{shown:0}%";
        TextRenderer.DrawText(graphics, text, rowFont, new Rectangle(Width - 66, y, 52, 30),
            Theme.Secondary, TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        if (!sliderTrack.IsEmpty && Rectangle.Inflate(sliderTrack, 10, 12).Contains(e.Location))
        {
            dragging = true;
            Capture = true;
            ApplySlider(e.X);
        }
        else if (Current == Kind.Volume && iconArea.Contains(e.Location))
        {
            metrics.SetMute(!snapshot.Muted);
        }
        else if (linkArea.Contains(e.Location))
        {
            OpenSettings(Current switch
            {
                Kind.Volume => "ms-settings:sound",
                Kind.Brightness => "ms-settings:display",
                Kind.Wifi => status.WifiAvailable ? "ms-settings:network-wifi" : "ms-settings:network-status",
                _ => "ms-settings:bluetooth"
            });
            HidePopup();
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (dragging)
        {
            ApplySlider(e.X);
            return;
        }
        bool nextHovered = linkArea.Contains(e.Location);
        Cursor = nextHovered || (!sliderTrack.IsEmpty && Rectangle.Inflate(sliderTrack, 10, 12).Contains(e.Location))
            ? Cursors.Hand : Cursors.Default;
        if (nextHovered == linkHovered) return;
        linkHovered = nextHovered;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        dragging = false;
        Capture = false;
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        if (!linkHovered) return;
        linkHovered = false;
        Invalidate();
    }

    private void ApplySlider(int x)
    {
        double value = Math.Clamp((x - sliderTrack.Left) * 100.0 / sliderTrack.Width, 0, 100);
        dragValue = value;
        if (Current == Kind.Volume) metrics.SetVolume(value);
        else metrics.SetBrightness(value);
        Invalidate();
    }

    private static void OpenSettings(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch (Exception) { }
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
            iconFont.Dispose();
        }
        base.Dispose(disposing);
    }
}
