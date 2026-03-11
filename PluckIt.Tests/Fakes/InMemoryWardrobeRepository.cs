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
        var filtered = ApplyFilters(_store, userId, query);
        var sorted = ApplySort(filtered, query.SortField, query.SortDir);
        var (page, nextToken) = ApplyPaging(sorted, query.PageSize, query.ContinuationToken);
        return Task.FromResult(new WardrobePagedResult(page, nextToken));
    }

    private static IEnumerable<ClothingItem> ApplyFilters(IEnumerable<ClothingItem> source, string userId, WardrobeQuery query)
    {
        var q = source.Where(i => string.Equals(i.UserId, userId, StringComparison.OrdinalIgnoreCase));
        q = ApplyStringFilter(q, query.Category, i => i.Category);
        q = ApplyStringFilter(q, query.Brand, i => i.Brand);
        q = query.Condition.HasValue ? q.Where(i => i.Condition == query.Condition.Value) : q;
        q = ApplyCollectionContainsFilter(q, query.Tags, i => i.Tags);
        q = ApplyAestheticTagFilter(q, query.AestheticTags);
        q = ApplyPriceFilter(q, query.PriceMin, (i, min) => i.Price is not null && i.Price.Amount >= min);
        q = ApplyPriceFilter(q, query.PriceMax, (i, max) => i.Price is not null && i.Price.Amount <= max);
        q = ApplyRangeFilter(q, query.MinWears, (i, min) => i.WearCount >= min);
        q = ApplyRangeFilter(q, query.MaxWears, (i, max) => i.WearCount <= max);
        return q;
    }

    private static IEnumerable<ClothingItem> ApplyStringFilter(
        IEnumerable<ClothingItem> source,
        string? filter,
        Func<ClothingItem, string?> selector)
    {
        if (string.IsNullOrEmpty(filter))
            return source;

        return source.Where(i => string.Equals(selector(i), filter, StringComparison.OrdinalIgnoreCase));
    }

    private static IEnumerable<ClothingItem> ApplyCollectionContainsFilter(
        IEnumerable<ClothingItem> source,
        IReadOnlyCollection<string>? filter,
        Func<ClothingItem, IReadOnlyCollection<string>?> selector)
    {
        if (filter is null || filter.Count == 0)
            return source;

        return source.Where(i => (selector(i) ?? Array.Empty<string>()).Any(t => filter.Contains(t, StringComparer.OrdinalIgnoreCase)));
    }

    private static IEnumerable<ClothingItem> ApplyAestheticTagFilter(
        IEnumerable<ClothingItem> source,
        IReadOnlyCollection<string>? filter)
    {
        if (filter is null || filter.Count == 0)
            return source;

        return source.Where(i =>
            i.AestheticTags is not null &&
            i.AestheticTags.Any(t => filter.Contains(t, StringComparer.OrdinalIgnoreCase)));
    }

    private static IEnumerable<ClothingItem> ApplyPriceFilter(
        IEnumerable<ClothingItem> source,
        decimal? filter,
        Func<ClothingItem, decimal, bool> match)
    {
        if (filter is null)
            return source;

        return source.Where(i => match(i, filter.Value));
    }

    private static IEnumerable<ClothingItem> ApplyRangeFilter(
        IEnumerable<ClothingItem> source,
        int? filter,
        Func<ClothingItem, int, bool> match)
    {
        if (filter is null)
            return source;

        return source.Where(i => match(i, filter.Value));
    }

    private static IEnumerable<ClothingItem> ApplySort(
        IEnumerable<ClothingItem> source,
        string? sortField,
        string? sortDir)
    {
        var asc = string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase);
        return sortField switch
        {
            WardrobeSortField.WearCount => asc
                ? source.OrderBy(i => i.WearCount)
                : source.OrderByDescending(i => i.WearCount),
            WardrobeSortField.PriceAmount => asc
                ? source.OrderBy(i => i.Price?.Amount)
                : source.OrderByDescending(i => i.Price?.Amount),
            _ => asc
                ? source.OrderBy(i => i.DateAdded ?? DateTimeOffset.MinValue)
                : source.OrderByDescending(i => i.DateAdded ?? DateTimeOffset.MinValue),
        };
    }

    private static (List<ClothingItem> page, string? nextToken) ApplyPaging(
        IEnumerable<ClothingItem> source,
        int pageSize,
        string? continuationToken)
    {
        var effectivePageSize = Math.Clamp(pageSize, 1, 100);
        var skip = DecodeToken(continuationToken);
        var page = source.Skip(skip).Take(effectivePageSize).ToList();
        var nextSkip = skip + page.Count;
        var nextToken = page.Count == effectivePageSize && nextSkip < source.Count()
            ? EncodeToken(nextSkip)
            : null;

        return (page, nextToken);
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

    public Task<ClothingItem?> AppendWearEventAsync(
        string itemId,
        string userId,
        WearEvent ev,
        string? clientEventId = null,
        int maxEvents = 30,
        CancellationToken cancellationToken = default)
    {
        var item = _store.FirstOrDefault(i =>
            string.Equals(i.Id,     itemId, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(i.UserId, userId, StringComparison.OrdinalIgnoreCase));
        if (item is null) return Task.FromResult<ClothingItem?>(null);

        if (!string.IsNullOrWhiteSpace(clientEventId) &&
            string.Equals(item.LastWearActionId, clientEventId, StringComparison.Ordinal))
            return Task.FromResult<ClothingItem?>(item);

        item.WearEvents ??= [];
        item.WearEvents.Add(ev);
        if (item.WearEvents.Count > maxEvents)
        {
            var trimmed = item.WearEvents.OrderByDescending(e => e.OccurredAt).Take(maxEvents).ToList();
            item.WearEvents.Clear();
            item.WearEvents.AddRange(trimmed);
        }
        item.WearCount  += 1;
        item.LastWornAt  = ev.OccurredAt;
        if (!string.IsNullOrWhiteSpace(clientEventId))
            item.LastWearActionId = clientEventId;
        return Task.FromResult<ClothingItem?>(item);
    }

    // ── Draft operations (stubs — sufficient for unit tests) ─────────────────

    public Task<WardrobeDraftsResult> GetDraftsAsync(
        string userId, int pageSize = 50, string? continuationToken = null, CancellationToken cancellationToken = default)
    {
        var drafts = _store
            .Where(i => string.Equals(i.UserId, userId, StringComparison.OrdinalIgnoreCase)
                     && i.DraftStatus.HasValue)
            .ToList();
        return Task.FromResult(new WardrobeDraftsResult(drafts, null));
    }

    public Task<bool> SetDraftTerminalAsync(
        string itemId, string userId, DraftStatus terminalStatus, string? processedBlobUrl,
        ClothingMetadata? metadata, string? errorMessage,
        CancellationToken cancellationToken = default)
    {
        _ = metadata; // not applied in the in-memory stub
        var item = _store.FirstOrDefault(i =>
            string.Equals(i.Id, itemId, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(i.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
            i.DraftStatus == DraftStatus.Processing);
        if (item is null) return Task.FromResult(false);
        item.DraftStatus    = terminalStatus;
        item.DraftError     = errorMessage;
        item.DraftUpdatedAt = DateTimeOffset.UtcNow;
        if (processedBlobUrl is not null) item.ImageUrl = processedBlobUrl;
        return Task.FromResult(true);
    }

    public Task<ClothingItem?> AcceptDraftAsync(
        string itemId, string userId, DateTimeOffset finalizedAt, CancellationToken cancellationToken = default)
    {
        var item = _store.FirstOrDefault(i =>
            string.Equals(i.Id, itemId, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(i.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
            i.DraftStatus == DraftStatus.Ready);
        if (item is null) return Task.FromResult<ClothingItem?>(null);
        item.DraftStatus    = null;
        item.DraftError     = null;
        item.RawImageBlobUrl= null;
        item.DraftCreatedAt = null;
        item.DraftUpdatedAt = null;
        item.DateAdded      = finalizedAt;
        return Task.FromResult<ClothingItem?>(item);
    }

    public Task<IReadOnlyList<ClothingItem>> GetByDraftStatusAsync(
        DraftStatus status, DateTimeOffset olderThan, int maxItems = 200, CancellationToken cancellationToken = default)
    {
        IReadOnlyList<ClothingItem> result = _store
            .Where(i => i.DraftStatus == status
                     && (i.DraftUpdatedAt ?? i.DraftCreatedAt ?? DateTimeOffset.MaxValue) < olderThan)
            .Take(maxItems)
            .ToList();
        return Task.FromResult(result);
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
