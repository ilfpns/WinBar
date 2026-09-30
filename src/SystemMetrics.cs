using System.Runtime.InteropServices;

namespace WinBar;

internal sealed record SystemSnapshot(double? CpuPercent = null, double? RamPercent = null, byte? BatteryPercent = null, bool Charging = false);

internal sealed class SystemMetrics : IDisposable
{
    private ulong previousIdle, previousKernel, previousUser;
    private bool hasCpuSample;

    public SystemSnapshot Sample()
    {
        double? cpu = SampleCpu();
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
        return new(cpu, ram, battery, charging);
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

    public void Dispose() { }

    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low, High; public readonly ulong Value => ((ulong)High << 32) | Low; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)] private struct MemoryStatusEx { public uint Length, MemoryLoad; public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual; }
    [StructLayout(LayoutKind.Sequential)] private struct SystemPowerStatus { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public uint BatteryLifeTime, BatteryFullLifeTime; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx status);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);
}
