using System.Net;
using Microsoft.Azure.Cosmos;
using Moq;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class CollectionRepositoryTests
{
    private const string DatabaseName = "test-db";
    private const string ContainerName = "collections";

    private readonly Mock<CosmosClient> _mockClient;
    private readonly Mock<Container> _mockContainer;
    private readonly CollectionRepository _sut;

    public CollectionRepositoryTests()
    {
        _mockClient = new Mock<CosmosClient>(MockBehavior.Strict);
        _mockContainer = new Mock<Container>(MockBehavior.Strict);
        _mockClient.Setup(c => c.GetContainer(DatabaseName, ContainerName))
            .Returns(_mockContainer.Object);

        _sut = new CollectionRepository(_mockClient.Object, DatabaseName, ContainerName);
    }

    private static Collection MakeCollection(
        string id,
        string ownerId,
        string[]? members = null,
        string[]? itemIds = null)
    {
        return new Collection
        {
            Id = id,
            OwnerId = ownerId,
            Name = $"Collection {id}",
            MemberUserIds = members ?? [],
            ClothingItemIds = itemIds ?? [],
        };
    }

    [Fact]
    public void Ctor_RejectsNullClient()
    {
        Should.Throw<ArgumentNullException>(() => new CollectionRepository(null!, DatabaseName, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullDatabaseName()
    {
        Should.Throw<ArgumentNullException>(() => new CollectionRepository(new Mock<CosmosClient>().Object, null!, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullContainerName()
    {
        Should.Throw<ArgumentNullException>(() => new CollectionRepository(new Mock<CosmosClient>().Object, DatabaseName, null!));
    }

    [Fact]
    public async Task GetByOwnerAsync_ReturnsCollectionsFromCosmos()
    {
        var ownerId = "owner-1";
        var expected = MakeCollection("c-1", ownerId);
        var iterator = CosmosTestHelpers.CreateQueryIterator((new[] { expected }, null));
        QueryDefinition? queryDefinition = null;
        QueryRequestOptions? queryOptions = null;

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<Collection>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Callback((QueryDefinition q, string c, QueryRequestOptions o) =>
            {
                queryDefinition = q;
                queryOptions = o;
            })
            .Returns(iterator.Object);

        var actual = await _sut.GetByOwnerAsync(ownerId, CancellationToken.None);

        actual.Count.ShouldBe(1);
        actual[0].Id.ShouldBe(expected.Id);
        queryDefinition.ShouldNotBeNull();
        queryDefinition!.QueryText.ShouldContain("ownerId");
        queryOptions.ShouldNotBeNull();
        queryOptions!.PartitionKey.ShouldNotBeNull();
        queryOptions!.MaxItemCount.ShouldBeNull();
    }

    [Fact]
    public async Task GetJoinedByUserAsync_UsesCrossPartitionQuery()
    {
        var userId = "user-join";
        var expected = MakeCollection("c-join", "owner-1", members: ["user-join"]);
        var iterator = CosmosTestHelpers.CreateQueryIterator((new[] { expected }, null));

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<Collection>(It.IsAny<QueryDefinition>(), It.IsAny<string>(), It.IsAny<QueryRequestOptions>()))
            .Returns(iterator.Object);

        var actual = await _sut.GetJoinedByUserAsync(userId, CancellationToken.None);

        actual.Count.ShouldBe(1);
        actual[0].Id.ShouldBe(expected.Id);
    }

    [Fact]
    public async Task GetByIdAsync_NotFoundReturnsNull()
    {
        var ownerId = "owner-1";
        _mockContainer
            .Setup(c => c.ReadItemAsync<Collection>(
                "missing",
                new PartitionKey(ownerId),
                null,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.NotFound));

        var actual = await _sut.GetByIdAsync("missing", ownerId, CancellationToken.None);

        actual.ShouldBeNull();
    }

    [Fact]
    public async Task FindByIdAsync_ReturnsFirstItemFromFirstPage()
    {
        var id = "found-id";
        var expected = MakeCollection(id, "owner-1");
        var iterator = CosmosTestHelpers.CreateQueryIterator((new[] { expected, MakeCollection("other", "owner-2") }, "token"));

        _mockContainer
            .Setup(c => c.GetItemQueryIterator<Collection>(
                It.IsAny<QueryDefinition>(),
                It.IsAny<string>(),
                It.IsAny<QueryRequestOptions>()))
            .Returns(iterator.Object);

        var actual = await _sut.FindByIdAsync(id, CancellationToken.None);

        actual.ShouldNotBeNull();
        actual!.Id.ShouldBe(expected.Id);
    }

    [Fact]
    public async Task UpsertAsync_ReturnsResource()
    {
        var collection = MakeCollection("c-save", "owner-2");
        var response = CosmosTestHelpers.CreateItemResponse(collection);

        _mockContainer
            .Setup(c => c.UpsertItemAsync(
                collection,
                new PartitionKey(collection.OwnerId),
                null,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(response.Object);

        var actual = await _sut.UpsertAsync(collection, CancellationToken.None);

        actual.ShouldBe(collection);
    }

    [Fact]
    public async Task DeleteAsync_NotFoundIsSwallowed()
    {
        _mockContainer
            .Setup(c => c.DeleteItemAsync<Collection>(
                "delete-me",
                new PartitionKey("owner"),
                null,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.NotFound));

        await _sut.DeleteAsync("delete-me", "owner", CancellationToken.None);

        _mockContainer.Verify(
            c => c.DeleteItemAsync<Collection>("delete-me", new PartitionKey("owner"), null, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task AddMemberAsync_ThrowsWhenCollectionMissing()
    {
        _mockContainer
            .Setup(c => c.ReadItemAsync<Collection>(
                "c",
                new PartitionKey("owner"),
                null,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.NotFound));

        await Should.ThrowAsync<InvalidOperationException>(() =>
            _sut.AddMemberAsync("c", "owner", "new-user", CancellationToken.None));
    }

    [Fact]
    public async Task AddMemberAsync_IdempotentWhenMemberAlreadyExists()
    {
        var collection = MakeCollection("c", "owner", members: ["existing"]);
        var response = CosmosTestHelpers.CreateItemResponse(collection);

        _mockContainer
            .Setup(c => c.ReadItemAsync<Collection>("c", new PartitionKey("owner"), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(response.Object);

        _mockContainer.Setup(c => c.UpsertItemAsync(It.IsAny<Collection>(), It.IsAny<PartitionKey>(), null, It.IsAny<CancellationToken>()))
            .Throws(new InvalidOperationException("Upsert should not be called"));

        await _sut.AddMemberAsync("c", "owner", "existing", CancellationToken.None);

        _mockContainer.Verify(c => c.ReadItemAsync<Collection>("c", new PartitionKey("owner"), null, It.IsAny<CancellationToken>()), Times.Once);
        _mockContainer.Verify(c => c.UpsertItemAsync(It.IsAny<Collection>(), It.IsAny<PartitionKey>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AddItemAsync_AppendsOnlyWhenMissing()
    {
        var collection = MakeCollection("c", "owner", itemIds: ["item-a"]);
        var response = CosmosTestHelpers.CreateItemResponse(collection);
        var upsertResponse = CosmosTestHelpers.CreateItemResponse(collection);
        Collection? upserted = null;

        _mockContainer
            .Setup(c => c.ReadItemAsync<Collection>("c", new PartitionKey("owner"), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(response.Object);
        _mockContainer
            .Setup(c => c.UpsertItemAsync(
                It.IsAny<Collection>(),
                new PartitionKey("owner"),
                null,
                It.IsAny<CancellationToken>()))
            .Callback<Collection, PartitionKey?, ItemRequestOptions?, CancellationToken>((item, _, _, _) => upserted = item)
            .ReturnsAsync(upsertResponse.Object);

        await _sut.AddItemAsync("c", "owner", "item-b", CancellationToken.None);
        upserted.ShouldNotBeNull();
        upserted!.ClothingItemIds.ShouldContain("item-a");
        upserted.ClothingItemIds.ShouldContain("item-b");
        upserted.ClothingItemIds.Count.ShouldBe(2);

        _mockContainer.Verify(
            c => c.UpsertItemAsync(It.IsAny<Collection>(), new PartitionKey("owner"), null, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task AddItemAsync_IdempotentWhenItemAlreadyInCollection()
    {
        var collection = MakeCollection("c", "owner", itemIds: ["item-a"]);
        var response = CosmosTestHelpers.CreateItemResponse(collection);

        _mockContainer
            .Setup(c => c.ReadItemAsync<Collection>("c", new PartitionKey("owner"), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(response.Object);
        _mockContainer.Setup(c => c.UpsertItemAsync(It.IsAny<Collection>(), It.IsAny<PartitionKey>(), null, It.IsAny<CancellationToken>()))
            .Throws(new InvalidOperationException("Upsert should not be called"));

        await _sut.AddItemAsync("c", "owner", "item-a", CancellationToken.None);

        _mockContainer.Verify(
            c => c.ReadItemAsync<Collection>("c", new PartitionKey("owner"), null, It.IsAny<CancellationToken>()),
            Times.Once);
        _mockContainer.Verify(
            c => c.UpsertItemAsync(It.IsAny<Collection>(), new PartitionKey("owner"), null, It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task RemoveMemberAsync_NoopWhenCollectionMissing()
    {
        _mockContainer
            .Setup(c => c.ReadItemAsync<Collection>(
                "c",
                new PartitionKey("owner"),
                null,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.NotFound));

        await _sut.RemoveMemberAsync("c", "owner", "member", CancellationToken.None);

        _mockContainer.Verify(
            c => c.ReadItemAsync<Collection>("c", new PartitionKey("owner"), null, It.IsAny<CancellationToken>()),
            Times.Once);
        _mockContainer.Verify(
            c => c.UpsertItemAsync(
                It.IsAny<Collection>(),
                new PartitionKey("owner"),
                null,
                It.IsAny<CancellationToken>()),
            Times.Never);
    }

}
