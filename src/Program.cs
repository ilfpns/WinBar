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

    public WinBarContext()
    {
        foreach (Screen screen in Screen.AllScreens)
            bars.Add(new BarForm(screen.Bounds));

        if (bars.Count == 0) { ExitThread(); return; }
        foreach (BarForm bar in bars) bar.Show();
        UpdateBars();
        timer.Tick += (_, _) => UpdateBars();
        timer.Start();
    }

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

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using Font font = new("Segoe UI", 10, FontStyle.Regular, GraphicsUnit.Point);
        Color textColor = Color.FromArgb(242, 242, 247);
        const TextFormatFlags commonFlags = TextFormatFlags.VerticalCenter
            | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding;
        var leftArea = new Rectangle(14, 0, ClientSize.Width / 3, ClientSize.Height);
        TextRenderer.DrawText(e.Graphics, "WinBar", font, leftArea, textColor,
            commonFlags | TextFormatFlags.Left);

        string Text(string icon, string name, double? value) => $"{icon} {name} {(value is null ? "--" : $"{value:0}%")}";
        string[] values =
        [
            Text("⚙️", "CPU", snapshot.CpuPercent),
            "🎮 GPU 0%",
            Text("🧠", "RAM", snapshot.RamPercent)
        ];
        const int columnWidth = 116;
        var batteryArea = new Rectangle(ClientSize.Width - 14 - columnWidth, 0,
            columnWidth, ClientSize.Height);
        DrawBattery(e.Graphics, font, textColor, batteryArea);

        int right = batteryArea.Left;
        for (int index = values.Length - 1; index >= 0; index--)
        {
            var area = new Rectangle(right - columnWidth, 0, columnWidth, ClientSize.Height);
            TextRenderer.DrawText(e.Graphics, values[index], font, area, textColor,
                commonFlags | TextFormatFlags.HorizontalCenter);
            right -= columnWidth;
        }
    }

    private void DrawBattery(Graphics graphics, Font font, Color textColor, Rectangle area)
    {
        const int bodyWidth = 48;
        const int bodyHeight = 18;
        const int terminalWidth = 4;
        const int gap = 8;
        string percentText = snapshot.BatteryPercent is null
            ? "--"
            : $"{snapshot.BatteryPercent}%{(snapshot.Charging ? "+" : "")}";
        Size textSize = TextRenderer.MeasureText(graphics, percentText, font,
            Size.Empty, TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        int groupWidth = bodyWidth + terminalWidth + gap + textSize.Width;
        int bodyLeft = area.Left + (area.Width - groupWidth) / 2;
        int bodyTop = area.Top + (area.Height - bodyHeight) / 2;
        var body = new Rectangle(bodyLeft, bodyTop, bodyWidth, bodyHeight);
        var terminal = new Rectangle(body.Right, bodyTop + 5, terminalWidth, bodyHeight - 10);

        using var outline = new Pen(textColor, 2);
        graphics.DrawRectangle(outline, body);
        graphics.DrawRectangle(outline, terminal);

        if (snapshot.BatteryPercent is byte percent)
        {
            int visualPercent = percent >= 99 ? 100 : percent;
            int fillWidth = (body.Width - 6) * visualPercent / 100;
            if (fillWidth > 0)
            {
                using var fill = new SolidBrush(Color.FromArgb(48, 209, 88));
                graphics.FillRectangle(fill, body.Left + 3, body.Top + 3,
                    fillWidth, body.Height - 5);
            }
        }

        var textArea = new Rectangle(terminal.Right + gap, area.Top,
            textSize.Width, area.Height);
        TextRenderer.DrawText(graphics, percentText, font, textArea, textColor,
            TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine
            | TextFormatFlags.NoPadding | TextFormatFlags.Left);
    }
}
