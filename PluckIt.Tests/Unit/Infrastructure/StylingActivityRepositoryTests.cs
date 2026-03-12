using System.Net;
using Microsoft.Azure.Cosmos;
using Moq;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class StylingActivityRepositoryTests
{
    private const string DatabaseName = "test-db";
    private const string ContainerName = "style-activity";

    private readonly Mock<CosmosClient> _mockClient;
    private readonly Mock<Container> _mockContainer;
    private readonly StylingActivityRepository _sut;

    public StylingActivityRepositoryTests()
    {
        _mockClient = new Mock<CosmosClient>(MockBehavior.Strict);
        _mockContainer = new Mock<Container>(MockBehavior.Strict);
        _mockClient.Setup(c => c.GetContainer(DatabaseName, ContainerName))
            .Returns(_mockContainer.Object);

        _sut = new StylingActivityRepository(_mockClient.Object, DatabaseName, ContainerName);
    }

    private static StylingActivityRecord Record(
        string id,
        string userId,
        string? clientEventId = null,
        WearSuggestionStatus status = WearSuggestionStatus.Pending) =>
        new()
        {
            Id = id,
            UserId = userId,
            ItemId = $"item-{id}",
            ClientEventId = clientEventId,
            Status = status,
            ActivityType = StylingActivityType.AddedToStyleBoard,
            OccurredAt = DateTimeOffset.UtcNow,
        };

    [Fact]
    public void Ctor_RejectsNullClient()
    {
        Should.Throw<ArgumentNullException>(() => new StylingActivityRepository(null!, DatabaseName, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullDatabase()
    {
        Should.Throw<ArgumentNullException>(() => new StylingActivityRepository(new Mock<CosmosClient>().Object, null!, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullContainer()
    {
        Should.Throw<ArgumentNullException>(() => new StylingActivityRepository(new Mock<CosmosClient>().Object, DatabaseName, null!));
    }

    [Fact]
    public async Task GetPendingSuggestionsAsync_ReturnsPendingAndNotExpired()
    {
        var userId = "user-1";
        var expected = Record("s1", userId, status: WearSuggestionStatus.Pending);
        var iterator = CosmosTestHelpers.CreateQueryIterator((new[] { expected }, null));

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<StylingActivityRecord>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Returns(iterator.Object);

        var actual = await _sut.GetPendingSuggestionsAsync(userId, DateTimeOffset.UtcNow, 10, CancellationToken.None);

        actual.Count.ShouldBe(1);
        actual[0].Id.ShouldBe(expected.Id);
    }

    [Fact]
    public async Task GetPendingSuggestionsAsync_ClampsMaxResultsToOneToHundred()
    {
        var userId = "user-1";
        var records = new[] { Record("s1", userId), Record("s2", userId) };
        var iterator = CosmosTestHelpers.CreateQueryIterator((records, null));
        QueryRequestOptions? queryOptions = null;

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<StylingActivityRecord>(
                It.IsAny<QueryDefinition>(),
                It.IsAny<string>(),
                It.IsAny<QueryRequestOptions>()))
            .Callback((QueryDefinition _, string _, QueryRequestOptions options) => queryOptions = options)
            .Returns(iterator.Object);

        var actual = await _sut.GetPendingSuggestionsAsync(userId, DateTimeOffset.UtcNow, 1000, CancellationToken.None);

        actual.Count.ShouldBe(2);
        queryOptions.ShouldNotBeNull();
        queryOptions!.MaxItemCount.ShouldBe(100);
    }

    [Fact]
    public async Task GetByClientEventIdAsync_NotFoundReturnsNull()
    {
        var iterator = CosmosTestHelpers.CreateQueryIterator<StylingActivityRecord>(([], null));
        _mockContainer
            .Setup(c => c.GetItemQueryIterator<StylingActivityRecord>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Returns(iterator.Object);

        var actual = await _sut.GetByClientEventIdAsync("user", "missing", CancellationToken.None);

        actual.ShouldBeNull();
    }

    [Fact]
    public async Task GetByClientEventIdAsync_ReturnsRecordWhenFound()
    {
        var record = Record("s-found", "user", clientEventId: "event-1");
        var iterator = CosmosTestHelpers.CreateQueryIterator((new[] { record }, null));
        _mockContainer
            .Setup(c => c.GetItemQueryIterator<StylingActivityRecord>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Returns(iterator.Object);

        var actual = await _sut.GetByClientEventIdAsync("user", "event-1", CancellationToken.None);

        actual.ShouldNotBeNull();
        actual!.Id.ShouldBe(record.Id);
    }

    [Fact]
    public async Task UpdateSuggestionStatusAsync_PatchesStatusAndReturnsUpdatedRecord()
    {
        var existing = Record("s-1", "user", status: WearSuggestionStatus.Pending);
        var readResponse = CosmosTestHelpers.CreateItemResponse(existing);
        var updated = Record("s-1", "user", status: WearSuggestionStatus.Accepted);
        var patchResponse = CosmosTestHelpers.CreateItemResponse(updated);
        List<PatchOperation>? patchOperations = null;

        _mockContainer
            .Setup(c => c.ReadItemAsync<StylingActivityRecord>(
                existing.Id,
                new PartitionKey(existing.UserId),
                null,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(readResponse.Object);

        _mockContainer
            .Setup(c => c.PatchItemAsync<StylingActivityRecord>(
                existing.Id,
                new PartitionKey(existing.UserId),
                It.IsAny<IReadOnlyList<PatchOperation>>(),
                null,
                It.IsAny<CancellationToken>()))
            .Callback<string, PartitionKey, IReadOnlyList<PatchOperation>, PatchItemRequestOptions?, CancellationToken>((_, _, ops, _, _) =>
            {
                patchOperations = ops.ToList();
            })
            .ReturnsAsync(patchResponse.Object);

        var actual = await _sut.UpdateSuggestionStatusAsync(existing.Id, existing.UserId, WearSuggestionStatus.Accepted, "wear-1", CancellationToken.None);

        actual.ShouldNotBeNull();
        actual!.Id.ShouldBe(existing.Id);
        patchOperations.ShouldNotBeNull();
        patchOperations!.ShouldContain(op => op.Path == "/status");
        patchOperations.ShouldContain(op => op.Path == "/lastUpdatedAt");
        patchOperations.ShouldContain(op => op.Path == "/linkedWearEventId");
        patchOperations.ShouldContain(op => op.OperationType == PatchOperationType.Set);
    }

    [Fact]
    public async Task UpdateSuggestionStatusAsync_NotFoundReturnsNull()
    {
        _mockContainer
            .Setup(c => c.ReadItemAsync<StylingActivityRecord>(
                "missing",
                new PartitionKey("user"),
                null,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.NotFound));

        var actual = await _sut.UpdateSuggestionStatusAsync("missing", "user", WearSuggestionStatus.Accepted, null, CancellationToken.None);

        actual.ShouldBeNull();
        _mockContainer.Verify(
            c => c.PatchItemAsync<StylingActivityRecord>(
                It.IsAny<string>(),
                It.IsAny<PartitionKey>(),
                It.IsAny<IReadOnlyList<PatchOperation>>(),
                It.IsAny<PatchItemRequestOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Never);
    }
}
