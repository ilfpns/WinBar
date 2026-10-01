#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <string>
#include <vector>

#include "system_metrics.h"

namespace {
constexpr wchar_t kWindowClass[] = L"WinBarWindow";
constexpr UINT_PTR kRefreshTimer = 1;
constexpr UINT kRefreshMilliseconds = 2000;
constexpr int kBarHeight = 30;

std::vector<HWND> g_windows;
SystemMetrics g_metrics;
SystemSnapshot g_snapshot;

std::wstring PercentText(const wchar_t* label, const std::optional<double>& value) {
    if (!value) return std::wstring(label) + L" --";
    return std::wstring(label) + L" " + std::to_wstring(static_cast<int>(*value + 0.5)) + L"%";
}

void PaintBar(HWND window) {
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(window, &paint);
    RECT area{};
    GetClientRect(window, &area);

    HBRUSH background = CreateSolidBrush(RGB(28, 28, 30));
    FillRect(dc, &area, background);
    DeleteObject(background);

    HFONT font = CreateFontW(-16, 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    HGDIOBJ previousFont = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(242, 242, 247));

    const std::wstring title = L"WinBar";
    RECT left = area;
    left.left += 14;
    DrawTextW(dc, title.c_str(), -1, &left, DT_LEFT | DT_VCENTER | DT_SINGLELINE);

    std::wstring status = PercentText(L"CPU", g_snapshot.cpuPercent) + L"   "
        + PercentText(L"GPU", g_snapshot.gpuPercent) + L"   "
        + PercentText(L"RAM", g_snapshot.ramPercent) + L"   BAT ";
    if (g_snapshot.batteryPercent) {
        status += std::to_wstring(*g_snapshot.batteryPercent) + L"%";
        if (g_snapshot.charging) status += L" +";
    } else {
        status += L"--";
    }

    RECT right = area;
    right.right -= 14;
    DrawTextW(dc, status.c_str(), -1, &right, DT_RIGHT | DT_VCENTER | DT_SINGLELINE);

    SelectObject(dc, previousFont);
    DeleteObject(font);
    EndPaint(window, &paint);
}

LRESULT CALLBACK WindowProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_TIMER:
        if (wParam == kRefreshTimer) {
            g_snapshot = g_metrics.Sample();
            for (HWND bar : g_windows) InvalidateRect(bar, nullptr, FALSE);
        }
        return 0;
    case WM_PAINT:
        PaintBar(window);
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_DESTROY:
        if (window == g_windows.front()) PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProcW(window, message, wParam, lParam);
    }
}

BOOL CALLBACK CreateBarForMonitor(HMONITOR monitor, HDC, LPRECT, LPARAM instanceValue) {
    MONITORINFO monitorInfo{ sizeof(monitorInfo) };
    if (!GetMonitorInfoW(monitor, &monitorInfo)) return TRUE;

    const int width = monitorInfo.rcMonitor.right - monitorInfo.rcMonitor.left;
    HWND window = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        kWindowClass, L"WinBar", WS_POPUP,
        monitorInfo.rcMonitor.left, monitorInfo.rcMonitor.top, width, kBarHeight,
        nullptr, nullptr, reinterpret_cast<HINSTANCE>(instanceValue), nullptr);
    if (window) {
        g_windows.push_back(window);
        ShowWindow(window, SW_SHOWNOACTIVATE);
    }
    return TRUE;
}
} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    WNDCLASSEXW windowClass{ sizeof(windowClass) };
    windowClass.lpfnWndProc = WindowProcedure;
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.lpszClassName = kWindowClass;
    if (!RegisterClassExW(&windowClass)) return 1;

    EnumDisplayMonitors(nullptr, nullptr, CreateBarForMonitor, reinterpret_cast<LPARAM>(instance));
    if (g_windows.empty()) return 2;

    g_snapshot = g_metrics.Sample();
    SetTimer(g_windows.front(), kRefreshTimer, kRefreshMilliseconds, nullptr);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return static_cast<int>(message.wParam);
}
