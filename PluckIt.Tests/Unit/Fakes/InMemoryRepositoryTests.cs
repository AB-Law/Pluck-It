using FluentAssertions;
using PluckIt.Core;
using PluckIt.Tests.Fakes;
using Xunit;

namespace PluckIt.Tests.Unit.Fakes;

/// <summary>
/// Verifies that the in-memory fakes behave correctly.
/// These are foundational — if fakes are wrong, unit tests are unreliable.
/// </summary>
[Trait("Category", "Unit")]
public sealed class InMemoryWardrobeRepositoryTests
{
    private const string User1 = "user-001";
    private const string User2 = "user-002";

    private static ClothingItem Item(string id, string userId = User1, string? category = "Tops", params string[] tags) =>
        new()
        {
            Id        = id,
            UserId    = userId,
            ImageUrl  = "https://example.com/img.png",
            Category  = category,
            Tags      = tags.Length > 0 ? [.. tags] : ["casual"],
            DateAdded = DateTimeOffset.UtcNow
        };

    [Fact]
    public async Task GetAllAsync_OnlyReturnsItemsForRequestedUser()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(Item("a", User1), Item("b", User2));

        var items = await repo.GetAllAsync(User1, null, null, 0, 100);

        items.Should().ContainSingle(i => i.Id == "a");
        items.Should().NotContain(i => i.UserId == User2);
    }

    [Fact]
    public async Task GetAllAsync_FiltersByCategory()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(Item("t1", category: "Tops"), Item("b1", category: "Bottoms"));

        var result = await repo.GetAllAsync(User1, "Tops", null, 0, 100);

        result.Should().ContainSingle(i => i.Id == "t1");
    }

    [Fact]
    public async Task GetAllAsync_FiltersByTagsWithOrLogic()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(
                Item("a", tags: ["denim", "casual"]),
                Item("b", tags: ["formal", "slim"]),
                Item("c", tags: ["denim", "ripped"]));

        var result = await repo.GetAllAsync(User1, null, ["denim"], 0, 100);

        result.Select(i => i.Id).Should().BeEquivalentTo(["a", "c"]);
    }

    [Fact]
    public async Task GetAllAsync_PaginatesCorrectly()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(Enumerable.Range(1, 20).Select(i => Item($"item-{i}")).ToArray());

        var page0 = await repo.GetAllAsync(User1, null, null, 0, 5);
        var page1 = await repo.GetAllAsync(User1, null, null, 1, 5);
        var page2 = await repo.GetAllAsync(User1, null, null, 2, 5);

        page0.Count.Should().Be(5);
        page1.Count.Should().Be(5);
        page2.Count.Should().Be(5);

        var ids0 = page0.Select(i => i.Id).ToHashSet();
        var ids1 = page1.Select(i => i.Id).ToHashSet();
        ids0.Intersect(ids1).Should().BeEmpty("pages must not overlap");
    }

    [Fact]
    public async Task UpsertAsync_CreatesNewItem()
    {
        var repo = new InMemoryWardrobeRepository();
        var item = Item("new-1");

        await repo.UpsertAsync(item);

        repo.AllItems.Should().ContainSingle(i => i.Id == "new-1");
    }

    [Fact]
    public async Task UpsertAsync_UpdatesExistingItem()
    {
        var repo = new InMemoryWardrobeRepository().WithItems(Item("upd-1"));

        var updated = Item("upd-1");
        updated.Category = "Bottoms";
        await repo.UpsertAsync(updated);

        repo.AllItems.Should().HaveCount(1);
        repo.AllItems.Single().Category.Should().Be("Bottoms");
    }

    [Fact]
    public async Task DeleteAsync_RemovesItemByIdAndUserId()
    {
        var repo = new InMemoryWardrobeRepository().WithItems(Item("del-1"), Item("keep-1"));

        await repo.DeleteAsync("del-1", User1);

        repo.AllItems.Should().ContainSingle(i => i.Id == "keep-1");
    }

    [Fact]
    public async Task DeleteAsync_DoesNotDeleteItemOwnedByAnotherUser()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(Item("shared-id", User2));

        await repo.DeleteAsync("shared-id", User1); // wrong user

        repo.AllItems.Should().HaveCount(1, "other user's item should be untouched");
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsNullForWrongUser()
    {
        var repo = new InMemoryWardrobeRepository().WithItems(Item("x", User1));

        var result = await repo.GetByIdAsync("x", User2);

        result.Should().BeNull();
    }
}
