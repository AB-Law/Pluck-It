using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

/// <summary>
/// In-memory <see cref="IWardrobeRepository"/> for unit tests.
/// Supports all query features: category filter, tag intersection, pagination.
/// Thread-safety is not a goal (single-threaded tests).
/// </summary>
public sealed class InMemoryWardrobeRepository : IWardrobeRepository
{
    private readonly List<ClothingItem> _store = [];

    // ── Seed helpers ─────────────────────────────────────────────────────────

    public InMemoryWardrobeRepository WithItems(params ClothingItem[] items)
    {
        _store.AddRange(items);
        return this;
    }

    public IReadOnlyList<ClothingItem> AllItems => _store.AsReadOnly();

    // ── Interface implementation ─────────────────────────────────────────────

    public Task<IReadOnlyCollection<ClothingItem>> GetAllAsync(
        string userId,
        string? category,
        IReadOnlyCollection<string>? tags,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        var query = _store.Where(i => i.UserId == userId);

        if (!string.IsNullOrEmpty(category))
            query = query.Where(i =>
                string.Equals(i.Category, category, StringComparison.OrdinalIgnoreCase));

        if (tags is { Count: > 0 })
            query = query.Where(i =>
                i.Tags.Any(t => tags.Contains(t, StringComparer.OrdinalIgnoreCase)));

        // Cosmos orders by dateAdded DESC; mirror that behaviour
        query = query.OrderByDescending(i => i.DateAdded ?? DateTimeOffset.MinValue);

        var page0 = query.Skip(page * pageSize).Take(pageSize).ToList();
        return Task.FromResult<IReadOnlyCollection<ClothingItem>>(page0);
    }

    public Task<ClothingItem?> GetByIdAsync(
        string id,
        string userId,
        CancellationToken cancellationToken = default)
    {
        var item = _store.FirstOrDefault(i =>
            string.Equals(i.Id, id, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(i.UserId, userId, StringComparison.OrdinalIgnoreCase));
        return Task.FromResult(item);
    }

    public Task UpsertAsync(ClothingItem item, CancellationToken cancellationToken = default)
    {
        // Match on (Id, UserId) — mirrors Cosmos partition semantics where the
        // same document id can exist in multiple userId partitions.
        var existing = _store.FindIndex(i =>
            string.Equals(i.Id,     item.Id,     StringComparison.OrdinalIgnoreCase) &&
            string.Equals(i.UserId, item.UserId, StringComparison.OrdinalIgnoreCase));
        if (existing >= 0) _store[existing] = item;
        else               _store.Add(item);
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string id, string userId, CancellationToken cancellationToken = default)
    {
        _store.RemoveAll(i =>
            string.Equals(i.Id, id, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(i.UserId, userId, StringComparison.OrdinalIgnoreCase));
        return Task.CompletedTask;
    }

    // ── Extra query helpers used by cleanup / digest ─────────────────────────

    public IEnumerable<string> AllImageUrls()
        => _store.Select(i => i.ImageUrl).Where(u => !string.IsNullOrEmpty(u))!;
}
