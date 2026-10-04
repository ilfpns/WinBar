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

    public static AppSettings Current { get; } = Load(FilePath);

    public event Action? Changed;

    // 메뉴바에 아이콘으로 표시할 항목(제어 센터와 날짜·시간은 항상 표시)
    public bool ShowPrivacy { get; set; } = true;
    public bool ShowWifi { get; set; } = true;
    public bool ShowVolume { get; set; } = true;
    public bool ShowBattery { get; set; } = true;
    // 달리는 고양이(CPU 사용량에 따라 빨라짐)
    public bool ShowRunCat { get; set; } = true;
    public bool Use24HourClock { get; set; }
    public bool LightMode { get; set; }

    // 메뉴바 배경을 덮는 테마 색의 불투명도(%). 0은 배경 없음(아이콘·글자만), 100은 불투명이다.
    public int BarOpacity { get; set; } = 60;

    // 메뉴바 오른쪽 아이콘들 사이의 좌우 간격(px)
    public const int MinIconSpacing = 0;
    public const int MaxIconSpacing = 24;
    public int IconSpacing { get; set; } = 4;

    // WinBar 표시 언어: ko(한국어) · zh(中文) · ja(日本語) · en(English)
    public string Language { get; set; } = "ko";

    private static IEnumerable<PropertyInfo> Options() =>
        typeof(AppSettings).GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(property => property.PropertyType == typeof(bool) || property.PropertyType == typeof(int) || property.PropertyType == typeof(string))
            .Where(property => property.CanWrite);

    // 파일이 손상되었거나 손으로 고친 값이 범위를 벗어나도 앱이 이상한 값을 쓰지 않게 읽은 뒤 범위로 맞춘다.
    private static AppSettings Load(string path)
    {
        var settings = new AppSettings();
        try
        {
            if (!File.Exists(path)) return settings;
            Dictionary<string, PropertyInfo> properties = Options().ToDictionary(property => property.Name);
            foreach (string line in File.ReadAllLines(path))
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
                else if (property.PropertyType == typeof(string) && text.Length is > 0 and <= 16)
                    property.SetValue(settings, text);
            }
        }
        catch (Exception) { }
        settings.BarOpacity = Math.Clamp(settings.BarOpacity, 0, 100);
        settings.IconSpacing = Math.Clamp(settings.IconSpacing, MinIconSpacing, MaxIconSpacing);
        if (settings.Language is not ("ko" or "zh" or "ja" or "en")) settings.Language = "ko";
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

    // 마이크로소프트 스토어(MSIX)로 설치되어 실행 중인지. 이때는 레지스트리 자동 실행이 동작하지 않으므로,
    // 패키지에 선언한 시작 작업을 사용자가 Windows 설정 > 앱 > 시작 프로그램에서 직접 켠다.
    public static bool IsPackaged { get; } = DetectPackage();

    private static bool DetectPackage()
    {
        try
        {
            int length = 0;
            return GetCurrentPackageFullName(ref length, null) != 15700; // APPMODEL_ERROR_NO_PACKAGE
        }
        catch (Exception) { return false; }
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int GetCurrentPackageFullName(ref int length, char[]? name);

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
