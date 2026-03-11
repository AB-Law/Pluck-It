using System.Net;
using System.Text.Json;
using Shouldly;
using PluckIt.Core;
using PluckIt.Functions.Functions;
using PluckIt.Functions.Serialization;
using PluckIt.Tests.Fakes;
using PluckIt.Tests.Helpers;
using Xunit;

namespace PluckIt.Tests.Unit.Functions;

/// <summary>
/// Unit tests for <see cref="CollectionFunctions"/>.
/// </summary>
[Trait("Category", "Unit")]
public sealed class CollectionFunctionsTests
{
    private const string OwnerId = "owner-001";
    private const string MemberId = "member-009";

    private static Collection MakeCollection(
        string id        = "col-1",
        string? ownerId  = null,
        bool isPublic    = false,
        string[]? members = null) => new()
    {
        Id            = id,
        OwnerId       = ownerId ?? OwnerId,
        Name          = $"Collection {id}",
        IsPublic      = isPublic,
        MemberUserIds = members ?? [],
        ClothingItemIds = [],
        CreatedAt     = DateTimeOffset.UtcNow
    };

    private static CollectionFunctions CreateSut(InMemoryCollectionRepository? repo = null, string userId = OwnerId)
    {
        var cfg = TestConfiguration.WithDevUser(userId);
        return new CollectionFunctions(
            repo ?? new InMemoryCollectionRepository(),
            TestFactory.CreateTokenValidator(cfg),
            cfg,
            TestFactory.NullLogger<CollectionFunctions>());
    }

    // ── GetCollections ───────────────────────────────────────────────────────

    [Fact]
    public async Task GetCollections_ReturnsMergedOwnedAndJoined()
    {
        var owned  = MakeCollection("owned-1");
        var joined = MakeCollection("joined-1", ownerId: "other-user", members: [OwnerId]);
        var repo   = new InMemoryCollectionRepository().WithCollections(owned, joined);
        var sut    = CreateSut(repo);

        var result = await sut.GetCollections(
            TestRequest.Get("http://localhost/api/collections"), CancellationToken.None)
            as TestHttpResponseData;

        var body = result!.ReadBodyAsString();
        body.ShouldContain("owned-1");
        body.ShouldContain("joined-1");
    }

    [Fact]
    public async Task GetCollections_DeduplicatesOwnedFromJoined()
    {
        // Edge: owner is also listed in memberUserIds of their own collection
        var col = MakeCollection("col-1", members: [OwnerId]);
        var repo = new InMemoryCollectionRepository().WithCollections(col);
        var sut  = CreateSut(repo);

        var result = await sut.GetCollections(
            TestRequest.Get("http://localhost/api/collections"), CancellationToken.None)
            as TestHttpResponseData;

        var items = JsonSerializer.Deserialize<List<Collection>>(result!.ReadBodyAsString(),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        items!.Count.ShouldBe(1);
    }

    [Fact]
    public async Task GetCollections_Returns401WhenUnauthenticated()
    {
        var cfg = TestConfiguration.Unauthenticated();
        var sut = new CollectionFunctions(
            new InMemoryCollectionRepository(),
            TestFactory.CreateTokenValidator(cfg),
            cfg,
            TestFactory.NullLogger<CollectionFunctions>());

        var result = await sut.GetCollections(
            TestRequest.Get("http://localhost/api/collections"), CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    // ── CreateCollection ─────────────────────────────────────────────────────

    [Fact]
    public async Task CreateCollection_PersistsAndReturns201()
    {
        var repo = new InMemoryCollectionRepository();
        var sut  = CreateSut(repo);
        var body = new Collection { Name = "Summer 2026", IsPublic = false };
        var json = JsonSerializer.Serialize(body, PluckItJsonContext.Default.Collection);

        var result = await sut.CreateCollection(
            TestRequest.Post("http://localhost/api/collections", json), CancellationToken.None)
            as TestHttpResponseData;

        result!.StatusCode.ShouldBe(HttpStatusCode.Created);
        repo.AllCollections.Count.ShouldBe(1);
        repo.AllCollections[0].OwnerId.ShouldBe(OwnerId);
        repo.AllCollections[0].Name.ShouldBe("Summer 2026");
    }

    [Fact]
    public async Task CreateCollection_Returns400WhenNameMissing()
    {
        var body = new Collection { Name = "  " };
        var json = JsonSerializer.Serialize(body, PluckItJsonContext.Default.Collection);
        var result = await CreateSut().CreateCollection(
            TestRequest.Post("http://localhost/api/collections", json), CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    // ── DeleteCollection ─────────────────────────────────────────────────────

    [Fact]
    public async Task DeleteCollection_OwnerCanDelete()
    {
        var col  = MakeCollection("del-col");
        var repo = new InMemoryCollectionRepository().WithCollections(col);
        var sut  = CreateSut(repo);

        var result = await sut.DeleteCollection(
            TestRequest.Delete("http://localhost/api/collections/del-col"), "del-col", CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        repo.AllCollections.ShouldBeEmpty();
    }

    [Fact]
    public async Task DeleteCollection_NonOwnerSilentlyNoOps()
    {
        // The function does not enforce ownership at the HTTP layer — it returns 204 regardless.
        // Security is enforced at the Cosmos partition key (ownerId partition) in production.
        // The in-memory fake mimics this: DeleteAsync only removes matching ownerId rows.
        var col  = MakeCollection("col-x", ownerId: "someone-else");
        var repo = new InMemoryCollectionRepository().WithCollections(col);
        var sut  = CreateSut(repo, userId: OwnerId);

        var result = await sut.DeleteCollection(
            TestRequest.Delete("http://localhost/api/collections/col-x"), "col-x", CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        // Collection still exists — non-owner partition delete was a no-op
        repo.AllCollections.Count.ShouldBe(1);
    }

    // ── JoinCollection ───────────────────────────────────────────────────────

    [Fact]
    public async Task JoinCollection_AddsUserToMembers()
    {
        var col  = MakeCollection("public-col", isPublic: true);
        var repo = new InMemoryCollectionRepository().WithCollections(col);
        var sut  = CreateSut(repo, userId: MemberId);

        var result = await sut.JoinCollection(
            TestRequest.Post("http://localhost/api/collections/public-col/join", ""),
            "public-col",
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        repo.AllCollections[0].MemberUserIds.ShouldContain(MemberId);
    }

    [Fact]
    public async Task JoinCollection_Returns403ForPrivateCollection()
    {
        var col  = MakeCollection("private-col", isPublic: false);
        var repo = new InMemoryCollectionRepository().WithCollections(col);
        var sut  = CreateSut(repo, userId: MemberId);

        var result = await sut.JoinCollection(
            TestRequest.Post("http://localhost/api/collections/private-col/join", ""),
            "private-col",
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ── AddItemToCollection / RemoveItemFromCollection ────────────────────────

    [Fact]
    public async Task AddItemToCollection_AppendsItemId()
    {
        var col  = MakeCollection("col-items");
        var repo = new InMemoryCollectionRepository().WithCollections(col);
        var sut  = CreateSut(repo);
        var json = """{"itemId":"item-abc"}""";

        var result = await sut.AddItemToCollection(
            TestRequest.Post("http://localhost/api/collections/col-items/items", json),
            "col-items",
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        repo.AllCollections[0].ClothingItemIds.ShouldContain("item-abc");
    }

    [Fact]
    public async Task RemoveItemFromCollection_RemovesItemId()
    {
        var col  = MakeCollection("col-remove");
        col.ClothingItemIds = ["item-xyz"];
        var repo = new InMemoryCollectionRepository().WithCollections(col);
        var sut  = CreateSut(repo);

        var result = await sut.RemoveItemFromCollection(
            TestRequest.Delete("http://localhost/api/collections/col-remove/items/item-xyz"),
            "col-remove",
            "item-xyz",
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        repo.AllCollections[0].ClothingItemIds.ShouldNotContain("item-xyz");
    }
}
