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

    public StatusSnapshot Sample(bool includeBluetooth)
    {
        (bool available, bool connected, string? name, int? quality) wifi = default;
        try { wifi = SampleWifi(); } catch (Exception) { }
        if (includeBluetooth)
        {
            try { SampleBluetooth(); } catch (Exception) { bluetoothOn = null; bluetoothDevices = []; }
        }
        (string label, string inputName) input = ("A", "알 수 없음");
        try { input = SampleInputSource(); } catch (Exception) { }

        return new StatusSnapshot(wifi.available, wifi.connected, wifi.name, wifi.quality,
            ethernetConnected, bluetoothOn, bluetoothDevices, input.label, input.inputName,
            microphoneInUse, cameraInUse);
    }

    public StatusSnapshot WithInput(StatusSnapshot current)
    {
        try
        {
            (string label, string name) = SampleInputSource();
            return current with { InputLabel = label, InputName = name };
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

    private static (string label, string name) SampleInputSource()
    {
        IntPtr window = GetForegroundWindow();
        uint thread = GetWindowThreadProcessId(window, out _);
        int language = (int)((long)GetKeyboardLayout(thread) & 0xFFFF);
        if (language == 0x0412)
        {
            bool native = false;
            IntPtr ime = ImmGetDefaultIMEWnd(window);
            if (ime != IntPtr.Zero
                && SendMessageTimeout(ime, 0x0283, (IntPtr)0x0001, IntPtr.Zero, 0x0002, 25, out IntPtr mode) != IntPtr.Zero)
                native = ((long)mode & 0x0001) != 0; // WM_IME_CONTROL · IMC_GETCONVERSIONMODE · IME_CMODE_NATIVE
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
