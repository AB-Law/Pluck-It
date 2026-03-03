using Microsoft.Azure.Cosmos;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Integration;

[Collection("CosmosDb Integration")]
[Trait("Category", "Integration")]
public sealed class StylingActivityRepositoryIntegrationTests
{
    private readonly CosmosClient _client;
    private readonly StylingActivityRepository _repo;
    private readonly string _userId = Guid.NewGuid().ToString("N");
    private const string ContainerName = "StylingActivity";

    public StylingActivityRepositoryIntegrationTests(CosmosDbFixture fixture)
    {
        _client = fixture.Client;
        _repo = new StylingActivityRepository(_client, CosmosDbFixture.Database, ContainerName);
    }

    private async Task EnsureContainerAsync()
    {
        await _client
            .GetDatabase(CosmosDbFixture.Database)
            .CreateContainerIfNotExistsAsync(new ContainerProperties(ContainerName, "/userId"));
    }

    [Fact]
    public async Task UpsertAndPendingQuery_RoundTrips()
    {
        await EnsureContainerAsync();

        var id = $"sty-{Guid.NewGuid():N}";
        await _repo.UpsertAsync(new StylingActivityRecord
        {
            Id = id,
            UserId = _userId,
            ItemId = "item-1",
            ClientEventId = $"evt-{Guid.NewGuid():N}",
            ActivityType = StylingActivityType.AddedToStyleBoard,
            Source = "dashboard_drag_drop",
            OccurredAt = DateTimeOffset.UtcNow.AddHours(-1),
            Status = WearSuggestionStatus.Pending,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(2),
        });

        var pending = await _repo.GetPendingSuggestionsAsync(_userId, DateTimeOffset.UtcNow);
        pending.ShouldContain(x => x.Id == id);
    }
}

