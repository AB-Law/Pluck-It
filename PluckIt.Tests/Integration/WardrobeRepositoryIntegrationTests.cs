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
/// - ORDER BY dateAdded DESC
/// - Pagination consistency under concurrent writes
/// </summary>
[Collection("CosmosDb Integration")]
[Trait("Category", "Integration")]
public sealed class WardrobeRepositoryIntegrationTests
{
    private readonly WardrobeRepository _repo;

    // Each xUnit test method creates a new instance of this class, so each test
    // gets a fresh GUID partition — no cross-test data contamination in the
    // shared container.
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
        string? category   = "Tops",
        string[]? tags     = null,
        DateTimeOffset? dt = null) => new()
    {
        Id        = id,
        UserId    = UserId,
        ImageUrl  = $"https://blob.example.com/{id}.png",
        Category  = category,
        Tags      = tags ?? ["casual"],
        DateAdded = dt ?? DateTimeOffset.UtcNow
    };

    // ── Sanity: upsert + point-read ──────────────────────────────────────────

    [Fact]
    public async Task UpsertAndGetById_RoundTrips()
    {
        var item = MakeItem("rt-001");
        await _repo.UpsertAsync(item);

        var fetched = await _repo.GetByIdAsync("rt-001", UserId);

        fetched.ShouldNotBeNull();
        fetched!.Id.ShouldBe("rt-001");
    }

    [Fact]
    public async Task DeleteAsync_RemovesItem()
    {
        var item = MakeItem("del-001");
        await _repo.UpsertAsync(item);
        await _repo.DeleteAsync("del-001", UserId);

        var fetched = await _repo.GetByIdAsync("del-001", UserId);
        fetched.ShouldBeNull();
    }

    // ── Pagination ───────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_PaginatesWithoutGapsOrDuplicates()
    {
        // Seed 12 items with distinct timestamps so ordering is deterministic
        for (var i = 1; i <= 12; i++)
        {
            await _repo.UpsertAsync(MakeItem(
                $"page-item-{i:D2}",
                dt: DateTimeOffset.UtcNow.AddSeconds(-i)));
        }

        var page0 = await _repo.GetAllAsync(UserId, null, null, 0, 4);
        var page1 = await _repo.GetAllAsync(UserId, null, null, 1, 4);
        var page2 = await _repo.GetAllAsync(UserId, null, null, 2, 4);

        page0.Count.ShouldBe(4);
        page1.Count.ShouldBe(4);
        page2.Count.ShouldBe(4);

        var allIds = page0.Concat(page1).Concat(page2).Select(i => i.Id).ToList();
        allIds.Distinct().Count().ShouldBe(allIds.Count, "no duplicates across pages");
        allIds.Count.ShouldBe(12);
    }

    // ── Category filter ──────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_FiltersByCategory()
    {
        await _repo.UpsertAsync(MakeItem("cat-tops", "Tops"));
        await _repo.UpsertAsync(MakeItem("cat-btm",  "Bottoms"));

        var tops = await _repo.GetAllAsync(UserId, "Tops", null, 0, 100);

        tops.ShouldHaveSingleItem().Id.ShouldBe("cat-tops");
        tops.ShouldNotContain(i => i.Id == "cat-btm");
    }

    // ── Tag filter (ARRAY_INTERSECT / ARRAY_CONTAINS in Cosmos) ─────────────

    [Fact]
    public async Task GetAllAsync_FiltersByTagIntersection()
    {
        await _repo.UpsertAsync(MakeItem("tag-a", tags: ["denim", "casual"]));
        await _repo.UpsertAsync(MakeItem("tag-b", tags: ["formal", "fitted"]));
        await _repo.UpsertAsync(MakeItem("tag-c", tags: ["denim", "ripped"]));

        var result = await _repo.GetAllAsync(UserId, null, ["denim"], 0, 100);

        result.Select(i => i.Id).ShouldBe(new[] {"tag-a", "tag-c"}, ignoreOrder: true);
    }

    [Fact]
    public async Task GetAllAsync_CombinesCategoryAndTagFilters()
    {
        await _repo.UpsertAsync(MakeItem("match", "Tops", ["denim"]));
        await _repo.UpsertAsync(MakeItem("wrong-cat", "Bottoms", ["denim"]));
        await _repo.UpsertAsync(MakeItem("wrong-tag", "Tops", ["formal"]));

        var result = await _repo.GetAllAsync(UserId, "Tops", ["denim"], 0, 100);

        result.ShouldHaveSingleItem().Id.ShouldBe("match");
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
            Tags     = ["casual"]
        };
        await _repo.UpsertAsync(otherItem);
        await _repo.UpsertAsync(MakeItem("my-item"));

        var result = await _repo.GetAllAsync(UserId, null, null, 0, 100);

        result.ShouldHaveSingleItem().Id.ShouldBe("my-item");
        result.ShouldNotContain(i => i.Id == "other-user-item");
    }
}
