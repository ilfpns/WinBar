using System.Runtime.InteropServices;

namespace WinBar;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new WinBarContext());
    }
}

internal sealed class WinBarContext : ApplicationContext
{
    private readonly List<BarForm> bars = [];
    private readonly SystemMetrics metrics = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 2000 };
    private int tickCount;

    public WinBarContext()
    {
        foreach (Screen screen in Screen.AllScreens)
            bars.Add(new BarForm(screen.Bounds));

        if (bars.Count == 0) { ExitThread(); return; }
        foreach (BarForm bar in bars) bar.Show();
        UpdateBars();
        timer.Tick += (_, _) => OnTick();
        timer.Start();
    }

    private void OnTick()
    {
        UpdateBars();
        // 시작 직후 한 번만 쓰인 DLL·초기화 페이지를 작업 집합에서 내보낸다(약 5분마다 반복).
        if (tickCount++ % 150 == 2) TrimWorkingSet();
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

    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetProcessWorkingSetSize(IntPtr process, nint minimum, nint maximum);

    private void UpdateBars()
    {
        SystemSnapshot value = metrics.Sample();
        foreach (BarForm bar in bars) bar.UpdateSnapshot(value);
    }

    protected override void ExitThreadCore()
    {
        timer.Dispose();
        metrics.Dispose();
        foreach (BarForm bar in bars) bar.Dispose();
        base.ExitThreadCore();
    }
}

internal sealed class BarForm : Form
{
    private SystemSnapshot snapshot = new();
    private readonly Font font = new("Segoe UI", 10, FontStyle.Regular, GraphicsUnit.Point);

    public BarForm(Rectangle bounds)
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(bounds.Left, bounds.Top, bounds.Width, 30);
        BackColor = Color.FromArgb(28, 28, 30);
        DoubleBuffered = true;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get { const int WsExToolWindow = 0x80, WsExNoActivate = 0x08000000; CreateParams value = base.CreateParams; value.ExStyle |= WsExToolWindow | WsExNoActivate; return value; }
    }

    public void UpdateSnapshot(SystemSnapshot value) { snapshot = value; Invalidate(); }

    protected override void Dispose(bool disposing)
    {
        if (disposing) font.Dispose();
        base.Dispose(disposing);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Color textColor = Color.FromArgb(242, 242, 247);
        const TextFormatFlags commonFlags = TextFormatFlags.VerticalCenter
            | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding;
        var leftArea = new Rectangle(14, 0, ClientSize.Width / 3, ClientSize.Height);
        TextRenderer.DrawText(e.Graphics, "WinBar", font, leftArea, textColor,
            commonFlags | TextFormatFlags.Left);

        string Text(string name, double? value) => $"{name} {(value is null ? "--" : $"{value:0}%")}";
        string[] values =
        [
            Text("CPU", snapshot.CpuPercent),
            Text("GPU", snapshot.GpuPercent),
            Text("RAM", snapshot.RamPercent)
        ];
        const int columnWidth = 116;
        var batteryArea = new Rectangle(ClientSize.Width - 14 - columnWidth, 0,
            columnWidth, ClientSize.Height);
        DrawBattery(e.Graphics, textColor, batteryArea, commonFlags);

        int right = batteryArea.Left;
        for (int index = values.Length - 1; index >= 0; index--)
        {
            var area = new Rectangle(right - columnWidth, 0, columnWidth, ClientSize.Height);
            TextRenderer.DrawText(e.Graphics, values[index], font, area, textColor,
                commonFlags | TextFormatFlags.HorizontalCenter);
            right -= columnWidth;
        }
    }

    private enum MetricIcon { Gpu, Cpu, Ram }

    private static void DrawMetric(Graphics graphics, Font font, Color textColor,
        Rectangle area, MetricIcon icon, string text)
    {
        const int iconWidth = 22;
        const int iconHeight = 16;
        const int gap = 5;
        Size textSize = TextRenderer.MeasureText(graphics, text, font, Size.Empty,
            TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        int groupWidth = iconWidth + gap + textSize.Width;
        int iconLeft = area.Left + (area.Width - groupWidth) / 2;
        int iconTop = area.Top + (area.Height - iconHeight) / 2;
        var iconArea = new Rectangle(iconLeft, iconTop, iconWidth, iconHeight);

        System.Drawing.Drawing2D.SmoothingMode previousSmoothing = graphics.SmoothingMode;
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        switch (icon)
        {
            case MetricIcon.Gpu: DrawGpuIcon(graphics, iconArea, textColor); break;
            case MetricIcon.Cpu: DrawCpuIcon(graphics, iconArea, textColor); break;
            case MetricIcon.Ram: DrawRamIcon(graphics, iconArea, textColor); break;
        }
        graphics.SmoothingMode = previousSmoothing;

        var textArea = new Rectangle(iconArea.Right + gap, area.Top, textSize.Width, area.Height);
        TextRenderer.DrawText(graphics, text, font, textArea, textColor,
            TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine
            | TextFormatFlags.NoPadding | TextFormatFlags.Left);
    }

    private static void DrawGpuIcon(Graphics graphics, Rectangle area, Color outlineColor)
    {
        using var outline = new Pen(outlineColor, 1.3f);
        using var board = new SolidBrush(Color.FromArgb(36, 138, 61));
        using var fan = new SolidBrush(Color.FromArgb(55, 66, 72));
        var body = new Rectangle(area.Left + 2, area.Top + 2, 18, 11);
        graphics.FillRectangle(board, body);
        graphics.DrawRectangle(outline, body);
        graphics.DrawLine(outline, area.Left, area.Top + 3, area.Left + 2, area.Top + 3);
        graphics.DrawLine(outline, area.Left, area.Top + 7, area.Left + 2, area.Top + 7);
        graphics.DrawLine(outline, area.Left, area.Top + 11, area.Left + 2, area.Top + 11);
        graphics.DrawLine(outline, body.Left + 4, body.Bottom, body.Left + 15, body.Bottom);
        graphics.FillEllipse(fan, body.Left + 6, body.Top + 2, 7, 7);
        graphics.DrawEllipse(outline, body.Left + 6, body.Top + 2, 7, 7);
        graphics.FillEllipse(board, body.Left + 8, body.Top + 4, 3, 3);
    }

    private static void DrawCpuIcon(Graphics graphics, Rectangle area, Color outlineColor)
    {
        using var outline = new Pen(outlineColor, 1.3f);
        using var shell = new SolidBrush(Color.FromArgb(66, 78, 84));
        using var core = new SolidBrush(Color.FromArgb(210, 166, 61));
        var chip = new Rectangle(area.Left + 5, area.Top + 2, 12, 12);
        graphics.FillRectangle(shell, chip);
        graphics.DrawRectangle(outline, chip);
        graphics.FillRectangle(core, chip.Left + 3, chip.Top + 3, 6, 6);
        graphics.DrawRectangle(outline, chip.Left + 3, chip.Top + 3, 6, 6);
        for (int offset = 4; offset <= 12; offset += 4)
        {
            graphics.DrawLine(outline, area.Left + offset, area.Top, area.Left + offset, chip.Top);
            graphics.DrawLine(outline, area.Left + offset, chip.Bottom, area.Left + offset, area.Bottom);
            graphics.DrawLine(outline, area.Left + 3, area.Top + offset, chip.Left, area.Top + offset);
            graphics.DrawLine(outline, chip.Right, area.Top + offset, area.Right - 2, area.Top + offset);
        }
    }

    private static void DrawRamIcon(Graphics graphics, Rectangle area, Color outlineColor)
    {
        using var outline = new Pen(outlineColor, 1.3f);
        using var board = new SolidBrush(Color.FromArgb(36, 138, 61));
        using var chip = new SolidBrush(Color.FromArgb(55, 66, 72));
        using var contact = new SolidBrush(Color.FromArgb(210, 166, 61));
        var body = new Rectangle(area.Left + 1, area.Top + 3, 20, 10);
        graphics.FillRectangle(board, body);
        graphics.DrawRectangle(outline, body);
        for (int index = 0; index < 4; index++)
        {
            graphics.FillRectangle(chip, body.Left + 2 + index * 5, body.Top + 2, 3, 5);
            graphics.FillRectangle(contact, body.Left + 2 + index * 5, body.Bottom, 3, 2);
        }
    }

    private void DrawBattery(Graphics graphics, Color textColor, Rectangle area, TextFormatFlags flags)
    {
        const int boltGap = 2, boltWidth = 8, boltHeight = 13, numberGap = 5;
        const TextFormatFlags measureFlags = TextFormatFlags.SingleLine | TextFormatFlags.NoPadding;
        string percent = snapshot.BatteryPercent is byte value ? $"{value}%" : "--";
        Size label = TextRenderer.MeasureText(graphics, "BAT", font, Size.Empty, measureFlags);
        Size number = TextRenderer.MeasureText(graphics, percent, font, Size.Empty, measureFlags);
        int left = area.Left + (area.Width - (label.Width + boltGap + boltWidth + numberGap + number.Width)) / 2;

        TextRenderer.DrawText(graphics, "BAT", font,
            new Rectangle(left, area.Top, label.Width, area.Height), textColor, flags | TextFormatFlags.Left);

        // 충전 중이면 번개 안쪽까지 채우고, 아니면 테두리만 그린다.
        float x = left + label.Width + boltGap, y = area.Top + (area.Height - boltHeight) / 2f;
        PointF[] bolt =
        [
            new(x + 6, y), new(x, y + 7.5f), new(x + 3.5f, y + 7.5f),
            new(x + 2, y + boltHeight), new(x + boltWidth, y + 5.5f), new(x + 4.5f, y + 5.5f)
        ];
        System.Drawing.Drawing2D.SmoothingMode previousSmoothing = graphics.SmoothingMode;
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        if (snapshot.Charging)
        {
            using var fill = new SolidBrush(textColor);
            graphics.FillPolygon(fill, bolt);
        }
        else
        {
            using var outline = new Pen(textColor, 1f);
            graphics.DrawPolygon(outline, bolt);
        }
        graphics.SmoothingMode = previousSmoothing;

        int numberLeft = left + label.Width + boltGap + boltWidth + numberGap;
        TextRenderer.DrawText(graphics, percent, font,
            new Rectangle(numberLeft, area.Top, number.Width, area.Height), textColor, flags | TextFormatFlags.Left);
    }
}
