using System;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Azure;
using Azure.AI.OpenAI;
using Azure.Identity;
using Azure.Storage.Queues;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.OpenTelemetry;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.StackExchangeRedis;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PluckIt.Core;
using PluckIt.Functions.Auth;
using PluckIt.Functions.Functions;
using PluckIt.Functions.Queue;
using PluckIt.Functions.Serialization;
using PluckIt.Infrastructure;
using OpenTelemetry;
using OpenTelemetry.Exporter;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using PluckIt.Functions.Observability;

const string OTelSignalTraces = "/v1/traces";
const string OTelSignalMetrics = "/v1/metrics";
const string OTelSignalLogs = "/v1/logs";
const string OTelServiceNameDefault = "pluckit-api-func-local";
string[] OTelSignalPaths = [OTelSignalTraces, OTelSignalMetrics, OTelSignalLogs];

var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureLogging((ctx, logging) =>
    {
        if (!TryGetOpenTelemetryConfig(ctx.Configuration, out var config) || !config.IsLogsEnabled)
        {
            return;
        }

        logging.AddOpenTelemetry(log =>
        {
            log.IncludeFormattedMessage = true;
            log.IncludeScopes = true;
            log.AddOtlpExporter(otlpOptions =>
            {
                otlpOptions.Endpoint = new Uri(config.LogsEndpoint);
                otlpOptions.Protocol = config.Protocol;
                if (!string.IsNullOrWhiteSpace(config.Headers))
                {
                    otlpOptions.Headers = config.Headers;
                }
            });
        });
    })
    .ConfigureServices((ctx, services) =>
    {
        var config = ctx.Configuration;
        ConfigureOpenTelemetry(config, services);

        // ── Google ID token validator (GIS auth) ────────────────────────────────
        // IHttpClientFactory is already registered by the AddHttpClient("processor") call below.
        // GoogleTokenValidator is a singleton so the JWKS cache is shared across invocations.
        services.AddSingleton<GoogleTokenValidator>();
        services.AddSingleton(sp =>
            new WardrobeFunctionsAuthContext(
                config["Local:DevUserId"],
                sp.GetRequiredService<GoogleTokenValidator>()));

        // ── Cosmos ──────────────────────────────────────────────────────────
        var cosmosEndpoint = config["Cosmos:Endpoint"]
            ?? throw new InvalidOperationException("Required env var 'Cosmos__Endpoint' is not set.");
        var cosmosKey = config["Cosmos:Key"]
            ?? throw new InvalidOperationException("Required env var 'Cosmos__Key' is not set.");
        var cosmosDatabase = config["Cosmos:Database"] ?? "PluckIt";
        var cosmosContainer = config["Cosmos:Container"] ?? "Wardrobe";

        // Use camelCase STJ options for Cosmos — plain reflection-based options work fine
        // at JIT runtime and avoid source-gen context restrictions (Cosmos asks for array
        // types like ClothingItem[] that would require extra [JsonSerializable] entries)
        var cosmosSerializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
            Converters =
            {
                new ClothingPriceConverter(),
                new JsonStringEnumConverter(null, allowIntegerValues: true),
            },
        };
        var cosmosOptions = new CosmosClientOptions
        {
            Serializer = new AotCosmosSerializer(cosmosSerializerOptions)
        };
        // The vnext-preview Cosmos emulator only supports Gateway (HTTP) mode, not Direct/RNTBD.
        // Force Gateway mode when connecting to localhost.
        if (cosmosEndpoint.Contains("localhost") || cosmosEndpoint.Contains("127.0.0.1"))
            cosmosOptions.ConnectionMode = ConnectionMode.Gateway;
        services.AddSingleton(_ => new CosmosClient(cosmosEndpoint, cosmosKey, cosmosOptions));
        services.AddSingleton<RefreshSessionStore>();
        services.AddSingleton<IWardrobeRepository>(sp =>
            new WardrobeRepository(
                sp.GetRequiredService<CosmosClient>(),
                cosmosDatabase,
                cosmosContainer,
                config["Cosmos:ImageCleanupIndexContainer"] ?? WardrobeImageCleanupIndex.DefaultContainerName));

        var cosmosWearEventsContainer = config["Cosmos:WearEventsContainer"] ?? "WearEvents";
        services.AddSingleton<IWearHistoryRepository>(sp =>
            new WearHistoryRepository(
                sp.GetRequiredService<CosmosClient>(),
                cosmosDatabase,
                cosmosWearEventsContainer));

        var cosmosStylingActivityContainer = config["Cosmos:StylingActivityContainer"] ?? "StylingActivity";
        services.AddSingleton<IStylingActivityRepository>(sp =>
            new StylingActivityRepository(
                sp.GetRequiredService<CosmosClient>(),
                cosmosDatabase,
                cosmosStylingActivityContainer));

        var cosmosUserProfilesContainer = config["Cosmos:UserProfilesContainer"] ?? "UserProfiles";
        services.AddSingleton<IUserProfileRepository>(sp =>
            new UserProfileRepository(
                sp.GetRequiredService<CosmosClient>(),
                cosmosDatabase,
                cosmosUserProfilesContainer));
        services.AddSingleton(sp =>
            new WardrobeFunctionsMutationDependencies(
                sp.GetRequiredService<IWearHistoryRepository>(),
                sp.GetRequiredService<IStylingActivityRepository>(),
                sp.GetRequiredService<IUserProfileRepository>()));

        var cosmosCollectionsContainer = config["Cosmos:CollectionsContainer"] ?? "Collections";
        services.AddSingleton<ICollectionRepository>(sp =>
            new CollectionRepository(
                sp.GetRequiredService<CosmosClient>(),
                cosmosDatabase,
                cosmosCollectionsContainer));

        // ── Azure OpenAI ─────────────────────────────────────────────────────
        var aiEndpoint = config["AI:Endpoint"]
            ?? throw new InvalidOperationException("Required env var 'AI__Endpoint' is not set.");
        var aiKey = config["AI:ApiKey"]
            ?? throw new InvalidOperationException("Required env var 'AI__ApiKey' is not set.");
        var aiDeployment = config["AI:Deployment"] ?? "gpt-4.1-mini";

        services.AddSingleton(_ =>
            new AzureOpenAIClient(new Uri(aiEndpoint), new AzureKeyCredential(aiKey)));
        services.AddSingleton<IStylistService>(sp =>
            new StylistService(sp.GetRequiredService<AzureOpenAIClient>(), aiDeployment));
        var processorBaseUrl = config["Processor:BaseUrl"] ?? "http://localhost:7071";
        var metadataEndpointUrl = config["Metadata:EndpointUrl"] ?? $"{processorBaseUrl}/api/extract-clothing-metadata";
        var metadataAuthMode = config["Metadata:AuthMode"] ?? "api-key";
        var metadataApiKey = config["Metadata:ApiKey"] ?? string.Empty;
        var metadataAzureAdScope = config["Metadata:AzureAdScope"] ?? string.Empty;
        var metadataAzureAdAudience = config["Metadata:AzureAdAudience"] ?? string.Empty;
        if (!string.Equals(metadataAuthMode, "azuread", StringComparison.OrdinalIgnoreCase))
        {
            metadataAzureAdScope = string.Empty;
            metadataAzureAdAudience = string.Empty;
        }

        Azure.Core.TokenCredential? metadataTokenCredential = string.Equals(
            metadataAuthMode,
            "azuread",
            StringComparison.OrdinalIgnoreCase)
            ? new Azure.Identity.DefaultAzureCredential()
            : null;
        services.AddSingleton<IClothingMetadataService>(sp =>
            new PythonClothingMetadataService(
                sp.GetRequiredService<IHttpClientFactory>(),
                metadataEndpointUrl,
                metadataAuthMode,
                new PythonClothingMetadataServiceOptions
                {
                    ApiKey = metadataApiKey,
                    AzureAdScope = metadataAzureAdScope,
                    AzureAdAudience = metadataAzureAdAudience,
                    TokenCredential = metadataTokenCredential,
                    Logger = sp.GetRequiredService<ILogger<PythonClothingMetadataService>>(),
                }));

        // ── Python Processor HTTP forwarding ──────────────────────────────────
        services.AddHttpClient("processor", client =>
        {
            client.BaseAddress = new Uri(processorBaseUrl);
            client.Timeout = TimeSpan.FromSeconds(130);
        });

        // ── Blob SAS URL generator ────────────────────────────────────────────
        var blobAccountName = config["BlobStorage:AccountName"] ?? "";
        var blobAccountKey = config["BlobStorage:AccountKey"] ?? "";
        var blobArchiveContainer = config["BlobStorage:ArchiveContainer"] ?? "archive";
        var blobUploadsContainer = config["BlobStorage:UploadsContainer"] ?? "uploads";
        var sasCacheEnabledSetting = config["SasCache:Enabled"] ?? config["SasCache__Enabled"];
        var sasCacheEnabled = false;
        if (!string.IsNullOrWhiteSpace(sasCacheEnabledSetting))
        {
            if (!bool.TryParse(sasCacheEnabledSetting, out var parsedSasCacheEnabled))
            {
                throw new InvalidOperationException(
                    "Invalid env var 'SasCache__Enabled' value. Set to true or false.");
            }
            sasCacheEnabled = parsedSasCacheEnabled;
        }
        var sasRedisConnectionString = config["SasCache:RedisConnectionString"] ??
                                      config["SasCache__RedisConnectionString"] ??
                                      string.Empty;

        if (sasCacheEnabled && string.IsNullOrWhiteSpace(sasRedisConnectionString))
        {
          throw new InvalidOperationException(
              "Required env var 'SasCache__RedisConnectionString' is not set while SAS cache is enabled.");
        }

        if (sasCacheEnabled)
        {
          services.AddStackExchangeRedisCache(options =>
          {
            options.Configuration = sasRedisConnectionString;
            options.InstanceName = "pluckit-sas";
          });
        }
        else
        {
          services.AddDistributedMemoryCache();
        }

        services.AddSingleton<IBlobSasService>(_ =>
        {
            if (blobAccountName == "devstoreaccount1")
            {
                return new BlobSasService(
                    "UseDevelopmentStorage=true",
                    blobArchiveContainer,
                    _.GetRequiredService<IDistributedCache>(),
                    blobUploadsContainer);
            }

            return new BlobSasService(
                blobAccountName,
                blobAccountKey,
                blobArchiveContainer,
                _.GetRequiredService<IDistributedCache>(),
                blobUploadsContainer);
        });

        // ── Image processing job queue ─────────────────────────────────────────
        // Re-uses the same storage account as blobs (sa_pluckit).
        // Connection string is read from StorageQueue app setting.
        var queueConnStr = config["StorageQueue"];
        if (string.IsNullOrEmpty(queueConnStr))
        {
            // Fallback: build from BlobStorage credentials (same account)
            queueConnStr = $"DefaultEndpointsProtocol=https;AccountName={blobAccountName};AccountKey={blobAccountKey};EndpointSuffix=core.windows.net";
        }
        var queueName = config["StorageQueue:QueueName"] ?? "image-processing-jobs";
        // In dotnet-isolated, host.json "queues" settings are NOT applied to the
        // effective QueuesOptions (extension bundle is skipped for isolated apps).
        // The trigger defaults to Base64 QueueMessageEncoding, so the QueueClient
        // must also use Base64 — otherwise the trigger fails to decode raw JSON,
        // binding errors occur before Run() is called, and with the default 0-second
        // VisibilityTimeout all 5 retries happen instantly → poison queue.
        var queueClient = new QueueClient(queueConnStr, queueName,
            new QueueClientOptions { MessageEncoding = QueueMessageEncoding.Base64 });
        // Best-effort queue creation at startup — idempotent, no-ops if already exists.
        try { queueClient.CreateIfNotExists(); } catch { /* ignore if already exists or offline */ }
        services.AddSingleton<IImageJobQueue>(new AzureStorageImageJobQueue(queueClient));
    })
    .Build();

await host.RunAsync();

bool TryGetOpenTelemetryConfig(IConfiguration configuration, out OpenTelemetryConfiguration config)
{
    config = default;

    var tracesEnabled = IsOtlpExporterEnabled(configuration["OTEL_TRACES_EXPORTER"]);
    var metricsEnabled = IsOtlpExporterEnabled(configuration["OTEL_METRICS_EXPORTER"]);
    var logsEnabled = IsOtlpExporterEnabled(configuration["OTEL_LOGS_EXPORTER"]);
    if (!tracesEnabled && !metricsEnabled && !logsEnabled)
    {
        return false;
    }

    var rawOtlpEndpoint = configuration["OTEL_EXPORTER_OTLP_ENDPOINT"];
    var tracesRawEndpoint = configuration["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] ?? rawOtlpEndpoint;
    if (string.IsNullOrWhiteSpace(tracesRawEndpoint))
    {
        return false;
    }

    var protocol = ParseOtlpProtocol(configuration["OTEL_EXPORTER_OTLP_PROTOCOL"]);
    var headers = NormalizeOtlpHeaders(configuration["OTEL_EXPORTER_OTLP_HEADERS"]);
    var serviceName = configuration["OTEL_SERVICE_NAME"] ?? OTelServiceNameDefault;
    var tracesEndpoint = BuildSignalEndpoint(tracesRawEndpoint, OTelSignalTraces, OTelSignalPaths);
    if (string.IsNullOrWhiteSpace(tracesEndpoint))
    {
        return false;
    }

    var metricsRawEndpoint = configuration["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"] ?? tracesRawEndpoint;
    var logsRawEndpoint = configuration["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"] ?? tracesRawEndpoint;
    var metricsEndpoint = BuildSignalEndpoint(metricsRawEndpoint, OTelSignalMetrics, OTelSignalPaths);
    var logsEndpoint = BuildSignalEndpoint(logsRawEndpoint, OTelSignalLogs, OTelSignalPaths);
    if (string.IsNullOrWhiteSpace(metricsEndpoint) || string.IsNullOrWhiteSpace(logsEndpoint))
    {
        return false;
    }

    config = new OpenTelemetryConfiguration(
        tracesEndpoint,
        tracesEnabled,
        metricsEndpoint,
        metricsEnabled,
        logsEndpoint,
        logsEnabled,
        serviceName,
        headers,
        protocol);
    return true;
}

void ConfigureOpenTelemetry(IConfiguration configuration, IServiceCollection services)
{
    if (!TryGetOpenTelemetryConfig(configuration, out var config) || (!config.IsTracesEnabled && !config.IsMetricsEnabled))
    {
        return;
    }

    var resourceBuilder = ResourceBuilder.CreateDefault().AddService(config.ServiceName, serviceNamespace: "pluckit");
    var telemetry = services.AddOpenTelemetry().UseFunctionsWorkerDefaults();

    if (config.IsTracesEnabled)
    {
        telemetry.WithTracing(BuildTracingPipeline(resourceBuilder, config));
    }

    if (config.IsMetricsEnabled)
    {
        telemetry.WithMetrics(BuildMetricsPipeline(resourceBuilder, config));
    }
}

static Action<OpenTelemetry.Trace.TracerProviderBuilder> BuildTracingPipeline(
    ResourceBuilder resourceBuilder,
    OpenTelemetryConfiguration config)
{
    return tracing =>
    {
        tracing.SetResourceBuilder(resourceBuilder);
        tracing.AddHttpClientInstrumentation();
        tracing.AddOtlpExporter(otlpOptions => ConfigureOtlpExporter(
            otlpOptions,
            config.TracesEndpoint,
            config.Protocol,
            config.Headers));
    };
}

static Action<OpenTelemetry.Metrics.MeterProviderBuilder> BuildMetricsPipeline(
    ResourceBuilder resourceBuilder,
    OpenTelemetryConfiguration config)
{
    return metrics =>
    {
        metrics.SetResourceBuilder(resourceBuilder);
        metrics.AddOtlpExporter(otlpOptions => ConfigureOtlpExporter(
            otlpOptions,
            config.MetricsEndpoint,
            config.Protocol,
            config.Headers));
    };
}

static void ConfigureOtlpExporter(
    OtlpExporterOptions otlpOptions,
    string endpoint,
    OtlpExportProtocol protocol,
    string? headers)
{
    otlpOptions.Endpoint = new Uri(endpoint);
    otlpOptions.Protocol = protocol;
    if (!string.IsNullOrWhiteSpace(headers))
    {
        otlpOptions.Headers = headers;
    }
}

static string? BuildSignalEndpoint(string? baseOrSignalEndpoint, string signalPath, string[] signalPaths)
{
    if (string.IsNullOrWhiteSpace(baseOrSignalEndpoint))
    {
        return null;
    }

    var normalized = baseOrSignalEndpoint.Trim().TrimEnd('/');
    if (normalized.EndsWith(signalPath, StringComparison.OrdinalIgnoreCase))
    {
        return normalized;
    }

    var matchingSignalPath = signalPaths.FirstOrDefault(
        knownSignalPath => normalized.EndsWith(knownSignalPath, StringComparison.OrdinalIgnoreCase));

    if (string.IsNullOrEmpty(matchingSignalPath))
    {
        return $"{normalized}{signalPath}";
    }

    if (matchingSignalPath == signalPath)
    {
        return normalized;
    }

    return $"{normalized[..^matchingSignalPath.Length]}{signalPath}";
}

static string? NormalizeOtlpHeaders(string? rawHeaders)
{
    if (string.IsNullOrWhiteSpace(rawHeaders))
    {
        return null;
    }

    var decoded = WebUtility.UrlDecode(rawHeaders.Trim());
    return string.IsNullOrWhiteSpace(decoded) ? null : decoded;
}

static OtlpExportProtocol ParseOtlpProtocol(string? rawProtocol)
{
    if (string.Equals(rawProtocol, "grpc", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(rawProtocol, "grpc/protobuf", StringComparison.OrdinalIgnoreCase))
    {
        return OtlpExportProtocol.Grpc;
    }

    return OtlpExportProtocol.HttpProtobuf;
}

static bool IsOtlpExporterEnabled(string? exporterSetting)
{
    if (string.IsNullOrWhiteSpace(exporterSetting))
    {
        return true;
    }

    return string.Equals(exporterSetting, "otlp", StringComparison.OrdinalIgnoreCase);
}


