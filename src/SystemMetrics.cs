using System.Runtime.InteropServices;

namespace WinBar;

internal sealed record SystemSnapshot(double? CpuPercent = null, double? GpuPercent = null,
    double? RamPercent = null, byte? BatteryPercent = null, bool Charging = false);

internal sealed class SystemMetrics : IDisposable
{
    private ulong previousIdle, previousKernel, previousUser;
    private bool hasCpuSample;
    private IntPtr gpuQuery;
    private IntPtr gpuCounter;

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
    }

    public SystemSnapshot Sample()
    {
        double? cpu = SampleCpu();
        double? gpu = SampleGpu();
        double? ram = null;
        byte? battery = null;
        bool charging = false;

        var memory = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        if (GlobalMemoryStatusEx(ref memory)) ram = memory.MemoryLoad;

        if (GetSystemPowerStatus(out SystemPowerStatus power) && power.BatteryFlag != 128 && power.BatteryLifePercent != 255)
        {
            battery = power.BatteryLifePercent;
            charging = power.ACLineStatus == 1 && power.BatteryFlag != 8;
        }
        return new(cpu, gpu, ram, battery, charging);
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

            // 작업 관리자와 같이 엔진 종류(engtype_3D, engtype_Copy 등)별로 합한 뒤 가장 큰 값을 쓴다.
            int itemSize = Marshal.SizeOf<PdhFormattedCounterValueItem>();
            var totals = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            for (uint index = 0; index < itemCount; index++)
            {
                IntPtr itemAddress = IntPtr.Add(buffer, checked((int)index * itemSize));
                PdhFormattedCounterValueItem item =
                    Marshal.PtrToStructure<PdhFormattedCounterValueItem>(itemAddress);
                if (item.Value.Status > PdhStatusNewData
                    || !double.IsFinite(item.Value.DoubleValue)) continue;

                string name = Marshal.PtrToStringUni(item.Name) ?? string.Empty;
                int typeIndex = name.IndexOf("engtype_", StringComparison.OrdinalIgnoreCase);
                string engineType = typeIndex < 0 ? string.Empty : name[(typeIndex + 8)..];
                totals[engineType] = totals.GetValueOrDefault(engineType)
                    + Math.Max(0, item.Value.DoubleValue);
            }
            return totals.Count == 0 ? null : Math.Clamp(totals.Values.Max(), 0, 100);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public void Dispose()
    {
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
}
