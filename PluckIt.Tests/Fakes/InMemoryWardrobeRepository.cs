using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

/// <summary>
/// In-memory <see cref="IWardrobeRepository"/> for unit tests.
/// Supports all query features: category, brand, condition, tags, aestheticTags,
/// price range, wearCount range, sort, and continuation-token pagination.
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

    public Task<WardrobePagedResult> GetAllAsync(
        string userId,
        WardrobeQuery query,
        CancellationToken cancellationToken = default)
    {
        var q = _store.Where(i => i.UserId == userId);

        // ── Filters ──────────────────────────────────────────────────────────

        if (!string.IsNullOrEmpty(query.Category))
            q = q.Where(i => string.Equals(i.Category, query.Category, StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrEmpty(query.Brand))
            q = q.Where(i => string.Equals(i.Brand, query.Brand, StringComparison.OrdinalIgnoreCase));

        if (query.Condition.HasValue)
            q = q.Where(i => i.Condition == query.Condition.Value);

        if (query.Tags is { Count: > 0 })
            q = q.Where(i => i.Tags.Any(t => query.Tags.Contains(t, StringComparer.OrdinalIgnoreCase)));

        if (query.AestheticTags is { Count: > 0 })
            q = q.Where(i => i.AestheticTags != null &&
                              i.AestheticTags.Any(t => query.AestheticTags.Contains(t, StringComparer.OrdinalIgnoreCase)));

        if (query.PriceMin.HasValue)
            q = q.Where(i => i.Price != null && i.Price.Amount >= query.PriceMin.Value);

        if (query.PriceMax.HasValue)
            q = q.Where(i => i.Price != null && i.Price.Amount <= query.PriceMax.Value);

        if (query.MinWears.HasValue)
            q = q.Where(i => i.WearCount >= query.MinWears.Value);

        if (query.MaxWears.HasValue)
            q = q.Where(i => i.WearCount <= query.MaxWears.Value);

        // ── Sort ──────────────────────────────────────────────────────────────

        bool asc = string.Equals(query.SortDir, "asc", StringComparison.OrdinalIgnoreCase);
        q = query.SortField switch
        {
            WardrobeSortField.WearCount   => asc ? q.OrderBy(i => i.WearCount)       : q.OrderByDescending(i => i.WearCount),
            WardrobeSortField.PriceAmount => asc ? q.OrderBy(i => i.Price?.Amount)   : q.OrderByDescending(i => i.Price?.Amount),
            _                             => asc ? q.OrderBy(i => i.DateAdded ?? DateTimeOffset.MinValue)
                                                 : q.OrderByDescending(i => i.DateAdded ?? DateTimeOffset.MinValue),
        };

        // ── Continuation-token paging (opaque base64-encoded skip count) ──────

        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var skip     = DecodeToken(query.ContinuationToken);
        var page     = q.Skip(skip).Take(pageSize).ToList();
        var nextSkip = skip + page.Count;
        var nextToken = page.Count == pageSize && nextSkip < q.Count()
            ? EncodeToken(nextSkip)
            : null;

        return Task.FromResult(new WardrobePagedResult(page, nextToken));
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

    // ── Token helpers ─────────────────────────────────────────────────────────

    private static string? EncodeToken(int skip) =>
        skip <= 0 ? null : Convert.ToBase64String(BitConverter.GetBytes(skip));

    private static int DecodeToken(string? token)
    {
        if (string.IsNullOrEmpty(token)) return 0;
        try { return BitConverter.ToInt32(Convert.FromBase64String(token)); }
        catch { return 0; }
    }
}

