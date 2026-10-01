using System.Runtime.InteropServices;

namespace WinBar;

// 메뉴바 높이만큼 화면 상단을 Windows 작업 영역에서 비워 둔다.
// 최대화한 창의 제목 표시줄과 닫기 단추를 메뉴바가 가리지 않게 한다.
internal static class AppBar
{
    public static readonly int CallbackMessage = (int)RegisterWindowMessage("WinBar.AppBar");
    public const int PositionChanged = 1;
    public const int FullscreenApp = 2;

    private const uint MessageNew = 0, MessageRemove = 1, MessageQueryPos = 2, MessageSetPos = 3;
    private const uint EdgeTop = 1;

    public static bool Register(IntPtr window)
    {
        try
        {
            AppBarData data = Create(window);
            data.CallbackMessage = (uint)CallbackMessage;
            return SHAppBarMessage(MessageNew, ref data) != UIntPtr.Zero;
        }
        catch (Exception) { return false; }
    }

    // 위치가 이미 맞으면 다시 설정하지 않는다. 다른 앱바와 위치 변경 알림을 끝없이 주고받지 않게 한다.
    public static Rectangle? Reserve(IntPtr window, Rectangle monitor, int height, Rectangle current)
    {
        try
        {
            AppBarData data = Create(window);
            data.Edge = EdgeTop;
            data.Bounds = new NativeRect
            {
                Left = monitor.Left, Top = monitor.Top, Right = monitor.Right, Bottom = monitor.Top + height
            };
            SHAppBarMessage(MessageQueryPos, ref data);
            data.Bounds.Bottom = data.Bounds.Top + height;
            var proposed = Rectangle.FromLTRB(data.Bounds.Left, data.Bounds.Top, data.Bounds.Right, data.Bounds.Bottom);
            if (proposed == current) return proposed;
            SHAppBarMessage(MessageSetPos, ref data);
            return Rectangle.FromLTRB(data.Bounds.Left, data.Bounds.Top, data.Bounds.Right, data.Bounds.Bottom);
        }
        catch (Exception) { return null; }
    }

    public static void Unregister(IntPtr window)
    {
        try
        {
            AppBarData data = Create(window);
            SHAppBarMessage(MessageRemove, ref data);
        }
        catch (Exception) { }
    }

    private static AppBarData Create(IntPtr window) =>
        new() { Size = (uint)Marshal.SizeOf<AppBarData>(), Window = window };

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct AppBarData
    {
        public uint Size;
        public IntPtr Window;
        public uint CallbackMessage;
        public uint Edge;
        public NativeRect Bounds;
        public IntPtr Param;
    }

    [DllImport("shell32.dll")] private static extern UIntPtr SHAppBarMessage(uint message, ref AppBarData data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessage(string name);
}
