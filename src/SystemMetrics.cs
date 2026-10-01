using System.Reflection;
using System.Runtime.InteropServices;

namespace WinBar;

internal sealed record SystemSnapshot(double? CpuPercent = null, double? GpuPercent = null,
    double? RamPercent = null, byte? BatteryPercent = null, bool Charging = false,
    double? VolumePercent = null, bool Muted = false, double? BrightnessPercent = null,
    int? BatteryMinutes = null);

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
    private bool stableCharging;
    private int missingChargingSamples;

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

        try
        {
            var enumerator = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorComObject();
            if (enumerator.GetDefaultAudioEndpoint(0, 1, out IMMDevice device) == 0)
            {
                Guid interfaceId = typeof(IAudioEndpointVolume).GUID;
                if (device.Activate(ref interfaceId, 23, IntPtr.Zero, out object endpoint) == 0)
                    audioVolume = (IAudioEndpointVolume)endpoint;
                Marshal.ReleaseComObject(device);
            }
            Marshal.ReleaseComObject(enumerator);
        }
        catch (Exception) { audioVolume = null; }

        if (audioVolume is not null)
        {
            SampleVolume();
            try
            {
                var callback = new VolumeCallback(OnVolumeNotify);
                if (audioVolume.RegisterControlChangeNotify(callback) == 0) volumeCallback = callback;
            }
            catch (Exception) { volumeCallback = null; }
        }

        brightnessThread = new Thread(() => MonitorBrightness(brightnessCancellation.Token))
        {
            IsBackground = true,
            Name = "WinBar brightness"
        };
        brightnessThread.Start();
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

        try { SampleBattery(ref battery, ref charging, ref batteryMinutes); } catch (Exception) { }

        // 변경 알림을 놓쳤을 때를 대비해 2초 주기에서만 음량을 직접 확인한다.
        if (volumeCallback is null) SampleVolume();
        return ApplyControls(new(cpu, gpu, ram, battery, charging, BatteryMinutes: batteryMinutes));
    }

    private void SampleBattery(ref byte? battery, ref bool charging, ref int? batteryMinutes)
    {
        if (GetSystemPowerStatus(out SystemPowerStatus power)
            && power.BatteryFlag is not 128 and not 255
            && power.BatteryLifePercent != 255)
        {
            battery = power.BatteryLifePercent;
            bool pluggedIn = power.ACLineStatus == 1;
            bool chargingSignal = (power.BatteryFlag & 0x08) != 0;
            if (!pluggedIn)
            {
                stableCharging = false;
                missingChargingSamples = 0;
            }
            else if (chargingSignal)
            {
                stableCharging = true;
                missingChargingSamples = 0;
            }
            else if (stableCharging && missingChargingSamples < 15)
            {
                missingChargingSamples++;
            }
            else
            {
                stableCharging = false;
            }
            charging = stableCharging;
            if (!pluggedIn && power.BatteryLifeTime != uint.MaxValue)
                batteryMinutes = (int)(power.BatteryLifeTime / 60);
        }
    }

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
                BrightnessPercent = ReadBrightness()
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
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid interfaceId, uint classContext, IntPtr activationParameters,
            [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
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
