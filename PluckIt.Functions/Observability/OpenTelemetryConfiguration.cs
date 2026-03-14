using OpenTelemetry.Exporter;

namespace PluckIt.Functions.Observability;

/// <summary>
/// Settings derived from environment variables for OpenTelemetry exports.
/// </summary>
internal sealed record OpenTelemetryConfiguration(
    string TracesEndpoint,
    bool IsTracesEnabled,
    string MetricsEndpoint,
    bool IsMetricsEnabled,
    string LogsEndpoint,
    bool IsLogsEnabled,
    string ServiceName,
    string? Headers,
    OtlpExportProtocol Protocol);
