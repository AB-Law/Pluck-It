using System.Net;
using Microsoft.Azure.Cosmos;
using Moq;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class WearHistoryRepositoryTests
{
    private const string DatabaseName = "test-db";
    private const string ContainerName = "wear-history";

    private readonly Mock<CosmosClient> _mockClient;
    private readonly Mock<Container> _mockContainer;
    private readonly WearHistoryRepository _sut;

    public WearHistoryRepositoryTests()
    {
        _mockClient = new Mock<CosmosClient>(MockBehavior.Strict);
        _mockContainer = new Mock<Container>(MockBehavior.Strict);
        _mockClient.Setup(c => c.GetContainer(DatabaseName, ContainerName))
            .Returns(_mockContainer.Object);
        _sut = new WearHistoryRepository(_mockClient.Object, DatabaseName, ContainerName);
    }

    private static WearHistoryRecord Record(string id, string itemId, string userId, DateTimeOffset? occurredAt = null) =>
        new()
        {
            Id = id,
            ItemId = itemId,
            UserId = userId,
            OccurredAt = occurredAt ?? DateTimeOffset.UtcNow,
            Source = WearLogSources.VaultCard,
        };

    [Fact]
    public void Ctor_RejectsNullClient()
    {
        Should.Throw<ArgumentNullException>(() => new WearHistoryRepository(null!, DatabaseName, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullDatabase()
    {
        Should.Throw<ArgumentNullException>(() => new WearHistoryRepository(new Mock<CosmosClient>().Object, null!, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullContainer()
    {
        Should.Throw<ArgumentNullException>(() => new WearHistoryRepository(new Mock<CosmosClient>().Object, DatabaseName, null!));
    }

    [Fact]
    public async Task AddAsync_ForwardsToCosmos()
    {
        var record = Record("r1", "item", "user");
        _mockContainer
            .Setup(c => c.UpsertItemAsync(record, new PartitionKey("user"), It.IsAny<ItemRequestOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CosmosTestHelpers.CreateItemResponse(record).Object);

        await _sut.AddAsync(record, CancellationToken.None);

        _mockContainer.Verify(
            c => c.UpsertItemAsync(record, new PartitionKey("user"), It.IsAny<ItemRequestOptions>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetByItemAsync_ReturnsAllResultsInDateRange()
    {
        var from = DateTimeOffset.UtcNow.AddDays(-2);
        var to = DateTimeOffset.UtcNow.AddDays(-1);
        var events = new[]
        {
            Record("h1", "item", "user", from.AddHours(1)),
            Record("h2", "item", "user", from.AddHours(2)),
        };
        var iterator = CosmosTestHelpers.CreateQueryIterator((events, null));
        QueryDefinition? query = null;
        QueryRequestOptions? queryOptions = null;

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<WearHistoryRecord>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Callback((QueryDefinition q, string _, QueryRequestOptions options) =>
            {
                query = q;
                queryOptions = options;
            })
            .Returns(iterator.Object);

        var actual = await _sut.GetByItemAsync("item", "user", from, to, 5, CancellationToken.None);

        actual.Count.ShouldBe(2);
        actual.ShouldContain(e => e.Id == "h1");
        actual.ShouldContain(e => e.Id == "h2");
        query.ShouldNotBeNull();
        query!.QueryText.ShouldContain("@from");
        query!.QueryText.ShouldContain("@to");
        queryOptions.ShouldNotBeNull();
        queryOptions!.MaxItemCount.ShouldBe(5);
    }

    [Fact]
    public async Task GetByItemAsync_ClampsMaxResultsToWithinOneToThousand()
    {
        var iterator = CosmosTestHelpers.CreateQueryIterator<WearHistoryRecord>(([], null));
        QueryRequestOptions? queryOptions = null;

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<WearHistoryRecord>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Callback((QueryDefinition _, string _, QueryRequestOptions options) => queryOptions = options)
            .Returns(iterator.Object);

        var actual = await _sut.GetByItemAsync("item", "user", maxResults: 5000, cancellationToken: CancellationToken.None);

        actual.Count.ShouldBe(0);
        queryOptions.ShouldNotBeNull();
        queryOptions!.MaxItemCount.ShouldBe(1000);
    }

    [Fact]
    public async Task GetByItemAsync_UsesMinimumOneForMaxResults()
    {
        var iterator = CosmosTestHelpers.CreateQueryIterator<WearHistoryRecord>(([], null));
        QueryRequestOptions? queryOptions = null;

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<WearHistoryRecord>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Callback((QueryDefinition _, string _, QueryRequestOptions options) => queryOptions = options)
            .Returns(iterator.Object);

        var actual = await _sut.GetByItemAsync("item", "user", maxResults: 0, cancellationToken: CancellationToken.None);

        actual.Count.ShouldBe(0);
        queryOptions.ShouldNotBeNull();
        queryOptions!.MaxItemCount.ShouldBe(1);
    }

  [Fact]
  public async Task GetByItemAsync_StopsFetchingAtClampedMaxResults()
  {
    var events = Enumerable.Range(1, 1100)
      .Select(i => Record($"h{i}", "item", "user"))
      .ToArray();
    var iterator = CosmosTestHelpers.CreateQueryIterator(
      (events.Take(1000).ToArray(), "token-2"),
      (events.Skip(1000).ToArray(), null));
    QueryRequestOptions? queryOptions = null;

    _mockContainer
      .Setup(c => c.GetItemQueryIterator<WearHistoryRecord>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
      .Callback((QueryDefinition _, string _, QueryRequestOptions options) => queryOptions = options)
      .Returns(iterator.Object);

    var actual = await _sut.GetByItemAsync("item", "user", maxResults: 2000, cancellationToken: CancellationToken.None);

    actual.Count.ShouldBe(1000);
    queryOptions.ShouldNotBeNull();
    queryOptions!.MaxItemCount.ShouldBe(1000);
  }
}
