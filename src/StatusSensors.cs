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
    bool MicrophoneInUse = false, bool CameraInUse = false);

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

        ethernetConnected = SampleEthernet();
        NetworkChange.NetworkAddressChanged += OnNetworkChanged;
        NetworkChange.NetworkAvailabilityChanged += OnNetworkChanged;

        privacyThread = new Thread(WatchPrivacy) { IsBackground = true, Name = "WinBar privacy" };
        privacyThread.Start();
    }

    private (string Label, string Name) lastInput = ("A", "알 수 없음");

    public StatusSnapshot Sample(bool includeBluetooth)
    {
        (bool available, bool connected, string? name, int? quality) wifi = default;
        try { wifi = SampleWifi(); } catch (Exception) { }
        if (includeBluetooth)
        {
            try { SampleBluetooth(); } catch (Exception) { bluetoothOn = null; bluetoothDevices = []; }
        }
        try { lastInput = SampleInputSource() ?? lastInput; } catch (Exception) { }

        return new StatusSnapshot(wifi.available, wifi.connected, wifi.name, wifi.quality,
            ethernetConnected, bluetoothOn, bluetoothDevices, lastInput.Label, lastInput.Name,
            microphoneInUse, cameraInUse);
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

    private (bool available, bool connected, string? name, int? quality) SampleWifi()
    {
        if (wlanHandle == IntPtr.Zero) return default;
        IntPtr list = IntPtr.Zero;
        try
        {
            if (WlanEnumInterfaces(wlanHandle, IntPtr.Zero, out list) != 0) return default;
            int count = Marshal.ReadInt32(list, 0);
            const int infoSize = 532; // Guid(16) + 설명 wchar[256](512) + 상태(4)
            for (int index = 0; index < count; index++)
            {
                IntPtr info = IntPtr.Add(list, 8 + index * infoSize);
                if (Marshal.ReadInt32(info, 528) != 1) continue; // wlan_interface_state_connected
                Guid interfaceId = Marshal.PtrToStructure<Guid>(info);
                if (WlanQueryInterface(wlanHandle, ref interfaceId, 7, IntPtr.Zero,
                        out _, out IntPtr data, out _) != 0) continue;
                try
                {
                    // WLAN_CONNECTION_ATTRIBUTES: SSID 길이 520, SSID 524, 신호 품질 576
                    int length = Math.Clamp(Marshal.ReadInt32(data, 520), 0, 32);
                    byte[] ssid = new byte[length];
                    Marshal.Copy(IntPtr.Add(data, 524), ssid, 0, length);
                    int quality = Math.Clamp(Marshal.ReadInt32(data, 576), 0, 100);
                    return (true, true, Encoding.UTF8.GetString(ssid), quality);
                }
                finally { WlanFreeMemory(data); }
            }
            return (count > 0, false, null, null);
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
    // 그런 앱(스레드)은 한/영 키를 직접 따라가며 상태를 기억한다.
    private readonly Dictionary<uint, bool> trackedNative = [];
    private uint pendingThread;
    private bool? pendingImmBefore;
    private bool pendingShownBefore;
    private long pendingSince = -1;
    private const int ImmSettleMilliseconds = 90;

    // 한/영 키를 누른 순간(UI 스레드)에 호출한다. 이후 확인에서 IMM 값이 바뀌는지 본다.
    public void NoteInputToggle()
    {
        try
        {
            IntPtr window = GetForegroundWindow();
            uint thread = GetWindowThreadProcessId(window, out uint processId);
            if (window == IntPtr.Zero || processId == (uint)Environment.ProcessId) return;
            if (((long)GetKeyboardLayout(thread) & 0xFFFF) != 0x0412) return;
            bool? imm = ReadImmNative(window);
            pendingThread = thread;
            pendingImmBefore = imm;
            pendingShownBefore = trackedNative.TryGetValue(thread, out bool tracked) ? tracked : imm ?? false;
            pendingSince = Environment.TickCount64;
        }
        catch (Exception) { pendingSince = -1; }
    }

    private static bool? ReadImmNative(IntPtr window)
    {
        IntPtr ime = ImmGetDefaultIMEWnd(window);
        if (ime == IntPtr.Zero
            || SendMessageTimeout(ime, 0x0283, (IntPtr)0x0001, IntPtr.Zero, 0x0002, 25, out IntPtr mode) == IntPtr.Zero)
            return null;
        return ((long)mode & 0x0001) != 0; // WM_IME_CONTROL · IMC_GETCONVERSIONMODE · IME_CMODE_NATIVE
    }

    // 사용 중인 앱(맨 앞 창)의 입력 상태를 읽는다. 맨 앞 창이 WinBar 자신이면 읽지 않고 이전 값을 유지한다.
    private (string label, string name)? SampleInputSource()
    {
        IntPtr window = GetForegroundWindow();
        uint thread = GetWindowThreadProcessId(window, out uint processId);
        if (window == IntPtr.Zero || processId == (uint)Environment.ProcessId) return null;
        int language = (int)((long)GetKeyboardLayout(thread) & 0xFFFF);
        if (language == 0x0412)
        {
            bool? imm = ReadImmNative(window);
            bool native;
            if (pendingSince >= 0 && Environment.TickCount64 - pendingSince > 1000) pendingSince = -1;
            if (pendingSince >= 0 && thread == pendingThread)
            {
                if (imm is not null && imm != pendingImmBefore)
                {
                    // IMM이 바로 따라오는 앱: Windows 값을 그대로 쓴다.
                    trackedNative.Remove(thread);
                    pendingSince = -1;
                    native = imm.Value;
                }
                else if (Environment.TickCount64 - pendingSince >= ImmSettleMilliseconds)
                {
                    // IMM이 바뀌지 않는 앱(TSF): 한/영 키를 직접 따라간다.
                    if (trackedNative.Count > 64) trackedNative.Clear();
                    native = trackedNative[thread] = !pendingShownBefore;
                    pendingSince = -1;
                }
                else return null; // 아직 확인 중이면 표시를 바꾸지 않는다.
            }
            else if (trackedNative.TryGetValue(thread, out bool tracked)) native = tracked;
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

    [DllImport("wlanapi.dll")] private static extern uint WlanOpenHandle(uint clientVersion, IntPtr reserved, out uint negotiatedVersion, out IntPtr clientHandle);
    [DllImport("wlanapi.dll")] private static extern uint WlanCloseHandle(IntPtr clientHandle, IntPtr reserved);
    [DllImport("wlanapi.dll")] private static extern uint WlanEnumInterfaces(IntPtr clientHandle, IntPtr reserved, out IntPtr interfaceList);
    [DllImport("wlanapi.dll")] private static extern uint WlanQueryInterface(IntPtr clientHandle, ref Guid interfaceId, int opCode, IntPtr reserved, out uint dataSize, out IntPtr data, out int valueType);
    [DllImport("wlanapi.dll")] private static extern void WlanFreeMemory(IntPtr memory);
    [DllImport("bthprops.cpl")] private static extern IntPtr BluetoothFindFirstRadio(ref BluetoothFindRadioParams parameters, out IntPtr radio);
    [DllImport("bthprops.cpl")] private static extern bool BluetoothFindRadioClose(IntPtr find);
    [DllImport("bthprops.cpl")] private static extern IntPtr BluetoothFindFirstDevice(ref BluetoothDeviceSearchParams parameters, ref BluetoothDeviceInfo info);
    [DllImport("bthprops.cpl")] private static extern bool BluetoothFindNextDevice(IntPtr find, ref BluetoothDeviceInfo info);
    [DllImport("bthprops.cpl")] private static extern bool BluetoothFindDeviceClose(IntPtr find);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint threadId);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("imm32.dll")] private static extern IntPtr ImmGetDefaultIMEWnd(IntPtr window);
    [DllImport("advapi32.dll")] private static extern int RegNotifyChangeKeyValue(SafeRegistryHandle key, bool watchSubtree, uint filter, SafeWaitHandle changeEvent, bool asynchronous);
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
    private IntPtr powerNotification;

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
        try
        {
            Guid source = AcDcPowerSource;
            powerNotification = RegisterPowerSettingNotification(Handle, ref source, 0);
        }
        catch (Exception) { powerNotification = IntPtr.Zero; }
    }

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
        if (powerNotification != IntPtr.Zero) UnregisterPowerSettingNotification(powerNotification);
        powerNotification = IntPtr.Zero;
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
