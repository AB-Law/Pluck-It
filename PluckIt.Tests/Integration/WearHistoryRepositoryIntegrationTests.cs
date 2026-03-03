using Microsoft.Azure.Cosmos;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Integration;

[Collection("CosmosDb Integration")]
[Trait("Category", "Integration")]
public sealed class WearHistoryRepositoryIntegrationTests
{
    private readonly CosmosClient _client;
    private readonly WearHistoryRepository _repo;
    private readonly string _userId = Guid.NewGuid().ToString("N");
    private const string ContainerName = "WearEvents";

    public WearHistoryRepositoryIntegrationTests(CosmosDbFixture fixture)
    {
        _client = fixture.Client;
        _repo = new WearHistoryRepository(_client, CosmosDbFixture.Database, ContainerName);
    }

    private async Task EnsureContainerAsync()
    {
        await _client
            .GetDatabase(CosmosDbFixture.Database)
            .CreateContainerIfNotExistsAsync(new ContainerProperties(ContainerName, "/userId"));
    }

    [Fact]
    public async Task AddAndGetByItem_RoundTrips()
    {
        await EnsureContainerAsync();

        await _repo.AddAsync(new WearHistoryRecord
        {
            Id = $"we-{Guid.NewGuid():N}",
            UserId = _userId,
            ItemId = "item-1",
            OccurredAt = DateTimeOffset.UtcNow,
            Source = "vault_card",
        });

        var rows = await _repo.GetByItemAsync("item-1", _userId);
        rows.Count.ShouldBe(1);
        rows[0].ItemId.ShouldBe("item-1");
    }
}

