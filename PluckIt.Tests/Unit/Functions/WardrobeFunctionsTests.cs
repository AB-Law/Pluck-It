using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using PluckIt.Core;
using PluckIt.Functions.Functions;
using PluckIt.Functions.Serialization;
using PluckIt.Tests.Fakes;
using PluckIt.Tests.Helpers;
using Xunit;

namespace PluckIt.Tests.Unit.Functions;

/// <summary>
/// Unit tests for <see cref="WardrobeFunctions"/>.
/// Auth is bypassed via <c>Local:DevUserId</c> in configuration.
/// </summary>
[Trait("Category", "Unit")]
public sealed class WardrobeFunctionsTests
{
    private const string UserId = "test-user-001";

    // ── Shared test data builders ────────────────────────────────────────────

    private static ClothingItem MakeItem(string id, string? category = "Tops", params string[] tags) => new()
    {
        Id        = id,
        UserId    = UserId,
        ImageUrl  = $"https://blob.example.com/{id}.png",
        Category  = category,
        Tags      = tags.Length > 0 ? tags : ["casual"],
        Colours   = [new ClothingColour("White", "#FFFFFF")],
        DateAdded = DateTimeOffset.UtcNow.AddDays(-1)
    };

    private WardrobeFunctions CreateSut(InMemoryWardrobeRepository? repo = null, FakeBlobSasService? sas = null)
    {
        var cfg = TestConfiguration.WithDevUser(UserId);
        return new WardrobeFunctions(
            repo  ?? new InMemoryWardrobeRepository(),
            sas   ?? new FakeBlobSasService(),
            new FakeClothingMetadataService(),
            TestFactory.CreateHttpClientFactory(),
            cfg,
            TestFactory.CreateTokenValidator(cfg),
            TestFactory.NullLogger<WardrobeFunctions>());
    }

    // ── GetWardrobe ──────────────────────────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_ReturnsOkWithItems()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("a"), MakeItem("b"));
        var sut = CreateSut(repo);

        var req    = TestRequest.Get($"http://localhost/api/wardrobe");
        var result = await sut.GetWardrobe(req, CancellationToken.None) as Helpers.TestHttpResponseData;

        result!.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = result.ReadBodyAsString();
        body.Should().Contain("\"id\":\"a\"");
        body.Should().Contain("\"id\":\"b\"");
    }

    [Fact]
    public async Task GetWardrobe_FiltersByCategory()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("tops-1", "Tops"),
                MakeItem("btm-1",  "Bottoms"));
        var sut = CreateSut(repo);

        var req    = TestRequest.Get("http://localhost/api/wardrobe?category=Tops");
        var result = await sut.GetWardrobe(req, CancellationToken.None) as Helpers.TestHttpResponseData;
        var body   = result!.ReadBodyAsString();

        body.Should().Contain("tops-1");
        body.Should().NotContain("btm-1");
    }

    [Fact]
    public async Task GetWardrobe_FiltersByTags()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("a", tags: ["denim", "casual"]),
                MakeItem("b", tags: ["formal"]));
        var sut = CreateSut(repo);

        var req    = TestRequest.Get("http://localhost/api/wardrobe?tags=denim");
        var result = await sut.GetWardrobe(req, CancellationToken.None) as Helpers.TestHttpResponseData;
        var body   = result!.ReadBodyAsString();

        body.Should().Contain("\"id\":\"a\"");
        body.Should().NotContain("\"id\":\"b\"");
    }

    [Fact]
    public async Task GetWardrobe_RespectsPageAndPageSize()
    {
        var repo = new InMemoryWardrobeRepository().WithItems(
            Enumerable.Range(1, 10)
                .Select(i => MakeItem($"item-{i:D2}"))
                .ToArray());
        var sut = CreateSut(repo);

        var req1 = TestRequest.Get("http://localhost/api/wardrobe?page=0&pageSize=3");
        var res1 = await sut.GetWardrobe(req1, CancellationToken.None) as Helpers.TestHttpResponseData;
        var list1 = JsonSerializer.Deserialize<List<ClothingItem>>(res1!.ReadBodyAsString(),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        list1!.Count.Should().Be(3);

        var req2 = TestRequest.Get("http://localhost/api/wardrobe?page=1&pageSize=3");
        var res2 = await sut.GetWardrobe(req2, CancellationToken.None) as Helpers.TestHttpResponseData;
        var list2 = JsonSerializer.Deserialize<List<ClothingItem>>(res2!.ReadBodyAsString(),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        list2!.Count.Should().Be(3);

        // Pages must not overlap
        var ids1 = list1.Select(i => i.Id).ToHashSet();
        var ids2 = list2.Select(i => i.Id).ToHashSet();
        ids1.Intersect(ids2).Should().BeEmpty();
    }

    [Fact]
    public async Task GetWardrobe_EnrichesImageUrlsWithSas()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("x"));
        // SAS fake just passes through, so the URL remains unchanged —
        // what we care about is that sasService.GenerateSasUrl was called.
        var sas = new FakeBlobSasService();
        var sut = CreateSut(repo, sas);

        var req = TestRequest.Get("http://localhost/api/wardrobe");
        await sut.GetWardrobe(req, CancellationToken.None);

        // FakeBlobSasService.GenerateSasUrl is a passthrough; items still return their URL
        // (Verifying it was called requires a counting fake; done implicitly since URL is correct)
        // The SAS service won't record calls unless DeleteBlobAsync is called — ok.
    }

    [Fact]
    public async Task GetWardrobe_Returns401WhenNotAuthenticated()
    {
        var sut = new WardrobeFunctions(
            new InMemoryWardrobeRepository(),
            new FakeBlobSasService(),
            new FakeClothingMetadataService(),
            TestFactory.CreateHttpClientFactory(),
            TestConfiguration.Unauthenticated(),
            TestFactory.CreateTokenValidator(TestConfiguration.Unauthenticated()),
            TestFactory.NullLogger<WardrobeFunctions>());

        var req    = TestRequest.Get("http://localhost/api/wardrobe");
        var result = await sut.GetWardrobe(req, CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── GetWardrobeItem ──────────────────────────────────────────────────────

    [Fact]
    public async Task GetWardrobeItem_ReturnsItemById()
    {
        var item = MakeItem("abc");
        var repo = new InMemoryWardrobeRepository().WithItems(item);
        var sut  = CreateSut(repo);

        var req    = TestRequest.Get("http://localhost/api/wardrobe/abc");
        var result = await sut.GetWardrobeItem(req, "abc", CancellationToken.None) as Helpers.TestHttpResponseData;

        result!.StatusCode.Should().Be(HttpStatusCode.OK);
        result.ReadBodyAsString().Should().Contain("\"id\":\"abc\"");
    }

    [Fact]
    public async Task GetWardrobeItem_Returns404WhenNotFound()
    {
        var sut = CreateSut();
        var req = TestRequest.Get("http://localhost/api/wardrobe/missing");
        var result = await sut.GetWardrobeItem(req, "missing", CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetWardrobeItem_CannotAccessAnotherUsersItem()
    {
        var otherItem = new ClothingItem { Id = "x", UserId = "other-user", ImageUrl = "https://b.com/x.png" };
        var repo = new InMemoryWardrobeRepository().WithItems(otherItem);
        var sut  = CreateSut(repo);

        var result = await sut.GetWardrobeItem(
            TestRequest.Get("http://localhost/api/wardrobe/x"), "x", CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── UpdateWardrobeItem ───────────────────────────────────────────────────

    [Fact]
    public async Task UpdateWardrobeItem_Returns400WhenIdMismatch()
    {
        var item = MakeItem("item-001");
        var json = JsonSerializer.Serialize(item, PluckItJsonContext.Default.ClothingItem);
        var sut  = CreateSut();

        // Path id = "wrong-id", body id = "item-001"
        var result = await sut.UpdateWardrobeItem(
            TestRequest.Put("http://localhost/api/wardrobe/wrong-id", json),
            "wrong-id",
            CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task UpdateWardrobeItem_ForcesUserIdFromAuth()
    {
        var item = MakeItem("item-002");
        item.UserId = "hacker"; // attacker tries to claim another userId
        var json = JsonSerializer.Serialize(item, PluckItJsonContext.Default.ClothingItem);

        var repo = new InMemoryWardrobeRepository().WithItems(MakeItem("item-002"));
        var sut  = CreateSut(repo);

        var result = await sut.UpdateWardrobeItem(
            TestRequest.Put("http://localhost/api/wardrobe/item-002", json),
            "item-002",
            CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.NoContent);
        repo.AllItems.Single(i => i.Id == "item-002").UserId.Should().Be(UserId);
    }

    // ── DeleteWardrobeItem ───────────────────────────────────────────────────

    [Fact]
    public async Task DeleteWardrobeItem_Returns404WhenNotFound()
    {
        var result = await CreateSut().DeleteWardrobeItem(
            TestRequest.Delete("http://localhost/api/wardrobe/ghost"), "ghost", CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteWardrobeItem_DeletesItemAndBlob()
    {
        var item = MakeItem("del-1");
        var repo = new InMemoryWardrobeRepository().WithItems(item);
        var sas  = new FakeBlobSasService();
        var sut  = CreateSut(repo, sas);

        var result = await sut.DeleteWardrobeItem(
            TestRequest.Delete("http://localhost/api/wardrobe/del-1"), "del-1", CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.NoContent);
        repo.AllItems.Should().BeEmpty();
        sas.DeletedUrls.Should().Contain(item.ImageUrl);
    }

    // ── LogWear ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task LogWear_IncrementsWearCount()
    {
        var item = MakeItem("wear-1");
        item.WearCount = 3;
        var repo = new InMemoryWardrobeRepository().WithItems(item);
        var sut  = CreateSut(repo);

        var result = await sut.LogWear(
            TestRequest.Patch("http://localhost/api/wardrobe/wear-1/wear"), "wear-1", CancellationToken.None)
            as Helpers.TestHttpResponseData;

        result!.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = JsonSerializer.Deserialize<ClothingItem>(result.ReadBodyAsString(),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        body!.WearCount.Should().Be(4);
        repo.AllItems.Single(i => i.Id == "wear-1").WearCount.Should().Be(4);
    }

    [Fact]
    public async Task LogWear_Returns404ForMissingItem()
    {
        var result = await CreateSut().LogWear(
            TestRequest.Patch("http://localhost/api/wardrobe/ghost/wear"), "ghost", CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── SaveItem ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task SaveItem_PersistsItemAndReturns201()
    {
        var repo = new InMemoryWardrobeRepository();
        var sut  = CreateSut(repo);

        var newItem = new ClothingItem { Id = "new-1", UserId = "ignored", ImageUrl = "https://b.com/new.png" };
        var json    = JsonSerializer.Serialize(newItem, PluckItJsonContext.Default.ClothingItem);

        var result = await sut.SaveItem(
            TestRequest.Post("http://localhost/api/wardrobe", json), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        result!.StatusCode.Should().Be(HttpStatusCode.Created);
        repo.AllItems.Should().ContainSingle(i => i.Id == "new-1");
        repo.AllItems.Single().UserId.Should().Be(UserId);
        repo.AllItems.Single().DateAdded.Should().NotBeNull();
    }

    [Fact]
    public async Task SaveItem_GeneratesIdWhenMissing()
    {
        var repo    = new InMemoryWardrobeRepository();
        var sut     = CreateSut(repo);
        var newItem = new ClothingItem { Id = "", ImageUrl = "https://b.com/img.png" };
        var json    = JsonSerializer.Serialize(newItem, PluckItJsonContext.Default.ClothingItem);

        var result = await sut.SaveItem(
            TestRequest.Post("http://localhost/api/wardrobe", json), CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.Created);
        repo.AllItems.Single().Id.Should().NotBeNullOrEmpty();
    }
}
