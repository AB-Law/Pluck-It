using System;
using System.Net.Http;
using Microsoft.Azure.Cosmos;
using Testcontainers.CosmosDb;
using Xunit;

namespace PluckIt.Tests.Integration;

/// <summary>
/// Starts a single Cosmos DB emulator container shared by the entire integration
/// test collection. Using a shared fixture means only one ~1.5 GB container is
/// started regardless of how many test classes belong to the collection, and all
/// tests run sequentially within the collection so no concurrent container starts.
/// </summary>
public sealed class CosmosDbFixture : IAsyncLifetime
{
    private readonly CosmosDbContainer _cosmos =
        new CosmosDbBuilder("mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-preview")
            .Build();

    public const string Database  = "PluckIt";
    public const string Container = "Wardrobe";

    public CosmosClient Client { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _cosmos.StartAsync();

        var allowInsecureTls = string.Equals(
            Environment.GetEnvironmentVariable("COSMOS_EMULATOR_INSECURE_TLS"),
            "true",
            StringComparison.OrdinalIgnoreCase);

        Func<HttpClient>? httpClientFactory = null;
        if (allowInsecureTls)
        {
            httpClientFactory = () => new HttpClient(
                new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback =
                        HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
                });
        }

        Client = new CosmosClient(
            _cosmos.GetConnectionString(),
            new CosmosClientOptions
            {
                HttpClientFactory = httpClientFactory,
                ConnectionMode = ConnectionMode.Gateway,
            });

        await Client.CreateDatabaseIfNotExistsAsync(Database);
        await Client
            .GetDatabase(Database)
            .CreateContainerIfNotExistsAsync(new ContainerProperties(Container, "/userId"));
    }

    public async Task DisposeAsync()
    {
        Client.Dispose();
        await _cosmos.StopAsync();
        await _cosmos.DisposeAsync();
    }
}

/// <summary>
/// Collection definition that groups all Cosmos integration tests.
/// Tests in this collection share one <see cref="CosmosDbFixture"/> instance and
/// execute sequentially, preventing multiple emulator containers from running
/// concurrently under xunit's parallel test collection scheduler.
/// </summary>
[CollectionDefinition("CosmosDb Integration")]
public class CosmosDbCollection : ICollectionFixture<CosmosDbFixture> { }
