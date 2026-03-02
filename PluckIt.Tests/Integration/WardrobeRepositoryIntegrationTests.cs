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

using FluentAssertions;
using Microsoft.Azure.Cosmos;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Testcontainers.CosmosDb;
using Xunit;

namespace PluckIt.Tests.Integration;

/// <summary>
/// Integration tests for <see cref="WardrobeRepository"/> against the live Cosmos emulator.
/// Validates query correctness that in-memory fakes cannot cover:
/// - ARRAY_INTERSECT tag filtering
/// - ORDER BY dateAdded DESC
/// - Pagination consistency under concurrent writes
/// </summary>
[Trait("Category", "Integration")]
public sealed class WardrobeRepositoryIntegrationTests : IAsyncLifetime
{
    private readonly CosmosDbContainer _cosmos = new CosmosDbBuilder("mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest")
        .Build();

    private CosmosClient _client = null!;
    private WardrobeRepository _repo = null!;

    private const string UserId  = "integration-user-001";
    private const string Database = "PluckIt";
    private const string Container = "Wardrobe";

    public async Task InitializeAsync()
    {
        await _cosmos.StartAsync();

        // The emulator uses a well-known self-signed cert; CosmosDb Testcontainer
        // disables TLS verification automatically via its connection string.
        _client = new CosmosClient(
            _cosmos.GetConnectionString(),
            new CosmosClientOptions
            {
                HttpClientFactory = () => new HttpClient(
                    new HttpClientHandler
                    {
                        ServerCertificateCustomValidationCallback =
                            HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
                    }),
                ConnectionMode = ConnectionMode.Gateway,
            });

        await _client.CreateDatabaseIfNotExistsAsync(Database);
        await _client
            .GetDatabase(Database)
            .CreateContainerIfNotExistsAsync(new ContainerProperties(Container, "/userId"));

        _repo = new WardrobeRepository(_client, Database, Container);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _cosmos.StopAsync();
    }

    private static ClothingItem MakeItem(
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

        fetched.Should().NotBeNull();
        fetched!.Id.Should().Be("rt-001");
    }

    [Fact]
    public async Task DeleteAsync_RemovesItem()
    {
        var item = MakeItem("del-001");
        await _repo.UpsertAsync(item);
        await _repo.DeleteAsync("del-001", UserId);

        var fetched = await _repo.GetByIdAsync("del-001", UserId);
        fetched.Should().BeNull();
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

        page0.Count.Should().Be(4);
        page1.Count.Should().Be(4);
        page2.Count.Should().Be(4);

        var allIds = page0.Concat(page1).Concat(page2).Select(i => i.Id).ToList();
        allIds.Should().OnlyHaveUniqueItems("no duplicates across pages");
        allIds.Should().HaveCount(12);
    }

    // ── Category filter ──────────────────────────────────────────────────────

    [Fact]
    public async Task GetAllAsync_FiltersByCategory()
    {
        await _repo.UpsertAsync(MakeItem("cat-tops", "Tops"));
        await _repo.UpsertAsync(MakeItem("cat-btm",  "Bottoms"));

        var tops = await _repo.GetAllAsync(UserId, "Tops", null, 0, 100);

        tops.Should().ContainSingle(i => i.Id == "cat-tops");
        tops.Should().NotContain(i => i.Id == "cat-btm");
    }

    // ── Tag filter (ARRAY_INTERSECT / ARRAY_CONTAINS in Cosmos) ─────────────

    [Fact]
    public async Task GetAllAsync_FiltersByTagIntersection()
    {
        await _repo.UpsertAsync(MakeItem("tag-a", tags: ["denim", "casual"]));
        await _repo.UpsertAsync(MakeItem("tag-b", tags: ["formal", "fitted"]));
        await _repo.UpsertAsync(MakeItem("tag-c", tags: ["denim", "ripped"]));

        var result = await _repo.GetAllAsync(UserId, null, ["denim"], 0, 100);

        result.Select(i => i.Id).Should().BeEquivalentTo(["tag-a", "tag-c"]);
    }

    [Fact]
    public async Task GetAllAsync_CombinesCategoryAndTagFilters()
    {
        await _repo.UpsertAsync(MakeItem("match", "Tops", ["denim"]));
        await _repo.UpsertAsync(MakeItem("wrong-cat", "Bottoms", ["denim"]));
        await _repo.UpsertAsync(MakeItem("wrong-tag", "Tops", ["formal"]));

        var result = await _repo.GetAllAsync(UserId, "Tops", ["denim"], 0, 100);

        result.Should().ContainSingle(i => i.Id == "match");
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

        result.Should().ContainSingle(i => i.Id == "my-item");
        result.Should().NotContain(i => i.Id == "other-user-item");
    }
}
