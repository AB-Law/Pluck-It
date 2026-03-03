using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shouldly;
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
/// Response shape is now a paged envelope: <c>{ items: [...], nextContinuationToken: ... }</c>.
/// </summary>
[Trait("Category", "Unit")]
public sealed class WardrobeFunctionsTests
{
    private const string UserId = "test-user-001";

    // ── Shared test data builders ────────────────────────────────────────────

    private static ClothingItem MakeItem(
        string id,
        string? category  = "Tops",
        string? brand     = null,
        ItemCondition? condition = null,
        decimal? price    = null,
        int wearCount     = 0,
        string[]? tags    = null,
        string[]? aestheticTags = null,
        DateTimeOffset? dt = null) => new()
    {
        Id          = id,
        UserId      = UserId,
        ImageUrl    = $"https://blob.example.com/{id}.png",
        Category    = category,
        Brand       = brand,
        Condition   = condition,
        Price       = price.HasValue ? new ClothingPrice { Amount = price.Value, OriginalCurrency = "USD" } : null,
        WearCount   = wearCount,
        Tags        = tags  ?? ["casual"],
        AestheticTags = aestheticTags,
        Colours     = [new ClothingColour("White", "#FFFFFF")],
        DateAdded   = dt ?? DateTimeOffset.UtcNow.AddDays(-1),
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

    /// <summary>Deserializes the paged envelope from the response body.</summary>
    private static (IReadOnlyList<ClothingItem> Items, string? NextToken) ParseEnvelope(string json)
    {
        var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var env  = JsonSerializer.Deserialize<WardrobePagedResult>(json, opts)!;
        return (env.Items, env.NextContinuationToken);
    }

    // ── GetWardrobe — basic ──────────────────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_ReturnsOkWithItems()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("a"), MakeItem("b"));
        var sut = CreateSut(repo);

        var req    = TestRequest.Get("http://localhost/api/wardrobe");
        var result = await sut.GetWardrobe(req, CancellationToken.None) as Helpers.TestHttpResponseData;

        result!.StatusCode.ShouldBe(HttpStatusCode.OK);
        var (items, _) = ParseEnvelope(result.ReadBodyAsString());
        items.Select(i => i.Id).ShouldBe(new[] { "a", "b" }, ignoreOrder: true);
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

        var result = await sut.GetWardrobe(TestRequest.Get("http://localhost/api/wardrobe"), CancellationToken.None);
        result.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetWardrobe_EnrichesImageUrlsWithSas()
    {
        var repo = new InMemoryWardrobeRepository().WithItems(MakeItem("x"));
        var sas  = new FakeBlobSasService();
        var sut  = CreateSut(repo, sas);

        var result = await sut.GetWardrobe(TestRequest.Get("http://localhost/api/wardrobe"), CancellationToken.None) as Helpers.TestHttpResponseData;
        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        var item = items.ShouldHaveSingleItem();
        sas.GenerateSasUrlCallCount.ShouldBe(1);
        item.ImageUrl.ShouldEndWith("?sas=fake");
    }

    // ── GetWardrobe — category filter ────────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_FiltersByCategory()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("tops-1", "Tops"), MakeItem("btm-1", "Bottoms"));
        var sut = CreateSut(repo);

        var result = await sut.GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?category=Tops"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("tops-1");
    }

    [Fact]
    public async Task GetWardrobe_CategoryIsCaseInsensitive()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("t", category: "TOPS"));
        var sut = CreateSut(repo);

        var result = await sut.GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?category=tops"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        // Category stored as "TOPS" but queried as "tops" — Cosmos uses LOWER() so InMemory should too
        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem();
    }

    // ── GetWardrobe — tags filter ────────────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_FiltersByTags()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("a", tags: ["denim", "casual"]),
                MakeItem("b", tags: ["formal"]));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?tags=denim"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("a");
    }

    [Fact]
    public async Task GetWardrobe_TagsFilterMatchesMultipleItems()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("a", tags: ["denim"]),
                MakeItem("b", tags: ["linen"]),
                MakeItem("c", tags: ["denim", "ripped"]));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?tags=denim"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.Select(i => i.Id).ShouldBe(new[] { "a", "c" }, ignoreOrder: true);
    }

    // ── GetWardrobe — brand filter ───────────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_FiltersByBrand()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("a", brand: "Nike"), MakeItem("b", brand: "Adidas"));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?brand=Nike"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("a");
    }

    [Fact]
    public async Task GetWardrobe_BrandFilterExcludesNonMatch()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("a", brand: "Zara"), MakeItem("b", brand: "H&M"));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?brand=Zara"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldAllBe(i => i.Id == "a");
    }

    // ── GetWardrobe — condition filter ───────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_FiltersByCondition()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("new-1",  condition: ItemCondition.New),
                MakeItem("good-1", condition: ItemCondition.Good));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?condition=New"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Condition.ShouldBe(ItemCondition.New);
    }

    [Fact]
    public async Task GetWardrobe_ConditionFilterExcludesOtherGrades()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("x", condition: ItemCondition.Excellent),
                MakeItem("y", condition: ItemCondition.Fair));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?condition=Fair"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("y");
    }

    // ── GetWardrobe — price range filter ─────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_FiltersByPriceMin()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("cheap", price: 20m), MakeItem("exp", price: 200m));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?priceMin=100"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("exp");
    }

    [Fact]
    public async Task GetWardrobe_FiltersByPriceMax()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("cheap", price: 20m), MakeItem("exp", price: 200m));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?priceMax=50"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("cheap");
    }

    [Fact]
    public async Task GetWardrobe_PriceRangeIsInclusive()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("a", price: 50m),
                MakeItem("b", price: 100m),
                MakeItem("c", price: 150m));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?priceMin=50&priceMax=100"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.Select(i => i.Id).ShouldBe(new[] { "a", "b" }, ignoreOrder: true);
    }

    [Fact]
    public async Task GetWardrobe_ExcludesItemsWithNoPriceWhenPriceFilterApplied()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("no-price"), MakeItem("has-price", price: 80m));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?priceMin=10"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("has-price");
    }

    // ── GetWardrobe — wearCount range filter ─────────────────────────────────

    [Fact]
    public async Task GetWardrobe_FiltersByMinWears()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("new",  wearCount: 0), MakeItem("worn", wearCount: 5));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?minWears=3"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("worn");
    }

    [Fact]
    public async Task GetWardrobe_FiltersByMaxWears()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("a", wearCount: 2), MakeItem("b", wearCount: 10));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?maxWears=5"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("a");
    }

    [Fact]
    public async Task GetWardrobe_WearCountRangeIsInclusive()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("x", wearCount: 1),
                MakeItem("y", wearCount: 5),
                MakeItem("z", wearCount: 10));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?minWears=1&maxWears=5"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.Select(i => i.Id).ShouldBe(new[] { "x", "y" }, ignoreOrder: true);
    }

    // ── GetWardrobe — range validation ───────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_Returns400WhenPriceMinExceedsPriceMax()
    {
        var result = await CreateSut().GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?priceMin=200&priceMax=50"),
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetWardrobe_Returns400WhenMinWearsExceedsMaxWears()
    {
        var result = await CreateSut().GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?minWears=10&maxWears=2"),
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetWardrobe_AllowsEqualPriceMinAndPriceMax()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("a", price: 50m), MakeItem("b", price: 100m));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?priceMin=50&priceMax=50"),
            CancellationToken.None) as Helpers.TestHttpResponseData;

        result!.StatusCode.ShouldBe(HttpStatusCode.OK);
        var (items, _) = ParseEnvelope(result.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("a");
    }

    // ── GetWardrobe — aesthetic tags filter ──────────────────────────────────

    [Fact]
    public async Task GetWardrobe_FiltersByAestheticTags()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("luxe",   aestheticTags: ["Luxe", "Formal"]),
                MakeItem("casual", aestheticTags: ["Casual"]));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?aestheticTags=Luxe"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("luxe");
    }

    // ── GetWardrobe — sort ───────────────────────────────────────────────────

    [Theory]
    [InlineData("wearCount", "desc", new[] { "c", "b", "a" })] // most worn first
    [InlineData("wearCount", "asc",  new[] { "a", "b", "c" })] // least worn first
    public async Task GetWardrobe_SortsByWearCount(string sortField, string sortDir, string[] expectedOrder)
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("a", wearCount: 1),
                MakeItem("b", wearCount: 5),
                MakeItem("c", wearCount: 10));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get($"http://localhost/api/wardrobe?sortField={sortField}&sortDir={sortDir}"),
            CancellationToken.None) as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.Select(i => i.Id).ShouldBe(expectedOrder);
    }

    [Theory]
    [InlineData("price.amount", "desc", new[] { "expensive", "mid", "cheap" })]
    [InlineData("price.amount", "asc",  new[] { "cheap", "mid", "expensive" })]
    public async Task GetWardrobe_SortsByPrice(string sortField, string sortDir, string[] expectedOrder)
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("cheap",     price: 10m),
                MakeItem("mid",       price: 50m),
                MakeItem("expensive", price: 200m));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get($"http://localhost/api/wardrobe?sortField={sortField}&sortDir={sortDir}"),
            CancellationToken.None) as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.Select(i => i.Id).ShouldBe(expectedOrder);
    }

    [Fact]
    public async Task GetWardrobe_DefaultSortIsDateAddedDesc()
    {
        var now  = DateTimeOffset.UtcNow;
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("old",  dt: now.AddDays(-10)),
                MakeItem("new",  dt: now.AddDays(-1)),
                MakeItem("mid",  dt: now.AddDays(-5)));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe"), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.Select(i => i.Id).ShouldBe(new[] { "new", "mid", "old" });
    }

    [Fact]
    public async Task GetWardrobe_InvalidSortFieldFallsBackToDateAdded()
    {
        var now  = DateTimeOffset.UtcNow;
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("a", dt: now.AddDays(-2)),
                MakeItem("b", dt: now.AddDays(-1)));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?sortField=__evil__injection__"),
            CancellationToken.None) as Helpers.TestHttpResponseData;

        result!.StatusCode.ShouldBe(HttpStatusCode.OK);
        var (items, _) = ParseEnvelope(result.ReadBodyAsString());
        items.Select(i => i.Id).ShouldBe(new[] { "b", "a" }); // still sorted newest first
    }

    // ── GetWardrobe — pagination ─────────────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_PaginatesWithContinuationToken()
    {
        var repo = new InMemoryWardrobeRepository().WithItems(
            Enumerable.Range(1, 10)
                .Select(i => MakeItem($"item-{i:D2}", dt: DateTimeOffset.UtcNow.AddSeconds(-i)))
                .ToArray());
        var sut = CreateSut(repo);

        // First page
        var res1 = await sut.GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?pageSize=3"), CancellationToken.None)
            as Helpers.TestHttpResponseData;
        var (page1, token1) = ParseEnvelope(res1!.ReadBodyAsString());
        page1.Count.ShouldBe(3);
        token1.ShouldNotBeNullOrEmpty();

        // Second page
        var res2 = await sut.GetWardrobe(
            TestRequest.Get($"http://localhost/api/wardrobe?pageSize=3&continuationToken={Uri.EscapeDataString(token1!)}"),
            CancellationToken.None) as Helpers.TestHttpResponseData;
        var (page2, token2) = ParseEnvelope(res2!.ReadBodyAsString());
        page2.Count.ShouldBe(3);
        token2.ShouldNotBeNullOrEmpty();

        // No overlap
        var ids1 = page1.Select(i => i.Id).ToHashSet();
        var ids2 = page2.Select(i => i.Id).ToHashSet();
        ids1.Intersect(ids2).ShouldBeEmpty();
    }

    [Fact]
    public async Task GetWardrobe_LastPageHasNullContinuationToken()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("a"), MakeItem("b"));
        var sut = CreateSut(repo);

        var result = await sut.GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?pageSize=10"), CancellationToken.None)
            as Helpers.TestHttpResponseData;
        var (items, token) = ParseEnvelope(result!.ReadBodyAsString());
        items.Count.ShouldBe(2);
        token.ShouldBeNullOrEmpty();
    }

    // ── GetWardrobe — combined filters ───────────────────────────────────────

    [Fact]
    public async Task GetWardrobe_CombinesCategoryAndBrandFilters()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("match",     "Tops",    brand: "Nike"),
                MakeItem("wrong-cat", "Bottoms", brand: "Nike"),
                MakeItem("wrong-brd", "Tops",    brand: "Adidas"));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?category=Tops&brand=Nike"),
            CancellationToken.None) as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("match");
    }

    [Fact]
    public async Task GetWardrobe_CombinesConditionAndPriceRange()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                MakeItem("ok",        condition: ItemCondition.Good, price: 80m),
                MakeItem("too-cheap", condition: ItemCondition.Good, price: 10m),
                MakeItem("wrong-cond",condition: ItemCondition.Fair, price: 80m));

        var result = await CreateSut(repo).GetWardrobe(
            TestRequest.Get("http://localhost/api/wardrobe?condition=Good&priceMin=50"),
            CancellationToken.None) as Helpers.TestHttpResponseData;

        var (items, _) = ParseEnvelope(result!.ReadBodyAsString());
        items.ShouldHaveSingleItem().Id.ShouldBe("ok");
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

        result!.StatusCode.ShouldBe(HttpStatusCode.OK);
        result.ReadBodyAsString().ShouldContain("\"id\":\"abc\"");
    }

    [Fact]
    public async Task GetWardrobeItem_Returns404WhenNotFound()
    {
        var sut = CreateSut();
        var req = TestRequest.Get("http://localhost/api/wardrobe/missing");
        var result = await sut.GetWardrobeItem(req, "missing", CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetWardrobeItem_CannotAccessAnotherUsersItem()
    {
        var otherItem = new ClothingItem { Id = "x", UserId = "other-user", ImageUrl = "https://b.com/x.png" };
        var repo = new InMemoryWardrobeRepository().WithItems(otherItem);
        var sut  = CreateSut(repo);

        var result = await sut.GetWardrobeItem(
            TestRequest.Get("http://localhost/api/wardrobe/x"), "x", CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    // ── UpdateWardrobeItem ───────────────────────────────────────────────────

    [Fact]
    public async Task UpdateWardrobeItem_Returns400WhenIdMismatch()
    {
        var item = MakeItem("item-001");
        var json = JsonSerializer.Serialize(item, PluckItJsonContext.Default.ClothingItem);
        var sut  = CreateSut();

        var result = await sut.UpdateWardrobeItem(
            TestRequest.Put("http://localhost/api/wardrobe/wrong-id", json),
            "wrong-id",
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task UpdateWardrobeItem_ForcesUserIdFromAuth()
    {
        var item = MakeItem("item-002");
        item.UserId = "hacker";
        var json = JsonSerializer.Serialize(item, PluckItJsonContext.Default.ClothingItem);

        var repo = new InMemoryWardrobeRepository().WithItems(MakeItem("item-002"));
        var sut  = CreateSut(repo);

        var result = await sut.UpdateWardrobeItem(
            TestRequest.Put("http://localhost/api/wardrobe/item-002", json),
            "item-002",
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        repo.AllItems.Single(i => i.Id == "item-002").UserId.ShouldBe(UserId);
    }

    // ── DeleteWardrobeItem ───────────────────────────────────────────────────

    [Fact]
    public async Task DeleteWardrobeItem_Returns404WhenNotFound()
    {
        var result = await CreateSut().DeleteWardrobeItem(
            TestRequest.Delete("http://localhost/api/wardrobe/ghost"), "ghost", CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NotFound);
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

        result.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        repo.AllItems.ShouldBeEmpty();
        sas.DeletedUrls.ShouldContain(item.ImageUrl);
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

        result!.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = JsonSerializer.Deserialize<ClothingItem>(result.ReadBodyAsString(),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        body!.WearCount.ShouldBe(4);
        repo.AllItems.Single(i => i.Id == "wear-1").WearCount.ShouldBe(4);
    }

    [Fact]
    public async Task LogWear_Returns404ForMissingItem()
    {
        var result = await CreateSut().LogWear(
            TestRequest.Patch("http://localhost/api/wardrobe/ghost/wear"), "ghost", CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    // ── SaveItem ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task SaveItem_PersistsItemAndReturns201()
    {
        var repo    = new InMemoryWardrobeRepository();
        var sut     = CreateSut(repo);
        var newItem = new ClothingItem { Id = "new-1", UserId = "ignored", ImageUrl = "https://b.com/new.png" };
        var json    = JsonSerializer.Serialize(newItem, PluckItJsonContext.Default.ClothingItem);

        var result = await sut.SaveItem(
            TestRequest.Post("http://localhost/api/wardrobe", json), CancellationToken.None)
            as Helpers.TestHttpResponseData;

        result!.StatusCode.ShouldBe(HttpStatusCode.Created);
        repo.AllItems.ShouldHaveSingleItem().Id.ShouldBe("new-1");
        repo.AllItems.Single().UserId.ShouldBe(UserId);
        repo.AllItems.Single().DateAdded.ShouldNotBeNull();
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

        result.StatusCode.ShouldBe(HttpStatusCode.Created);
        repo.AllItems.Single().Id.ShouldNotBeNullOrEmpty();
    }
}
