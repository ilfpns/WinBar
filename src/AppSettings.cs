using System.Reflection;
using Microsoft.Win32;

namespace WinBar;

// 사용자 설정은 %LOCALAPPDATA%\WinBar\settings.ini 에만 저장하고 외부로 보내지 않는다.
internal sealed class AppSettings
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "WinBar";

    public static string FilePath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WinBar", "settings.ini");

    public static AppSettings Current { get; } = Load();

    public event Action? Changed;

    public bool ShowPrivacy { get; set; } = true;
    public bool ShowInputSource { get; set; } = true;
    public bool ShowWifi { get; set; } = true;
    public bool ShowBluetooth { get; set; } = true;
    public bool ShowSystemUsage { get; set; } = true;
    public bool ShowVolume { get; set; } = true;
    public bool ShowBrightness { get; set; } = true;
    public bool ShowBattery { get; set; } = true;
    public bool ShowBatteryPercent { get; set; } = true;
    public bool Use24HourClock { get; set; }

    // 메뉴바 배경을 덮는 색의 불투명도(%). 낮을수록 뒤 배경화면이 더 비친다.
    public int BarOpacity { get; set; } = 60;

    private static IEnumerable<PropertyInfo> Options() =>
        typeof(AppSettings).GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(property => property.PropertyType == typeof(bool) || property.PropertyType == typeof(int))
            .Where(property => property.CanWrite);

    private static AppSettings Load()
    {
        var settings = new AppSettings();
        try
        {
            if (!File.Exists(FilePath)) return settings;
            Dictionary<string, PropertyInfo> properties = Options().ToDictionary(property => property.Name);
            foreach (string line in File.ReadAllLines(FilePath))
            {
                int separator = line.IndexOf('=');
                if (separator <= 0) continue;
                string name = line[..separator].Trim();
                string text = line[(separator + 1)..].Trim();
                if (!properties.TryGetValue(name, out PropertyInfo? property)) continue;
                if (property.PropertyType == typeof(bool) && bool.TryParse(text, out bool flag))
                    property.SetValue(settings, flag);
                else if (property.PropertyType == typeof(int) && int.TryParse(text, out int number))
                    property.SetValue(settings, number);
            }
        }
        catch (Exception) { }
        return settings;
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllLines(FilePath, Options().Select(property => $"{property.Name}={property.GetValue(this)}"));
        }
        catch (Exception) { }
        Changed?.Invoke();
    }

    // 슬라이더를 끄는 동안 파일에 쓰지 않고 화면에만 바로 반영한다.
    public void Preview() => Changed?.Invoke();

    public static bool IsAutoStartEnabled()
    {
        try
        {
            using RegistryKey? key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return key?.GetValue(RunValueName) is string;
        }
        catch (Exception) { return false; }
    }

    // 사용자가 설정 창에서 직접 켠 경우에만 현재 사용자 계정의 로그인 자동 실행에 등록한다.
    public static bool SetAutoStart(bool enabled)
    {
        try
        {
            using RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKeyPath);
            if (enabled)
                key.SetValue(RunValueName, $"\"{Environment.ProcessPath}\"");
            else
                key.DeleteValue(RunValueName, throwOnMissingValue: false);
            return true;
        }
        catch (Exception) { return false; }
    }
}
