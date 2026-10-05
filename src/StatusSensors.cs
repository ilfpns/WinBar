using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace WinBar;

internal sealed record StatusSnapshot(
    bool WifiAvailable = false, bool WifiConnected = false, string? WifiName = null, int? WifiQuality = null,
    bool EthernetConnected = false,
    bool? BluetoothOn = null, string[]? BluetoothDevices = null,
    string InputLabel = "A", string InputName = "영어",
    bool MicrophoneInUse = false, bool CameraInUse = false,
    bool WifiConnecting = false, int? WifiLinkMbps = null)
{
    // Windows처럼 신호 품질을 1~5칸으로 나눈다(연결 안 됨은 0).
    public int WifiBars => !WifiConnected || WifiQuality is not int quality ? 0
        : quality >= 80 ? 5 : quality >= 60 ? 4 : quality >= 40 ? 3 : quality >= 20 ? 2 : 1;
}

// 재생 중인 곡 하나(Spotify·브라우저 등이 Windows 미디어 정보로 알려 주는 값). 앨범 그림은 96×96으로 줄여 둔다.
// Id: 앱 ID(세션 구분), Icon: 그 앱의 Windows 아이콘(작업 표시줄과 같은 그림), YouTube: 브라우저 창 제목으로 YouTube를 알아낸 경우
internal sealed record NowPlayingInfo(string Id, string Title, string Artist, string Album, string App, bool Playing,
    bool CanPrevious, bool CanNext, bool CanToggle, TimeSpan Position, TimeSpan Duration, DateTimeOffset UpdatedAt, Bitmap? Art,
    Bitmap? Icon = null, bool YouTube = false, bool CanSeek = false)
{
    // 재생 중이면 마지막으로 받은 위치에서 흐른 시간만큼 더한다(Windows는 위치를 가끔만 알려 줌).
    public TimeSpan CurrentPosition => Playing && Duration > TimeSpan.Zero
        ? TimeSpan.FromTicks(Math.Min(Duration.Ticks, (Position + (DateTimeOffset.Now - UpdatedAt)).Ticks))
        : Position;
}

// 지금 재생 중 감시: Windows 미디어 세션(System Media Transport Controls)을 모두 읽는다. Spotify API·인터넷이 필요 없다.
// Spotify와 YouTube가 동시에 있으면 둘 다(앱마다 하나씩) 알려 준다. Windows가 바뀜을 알려 줄 때만 다시 읽고(주기 조회 없음),
// 재생 위치만 바뀐 경우는 화면을 다시 그리지 않는다(진행 막대는 모달이 직접 계산). Changed는 UI가 아닌 스레드에서 올 수 있다.
internal static class NowPlaying
{
    private const int MaxSessions = 3;
    private static Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager? manager;
    private static readonly List<Windows.Media.Control.GlobalSystemMediaTransportControlsSession> sessions = [];
    private static readonly Dictionary<string, (string Key, Bitmap? Art)> arts = [];   // 앱 ID → (곡, 앨범 그림)
    private static int refreshing, pending;
    private static string signature = "";
    // 앨범 그림은 메뉴바·모달이 UI 스레드에서 그리므로, 다 쓴 그림은 UI 스레드에서 정리한다(그리는 도중 지워지지 않게).
    private static SynchronizationContext? ui;

    public static IReadOnlyList<NowPlayingInfo> All { get; private set; } = [];

    // 메뉴바에서 마우스를 올린 로고의 앱. 모달·버튼은 이 앱에 적용된다(없으면 재생 중인 것 → 첫 번째).
    public static string? SelectedId { get; set; }

    public static NowPlayingInfo? Current =>
        All.FirstOrDefault(info => info.Id == SelectedId) ?? All.FirstOrDefault(info => info.Playing) ?? All.FirstOrDefault();

    // artChanged: 앨범 그림이 바뀌어 메모리를 정리할 만한 경우
    public static event Action<bool>? Changed;

    public static async void Start()
    {
        ui = SynchronizationContext.Current;
        try
        {
            manager = await Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            manager.SessionsChanged += (_, _) => Attach();
            Attach();
        }
        catch (Exception) { manager = null; }
    }

    public static void Stop()
    {
        Detach();
        lock (arts)
        {
            foreach ((_, Bitmap? art) in arts.Values) art?.Dispose();
            arts.Clear();
        }
        All = [];
    }

    // 재생·일시정지·이전 곡·다음 곡·위치 이동(선택된 앱에 요청만 보낸다)
    public static void TogglePlayPause() => Send(s => s.TryTogglePlayPauseAsync().AsTask());
    public static void Previous() => Send(s => s.TrySkipPreviousAsync().AsTask());
    public static void Next() => Send(s => s.TrySkipNextAsync().AsTask());
    public static void Seek(TimeSpan position) => Send(s => s.TryChangePlaybackPositionAsync(Math.Max(0, position.Ticks)).AsTask());
    // 브라우저 탭을 바꾸면 창 제목이 바뀌므로, 메뉴바 로고에 마우스를 올릴 때 다시 확인한다.
    public static void Recheck() => _ = RefreshAsync();

    private static async void Send(Func<Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Task<bool>> request)
    {
        try
        {
            string? id = Current?.Id;
            Windows.Media.Control.GlobalSystemMediaTransportControlsSession? target;
            lock (sessions) target = sessions.FirstOrDefault(s => s.SourceAppUserModelId == id);
            if (target is not null) await request(target);
        }
        catch (Exception) { }
    }

    private static void Attach()
    {
        Detach();
        try
        {
            if (manager is null) return;
            lock (sessions)
            {
                foreach (var session in manager.GetSessions().Take(MaxSessions))
                {
                    session.MediaPropertiesChanged += OnMediaChanged;
                    session.PlaybackInfoChanged += OnPlaybackChanged;
                    session.TimelinePropertiesChanged += OnTimelineChanged;
                    sessions.Add(session);
                }
            }
        }
        catch (Exception) { }
        _ = RefreshAsync();
    }

    private static void Detach()
    {
        lock (sessions)
        {
            foreach (var session in sessions)
            {
                try
                {
                    session.MediaPropertiesChanged -= OnMediaChanged;
                    session.PlaybackInfoChanged -= OnPlaybackChanged;
                    session.TimelinePropertiesChanged -= OnTimelineChanged;
                }
                catch (Exception) { }
            }
            sessions.Clear();
        }
    }

    private static void OnMediaChanged(Windows.Media.Control.GlobalSystemMediaTransportControlsSession sender, Windows.Media.Control.MediaPropertiesChangedEventArgs args) => _ = RefreshAsync();
    private static void OnPlaybackChanged(Windows.Media.Control.GlobalSystemMediaTransportControlsSession sender, Windows.Media.Control.PlaybackInfoChangedEventArgs args) => _ = RefreshAsync();
    private static void OnTimelineChanged(Windows.Media.Control.GlobalSystemMediaTransportControlsSession sender, Windows.Media.Control.TimelinePropertiesChangedEventArgs args) => _ = RefreshAsync();

    // 알림이 한꺼번에 여러 번 와도 짧게 모아 한 번만 읽는다. 읽는 도중 새 알림이 오면 끝난 뒤 한 번 더 읽는다.
    // 읽기(세션·창 제목·아이콘·앨범 그림)는 UI 스레드 밖에서 한다 — 메뉴바에서 부르더라도 애니메이션이 멈추지 않게.
    private static async Task RefreshAsync()
    {
        if (Interlocked.Exchange(ref refreshing, 1) == 1) { Interlocked.Exchange(ref pending, 1); return; }
        try
        {
            do
            {
                Interlocked.Exchange(ref pending, 0);
                await Task.Delay(120).ConfigureAwait(false);
                await ReadAllAsync().ConfigureAwait(false);
            } while (Interlocked.Exchange(ref pending, 0) == 1);
        }
        catch (Exception) { }
        finally { Interlocked.Exchange(ref refreshing, 0); }
    }

    private static async Task ReadAllAsync()
    {
        Windows.Media.Control.GlobalSystemMediaTransportControlsSession[] snapshot;
        lock (sessions) snapshot = [.. sessions];
        var infos = new List<NowPlayingInfo>();
        bool artChanged = false;
        var alive = new HashSet<string>();
        var retired = new List<Bitmap>();
        foreach (var session in snapshot)
        {
            try
            {
                var properties = await session.TryGetMediaPropertiesAsync();
                if (properties is null || string.IsNullOrWhiteSpace(properties.Title)) continue;
                var playback = session.GetPlaybackInfo();
                var timeline = session.GetTimelineProperties();
                var controls = playback.Controls;
                string id = session.SourceAppUserModelId;
                if (!alive.Add(id)) continue; // 같은 앱의 세션이 둘이면 하나만
                // 같은 곡이면 앨범 그림을 다시 읽지 않는다.
                string key = properties.Title + "\n" + properties.AlbumTitle;
                Bitmap? art;
                bool known;
                lock (arts) known = arts.TryGetValue(id, out var cached) && cached.Key == key;
                if (known) lock (arts) art = arts[id].Art;
                else
                {
                    art = await ReadArtAsync(properties.Thumbnail);
                    lock (arts)
                    {
                        if (arts.TryGetValue(id, out var old) && old.Art is not null) retired.Add(old.Art);
                        arts[id] = (key, art);
                    }
                    artChanged = true;
                }
                string? site = IsBrowser(id) ? FindYouTubeWindow(id) : null;
                infos.Add(new NowPlayingInfo(id, properties.Title, properties.Artist ?? "", properties.AlbumTitle ?? "", site ?? AppName(id),
                    playback.PlaybackStatus == Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
                    controls.IsPreviousEnabled, controls.IsNextEnabled, controls.IsPlayPauseToggleEnabled,
                    timeline.Position, timeline.EndTime - timeline.StartTime, timeline.LastUpdatedTime, art,
                    AppIcon(id), site is not null, controls.IsPlaybackPositionEnabled));
            }
            catch (Exception) { }
        }
        // 사라진 앱의 앨범 그림은 정리
        lock (arts)
        {
            foreach (string gone in arts.Keys.Where(id => !alive.Contains(id)).ToArray())
            {
                if (arts[gone].Art is Bitmap art) retired.Add(art);
                arts.Remove(gone);
                artChanged = true;
            }
        }
        All = infos;
        // 바뀐 목록을 내건 뒤에 옛 앨범 그림을 UI 스레드에서 정리(그 전까지 그리는 쪽이 쓸 수 있음)
        if (retired.Count > 0)
        {
            if (ui is null) retired.ForEach(art => art.Dispose());
            else ui.Post(_ => retired.ForEach(art => art.Dispose()), null);
        }
        // 보이는 내용(곡·가수·앱·재생 상태·앨범 그림)이 바뀐 경우에만 알린다. 위치만 바뀐 알림은 조용히 반영.
        string next = string.Join("|", infos.Select(info => $"{info.Id}/{info.Title}/{info.Artist}/{info.App}/{info.Playing}/{info.YouTube}/{info.Art?.GetHashCode()}"));
        if (next == signature && !artChanged) return;
        signature = next;
        Changed?.Invoke(artChanged);
    }

    private static async Task<Bitmap?> ReadArtAsync(Windows.Storage.Streams.IRandomAccessStreamReference? reference)
    {
        if (reference is null) return null;
        try
        {
            using var stream = await reference.OpenReadAsync();
            using Stream data = stream.AsStreamForRead();
            using var image = Image.FromStream(data);
            var small = new Bitmap(96, 96);
            using Graphics graphics = Graphics.FromImage(small);
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(image, 0, 0, 96, 96);
            return small;
        }
        catch (Exception) { return null; }
    }
    private static bool IsBrowser(string id)
    {
        string lower = id.ToLowerInvariant();
        return lower.Contains("chrome") || lower.Contains("msedge") || lower.Contains("firefox") || lower.Contains("whale") || lower.Contains("opera") || lower.Contains("brave");
    }

    // 브라우저 창 제목에 YouTube가 있으면 "YouTube"(또는 "YouTube Music"). 창 제목은 일반 권한으로 읽을 수 있다.
    private static string? FindYouTubeWindow(string id)
    {
        string? found = null;
        try
        {
            EnumWindows((window, _) =>
            {
                if (!IsWindowVisible(window)) return true;
                var text = new StringBuilder(512);
                if (GetWindowText(window, text, text.Capacity) == 0) return true;
                string title = text.ToString();
                if (title.Contains("YouTube Music", StringComparison.OrdinalIgnoreCase)) { found = "YouTube Music"; return false; }
                if (title.Contains("- YouTube", StringComparison.OrdinalIgnoreCase)) { found = "YouTube"; return false; }
                return true;
            }, IntPtr.Zero);
        }
        catch (Exception) { }
        return found;
    }

    // 앱 아이콘: Windows 셸에 앱 ID로 물어 작업 표시줄과 같은 아이콘을 받는다(32×32, 투명 배경 유지). 앱마다 한 번만 읽는다.
    private static readonly Dictionary<string, Bitmap?> icons = [];

    private static Bitmap? AppIcon(string id)
    {
        lock (icons)
        {
            if (icons.TryGetValue(id, out Bitmap? cached)) return cached;
            Bitmap? icon = null;
            try
            {
                SHCreateItemFromParsingName(@"shell:AppsFolder\" + id, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out IShellItemImageFactory factory);
                if (factory.GetImage(new NativeSize { Width = 32, Height = 32 }, 0x1 | 0x4, out IntPtr bitmap) == 0 && bitmap != IntPtr.Zero) // BIGGERSIZEOK | ICONONLY
                    icon = ToAlphaBitmap(bitmap);
                Marshal.ReleaseComObject(factory);
            }
            catch (Exception) { icon = null; }
            icons[id] = icon;
            return icon;
        }
    }

    // 셸이 준 32비트 비트맵을 투명도를 살려 옮긴다(Image.FromHbitmap은 투명도를 버림).
    private static Bitmap? ToAlphaBitmap(IntPtr handle)
    {
        try
        {
            if (GetObject(handle, Marshal.SizeOf<NativeBitmap>(), out NativeBitmap info) == 0 || info.Width <= 0 || info.Height <= 0) return null;
            var bitmap = new Bitmap(info.Width, info.Height, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
            var data = bitmap.LockBits(new Rectangle(0, 0, info.Width, info.Height), System.Drawing.Imaging.ImageLockMode.WriteOnly, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
            var header = new BitmapInfoHeader { Size = 40, Width = info.Width, Height = -info.Height, Planes = 1, BitCount = 32 };
            IntPtr screen = GetDC(IntPtr.Zero);
            GetDIBits(screen, handle, 0, (uint)info.Height, data.Scan0, ref header, 0);
            ReleaseDC(IntPtr.Zero, screen);
            bitmap.UnlockBits(data);
            return bitmap;
        }
        catch (Exception) { return null; }
        finally { DeleteObject(handle); }
    }

    [ComImport, Guid("BCC18B79-BA16-442F-80C4-8A59C30C463B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory { [PreserveSig] int GetImage(NativeSize size, int flags, out IntPtr bitmap); }
    [StructLayout(LayoutKind.Sequential)] private struct NativeSize { public int Width, Height; }
    [StructLayout(LayoutKind.Sequential)] private struct NativeBitmap { public int Type, Width, Height, WidthBytes; public ushort Planes, BitsPixel; public IntPtr Bits; }
    [StructLayout(LayoutKind.Sequential)] private struct BitmapInfoHeader { public int Size, Width, Height; public ushort Planes, BitCount; public int Compression, SizeImage, XPelsPerMeter, YPelsPerMeter, ClrUsed, ClrImportant; }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string path, IntPtr bindContext, [MarshalAs(UnmanagedType.LPStruct)] Guid interfaceId, out IShellItemImageFactory item);
    [DllImport("gdi32.dll")] private static extern int GetObject(IntPtr handle, int size, out NativeBitmap value);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint lines, IntPtr bits, ref BitmapInfoHeader info, uint usage);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);

    // "SpotifyAB.SpotifyMusic_…!Spotify" → "Spotify", "chrome" → "Chrome"
    private static string AppName(string id)
    {
        string name = id.Contains('!') ? id[(id.LastIndexOf('!') + 1)..] : Path.GetFileNameWithoutExtension(id);
        return name.ToLowerInvariant() switch
        {
            "chrome" => "Chrome",
            "msedge" => "Edge",
            "firefox" => "Firefox",
            "app" => "Windows",
            _ => name.Length > 0 ? char.ToUpperInvariant(name[0]) + name[1..] : "앱"
        };
    }
}

// 등록된 Bluetooth 기기 하나(이름, 지금 연결되어 있는지, Windows가 알려 주는 배터리 잔량 %)
internal sealed record BluetoothDevice(string Name, bool Connected, int? Battery = null);

// macOS 메뉴바처럼 "상태"를 보여 주는 센서들. 각 센서는 따로 실패를 처리한다.
internal sealed class StatusSensors : IDisposable
{
    private IntPtr wlanHandle;
    private volatile bool ethernetConnected;
    private bool? bluetoothOn;
    private string[] bluetoothDevices = [];
    private volatile bool microphoneInUse, cameraInUse;
    private readonly ManualResetEvent stopEvent = new(false);
    private readonly Thread privacyThread;

    // Wi-Fi 외 네트워크 변경, 카메라·마이크 사용 변경 시 백그라운드 스레드에서 호출된다.
    public event Action? Changed;

    public StatusSensors()
    {
        try
        {
            if (WlanOpenHandle(2, IntPtr.Zero, out _, out IntPtr handle) == 0) wlanHandle = handle;
        }
        catch (Exception) { wlanHandle = IntPtr.Zero; }

        // Wi-Fi 서비스가 신호 세기·연결 시작·연결·끊김을 알려 줄 때만 다시 읽는다(주기 조회 없음).
        if (wlanHandle != IntPtr.Zero)
        {
            try
            {
                wlanCallback = OnWlanNotification;
                WlanRegisterNotification(wlanHandle, 0x08 | 0x10, false, wlanCallback, IntPtr.Zero, IntPtr.Zero, out _);
            }
            catch (Exception) { wlanCallback = null; }
        }

        ethernetConnected = SampleEthernet();
        NetworkChange.NetworkAddressChanged += OnNetworkChanged;
        NetworkChange.NetworkAvailabilityChanged += OnNetworkChanged;

        privacyThread = new Thread(WatchPrivacy) { IsBackground = true, Name = "WinBar privacy" };
        privacyThread.Start();
    }

    private (string Label, string Name) lastInput = ("A", "알 수 없음");

    public StatusSnapshot Sample(bool includeBluetooth)
    {
        (bool available, bool connected, string? name, int? quality, int? linkMbps) wifi = default;
        try { wifi = SampleWifi(); } catch (Exception) { }
        if (includeBluetooth)
        {
            try { SampleBluetooth(); } catch (Exception) { bluetoothOn = null; bluetoothDevices = []; }
        }
        try { lastInput = SampleInputSource() ?? lastInput; } catch (Exception) { }

        return new StatusSnapshot(wifi.available, wifi.connected, wifi.name, wifi.quality,
            ethernetConnected, radioOn ?? bluetoothOn, bluetoothDevices, lastInput.Label, lastInput.Name,
            microphoneInUse, cameraInUse, wifiConnecting && !wifi.connected, wifi.linkMbps);
    }

    private WlanNotificationCallback? wlanCallback;
    private volatile bool wifiConnecting;
    private Guid wifiInterface;
    private bool? radioOn;

    // Wi-Fi 알림(Wi-Fi 서비스 스레드): 연결 시작이면 "연결 중"으로 표시하고, 무엇이든 바뀌면 다시 읽게 알린다.
    private void OnWlanNotification(IntPtr data, IntPtr context)
    {
        try
        {
            int source = Marshal.ReadInt32(data, 0);
            int code = Marshal.ReadInt32(data, 4);
            if (source == 0x08) // ACM: 연결 시작(9) · 완료(10) · 실패(11) · 끊김(21)
            {
                if (code == 9) wifiConnecting = true;
                else if (code is 10 or 11 or 21) wifiConnecting = false;
            }
            else if (source == 0x10) // MSM: 연결 중(1,3) · 연결됨(4) · 끊김(10) · 신호 변화(8)
            {
                if (code is 1 or 3) wifiConnecting = true;
                else if (code is 4 or 10) wifiConnecting = false;
            }
            Changed?.Invoke();
        }
        catch (Exception) { }
    }

    // 기기에 저장된 Wi-Fi 네트워크 이름(네트워크 모달을 열 때만 읽는다)
    public string[] GetSavedNetworks()
    {
        if (wlanHandle == IntPtr.Zero || wifiInterface == Guid.Empty) return [];
        IntPtr list = IntPtr.Zero;
        try
        {
            Guid id = wifiInterface;
            if (WlanGetProfileList(wlanHandle, ref id, IntPtr.Zero, out list) != 0) return [];
            int count = Marshal.ReadInt32(list, 0);
            var names = new List<string>();
            for (int index = 0; index < count && index < 32; index++)
            {
                string? name = Marshal.PtrToStringUni(IntPtr.Add(list, 8 + index * 516)); // WLAN_PROFILE_INFO: wchar[256] + flags
                if (!string.IsNullOrWhiteSpace(name)) names.Add(name);
            }
            return [.. names];
        }
        catch (Exception) { return []; }
        finally { if (list != IntPtr.Zero) WlanFreeMemory(list); }
    }

    // 지금 Wi-Fi(없으면 유선) 인터페이스로 주고받은 누적 바이트. 1초 간격 차이로 실제 Mbps를 구한다.
    public (long Received, long Sent)? ReadTraffic()
    {
        try
        {
            string wanted = wifiInterface == Guid.Empty ? "" : wifiInterface.ToString("B");
            foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
            {
                bool match = wanted.Length > 0
                    ? adapter.Id.Equals(wanted, StringComparison.OrdinalIgnoreCase)
                    : adapter.OperationalStatus == OperationalStatus.Up
                      && adapter.NetworkInterfaceType is NetworkInterfaceType.Ethernet or NetworkInterfaceType.GigabitEthernet;
                if (!match) continue;
                IPInterfaceStatistics statistics = adapter.GetIPStatistics();
                return (statistics.BytesReceived, statistics.BytesSent);
            }
        }
        catch (Exception) { }
        return null;
    }

    // Bluetooth 켜짐 여부(Windows Radio API). 제어 센터를 열 때만 부른다.
    public async Task<bool?> ReadBluetoothRadioAsync()
    {
        try
        {
            radioOn = await BluetoothRadio.GetStateAsync();
            return radioOn;
        }
        catch (Exception) { return null; }
    }

    // Bluetooth를 켜거나 끈다. 사용자가 제어 센터에서 직접 눌렀을 때만 부른다.
    public async Task<bool> SetBluetoothAsync(bool on)
    {
        try
        {
            bool ok = await BluetoothRadio.SetStateAsync(on);
            radioOn = await BluetoothRadio.GetStateAsync();
            Changed?.Invoke();
            return ok;
        }
        catch (Exception) { return false; }
    }

    public StatusSnapshot WithInput(StatusSnapshot current)
    {
        try
        {
            lastInput = SampleInputSource() ?? lastInput;
            return current with { InputLabel = lastInput.Label, InputName = lastInput.Name };
        }
        catch (Exception) { return current; }
    }

    private void OnNetworkChanged(object? sender, EventArgs e)
    {
        bool next = SampleEthernet();
        ethernetConnected = next;
        Changed?.Invoke();
    }

    private (bool available, bool connected, string? name, int? quality, int? linkMbps) SampleWifi()
    {
        if (wlanHandle == IntPtr.Zero) return default;
        IntPtr list = IntPtr.Zero;
        try
        {
            if (WlanEnumInterfaces(wlanHandle, IntPtr.Zero, out list) != 0) return default;
            int count = Marshal.ReadInt32(list, 0);
            const int infoSize = 532; // Guid(16) + 설명 wchar[256](512) + 상태(4)
            if (count > 0) wifiInterface = Marshal.PtrToStructure<Guid>(IntPtr.Add(list, 8));
            for (int index = 0; index < count; index++)
            {
                IntPtr info = IntPtr.Add(list, 8 + index * infoSize);
                if (Marshal.ReadInt32(info, 528) != 1) continue; // wlan_interface_state_connected
                Guid interfaceId = Marshal.PtrToStructure<Guid>(info);
                wifiInterface = interfaceId;
                if (WlanQueryInterface(wlanHandle, ref interfaceId, 7, IntPtr.Zero,
                        out _, out IntPtr data, out _) != 0) continue;
                try
                {
                    // WLAN_CONNECTION_ATTRIBUTES: SSID 길이 520, SSID 524, 신호 품질 576, 받기 속도(kbps) 580
                    int length = Math.Clamp(Marshal.ReadInt32(data, 520), 0, 32);
                    byte[] ssid = new byte[length];
                    Marshal.Copy(IntPtr.Add(data, 524), ssid, 0, length);
                    int quality = Math.Clamp(Marshal.ReadInt32(data, 576), 0, 100);
                    uint rxKbps = (uint)Marshal.ReadInt32(data, 580);
                    int? linkMbps = rxKbps == 0 ? null : (int)(rxKbps / 1000);
                    return (true, true, Encoding.UTF8.GetString(ssid), quality, linkMbps);
                }
                finally { WlanFreeMemory(data); }
            }
            return (count > 0, false, null, null, null);
        }
        finally
        {
            if (list != IntPtr.Zero) WlanFreeMemory(list);
        }
    }

    private static bool SampleEthernet()
    {
        try
        {
            foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (adapter.OperationalStatus != OperationalStatus.Up
                    || adapter.NetworkInterfaceType is not (NetworkInterfaceType.Ethernet
                        or NetworkInterfaceType.GigabitEthernet)) continue;
                string description = adapter.Description;
                if (description.Contains("Virtual", StringComparison.OrdinalIgnoreCase)
                    || description.Contains("Hyper-V", StringComparison.OrdinalIgnoreCase)
                    || description.Contains("VPN", StringComparison.OrdinalIgnoreCase)
                    || description.Contains("TAP", StringComparison.Ordinal)) continue;
                if (adapter.GetIPProperties().GatewayAddresses.Count > 0) return true;
            }
        }
        catch (Exception) { }
        return false;
    }

    // 이 PC에 등록(페어링)된 Bluetooth 기기와 연결 여부. 제어 센터의 Bluetooth 세부 창을 열 때만 읽는다(주변 검색은 하지 않음).
    public BluetoothDevice[] GetPairedBluetoothDevices()
    {
        try
        {
            var search = new BluetoothDeviceSearchParams
            {
                Size = (uint)Marshal.SizeOf<BluetoothDeviceSearchParams>(),
                ReturnAuthenticated = 1,
                ReturnRemembered = 1,
                ReturnConnected = 1,
                Radio = IntPtr.Zero // 모든 Bluetooth 라디오
            };
            var info = new BluetoothDeviceInfo { Size = (uint)Marshal.SizeOf<BluetoothDeviceInfo>() };
            var devices = new List<BluetoothDevice>();
            IntPtr find = BluetoothFindFirstDevice(ref search, ref info);
            if (find == IntPtr.Zero) return [];
            do
            {
                if (!string.IsNullOrWhiteSpace(info.Name) && devices.All(device => device.Name != info.Name))
                    devices.Add(new BluetoothDevice(info.Name, info.Connected != 0));
                info.Size = (uint)Marshal.SizeOf<BluetoothDeviceInfo>();
            } while (BluetoothFindNextDevice(find, ref info));
            BluetoothFindDeviceClose(find);
            // 연결된 기기에 배터리 잔량을 붙이고, 연결된 기기를 위로
            Dictionary<string, int> levels = ReadBluetoothBatteryLevels();
            return [.. devices
                .Select(device => device.Connected ? device with { Battery = FindBattery(levels, device.Name) } : device)
                .OrderByDescending(device => device.Connected).ThenBy(device => device.Name)];
        }
        catch (Exception) { return []; }
    }

    // 장치 이름이 같거나 "AirPods Pro Hands-Free"처럼 Bluetooth 이름으로 시작하는 장치의 배터리 값을 찾는다.
    private static int? FindBattery(Dictionary<string, int> levels, string name)
    {
        foreach ((string device, int level) in levels)
            if (device.StartsWith(name, StringComparison.OrdinalIgnoreCase) || name.StartsWith(device, StringComparison.OrdinalIgnoreCase))
                return level;
        return null;
    }

    // Windows 설정의 Bluetooth 배터리 표시와 같은 값: 장치 속성 DEVPKEY_Bluetooth_Battery(0~100).
    // 연결된 기기가 알려 주는 경우에만 있다(이어폰·키보드 등). Bluetooth 세부 창을 열 때만 읽는다.
    private static Dictionary<string, int> ReadBluetoothBatteryLevels()
    {
        var levels = new Dictionary<string, int>();
        IntPtr set = SetupDiGetClassDevs(IntPtr.Zero, null, IntPtr.Zero, 0x2 | 0x4); // DIGCF_PRESENT | DIGCF_ALLCLASSES
        if (set == IntPtr.Zero || set == new IntPtr(-1)) return levels;
        try
        {
            var batteryKey = new DevPropKey { Category = new Guid("104EA319-6EE2-4701-BD47-8DDBF425BBE5"), Id = 2 };
            var nameKey = new DevPropKey { Category = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), Id = 14 };
            var info = new DevInfoData { Size = (uint)Marshal.SizeOf<DevInfoData>() };
            var battery = new byte[1];
            var name = new byte[512];
            for (uint index = 0; SetupDiEnumDeviceInfo(set, index, ref info); index++)
            {
                if (!SetupDiGetDeviceProperty(set, ref info, ref batteryKey, out _, battery, 1, out _, 0)) continue;
                if (!SetupDiGetDeviceProperty(set, ref info, ref nameKey, out _, name, (uint)name.Length, out uint used, 0)) continue;
                string device = Encoding.Unicode.GetString(name, 0, (int)Math.Max(0, used - 2));
                if (device.Length > 0 && battery[0] <= 100) levels[device] = battery[0];
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return levels;
    }

    [StructLayout(LayoutKind.Sequential)] private struct DevInfoData { public uint Size; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] private struct DevPropKey { public Guid Category; public uint Id; }
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SetupDiGetClassDevs(IntPtr classGuid, string? enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll")] private static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref DevInfoData data);
    [DllImport("setupapi.dll", EntryPoint = "SetupDiGetDevicePropertyW")]
    private static extern bool SetupDiGetDeviceProperty(IntPtr set, ref DevInfoData data, ref DevPropKey key, out uint type, byte[] buffer, uint size, out uint required, uint flags);
    [DllImport("setupapi.dll")] private static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

    private void SampleBluetooth()
    {
        var radioParams = new BluetoothFindRadioParams { Size = (uint)Marshal.SizeOf<BluetoothFindRadioParams>() };
        IntPtr radioFind = BluetoothFindFirstRadio(ref radioParams, out IntPtr radio);
        if (radioFind == IntPtr.Zero)
        {
            // 라디오가 꺼져 있거나 Bluetooth 장치가 없다.
            bluetoothOn = false;
            bluetoothDevices = [];
            return;
        }
        BluetoothFindRadioClose(radioFind);
        try
        {
            var search = new BluetoothDeviceSearchParams
            {
                Size = (uint)Marshal.SizeOf<BluetoothDeviceSearchParams>(),
                ReturnConnected = 1,
                Radio = radio
            };
            var info = new BluetoothDeviceInfo { Size = (uint)Marshal.SizeOf<BluetoothDeviceInfo>() };
            var names = new List<string>();
            IntPtr deviceFind = BluetoothFindFirstDevice(ref search, ref info);
            if (deviceFind != IntPtr.Zero)
            {
                do
                {
                    if (info.Connected != 0 && !string.IsNullOrWhiteSpace(info.Name)) names.Add(info.Name);
                    info.Size = (uint)Marshal.SizeOf<BluetoothDeviceInfo>();
                } while (BluetoothFindNextDevice(deviceFind, ref info));
                BluetoothFindDeviceClose(deviceFind);
            }
            bluetoothOn = true;
            bluetoothDevices = [.. names];
        }
        finally { CloseHandle(radio); }
    }

    // 메모장·Chrome처럼 TSF만 쓰는 앱은 Windows가 알려 주는 한/영 값(IMM)이 바뀌지 않는다.
    // 내부 입력 스레드가 바뀌어도 같은 앱 창의 상태가 끊기지 않도록 최상위 창별로 기억한다.
    private readonly Dictionary<IntPtr, bool> trackedNative = [];
    private IntPtr pendingContextWindow;
    private bool? pendingImmBefore;
    private bool pendingShownBefore;
    private long pendingSince = -1;
    private const int ImmSettleMilliseconds = 90;

    // 한/영 키를 누른 순간(UI 스레드)에 호출한다. 이후 확인에서 IMM 값이 바뀌는지 본다.
    public void NoteInputToggle()
    {
        try
        {
            (IntPtr inputWindow, IntPtr contextWindow, uint thread, uint processId) = GetInputTarget();
            if (inputWindow == IntPtr.Zero || processId == (uint)Environment.ProcessId) return;
            if (((long)GetKeyboardLayout(thread) & 0xFFFF) != 0x0412) return;
            bool? imm = ReadImmNative(inputWindow);
            pendingContextWindow = contextWindow;
            pendingImmBefore = imm;
            pendingShownBefore = trackedNative.TryGetValue(contextWindow, out bool tracked) ? tracked : imm ?? false;
            pendingSince = Environment.TickCount64;
        }
        catch (Exception) { pendingSince = -1; }
    }

    private static bool? ReadImmNative(IntPtr window)
    {
        IntPtr ime = ImmGetDefaultIMEWnd(window);
        if (ime == IntPtr.Zero
            || SendMessageTimeout(ime, 0x0283, (IntPtr)0x0005, IntPtr.Zero, 0x0002, 25, out IntPtr open) == IntPtr.Zero)
            return null;
        return open != IntPtr.Zero; // WM_IME_CONTROL · IMC_GETOPENSTATUS: 열림=한글(K), 닫힘=영문(A)
    }

    // 최상위 창이 아니라 실제 키보드 포커스를 가진 자식 창을 기준으로 입력 상태를 읽는다.
    // 브라우저·편집기처럼 창과 입력 컨트롤의 스레드가 다른 앱에서도 같은 기준을 사용한다.
    private static (IntPtr InputWindow, IntPtr ContextWindow, uint Thread, uint ProcessId) GetInputTarget()
    {
        IntPtr foreground = GetForegroundWindow();
        uint foregroundThread = GetWindowThreadProcessId(foreground, out uint foregroundProcess);
        if (foreground == IntPtr.Zero || foregroundThread == 0)
            return (IntPtr.Zero, IntPtr.Zero, 0, foregroundProcess);

        GuiThreadInfo info = new() { Size = (uint)Marshal.SizeOf<GuiThreadInfo>() };
        if (GetGUIThreadInfo(foregroundThread, ref info) && info.Focus != IntPtr.Zero)
            return (info.Focus, foreground, foregroundThread, foregroundProcess);
        return (foreground, foreground, foregroundThread, foregroundProcess);
    }

    // 사용 중인 앱(맨 앞 창)의 입력 상태를 읽는다. 맨 앞 창이 WinBar 자신이면 읽지 않고 이전 값을 유지한다.
    private (string label, string name)? SampleInputSource()
    {
        (IntPtr inputWindow, IntPtr contextWindow, uint thread, uint processId) = GetInputTarget();
        if (inputWindow == IntPtr.Zero || processId == (uint)Environment.ProcessId) return null;
        int language = (int)((long)GetKeyboardLayout(thread) & 0xFFFF);
        if (language == 0x0412)
        {
            bool? imm = ReadImmNative(inputWindow);
            bool native;
            if (pendingSince >= 0 && Environment.TickCount64 - pendingSince > 1000) pendingSince = -1;
            if (pendingSince >= 0 && contextWindow == pendingContextWindow)
            {
                if (imm is not null && imm != pendingImmBefore)
                {
                    // IMM이 바로 따라오는 앱: Windows 값을 그대로 쓴다.
                    trackedNative.Remove(contextWindow);
                    pendingSince = -1;
                    native = imm.Value;
                }
                else if (Environment.TickCount64 - pendingSince >= ImmSettleMilliseconds)
                {
                    // IMM이 바뀌지 않는 앱(TSF): 한/영 키를 직접 따라간다.
                    if (trackedNative.Count > 64) trackedNative.Clear();
                    native = trackedNative[contextWindow] = !pendingShownBefore;
                    pendingSince = -1;
                }
                else return null; // 아직 확인 중이면 표시를 바꾸지 않는다.
            }
            else if (trackedNative.TryGetValue(contextWindow, out bool tracked)) native = tracked;
            else native = imm ?? false;
            return native ? ("K", "한국어 · 한글") : ("A", "한국어 · 영문");
        }
        return language switch
        {
            0x0409 => ("A", "영어 (미국)"),
            0x0809 => ("A", "영어 (영국)"),
            0x0411 => ("あ", "일본어"),
            0x0804 or 0x0404 => ("中", "중국어"),
            _ => ("A", "기타 입력 소스")
        };
    }

    // 카메라·마이크 사용 기록 레지스트리가 바뀔 때만 다시 확인한다(주기 조회 없음).
    private void WatchPrivacy()
    {
        const string storePath = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";
        try
        {
            using RegistryKey? store = Registry.CurrentUser.OpenSubKey(storePath);
            if (store is null) return;
            using var changed = new AutoResetEvent(false);
            while (true)
            {
                if (RegNotifyChangeKeyValue(store.Handle, true, 0x00000001 | 0x00000004,
                        changed.SafeWaitHandle, true) != 0) return;
                bool microphone = IsInUse(store, "microphone");
                bool camera = IsInUse(store, "webcam");
                if (microphone != microphoneInUse || camera != cameraInUse)
                {
                    microphoneInUse = microphone;
                    cameraInUse = camera;
                    Changed?.Invoke();
                }
                if (WaitHandle.WaitAny([changed, stopEvent]) == 1) return;
            }
        }
        catch (Exception) { }
    }

    private static bool IsInUse(RegistryKey store, string capability)
    {
        using RegistryKey? key = store.OpenSubKey(capability);
        return key is not null && AnyInUse(key, nested: false);
    }

    private static bool AnyInUse(RegistryKey key, bool nested)
    {
        foreach (string name in key.GetSubKeyNames())
        {
            using RegistryKey? child = key.OpenSubKey(name);
            if (child is null) continue;
            if (child.GetValue("LastUsedTimeStart") is long start && start != 0
                && child.GetValue("LastUsedTimeStop") is long stop && stop == 0) return true;
            if (!nested && name == "NonPackaged" && AnyInUse(child, nested: true)) return true;
        }
        return false;
    }

    public void Dispose()
    {
        NetworkChange.NetworkAddressChanged -= OnNetworkChanged;
        NetworkChange.NetworkAvailabilityChanged -= OnNetworkChanged;
        Changed = null;
        stopEvent.Set();
        privacyThread.Join(500);
        stopEvent.Dispose();
        if (wlanHandle != IntPtr.Zero)
        {
            WlanCloseHandle(wlanHandle, IntPtr.Zero);
            wlanHandle = IntPtr.Zero;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BluetoothFindRadioParams { public uint Size; }

    [StructLayout(LayoutKind.Sequential)]
    private struct BluetoothDeviceSearchParams
    {
        public uint Size;
        public int ReturnAuthenticated, ReturnRemembered, ReturnUnknown, ReturnConnected, IssueInquiry;
        public byte TimeoutMultiplier;
        public IntPtr Radio;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemTime { public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct BluetoothDeviceInfo
    {
        public uint Size;
        public ulong Address;
        public uint ClassOfDevice;
        public int Connected, Remembered, Authenticated;
        public SystemTime LastSeen, LastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string Name;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo
    {
        public uint Size, Flags;
        public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public int CaretLeft, CaretTop, CaretRight, CaretBottom;
    }

    [DllImport("wlanapi.dll")] private static extern uint WlanOpenHandle(uint clientVersion, IntPtr reserved, out uint negotiatedVersion, out IntPtr clientHandle);
    [DllImport("wlanapi.dll")] private static extern uint WlanCloseHandle(IntPtr clientHandle, IntPtr reserved);
    [DllImport("wlanapi.dll")] private static extern uint WlanEnumInterfaces(IntPtr clientHandle, IntPtr reserved, out IntPtr interfaceList);
    [DllImport("wlanapi.dll")] private static extern uint WlanQueryInterface(IntPtr clientHandle, ref Guid interfaceId, int opCode, IntPtr reserved, out uint dataSize, out IntPtr data, out int valueType);
    [DllImport("wlanapi.dll")] private static extern void WlanFreeMemory(IntPtr memory);
    private delegate void WlanNotificationCallback(IntPtr data, IntPtr context);
    [DllImport("wlanapi.dll")] private static extern uint WlanRegisterNotification(IntPtr clientHandle, uint source, bool ignoreDuplicate, WlanNotificationCallback? callback, IntPtr context, IntPtr reserved, out uint previousSource);
    [DllImport("wlanapi.dll")] private static extern uint WlanGetProfileList(IntPtr clientHandle, ref Guid interfaceId, IntPtr reserved, out IntPtr profileList);
    [DllImport("bthprops.cpl")] private static extern IntPtr BluetoothFindFirstRadio(ref BluetoothFindRadioParams parameters, out IntPtr radio);
    [DllImport("bthprops.cpl")] private static extern bool BluetoothFindRadioClose(IntPtr find);
    [DllImport("bthprops.cpl")] private static extern IntPtr BluetoothFindFirstDevice(ref BluetoothDeviceSearchParams parameters, ref BluetoothDeviceInfo info);
    [DllImport("bthprops.cpl")] private static extern bool BluetoothFindNextDevice(IntPtr find, ref BluetoothDeviceInfo info);
    [DllImport("bthprops.cpl")] private static extern bool BluetoothFindDeviceClose(IntPtr find);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint threadId, ref GuiThreadInfo info);
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint threadId);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("imm32.dll")] private static extern IntPtr ImmGetDefaultIMEWnd(IntPtr window);
    [DllImport("advapi32.dll")] private static extern int RegNotifyChangeKeyValue(SafeRegistryHandle key, bool watchSubtree, uint filter, SafeWaitHandle changeEvent, bool asynchronous);
}

// Bluetooth 라디오 켜기·끄기(Windows.Devices.Radios). 공식 Windows SDK 연결을 쓰며,
// 이 형식은 제어 센터를 열거나 Bluetooth를 누를 때만 불러와 평소 메모리에 올라오지 않게 한다.
internal static class BluetoothRadio
{
    private static async Task<Windows.Devices.Radios.Radio?> FindAsync()
    {
        foreach (Windows.Devices.Radios.Radio radio in await Windows.Devices.Radios.Radio.GetRadiosAsync())
            if (radio.Kind == Windows.Devices.Radios.RadioKind.Bluetooth) return radio;
        return null;
    }

    public static async Task<bool?> GetStateAsync()
    {
        Windows.Devices.Radios.Radio? radio = await FindAsync();
        return radio is null ? null : radio.State == Windows.Devices.Radios.RadioState.On;
    }

    public static async Task<bool> SetStateAsync(bool on)
    {
        if (await Windows.Devices.Radios.Radio.RequestAccessAsync() != Windows.Devices.Radios.RadioAccessStatus.Allowed) return false;
        Windows.Devices.Radios.Radio? radio = await FindAsync();
        if (radio is null) return false;
        var result = await radio.SetStateAsync(on ? Windows.Devices.Radios.RadioState.On : Windows.Devices.Radios.RadioState.Off);
        return result == Windows.Devices.Radios.RadioAccessStatus.Allowed;
    }
}

// 화면에 보이지 않는 창 하나로 키보드·마우스 입력과 전원 변경을 "지켜보기만" 한다.
// Raw Input(RIDEV_INPUTSINK)은 입력을 가로채거나 막지 않으며, 키 내용을 저장하지 않는다.
internal sealed class SystemEventWatcher : NativeWindow, IDisposable
{
    private const int WmInput = 0x00FF;
    private const int WmPowerBroadcast = 0x0218;
    private const int PbtPowerStatusChange = 0x000A;
    private const int PbtPowerSettingChange = 0x8013;
    private const ushort VkHangul = 0x15;
    private const ushort VkSpace = 0x20;
    private const ushort VkMenu = 0x12;
    private const ushort VkEscape = 0x1B;
    private static readonly Guid AcDcPowerSource = new("5D3E9A59-E9D5-4B00-A6BD-FF34FF516548");

    // 한/영 전환이 일어났을 수 있는 키 입력. 인수가 true면 한/영 키를 누른 순간이다(누르고 있을 때의 반복은 제외).
    // false면 오른쪽 Alt·Shift+Space처럼 설정에 따라 전환일 수도 있는 입력이라 다시 확인만 한다.
    public event Action<bool>? InputToggleKey;
    private bool hangulHeld;
    private long hangulPressedAt;
    public event Action? EscapePressed;
    // 마우스 버튼을 누른 화면 좌표
    public event Action<Point>? MouseButtonDown;
    // 충전기 연결·분리 등 전원 상태 변경
    public event Action? PowerChanged;

    public SystemEventWatcher()
    {
        CreateHandle(new CreateParams { Caption = "WinBar events", Style = unchecked((int)0x80000000) }); // 보이지 않는 WS_POPUP
        var devices = new[]
        {
            new RawInputDevice { UsagePage = 1, Usage = 6, Flags = 0x00000100, Target = Handle }, // 키보드, RIDEV_INPUTSINK
            new RawInputDevice { UsagePage = 1, Usage = 2, Flags = 0x00000100, Target = Handle }  // 마우스, RIDEV_INPUTSINK
        };
        try { RegisterRawInputDevices(devices, devices.Length, Marshal.SizeOf<RawInputDevice>()); } catch (Exception) { }
        // 전원 연결, 배터리 %, 절전 모드 켜짐/꺼짐, 절전 기준값이 바뀌면 Windows가 바로 알려 준다.
        foreach (Guid setting in new[]
        {
            AcDcPowerSource,
            new Guid("A7AD8041-B45A-4CAE-87A3-EECBB468A9E1"), // 배터리 남은 %
            new Guid("E00958C0-C213-4ACE-AC77-FECCED2EEEA5"), // 절전 모드 상태
            new Guid("550E8400-E29B-41D4-A716-446655440000"), // 에너지 절약 상태(Windows 11)
            new Guid("E69653CA-CF7F-4F05-AA73-CB833FA90AD4")  // 절전 모드가 켜지는 배터리 기준
        })
        {
            try
            {
                Guid value = setting;
                IntPtr registration = RegisterPowerSettingNotification(Handle, ref value, 0);
                if (registration != IntPtr.Zero) powerNotifications.Add(registration);
            }
            catch (Exception) { }
        }
    }

    private readonly List<IntPtr> powerNotifications = [];

    // 사용 중인 앱에 한/영 키를 한 번 보낸다(WinBar 스위치를 눌렀을 때만 호출).
    public static void SendInputToggle()
    {
        keybd_event((byte)VkHangul, 0, 0, UIntPtr.Zero);
        keybd_event((byte)VkHangul, 0, 0x0002, UIntPtr.Zero);
    }

    protected override unsafe void WndProc(ref Message m)
    {
        if (m.Msg == WmInput)
        {
            try { HandleRawInput(m.LParam); } catch (Exception) { }
        }
        else if (m.Msg == WmPowerBroadcast
            && ((int)m.WParam == PbtPowerStatusChange || (int)m.WParam == PbtPowerSettingChange))
        {
            PowerChanged?.Invoke();
        }
        base.WndProc(ref m);
    }

    private unsafe void HandleRawInput(IntPtr handle)
    {
        const int headerSize = 24; // RAWINPUTHEADER(x64): 형식·크기·장치·wParam
        byte* buffer = stackalloc byte[64];
        uint size = 64;
        if (GetRawInputData(handle, 0x10000003, (IntPtr)buffer, ref size, (uint)headerSize) == uint.MaxValue) return;
        uint type = *(uint*)buffer;
        if (type == 1) // 키보드
        {
            ushort flags = *(ushort*)(buffer + headerSize + 2);
            ushort key = *(ushort*)(buffer + headerSize + 6);
            bool keyDown = (flags & 0x0001) == 0;
            bool extended = (flags & 0x0002) != 0;
            if (key == VkHangul)
            {
                // 한/영 키는 누를 때 한 번만 센다. 떼는 신호가 없는 키보드도 있어 0.5초가 지나면 새로 누른 것으로 본다.
                if (!keyDown) { hangulHeld = false; return; }
                long now = Environment.TickCount64;
                bool repeated = hangulHeld && now - hangulPressedAt < 500;
                hangulHeld = true;
                hangulPressedAt = now;
                if (!repeated) InputToggleKey?.Invoke(true);
            }
            else if ((key == VkMenu && extended && keyDown)
                || (key == VkSpace && keyDown && (GetKeyState(0x10) & 0x8000) != 0))
                InputToggleKey?.Invoke(false);
            else if (key == VkEscape && keyDown)
                EscapePressed?.Invoke();
        }
        else if (type == 0) // 마우스: 버튼을 누를 때만 처리하고 움직임은 무시한다.
        {
            ushort buttons = *(ushort*)(buffer + headerSize + 4);
            if ((buttons & (0x0001 | 0x0004 | 0x0010)) != 0 && GetCursorPos(out NativePoint point))
                MouseButtonDown?.Invoke(new Point(point.X, point.Y));
        }
    }

    public void Dispose()
    {
        InputToggleKey = null;
        EscapePressed = null;
        MouseButtonDown = null;
        PowerChanged = null;
        foreach (IntPtr registration in powerNotifications)
            try { UnregisterPowerSettingNotification(registration); } catch (Exception) { }
        powerNotifications.Clear();
        DestroyHandle();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RawInputDevice { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X, Y; }

    [DllImport("user32.dll")] private static extern bool RegisterRawInputDevices(RawInputDevice[] devices, int count, int size);
    [DllImport("user32.dll")] private static extern uint GetRawInputData(IntPtr rawInput, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll")] private static extern short GetKeyState(int key);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] private static extern IntPtr RegisterPowerSettingNotification(IntPtr recipient, ref Guid setting, int flags);
    [DllImport("user32.dll")] private static extern bool UnregisterPowerSettingNotification(IntPtr handle);
}
