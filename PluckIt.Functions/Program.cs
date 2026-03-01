using System;
using System.Text.Json;
using Azure;
using Azure.AI.OpenAI;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PluckIt.Core;
using PluckIt.Functions.Auth;
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
            client.BaseAddress = new Uri(processorBaseUrl));

        // ── Blob SAS URL generator ────────────────────────────────────────────
        var blobAccountName = config["BlobStorage:AccountName"] ?? "";
        var blobAccountKey = config["BlobStorage:AccountKey"] ?? "";
        var blobArchiveContainer = config["BlobStorage:ArchiveContainer"] ?? "archive";
        services.AddSingleton<IBlobSasService>(
            new BlobSasService(blobAccountName, blobAccountKey, blobArchiveContainer));
    })
    .Build();

await host.RunAsync();
