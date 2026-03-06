using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using Azure;
using Azure.AI.OpenAI;
using Azure.Storage.Queues;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PluckIt.Core;
using PluckIt.Functions.Auth;
using PluckIt.Functions.Queue;
using PluckIt.Functions.Serialization;
using PluckIt.Infrastructure;

var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices((ctx, services) =>
    {
        var config = ctx.Configuration;

        // ── Google ID token validator (GIS auth) ────────────────────────────────
        // IHttpClientFactory is already registered by the AddHttpClient("processor") call below.
        // GoogleTokenValidator is a singleton so the JWKS cache is shared across invocations.
        services.AddSingleton<GoogleTokenValidator>();

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
        services.AddSingleton(_ => new CosmosClient(cosmosEndpoint, cosmosKey, new CosmosClientOptions
        {
            Serializer = new AotCosmosSerializer(cosmosSerializerOptions)
        }));
        services.AddSingleton<IWardrobeRepository>(sp =>
            new WardrobeRepository(
                sp.GetRequiredService<CosmosClient>(),
                cosmosDatabase,
                cosmosContainer));

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
        var visionDeployment = config["AI:VisionDeployment"] ?? aiDeployment;

        services.AddSingleton(_ =>
            new AzureOpenAIClient(new Uri(aiEndpoint), new AzureKeyCredential(aiKey)));
        services.AddSingleton<IStylistService>(sp =>
            new StylistService(sp.GetRequiredService<AzureOpenAIClient>(), aiDeployment));
        services.AddSingleton<IClothingMetadataService>(sp =>
            new ClothingMetadataService(sp.GetRequiredService<AzureOpenAIClient>(), visionDeployment));

        // ── Python Processor HTTP forwarding ──────────────────────────────────
        var processorBaseUrl = config["Processor:BaseUrl"] ?? "http://localhost:7071";
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
        services.AddSingleton<IBlobSasService>(
            new BlobSasService(blobAccountName, blobAccountKey, blobArchiveContainer, blobUploadsContainer));

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
