// ── Integration Tests — Cosmos DB Emulator ───────────────────────────────────
//
// These tests run against the Azure Cosmos DB Linux emulator via Testcontainers.
// They are gated with [Trait("Category", "Integration")] and skipped by default
// in the unit test CI step.
//
// Prerequisites: Docker desktop must be running.
//
// Run with:
//   dotnet test --filter "Category=Integration"
//
// The emulator image ~1.5 GB — first pull takes a few minutes. Subsequent runs
// use Docker's layer cache.
//
// The [Collection("CosmosDb Integration")] attribute ensures all tests in this
// file share a single CosmosDbFixture (one container for the whole run) and
// execute sequentially, preventing multiple 1.5 GB containers starting in parallel.

using Shouldly;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Xunit;

namespace PluckIt.Tests.Integration;

/// <summary>
/// Integration tests for <see cref="WardrobeRepository"/> against the live Cosmos emulator.
/// Validates query correctness that in-memory fakes cannot cover:
/// - ARRAY_INTERSECT tag filtering
/// - ORDER BY, composite indexes
/// - Continuation-token paging
/// </summary>
[Collection("CosmosDb Integration")]
[Trait("Category", "Integration")]
public sealed class WardrobeRepositoryIntegrationTests
{
    private readonly WardrobeRepository _repo;

    // Each xUnit test method creates a new instance of this class, so each test
    // gets a fresh GUID partition — no cross-test data contamination.
    private readonly string UserId = Guid.NewGuid().ToString("N");

    public WardrobeRepositoryIntegrationTests(CosmosDbFixture fixture)
    {
        _repo = new WardrobeRepository(
            fixture.Client,
            CosmosDbFixture.Database,
            CosmosDbFixture.Container);
    }

    private ClothingItem MakeItem(
        string id,
        string? category      = "Tops",
        string[]? tags        = null,
        string? brand         = null,
        ItemCondition? cond   = null,
        decimal? price        = null,
        int wearCount         = 0,
        DateTimeOffset? dt    = null) => new()
    {
        Id        = id,
        UserId    = UserId,
        ImageUrl  = $"https://blob.example.com/{id}.png",
        Category  = category,
        Tags      = tags ?? ["casual"],
        Brand     = brand,
        Condition = cond,
        Price     = price.HasValue ? new ClothingPrice { Amount = price.Value, OriginalCurrency = "USD" } : null,
        WearCount = wearCount,
        DateAdded = dt ?? DateTimeOffset.UtcNow,
    };

    private static WardrobeQuery Q(
        string? category     = null,
        string[]? tags       = null,
        string? brand        = null,
        ItemCondition? cond  = null,
        decimal? priceMin    = null,
        decimal? priceMax    = null,
        int? minWears        = null,
        int? maxWears        = null,
        string sortField     = WardrobeSortField.DateAdded,
        string sortDir       = "desc",
        int pageSize         = 100,
        string? token        = null) => new()
    {
        Category          = category,
        Tags              = tags,
        Brand             = brand,
        Condition         = cond,
        PriceMin          = priceMin,
        PriceMax          = priceMax,
        MinWears          = minWears,
        MaxWears          = maxWears,
        SortField         = sortField,
        SortDir           = sortDir,
        PageSize          = pageSize,
        ContinuationToken = token,
    };

    // ── Sanity: upsert + point-read ──────────────────────────────────────────

    [Fact]
    public async Task UpsertAndGetById_RoundTrips()
    {
        await _repo.UpsertAsync(MakeItem("rt-001"));

        var fetched = await _repo.GetByIdAsync("rt-001", UserId);

        fetched.ShouldNotBeNull();
        fetched!.Id.ShouldBe("rt-001");
    }

    [Fact]
    public async Task DeleteAsync_RemovesItem()
    {
        await _repo.UpsertAsync(MakeItem("del-001"));
        await _repo.DeleteAsync("del-001", UserId);

        (await _repo.GetByIdAsync("del-001", UserId)).ShouldBeNull();
    }

    // ── Pagination (continuation tokens) ─────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_PaginatesWithContinuationTokens()
    {
        for (var i = 1; i <= 12; i++)
            await _repo.UpsertAsync(MakeItem($"page-{i:D2}", dt: DateTimeOffset.UtcNow.AddSeconds(-i)));

        var page0 = await _repo.GetAllAsync(UserId, Q(pageSize: 4));
        page0.Items.Count.ShouldBe(4);
        page0.NextContinuationToken.ShouldNotBeNullOrEmpty();

        var page1 = await _repo.GetAllAsync(UserId, Q(pageSize: 4, token: page0.NextContinuationToken));
        page1.Items.Count.ShouldBe(4);
        page1.NextContinuationToken.ShouldNotBeNullOrEmpty();

        var page2 = await _repo.GetAllAsync(UserId, Q(pageSize: 4, token: page1.NextContinuationToken));
        page2.Items.Count.ShouldBe(4);

        var allIds = page0.Items.Concat(page1.Items).Concat(page2.Items).Select(i => i.Id).ToList();
        allIds.Distinct().Count().ShouldBe(12, "no duplicates across pages");
    }

    // ── Category filter ──────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_FiltersByCategory()
    {
        await _repo.UpsertAsync(MakeItem("cat-tops", "Tops"));
        await _repo.UpsertAsync(MakeItem("cat-btm",  "Bottoms"));

        var result = await _repo.GetAllAsync(UserId, Q(category: "Tops"));

        result.Items.ShouldHaveSingleItem().Id.ShouldBe("cat-tops");
    }

    // ── Tag filter ───────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_FiltersByTagIntersection()
    {
        await _repo.UpsertAsync(MakeItem("tag-a", tags: ["denim", "casual"]));
        await _repo.UpsertAsync(MakeItem("tag-b", tags: ["formal"]));
        await _repo.UpsertAsync(MakeItem("tag-c", tags: ["denim", "ripped"]));

        var result = await _repo.GetAllAsync(UserId, Q(tags: ["denim"]));

        result.Items.Select(i => i.Id).ShouldBe(new[] { "tag-a", "tag-c" }, ignoreOrder: true);
    }

    [Fact]
    public async Task GetAllAsync_CombinesCategoryAndTagFilters()
    {
        await _repo.UpsertAsync(MakeItem("match",      "Tops",    tags: ["denim"]));
        await _repo.UpsertAsync(MakeItem("wrong-cat",  "Bottoms", tags: ["denim"]));
        await _repo.UpsertAsync(MakeItem("wrong-tag",  "Tops",    tags: ["formal"]));

        var result = await _repo.GetAllAsync(UserId, Q(category: "Tops", tags: ["denim"]));

        result.Items.ShouldHaveSingleItem().Id.ShouldBe("match");
    }

    // ── Brand filter ─────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_FiltersByBrand()
    {
        await _repo.UpsertAsync(MakeItem("nike",   brand: "Nike"));
        await _repo.UpsertAsync(MakeItem("adidas", brand: "Adidas"));

        var result = await _repo.GetAllAsync(UserId, Q(brand: "Nike"));

        result.Items.ShouldHaveSingleItem().Id.ShouldBe("nike");
    }

    // ── Condition filter ─────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_FiltersByCondition()
    {
        await _repo.UpsertAsync(MakeItem("new-item",  cond: ItemCondition.New));
        await _repo.UpsertAsync(MakeItem("fair-item", cond: ItemCondition.Fair));

        var result = await _repo.GetAllAsync(UserId, Q(cond: ItemCondition.New));

        result.Items.ShouldHaveSingleItem().Id.ShouldBe("new-item");
    }

    // ── Price range filter ────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_FiltersByPriceRange()
    {
        await _repo.UpsertAsync(MakeItem("cheap",     price: 20m));
        await _repo.UpsertAsync(MakeItem("mid",       price: 75m));
        await _repo.UpsertAsync(MakeItem("expensive", price: 200m));

        var result = await _repo.GetAllAsync(UserId, Q(priceMin: 50m, priceMax: 100m));

        result.Items.ShouldHaveSingleItem().Id.ShouldBe("mid");
    }

    // ── WearCount range filter ────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_FiltersByWearCountRange()
    {
        await _repo.UpsertAsync(MakeItem("unworn",  wearCount: 0));
        await _repo.UpsertAsync(MakeItem("worn",    wearCount: 5));
        await _repo.UpsertAsync(MakeItem("heavily", wearCount: 20));

        var result = await _repo.GetAllAsync(UserId, Q(minWears: 3, maxWears: 10));

        result.Items.ShouldHaveSingleItem().Id.ShouldBe("worn");
    }

    // ── Sort ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_SortsByWearCountDesc()
    {
        await _repo.UpsertAsync(MakeItem("a", wearCount: 1));
        await _repo.UpsertAsync(MakeItem("b", wearCount: 10));
        await _repo.UpsertAsync(MakeItem("c", wearCount: 5));

        var result = await _repo.GetAllAsync(UserId,
            Q(sortField: WardrobeSortField.WearCount, sortDir: "desc"));

        result.Items.Select(i => i.Id).ShouldBe(new[] { "b", "c", "a" });
    }

    [Fact]
    public async Task GetAllAsync_SortsByDateAddedDesc()
    {
        var now = DateTimeOffset.UtcNow;
        await _repo.UpsertAsync(MakeItem("old", dt: now.AddDays(-10)));
        await _repo.UpsertAsync(MakeItem("new", dt: now.AddDays(-1)));
        await _repo.UpsertAsync(MakeItem("mid", dt: now.AddDays(-5)));

        var result = await _repo.GetAllAsync(UserId,
            Q(sortField: WardrobeSortField.DateAdded, sortDir: "desc"));

        result.Items.Select(i => i.Id).ShouldBe(new[] { "new", "mid", "old" });
    }

    // ── User isolation ───────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_DoesNotReturnAnotherUsersItems()
    {
        var otherItem = new ClothingItem
        {
            Id       = "other-user-item",
            UserId   = "other-user-999",
            ImageUrl = "https://blob.example.com/other.png",
            Tags     = ["casual"],
        };
        await _repo.UpsertAsync(otherItem);
        await _repo.UpsertAsync(MakeItem("my-item"));

        var result = await _repo.GetAllAsync(UserId, Q());

        result.Items.ShouldHaveSingleItem().Id.ShouldBe("my-item");
        result.Items.ShouldNotContain(i => i.Id == "other-user-item");
    }
}

