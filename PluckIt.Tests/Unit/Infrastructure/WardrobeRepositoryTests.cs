using System.Net;
using Microsoft.Azure.Cosmos;
using Moq;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class WardrobeRepositoryTests
{
    private const string DatabaseName = "test-db";
    private const string ContainerName = "wardrobe";

    private readonly Mock<CosmosClient> _mockClient = new(MockBehavior.Strict);
    private readonly Mock<Container> _mockContainer = new(MockBehavior.Strict);
    private readonly WardrobeRepository _sut;

    public WardrobeRepositoryTests()
    {
        _mockClient.Setup(c => c.GetContainer(DatabaseName, ContainerName)).Returns(_mockContainer.Object);
        _sut = new WardrobeRepository(_mockClient.Object, DatabaseName, ContainerName);
    }

    private static ClothingItem MakeItem(string id, string userId, int wearCount = 0, params WearEvent[] events) =>
        new()
        {
            Id = id,
            UserId = userId,
            ImageUrl = $"https://cdn/{id}.jpg",
            Brand = "Generic",
            Category = "Tops",
            DateAdded = DateTimeOffset.UtcNow,
            WearCount = wearCount,
            WearEvents = events.ToList(),
        };

    [Fact]
    public void Ctor_RejectsNullClient()
    {
        Should.Throw<ArgumentNullException>(() => new WardrobeRepository(null!, DatabaseName, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullDatabase()
    {
        Should.Throw<ArgumentNullException>(() => new WardrobeRepository(new Mock<CosmosClient>().Object, null!, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullContainer()
    {
        Should.Throw<ArgumentNullException>(() => new WardrobeRepository(new Mock<CosmosClient>().Object, DatabaseName, null!));
    }

    [Fact]
    public async Task GetAllAsync_ReturnsEmptyWhenNoResults()
    {
        var iterator = CosmosTestHelpers.CreateQueryIterator<ClothingItem>(([], null));
        _mockContainer
            .Setup(c => c.GetItemQueryIterator<ClothingItem>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Returns(iterator.Object);

        var actual = await _sut.GetAllAsync("user", new WardrobeQuery());

        actual.Items.Count.ShouldBe(0);
        actual.NextContinuationToken.ShouldBeNull();
    }

    [Fact]
    public async Task GetAllAsync_UsesFiltersAndMaxPageSize()
    {
        QueryDefinition? query = null;
        QueryRequestOptions? queryOptions = null;
        var item = MakeItem("i1", "user");
        var iterator = CosmosTestHelpers.CreateQueryIterator((new[] { item }, "token-1"));

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<ClothingItem>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Callback((QueryDefinition q, string token, QueryRequestOptions options) =>
            {
                query = q;
                queryOptions = options;
            })
            .Returns(iterator.Object);

        var filter = new WardrobeQuery
        {
            Category = "Tops",
            Brand = "BrandX",
            Condition = ItemCondition.Good,
            Tags = ["casual", "basic"],
            AestheticTags = ["minimal"],
            PriceMin = 10,
            PriceMax = 100,
            MinWears = 0,
            MaxWears = 20,
            SortField = WardrobeSortField.WearCount,
            SortDir = "asc",
            PageSize = 200,
            ContinuationToken = "page-token",
        };

        var actual = await _sut.GetAllAsync("user", filter);

        actual.Items.Count.ShouldBe(1);
        actual.NextContinuationToken.ShouldBe("token-1");
        query.ShouldNotBeNull();
        query!.QueryText.ShouldContain("LOWER(c.category) = LOWER(@category)");
        query.QueryText.ShouldContain("LOWER(c.brand) = LOWER(@brand)");
        query.QueryText.ShouldContain("ARRAY_LENGTH(ARRAY_INTERSECT(c.tags, @tags)) > 0");
        query.QueryText.ShouldContain("c.wearCount >= @minWears");
        query.QueryText.ShouldContain("ORDER BY c.wearCount ASC");
        queryOptions.ShouldNotBeNull();
        queryOptions!.MaxItemCount.ShouldBe(100);
        queryOptions!.PartitionKey.ShouldNotBeNull();
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsNullWhenNotFound()
    {
        _mockContainer
            .Setup(c => c.ReadItemAsync<ClothingItem>("missing", new PartitionKey("user"), null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.NotFound));

        var actual = await _sut.GetByIdAsync("missing", "user", CancellationToken.None);
        actual.ShouldBeNull();
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsItemWhenFound()
    {
        var item = MakeItem("found", "user");
        _mockContainer
            .Setup(c => c.ReadItemAsync<ClothingItem>("found", new PartitionKey("user"), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CosmosTestHelpers.CreateItemResponse(item).Object);

        var actual = await _sut.GetByIdAsync("found", "user", CancellationToken.None);
        actual.ShouldNotBeNull();
        actual!.Id.ShouldBe("found");
    }

    [Fact]
    public async Task UpsertAsync_ForwardsWrite()
    {
        var item = MakeItem("to-save", "user");
        _mockContainer
            .Setup(c => c.UpsertItemAsync(item, new PartitionKey("user"), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CosmosTestHelpers.CreateItemResponse(item).Object);

        await _sut.UpsertAsync(item, CancellationToken.None);

        _mockContainer.Verify(
            c => c.UpsertItemAsync(item, new PartitionKey("user"), null, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task DeleteAsync_NotFoundIsSwallowed()
    {
        _mockContainer
            .Setup(c => c.DeleteItemAsync<ClothingItem>("missing", new PartitionKey("user"), null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.NotFound));

        await _sut.DeleteAsync("missing", "user", CancellationToken.None);

        _mockContainer.Verify(
            c => c.DeleteItemAsync<ClothingItem>("missing", new PartitionKey("user"), null, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task AppendWearEventAsync_ReturnsExistingWhenIdempotent()
    {
        var existing = MakeItem("item", "user", wearCount: 2, new WearEvent(DateTimeOffset.UtcNow, "run", null));
        existing.LastWearActionId = "dupe-evt";

        _mockContainer
            .Setup(c => c.ReadItemAsync<ClothingItem>(
                "item",
                new PartitionKey("user"),
                null,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(CosmosTestHelpers.CreateItemResponse(existing).Object);

        var actual = await _sut.AppendWearEventAsync("item", "user", new WearEvent(DateTimeOffset.UtcNow, "work", null), "dupe-evt");

        actual.ShouldNotBeNull();
        actual!.WearCount.ShouldBe(2);
        _mockContainer.Verify(
            c => c.PatchItemAsync<ClothingItem>(
                It.IsAny<string>(),
                It.IsAny<PartitionKey>(),
                It.IsAny<IReadOnlyList<PatchOperation>>(),
                It.IsAny<PatchItemRequestOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task AppendWearEventAsync_AppendsAndTrimsEvents()
    {
        var old = MakeItem(
            "item",
            "user",
            wearCount: 2,
            new WearEvent(DateTimeOffset.UtcNow.AddHours(-1), "old", null),
            new WearEvent(DateTimeOffset.UtcNow.AddHours(-2), "older", null),
            new WearEvent(DateTimeOffset.UtcNow.AddHours(-3), "oldest", null));
        var newEvent = new WearEvent(DateTimeOffset.UtcNow, "new", null);
        old.WearEvents = new List<WearEvent>(old.WearEvents) { newEvent };
        var updatedResponse = CosmosTestHelpers.CreateItemResponse(new ClothingItem
        {
            Id = old.Id,
            UserId = old.UserId,
        });

        _mockContainer
            .Setup(c => c.ReadItemAsync<ClothingItem>("item", new PartitionKey("user"), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CosmosTestHelpers.CreateItemResponse(old).Object);

        List<PatchOperation>? patchOperations = null;
        _mockContainer
            .Setup(c => c.PatchItemAsync<ClothingItem>(
                "item",
                new PartitionKey("user"),
                It.IsAny<IReadOnlyList<PatchOperation>>(),
                null,
                It.IsAny<CancellationToken>()))
            .Callback<string, PartitionKey, IReadOnlyList<PatchOperation>, PatchItemRequestOptions, CancellationToken>((_, _, ops, _, _) =>
            {
                patchOperations = ops.ToList();
            })
            .ReturnsAsync(updatedResponse.Object);

        var actual = await _sut.AppendWearEventAsync("item", "user", newEvent, maxEvents: 2, cancellationToken: CancellationToken.None);

        actual.ShouldNotBeNull();
        patchOperations.ShouldNotBeNull();
        patchOperations!.Count.ShouldBe(3);
        patchOperations.ShouldContain(op => op.Path == "/wearEvents");
        patchOperations.ShouldContain(op => op.Path == "/wearCount");
        patchOperations.ShouldContain(op => op.Path == "/lastWornAt");
    }

    [Fact]
    public async Task GetDraftsAsync_ReturnsPage()
    {
        var draft = MakeItem("draft", "user");
        draft.DraftStatus = DraftStatus.Processing;
        var iterator = CosmosTestHelpers.CreateQueryIterator((new[] { draft }, "draft-token"));
        _mockContainer
            .Setup(c => c.GetItemQueryIterator<ClothingItem>(
                It.IsAny<QueryDefinition>(),
                It.IsAny<string>(),
                It.IsAny<QueryRequestOptions>()))
            .Returns(iterator.Object);

        var actual = await _sut.GetDraftsAsync("user", pageSize: 60, continuationToken: "next");

        actual.Items.Count.ShouldBe(1);
        actual.NextContinuationToken.ShouldBe("draft-token");
    }

    [Fact]
    public async Task GetDraftsAsync_ClampsPageSizeToOneToFifty()
    {
        QueryRequestOptions? queryOptions = null;
        var iterator = CosmosTestHelpers.CreateQueryIterator<ClothingItem>(([], null));

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<ClothingItem>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Callback((QueryDefinition _, string _, QueryRequestOptions options) => queryOptions = options)
            .Returns(iterator.Object);

        var actual = await _sut.GetDraftsAsync("user", pageSize: 80);

        actual.Items.Count.ShouldBe(0);
        queryOptions.ShouldNotBeNull();
        queryOptions!.MaxItemCount.ShouldBe(50);
    }

    [Fact]
    public async Task SetDraftTerminalAsync_SetsReadyStateAndMetadata()
    {
        var metadata = new ClothingMetadata(
            "Brand",
            "Category",
            ["tag1", "tag2"],
            [new ClothingColour("Black", "#000")]);
        PatchItemRequestOptions? patchOptions = null;
        _mockContainer
            .Setup(c => c.PatchItemAsync<ClothingItem>(
                "item",
                new PartitionKey("user"),
                It.IsAny<IReadOnlyList<PatchOperation>>(),
                It.IsAny<PatchItemRequestOptions>(),
                It.IsAny<CancellationToken>()))
            .Callback<string, PartitionKey, IReadOnlyList<PatchOperation>, PatchItemRequestOptions, CancellationToken>((_, _, _, options, _) =>
            {
                patchOptions = options;
            })
            .ReturnsAsync(CosmosTestHelpers.CreateItemResponse(new ClothingItem { Id = "item", UserId = "user" }).Object);

        var actual = await _sut.SetDraftTerminalAsync("item", "user", DraftStatus.Ready, "https://cdn/final.jpg", metadata, null, CancellationToken.None);

        actual.ShouldBeTrue();
        patchOptions.ShouldNotBeNull();
        patchOptions!.FilterPredicate.ShouldContain("draftStatus");
    }

    [Fact]
    public async Task SetDraftTerminalAsync_ReturnsFalseWhenPreconditionFails()
    {
        _mockContainer
            .Setup(c => c.PatchItemAsync<ClothingItem>(
                "item",
                new PartitionKey("user"),
                It.IsAny<IReadOnlyList<PatchOperation>>(),
                It.IsAny<PatchItemRequestOptions>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.PreconditionFailed));

        var actual = await _sut.SetDraftTerminalAsync("item", "user", DraftStatus.Failed, null, null, "error", CancellationToken.None);
        actual.ShouldBeFalse();
    }

    [Fact]
    public async Task AcceptDraftAsync_ReturnsItemWhenPatchSucceeds()
    {
        var accepted = MakeItem("item", "user");
        var response = CosmosTestHelpers.CreateItemResponse(accepted);
        _mockContainer
            .Setup(c => c.PatchItemAsync<ClothingItem>(
                "item",
                new PartitionKey("user"),
                It.IsAny<IReadOnlyList<PatchOperation>>(),
                It.IsAny<PatchItemRequestOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(response.Object);

        var actual = await _sut.AcceptDraftAsync("item", "user", DateTimeOffset.UtcNow);
        actual.ShouldNotBeNull();
        actual!.Id.ShouldBe("item");
    }

    [Fact]
    public async Task AcceptDraftAsync_ReturnsNullWhenPreconditionFails()
    {
        _mockContainer
            .Setup(c => c.PatchItemAsync<ClothingItem>(
                "item",
                new PartitionKey("user"),
                It.IsAny<IReadOnlyList<PatchOperation>>(),
                It.IsAny<PatchItemRequestOptions>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.PreconditionFailed));

        var actual = await _sut.AcceptDraftAsync("item", "user", DateTimeOffset.UtcNow);
        actual.ShouldBeNull();
    }

    [Fact]
    public async Task GetByDraftStatusAsync_ReturnsAllPagesUntilLimit()
    {
        var firstPage = new[] { MakeItem("d1", "user"), MakeItem("d2", "user") };
        var secondPage = new[] { MakeItem("d3", "user2") };
        var iterator = CosmosTestHelpers.CreateQueryIterator(
            (firstPage, null),
            (secondPage, null));

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<ClothingItem>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Returns(iterator.Object);

        var actual = await _sut.GetByDraftStatusAsync(DraftStatus.Processing, DateTimeOffset.UtcNow.AddDays(-1), maxItems: 3);

        actual.Count.ShouldBe(3);
    }
}
