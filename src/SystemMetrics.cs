using System.Reflection;
using System.Runtime.InteropServices;

namespace WinBar;

internal sealed record SystemSnapshot(double? CpuPercent = null, double? GpuPercent = null,
    double? RamPercent = null, byte? BatteryPercent = null, bool Charging = false,
    double? VolumePercent = null, bool Muted = false, double? BrightnessPercent = null,
    int? BatteryMinutes = null, string? PowerMode = null, bool SaverOn = false, int? SaverThreshold = null,
    string? OutputName = null);

// 소리 출력 장치 하나(스피커, 블루투스 헤드폰 등)
internal sealed record AudioDevice(string Id, string Name, bool IsDefault);

internal sealed class SystemMetrics : IDisposable
{
    private ulong previousIdle, previousKernel, previousUser;
    private bool hasCpuSample;
    private IntPtr gpuQuery;
    private IntPtr gpuCounter;
    private IAudioEndpointVolume? audioVolume;
    private VolumeCallback? volumeCallback;
    private double brightnessValue = double.NaN;
    private readonly CancellationTokenSource brightnessCancellation = new();
    private readonly Thread brightnessThread;
    private readonly object controlLock = new();
    private double? volumePercent;
    private bool muted;
    private volatile bool disposed;

    // 음량·밝기가 바뀌었을 때 백그라운드 스레드에서 호출된다. 주기적으로 읽지 않는다.
    public event Action? ControlsChanged;

    public SystemMetrics()
    {
        if (PdhOpenQuery(null, UIntPtr.Zero, out gpuQuery) != ErrorSuccess
            || PdhAddEnglishCounter(gpuQuery,
                @"\GPU Engine(*)\Utilization Percentage", UIntPtr.Zero,
                out gpuCounter) != ErrorSuccess
            || PdhCollectQueryData(gpuQuery) != ErrorSuccess)
        {
            if (gpuQuery != IntPtr.Zero) PdhCloseQuery(gpuQuery);
            gpuQuery = IntPtr.Zero;
            gpuCounter = IntPtr.Zero;
        }

        // 기본 출력 장치가 바뀌거나(블루투스 헤드폰 연결 등) 장치가 추가·제거되면 알림을 받아 다시 연결한다.
        try
        {
            deviceEnumerator = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorComObject();
            deviceNotifications = new DeviceNotificationClient(() => { if (!disposed) AudioDevicesChanged?.Invoke(); });
            deviceEnumerator.RegisterEndpointNotificationCallback(deviceNotifications);
        }
        catch (Exception) { deviceNotifications = null; }
        RebindAudio();

        // 전원 모드(최고의 전원 효율·균형·최고 성능 등)는 Windows가 바뀔 때 바로 알려 준다.
        try
        {
            powerModeCallback = OnPowerModeChanged;
            if (PowerRegisterForEffectivePowerModeNotifications(2, powerModeCallback, IntPtr.Zero, out IntPtr handle) == 0)
                powerModeRegistration = handle;
        }
        catch (Exception) { powerModeRegistration = IntPtr.Zero; }

        brightnessThread = new Thread(() => MonitorBrightness(brightnessCancellation.Token))
        {
            IsBackground = true,
            Name = "WinBar brightness"
        };
        brightnessThread.Start();
    }

    private IMMDeviceEnumerator? deviceEnumerator;
    private DeviceNotificationClient? deviceNotifications;
    private string? outputName;
    private string? outputId;
    private PowerModeCallback? powerModeCallback;
    private IntPtr powerModeRegistration;
    private volatile int powerMode = -1;

    // 기본 출력 장치 변경·장치 추가/제거 시 백그라운드 스레드에서 호출된다. UI 스레드에서 RebindAudio()를 불러 처리한다.
    public event Action? AudioDevicesChanged;
    // 전원 모드가 바뀌면 백그라운드 스레드에서 호출된다.
    public event Action? PowerModeChanged;

    // 현재 기본 출력 장치의 음량 조절 개체에 다시 연결한다(UI 스레드).
    public void RebindAudio()
    {
        if (disposed) return;
        try
        {
            if (audioVolume is not null)
            {
                if (volumeCallback is not null)
                    try { audioVolume.UnregisterControlChangeNotify(volumeCallback); } catch (Exception) { }
                Marshal.ReleaseComObject(audioVolume);
            }
        }
        catch (Exception) { }
        audioVolume = null;
        volumeCallback = null;
        outputName = null;
        outputId = null;
        try
        {
            if (deviceEnumerator?.GetDefaultAudioEndpoint(0, 1, out IMMDevice device) == 0)
            {
                Guid interfaceId = typeof(IAudioEndpointVolume).GUID;
                if (device.Activate(ref interfaceId, 23, IntPtr.Zero, out object endpoint) == 0)
                    audioVolume = (IAudioEndpointVolume)endpoint;
                if (device.GetId(out string id) == 0) outputId = id;
                outputName = ReadFriendlyName(device);
                Marshal.ReleaseComObject(device);
            }
        }
        catch (Exception) { audioVolume = null; }

        if (audioVolume is null)
        {
            lock (controlLock) { volumePercent = null; muted = false; }
            return;
        }
        SampleVolume();
        try
        {
            var callback = new VolumeCallback(OnVolumeNotify);
            if (audioVolume.RegisterControlChangeNotify(callback) == 0) volumeCallback = callback;
        }
        catch (Exception) { volumeCallback = null; }
    }

    // 지금 선택할 수 있는 출력 장치 목록(사용 가능한 장치만)
    public IReadOnlyList<AudioDevice> GetOutputDevices()
    {
        var devices = new List<AudioDevice>();
        if (deviceEnumerator is null) return devices;
        IMMDeviceCollection? collection = null;
        try
        {
            if (deviceEnumerator.EnumAudioEndpoints(0, 0x1, out collection) != 0 || collection is null) return devices;
            collection.GetCount(out uint count);
            for (uint index = 0; index < count && index < 16; index++)
            {
                if (collection.Item(index, out IMMDevice device) != 0) continue;
                try
                {
                    if (device.GetId(out string id) != 0) continue;
                    devices.Add(new AudioDevice(id, ReadFriendlyName(device) ?? "알 수 없는 장치", id == outputId));
                }
                finally { Marshal.ReleaseComObject(device); }
            }
        }
        catch (Exception) { }
        finally { if (collection is not null) Marshal.ReleaseComObject(collection); }
        return devices;
    }

    // 기본 출력 장치를 바꾼다. Windows 사운드 설정과 같은 방법(IPolicyConfig)이며 관리자 권한이 필요 없다.
    public bool SetDefaultOutput(string id)
    {
        object? config = null;
        try
        {
            config = new PolicyConfigComObject();
            var policy = (IPolicyConfig)config;
            bool ok = true;
            for (int role = 0; role < 3; role++) ok &= policy.SetDefaultEndpoint(id, role) == 0;
            return ok;
        }
        catch (Exception) { return false; }
        finally { if (config is not null) Marshal.ReleaseComObject(config); }
    }

    // ── Bluetooth 오디오 기기 연결 ─────────────────────────────────
    // 등록(페어링)은 되어 있지만 연결이 끊긴 이어폰·헤드폰·스피커를 Windows에 다시 연결하라고 요청한다.
    // Windows 설정의 "연결" 단추와 같은 드라이버 요청(KSPROPERTY_ONESHOT_RECONNECT)이며 관리자 권한이 필요 없다.
    // 오디오가 아닌 기기(마우스·키보드 등)는 이 방법이 없다. 연결이 끝날 때까지 몇 초 걸릴 수 있어 UI 밖 스레드에서 부른다.
    public static bool ConnectBluetoothAudio(string name)
    {
        bool requested = false;
        ForEachBluetoothAudio(name, control =>
        {
            var property = new KsPropertyHeader { Set = BluetoothAudioPropertySet, Id = 0, Flags = 1 }; // ONESHOT_RECONNECT, GET
            requested |= control.KsProperty(ref property, (uint)Marshal.SizeOf<KsPropertyHeader>(), IntPtr.Zero, 0, out _) == 0;
        });
        return requested;
    }

    // 등록된 기기 이름 중 Bluetooth 오디오 출력이 있어 위 방법으로 연결할 수 있는 이름
    public static HashSet<string> FindBluetoothAudioNames(IEnumerable<string> names)
    {
        var found = new HashSet<string>();
        string[] endpoints = ReadAllRenderEndpointNames();
        foreach (string name in names)
            if (endpoints.Any(endpoint => endpoint.Contains(name, StringComparison.OrdinalIgnoreCase))) found.Add(name);
        return found;
    }

    private static readonly Guid BluetoothAudioPropertySet = new("7FA06C40-B8F6-4C7E-8556-E8C33A12E54D"); // KSPROPSETID_BtAudio

    // 출력 장치(연결이 끊긴 것까지) 이름 목록
    private static string[] ReadAllRenderEndpointNames()
    {
        var names = new List<string>();
        object? enumeratorObject = null;
        IMMDeviceCollection? collection = null;
        try
        {
            enumeratorObject = new MMDeviceEnumeratorComObject();
            var enumerator = (IMMDeviceEnumerator)enumeratorObject;
            if (enumerator.EnumAudioEndpoints(0, 0xF, out collection) != 0 || collection is null) return [];
            collection.GetCount(out uint count);
            for (uint index = 0; index < count && index < 64; index++)
            {
                if (collection.Item(index, out IMMDevice device) != 0) continue;
                try { if (ReadFriendlyName(device) is string endpointName) names.Add(endpointName); }
                finally { Marshal.ReleaseComObject(device); }
            }
        }
        catch (Exception) { }
        finally
        {
            if (collection is not null) Marshal.ReleaseComObject(collection);
            if (enumeratorObject is not null) Marshal.ReleaseComObject(enumeratorObject);
        }
        return [.. names];
    }

    // 이름이 맞는 출력 장치마다: 장치 → 연결점 → 연결된 드라이버 부분 → IKsControl 을 찾아 넘긴다.
    private static void ForEachBluetoothAudio(string name, Action<IKsControl> use)
    {
        object? enumeratorObject = null;
        IMMDeviceCollection? collection = null;
        try
        {
            enumeratorObject = new MMDeviceEnumeratorComObject();
            var enumerator = (IMMDeviceEnumerator)enumeratorObject;
            if (enumerator.EnumAudioEndpoints(0, 0xF, out collection) != 0 || collection is null) return;
            collection.GetCount(out uint count);
            for (uint index = 0; index < count && index < 64; index++)
            {
                if (collection.Item(index, out IMMDevice device) != 0) continue;
                object? topologyObject = null, control = null;
                IConnector? connector = null, connectedTo = null;
                try
                {
                    if (ReadFriendlyName(device) is not string endpointName || !endpointName.Contains(name, StringComparison.OrdinalIgnoreCase)) continue;
                    Guid topologyId = typeof(IDeviceTopology).GUID;
                    if (device.Activate(ref topologyId, 0x17, IntPtr.Zero, out topologyObject) != 0) continue; // CLSCTX_ALL
                    var topology = (IDeviceTopology)topologyObject;
                    if (topology.GetConnector(0, out connector) != 0) continue;
                    if (connector.GetConnectedTo(out connectedTo) != 0) continue;
                    Guid controlId = typeof(IKsControl).GUID;
                    if (((IPart)connectedTo).Activate(1, ref controlId, out control) != 0) continue; // CLSCTX_INPROC_SERVER
                    use((IKsControl)control);
                }
                catch (Exception) { }
                finally
                {
                    foreach (object? item in new object?[] { control, connectedTo, connector, topologyObject })
                        if (item is not null) Marshal.ReleaseComObject(item);
                    Marshal.ReleaseComObject(device);
                }
            }
        }
        catch (Exception) { }
        finally
        {
            if (collection is not null) Marshal.ReleaseComObject(collection);
            if (enumeratorObject is not null) Marshal.ReleaseComObject(enumeratorObject);
        }
    }

    [ComImport, Guid("2A07407E-6497-4A18-9787-32F79BD0D98F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDeviceTopology
    {
        [PreserveSig] int GetConnectorCount(out uint count);
        [PreserveSig] int GetConnector(uint index, out IConnector connector);
    }

    [ComImport, Guid("9C2C4058-23F5-41DE-877A-DF3AF236A09E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IConnector
    {
        [PreserveSig] int GetConnectorType(out int type); // COM은 순서로 부르므로 이름은 C# GetType과 겹치지 않게 바꿈
        [PreserveSig] int GetDataFlow(out int flow);
        [PreserveSig] int ConnectTo(IConnector connectTo);
        [PreserveSig] int Disconnect();
        [PreserveSig] int IsConnected([MarshalAs(UnmanagedType.Bool)] out bool connected);
        [PreserveSig] int GetConnectedTo(out IConnector connectedTo);
    }

    [ComImport, Guid("AE2DE0E4-5BCA-4F2D-AA46-5D13F8FDB3A9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPart
    {
        [PreserveSig] int GetName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int GetLocalId(out uint id);
        [PreserveSig] int GetGlobalId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetPartType(out int type);
        [PreserveSig] int GetSubType(out Guid subType);
        [PreserveSig] int GetControlInterfaceCount(out uint count);
        [PreserveSig] int GetControlInterface(uint index, out IntPtr control);
        [PreserveSig] int EnumPartsIncoming(out IntPtr parts);
        [PreserveSig] int EnumPartsOutgoing(out IntPtr parts);
        [PreserveSig] int GetTopologyObject(out IntPtr topology);
        [PreserveSig] int Activate(uint classContext, ref Guid interfaceId, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport, Guid("28F54685-06FD-11D2-B27A-00A0C9223196"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IKsControl
    {
        [PreserveSig] int KsProperty(ref KsPropertyHeader property, uint propertyLength, IntPtr data, uint dataLength, out uint returned);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KsPropertyHeader { public Guid Set; public uint Id; public uint Flags; }

    private static string? ReadFriendlyName(IMMDevice device)
    {
        IPropertyStore? store = null;
        var value = new PropVariant();
        try
        {
            if (device.OpenPropertyStore(0, out store) != 0 || store is null) return null;
            var key = new PropertyKey { FormatId = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), PropertyId = 14 };
            if (store.GetValue(ref key, out value) != 0 || value.Type != 31 || value.Pointer == IntPtr.Zero) return null;
            return Marshal.PtrToStringUni(value.Pointer);
        }
        catch (Exception) { return null; }
        finally
        {
            try { PropVariantClear(ref value); } catch (Exception) { }
            if (store is not null) Marshal.ReleaseComObject(store);
        }
    }

    private void OnPowerModeChanged(int mode, IntPtr context)
    {
        powerMode = mode;
        if (!disposed) PowerModeChanged?.Invoke();
    }

    private static string? PowerModeName(int mode) => mode switch
    {
        0 => "절전 모드",
        1 => "최고의 전원 효율",
        2 => "균형",
        3 or 4 => "최고 성능",
        5 => "게임 모드",
        6 => "혼합 현실",
        _ => null
    };

    // 절전 모드가 켜지는 배터리 기준(%) — 현재 전원 구성표의 배터리 사용 값
    private static int? ReadSaverThreshold()
    {
        IntPtr scheme = IntPtr.Zero;
        try
        {
            if (PowerGetActiveScheme(IntPtr.Zero, out scheme) != 0 || scheme == IntPtr.Zero) return null;
            Guid active = Marshal.PtrToStructure<Guid>(scheme);
            Guid subgroup = new("DE830923-A562-41AF-A086-E3A2C6BAD2DA");
            Guid setting = new("E69653CA-CF7F-4F05-AA73-CB833FA90AD4");
            return PowerReadDCValueIndex(IntPtr.Zero, ref active, ref subgroup, ref setting, out uint value) == 0
                ? (int)Math.Clamp(value, 0u, 100u) : null;
        }
        catch (Exception) { return null; }
        finally { if (scheme != IntPtr.Zero) LocalFree(scheme); }
    }

    private void OnVolumeNotify(bool nextMuted, float scalar)
    {
        if (disposed) return;
        lock (controlLock)
        {
            volumePercent = Math.Clamp(scalar * 100, 0, 100);
            muted = nextMuted;
        }
        ControlsChanged?.Invoke();
    }

    // 센서마다 따로 실패를 처리해, 한 값을 못 읽어도 나머지는 그대로 표시한다.
    private static T? Try<T>(Func<T?> read) where T : struct
    {
        try { return read(); } catch (Exception) { return null; }
    }

    public SystemSnapshot Sample()
    {
        double? cpu = Try(SampleCpu);
        double? gpu = Try(SampleGpu);
        double? ram = Try<double>(() =>
        {
            var memory = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
            return GlobalMemoryStatusEx(ref memory) ? memory.MemoryLoad : null;
        });
        byte? battery = null;
        bool charging = false;
        int? batteryMinutes = null;
        bool saverOn = false;

        try { SampleBattery(ref battery, ref charging, ref batteryMinutes, ref saverOn); } catch (Exception) { }
        int? saverThreshold = battery is null ? null : ReadSaverThreshold();

        // 변경 알림을 놓쳤을 때를 대비해 2초 주기에서만 음량을 직접 확인한다.
        if (volumeCallback is null) SampleVolume();
        return ApplyControls(new(cpu, gpu, ram, battery, charging, BatteryMinutes: batteryMinutes,
            PowerMode: PowerModeName(powerMode), SaverOn: saverOn, SaverThreshold: saverThreshold));
    }

    private void SampleBattery(ref byte? battery, ref bool charging, ref int? batteryMinutes, ref bool saverOn)
    {
        if (GetSystemPowerStatus(out SystemPowerStatus power)
            && power.BatteryFlag is not 128 and not 255
            && power.BatteryLifePercent != 255)
        {
            battery = power.BatteryLifePercent;
            saverOn = power.SystemStatusFlag == 1; // 절전 모드 켜짐
            // 충전기가 연결되면 Windows 전원 알림 직후 바로 번개를 표시한다.
            // (배터리의 "충전 중" 신호는 연결 후 수 초 늦게 켜질 수 있어 기다리지 않는다.)
            bool pluggedIn = power.ACLineStatus == 1;
            charging = pluggedIn;
            // 남은 사용 예측 시간은 직접 계산하지 않고, Windows 전원 관리자가 내는 예측값
            // (작업 표시줄 배터리·설정 앱과 같은 출처)을 그대로 쓴다. 읽지 못하면 GetSystemPowerStatus 값을 쓴다.
            if (!pluggedIn)
            {
                uint seconds = ReadEstimatedSeconds() ?? power.BatteryLifeTime;
                if (seconds != uint.MaxValue) batteryMinutes = (int)(seconds / 60);
            }
        }
    }

    // SYSTEM_BATTERY_STATE(32바이트)의 EstimatedTime(초, 20바이트 위치). 모르면 0xFFFFFFFF.
    private static uint? ReadEstimatedSeconds()
    {
        try
        {
            var state = new byte[32];
            if (CallNtPowerInformation(5, IntPtr.Zero, 0, state, (uint)state.Length) != 0) return null; // SystemBatteryState
            return BitConverter.ToUInt32(state, 20);
        }
        catch (Exception) { return null; }
    }

    [DllImport("powrprof.dll")]
    private static extern uint CallNtPowerInformation(int level, IntPtr input, uint inputLength, byte[] output, uint outputLength);

    public void SetVolume(double percent)
    {
        try
        {
            audioVolume?.SetMasterVolumeLevelScalar((float)(Math.Clamp(percent, 0, 100) / 100), IntPtr.Zero);
            if (muted && percent > 0) audioVolume?.SetMute(false, IntPtr.Zero);
        }
        catch (Exception) { }
        if (volumeCallback is null) { SampleVolume(); ControlsChanged?.Invoke(); }
    }

    public void SetMute(bool nextMuted)
    {
        try { audioVolume?.SetMute(nextMuted, IntPtr.Zero); } catch (Exception) { }
        if (volumeCallback is null) { SampleVolume(); ControlsChanged?.Invoke(); }
    }

    private double pendingBrightness = double.NaN;
    private int brightnessWriterRunning;

    // 슬라이더를 끄는 동안 마지막 값만 백그라운드에서 적용한다(UI가 멈추지 않게).
    public void SetBrightness(double percent)
    {
        Interlocked.Exchange(ref pendingBrightness, Math.Clamp(percent, 0, 100));
        if (Interlocked.Exchange(ref brightnessWriterRunning, 1) == 1) return;
        new Thread(WriteBrightnessLoop) { IsBackground = true, Name = "WinBar brightness writer" }.Start();
    }

    private void WriteBrightnessLoop()
    {
        object? locator = null, services = null;
        try
        {
            services = ConnectWmi(out locator);
            if (services is null) return;
            while (!disposed)
            {
                double target = Interlocked.Exchange(ref pendingBrightness, double.NaN);
                if (double.IsNaN(target)) break;
                ApplyBrightness(services!, (byte)Math.Round(target));
            }
        }
        catch (Exception) { }
        finally
        {
            Release(services);
            Release(locator);
            Volatile.Write(ref brightnessWriterRunning, 0);
            if (!disposed && !double.IsNaN(Volatile.Read(ref pendingBrightness))
                && Interlocked.Exchange(ref brightnessWriterRunning, 1) == 0)
                new Thread(WriteBrightnessLoop) { IsBackground = true, Name = "WinBar brightness writer" }.Start();
        }
    }

    private static void ApplyBrightness(object services, byte value)
    {
        object? results = null;
        try
        {
            results = ComCall(services, "ExecQuery", "SELECT * FROM WmiMonitorBrightnessMethods WHERE Active=TRUE");
            foreach (object method in (System.Collections.IEnumerable)results!)
            {
                try
                {
                    ComCall(method, "WmiSetBrightness", 1, value);
                }
                catch (Exception) { }
                finally { Release(method); }
            }
        }
        catch (Exception) { }
        finally { Release(results); }
    }

    // 마지막으로 알려진 음량·밝기 값을 스냅샷에 넣는다. 장치를 다시 읽지 않는다.
    public SystemSnapshot ApplyControls(SystemSnapshot current)
    {
        lock (controlLock)
        {
            return current with
            {
                VolumePercent = volumePercent,
                Muted = muted,
                BrightnessPercent = ReadBrightness(),
                OutputName = outputName,
                PowerMode = PowerModeName(powerMode) ?? current.PowerMode
            };
        }
    }

    private void SampleVolume()
    {
        try
        {
            if (audioVolume is null
                || audioVolume.GetMasterVolumeLevelScalar(out float volumeScalar) != 0) return;
            bool nextMuted = false;
            audioVolume.GetMute(out nextMuted);
            lock (controlLock)
            {
                volumePercent = Math.Clamp(volumeScalar * 100, 0, 100);
                muted = nextMuted;
            }
        }
        catch (Exception) { }
    }

    private double? ReadBrightness()
    {
        double value = Volatile.Read(ref brightnessValue);
        return double.IsNaN(value) ? null : value;
    }

    private void PublishBrightness(double? value)
    {
        if (value is not double brightness || disposed) return;
        double previous = Volatile.Read(ref brightnessValue);
        Volatile.Write(ref brightnessValue, brightness);
        if (previous != brightness) ControlsChanged?.Invoke();
    }

    // WMI 연결은 한 번만 만들고, 밝기 변경 이벤트가 올 때까지 대기한다.
    // 이벤트를 쓸 수 없으면 같은 연결로 2초마다 읽는다.
    private void MonitorBrightness(CancellationToken cancellationToken)
    {
        object? locator = null, services = null, source = null;
        try
        {
            services = ConnectWmi(out locator);
            if (services is null) return;

            double? initial = QueryBrightness(services!);
            if (initial is null) return; // 밝기를 제공하지 않는 모니터
            PublishBrightness(initial);

            try
            {
                source = ComCall(services, "ExecNotificationQuery", "SELECT * FROM WmiMonitorBrightnessEvent");
            }
            catch (Exception) { source = null; }

            while (!cancellationToken.IsCancellationRequested)
            {
                if (source is null)
                {
                    if (cancellationToken.WaitHandle.WaitOne(2000)) break;
                    PublishBrightness(QueryBrightness(services!));
                    continue;
                }

                object? brightnessEvent = null;
                try
                {
                    brightnessEvent = ComCall(source, "NextEvent", 1000);
                    PublishBrightness(Math.Clamp(Convert.ToDouble(ComGet(brightnessEvent!, "Brightness")), 0, 100));
                }
                catch (Exception error) when (IsWmiTimeout(error)) { }
                catch (Exception)
                {
                    Release(source);
                    source = null;
                }
                finally { Release(brightnessEvent); }
            }
        }
        catch (Exception) { }
        finally
        {
            Release(source);
            Release(services);
            Release(locator);
        }
    }

    private static bool IsWmiTimeout(Exception error)
    {
        const int WbemTimedOut = unchecked((int)0x80043001);
        return error.HResult == WbemTimedOut || error.InnerException?.HResult == WbemTimedOut;
    }

    private static void Release(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }

    private double? SampleCpu()
    {
        if (!GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user)) return null;
        ulong i = idle.Value, k = kernel.Value, u = user.Value;
        if (!hasCpuSample) { previousIdle = i; previousKernel = k; previousUser = u; hasCpuSample = true; return null; }
        ulong idleDelta = i - previousIdle, total = (k - previousKernel) + (u - previousUser);
        previousIdle = i; previousKernel = k; previousUser = u;
        return total == 0 || idleDelta > total ? null : Math.Clamp(100d * (total - idleDelta) / total, 0, 100);
    }

    private double? SampleGpu()
    {
        if (gpuQuery == IntPtr.Zero || gpuCounter == IntPtr.Zero
            || PdhCollectQueryData(gpuQuery) != ErrorSuccess) return null;

        uint bufferSize = 0;
        uint itemCount = 0;
        uint status = PdhGetFormattedCounterArray(gpuCounter, PdhFormatDouble,
            ref bufferSize, ref itemCount, IntPtr.Zero);
        if (status != PdhMoreData || bufferSize == 0) return null;

        IntPtr buffer = Marshal.AllocHGlobal(checked((int)bufferSize));
        try
        {
            status = PdhGetFormattedCounterArray(gpuCounter, PdhFormatDouble,
                ref bufferSize, ref itemCount, buffer);
            if (status != ErrorSuccess) return null;

            return SumByEngineType(buffer, itemCount);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private readonly List<string> engineTypes = [];
    private double[] engineTotals = new double[16];

    // 작업 관리자와 같이 엔진 종류(engtype_3D, engtype_Copy 등)별로 합한 뒤 가장 큰 값을 쓴다.
    // 인스턴스 이름(약 700개)을 문자열로 만들지 않고 버퍼를 직접 읽어, 2초마다 새 객체를 만들지 않는다.
    private unsafe double? SumByEngineType(IntPtr buffer, uint itemCount)
    {
        Array.Clear(engineTotals);
        bool found = false;
        var items = (PdhFormattedCounterValueItem*)buffer;
        for (uint index = 0; index < itemCount; index++)
        {
            PdhFormattedCounterValueItem* item = items + index;
            if (item->Value.Status > PdhStatusNewData || !double.IsFinite(item->Value.DoubleValue)) continue;

            ReadOnlySpan<char> name = MemoryMarshal.CreateReadOnlySpanFromNullTerminated((char*)item->Name);
            int typeIndex = name.IndexOf("engtype_", StringComparison.OrdinalIgnoreCase);
            ReadOnlySpan<char> engineType = typeIndex < 0 ? [] : name[(typeIndex + 8)..];

            int slot = -1;
            for (int known = 0; known < engineTypes.Count; known++)
            {
                if (!engineType.Equals(engineTypes[known], StringComparison.OrdinalIgnoreCase)) continue;
                slot = known;
                break;
            }
            if (slot < 0)
            {
                slot = engineTypes.Count;
                engineTypes.Add(engineType.ToString()); // 처음 보는 엔진 종류일 때만 문자열을 만든다.
                if (slot >= engineTotals.Length) Array.Resize(ref engineTotals, engineTotals.Length * 2);
            }
            engineTotals[slot] += Math.Max(0, item->Value.DoubleValue);
            found = true;
        }
        if (!found) return null;
        double max = 0;
        for (int slot = 0; slot < engineTypes.Count; slot++) max = Math.Max(max, engineTotals[slot]);
        return Math.Clamp(max, 0, 100);
    }

    public void Dispose()
    {
        disposed = true;
        ControlsChanged = null;
        AudioDevicesChanged = null;
        PowerModeChanged = null;
        if (powerModeRegistration != IntPtr.Zero)
        {
            try { PowerUnregisterFromEffectivePowerModeNotifications(powerModeRegistration); } catch (Exception) { }
            powerModeRegistration = IntPtr.Zero;
        }
        if (deviceEnumerator is not null)
        {
            if (deviceNotifications is not null)
                try { deviceEnumerator.UnregisterEndpointNotificationCallback(deviceNotifications); } catch (Exception) { }
            try { Marshal.ReleaseComObject(deviceEnumerator); } catch (Exception) { }
            deviceEnumerator = null;
        }
        brightnessCancellation.Cancel();
        brightnessThread.Join(1500);
        brightnessCancellation.Dispose();
        if (audioVolume is not null)
        {
            if (volumeCallback is not null)
            {
                try { audioVolume.UnregisterControlChangeNotify(volumeCallback); } catch (Exception) { }
                volumeCallback = null;
            }
            Marshal.ReleaseComObject(audioVolume);
            audioVolume = null;
        }
        if (gpuQuery != IntPtr.Zero)
        {
            PdhCloseQuery(gpuQuery);
            gpuQuery = IntPtr.Zero;
            gpuCounter = IntPtr.Zero;
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low, High; public readonly ulong Value => ((ulong)High << 32) | Low; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)] private struct MemoryStatusEx { public uint Length, MemoryLoad; public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual; }
    [StructLayout(LayoutKind.Sequential)] private struct SystemPowerStatus { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public uint BatteryLifeTime, BatteryFullLifeTime; }
    [StructLayout(LayoutKind.Explicit)] private struct PdhFormattedCounterValue { [FieldOffset(0)] public uint Status; [FieldOffset(8)] public double DoubleValue; }
    [StructLayout(LayoutKind.Sequential)] private struct PdhFormattedCounterValueItem { public IntPtr Name; public PdhFormattedCounterValue Value; }
    private const uint ErrorSuccess = 0;
    private const uint PdhStatusNewData = 1;
    private const uint PdhMoreData = 0x800007D2;
    private const uint PdhFormatDouble = 0x00000200;
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx status);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhOpenQuery(string? dataSource, UIntPtr userData, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode, EntryPoint = "PdhAddEnglishCounterW")] private static extern uint PdhAddEnglishCounter(IntPtr query, string counterPath, UIntPtr userData, out IntPtr counter);
    [DllImport("pdh.dll")] private static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode, EntryPoint = "PdhGetFormattedCounterArrayW")] private static extern uint PdhGetFormattedCounterArray(IntPtr counter, uint format, ref uint bufferSize, ref uint itemCount, IntPtr itemBuffer);
    [DllImport("pdh.dll")] private static extern uint PdhCloseQuery(IntPtr query);

    private static double? QueryBrightness(object services)
    {
        object? results = null, item = null;
        try
        {
            results = ComCall(services, "ExecQuery", "SELECT CurrentBrightness FROM WmiMonitorBrightness");
            foreach (object result in (System.Collections.IEnumerable)results!)
            {
                item = result;
                return Math.Clamp(Convert.ToDouble(ComGet(result, "CurrentBrightness")), 0, 100);
            }
        }
        catch (Exception) { }
        finally
        {
            Release(item);
            Release(results);
        }
        return null;
    }

    // WMI 스크립팅 개체는 IDispatch로 호출한다(dynamic 바인더를 불러오지 않아 메모리를 아낀다).
    private static object? ComCall(object target, string name, params object?[] arguments) =>
        target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, arguments);

    private static object? ComGet(object target, string name) =>
        target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, null);

    private static object? ConnectWmi(out object? locator)
    {
        locator = null;
        Type? locatorType = Type.GetTypeFromProgID("WbemScripting.SWbemLocator");
        if (locatorType is null) return null;
        locator = Activator.CreateInstance(locatorType);
        return locator is null ? null : ComCall(locator, "ConnectServer", ".", @"root\WMI");
    }

    // 오디오 서비스가 음량·음소거 변경을 알려 줄 때 호출된다(COM 작업 스레드).
    private sealed class VolumeCallback(Action<bool, float> onChanged) : IAudioEndpointVolumeCallback
    {
        public int OnNotify(IntPtr notifyData)
        {
            try
            {
                // AUDIO_VOLUME_NOTIFICATION_DATA: Guid(16) · BOOL bMuted · float fMasterVolume
                bool nextMuted = Marshal.ReadInt32(notifyData, 16) != 0;
                float scalar = BitConverter.Int32BitsToSingle(Marshal.ReadInt32(notifyData, 20));
                onChanged(nextMuted, scalar);
            }
            catch (Exception) { }
            return 0;
        }
    }

    [ComImport, Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolumeCallback
    {
        [PreserveSig] int OnNotify(IntPtr notifyData);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private sealed class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IMMNotificationClient client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IMMNotificationClient client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid FormatId; public int PropertyId; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }

    [ComImport, Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMNotificationClient
    {
        [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string id, uint state);
        [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int OnDefaultDeviceChanged(int flow, int role, [MarshalAs(UnmanagedType.LPWStr)] string? id);
        [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string id, PropertyKey key);
    }

    // 장치 상태·추가·제거·기본 장치 변경만 알린다(속성 변경은 너무 잦아 무시).
    private sealed class DeviceNotificationClient(Action changed) : IMMNotificationClient
    {
        public int OnDeviceStateChanged(string id, uint state) { changed(); return 0; }
        public int OnDeviceAdded(string id) { changed(); return 0; }
        public int OnDeviceRemoved(string id) { changed(); return 0; }
        public int OnDefaultDeviceChanged(int flow, int role, string? id) { if (flow == 0 && role == 1) changed(); return 0; }
        public int OnPropertyValueChanged(string id, PropertyKey key) => 0;
    }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    private sealed class PolicyConfigComObject { }

    // Windows 사운드 설정이 기본 장치를 바꿀 때 쓰는 인터페이스(공개 문서는 없음). SetDefaultEndpoint만 사용한다.
    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultFormat, IntPtr format);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultPeriod, IntPtr defaultPeriodValue, IntPtr minimumPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    }

    private delegate void PowerModeCallback(int mode, IntPtr context);
    [DllImport("powrprof.dll")] private static extern int PowerRegisterForEffectivePowerModeNotifications(uint version, PowerModeCallback callback, IntPtr context, out IntPtr registration);
    [DllImport("powrprof.dll")] private static extern int PowerUnregisterFromEffectivePowerModeNotifications(IntPtr registration);
    [DllImport("powrprof.dll")] private static extern uint PowerGetActiveScheme(IntPtr rootPowerKey, out IntPtr activeScheme);
    [DllImport("powrprof.dll")] private static extern uint PowerReadDCValueIndex(IntPtr rootPowerKey, ref Guid scheme, ref Guid subgroup, ref Guid setting, out uint value);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid interfaceId, uint classContext, IntPtr activationParameters,
            [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
        [PreserveSig] int OpenPropertyStore(uint access, out IPropertyStore properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IAudioEndpointVolumeCallback notify);
        [PreserveSig] int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback notify);
        [PreserveSig] int GetChannelCount(out uint channelCount);
        [PreserveSig] int SetMasterVolumeLevel(float level, IntPtr context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr context);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, IntPtr context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, IntPtr context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
    }
}
