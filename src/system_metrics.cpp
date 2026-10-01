#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <pdh.h>

#include <algorithm>
#include <memory>
#include <vector>

#include "system_metrics.h"

namespace {
unsigned long long FileTimeValue(const FILETIME& value) {
    ULARGE_INTEGER result{};
    result.LowPart = value.dwLowDateTime;
    result.HighPart = value.dwHighDateTime;
    return result.QuadPart;
}
} // namespace

struct SystemMetrics::Impl {
    FILETIME previousIdle{};
    FILETIME previousKernel{};
    FILETIME previousUser{};
    bool hasCpuSample = false;

    PDH_HQUERY gpuQuery = nullptr;
    PDH_HCOUNTER gpuCounter = nullptr;
    bool gpuReady = false;

    Impl() {
        if (PdhOpenQueryW(nullptr, 0, &gpuQuery) == ERROR_SUCCESS) {
            const PDH_STATUS status = PdhAddEnglishCounterW(
                gpuQuery, L"\\GPU Engine(*)\\Utilization Percentage", 0, &gpuCounter);
            if (status == ERROR_SUCCESS && PdhCollectQueryData(gpuQuery) == ERROR_SUCCESS) {
                gpuReady = true;
            }
        }
        if (!gpuReady && gpuQuery) {
            PdhCloseQuery(gpuQuery);
            gpuQuery = nullptr;
            gpuCounter = nullptr;
        }
    }

    ~Impl() {
        if (gpuQuery) PdhCloseQuery(gpuQuery);
    }

    std::optional<double> SampleCpu() {
        FILETIME idle{}, kernel{}, user{};
        if (!GetSystemTimes(&idle, &kernel, &user)) return std::nullopt;

        if (!hasCpuSample) {
            previousIdle = idle;
            previousKernel = kernel;
            previousUser = user;
            hasCpuSample = true;
            return std::nullopt;
        }

        const auto idleDelta = FileTimeValue(idle) - FileTimeValue(previousIdle);
        const auto kernelDelta = FileTimeValue(kernel) - FileTimeValue(previousKernel);
        const auto userDelta = FileTimeValue(user) - FileTimeValue(previousUser);
        previousIdle = idle;
        previousKernel = kernel;
        previousUser = user;

        const auto total = kernelDelta + userDelta;
        if (total == 0 || idleDelta > total) return std::nullopt;
        return std::clamp(100.0 * static_cast<double>(total - idleDelta)
            / static_cast<double>(total), 0.0, 100.0);
    }

    std::optional<double> SampleGpu() {
        if (!gpuReady || PdhCollectQueryData(gpuQuery) != ERROR_SUCCESS) return std::nullopt;

        DWORD bufferSize = 0;
        DWORD itemCount = 0;
        PDH_STATUS status = PdhGetFormattedCounterArrayW(
            gpuCounter, PDH_FMT_DOUBLE, &bufferSize, &itemCount, nullptr);
        if (status != PDH_MORE_DATA || bufferSize == 0) return std::nullopt;

        std::vector<unsigned char> buffer(bufferSize);
        auto* items = reinterpret_cast<PDH_FMT_COUNTERVALUE_ITEM_W*>(buffer.data());
        status = PdhGetFormattedCounterArrayW(
            gpuCounter, PDH_FMT_DOUBLE, &bufferSize, &itemCount, items);
        if (status != ERROR_SUCCESS) return std::nullopt;

        double total = 0.0;
        bool found = false;
        for (DWORD index = 0; index < itemCount; ++index) {
            if (items[index].FmtValue.CStatus == ERROR_SUCCESS) {
                total += items[index].FmtValue.doubleValue;
                found = true;
            }
        }
        if (!found) return std::nullopt;
        return std::clamp(total, 0.0, 100.0);
    }

    std::optional<double> SampleRam() const {
        MEMORYSTATUSEX memory{ sizeof(memory) };
        if (!GlobalMemoryStatusEx(&memory)) return std::nullopt;
        return std::clamp(static_cast<double>(memory.dwMemoryLoad), 0.0, 100.0);
    }

    void SampleBattery(SystemSnapshot& snapshot) const {
        SYSTEM_POWER_STATUS power{};
        if (!GetSystemPowerStatus(&power) || power.BatteryFlag == 128
            || power.BatteryLifePercent == 255) {
            return;
        }
        snapshot.batteryPercent = power.BatteryLifePercent;
        snapshot.charging = power.ACLineStatus == 1 && power.BatteryFlag != 8;
    }
};

SystemMetrics::SystemMetrics() : impl_(new Impl) {}
SystemMetrics::~SystemMetrics() { delete impl_; }

SystemSnapshot SystemMetrics::Sample() {
    SystemSnapshot snapshot;
    snapshot.cpuPercent = impl_->SampleCpu();
    snapshot.gpuPercent = impl_->SampleGpu();
    snapshot.ramPercent = impl_->SampleRam();
    impl_->SampleBattery(snapshot);
    return snapshot;
}
