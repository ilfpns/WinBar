#pragma once

#include <optional>

struct SystemSnapshot {
    std::optional<double> cpuPercent;
    std::optional<double> gpuPercent;
    std::optional<double> ramPercent;
    std::optional<unsigned int> batteryPercent;
    bool charging = false;
};

class SystemMetrics final {
public:
    SystemMetrics();
    ~SystemMetrics();

    SystemMetrics(const SystemMetrics&) = delete;
    SystemMetrics& operator=(const SystemMetrics&) = delete;

    SystemSnapshot Sample();

private:
    struct Impl;
    Impl* impl_;
};
