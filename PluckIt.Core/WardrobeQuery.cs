namespace PluckIt.Core;

/// <summary>
/// Allowlisted sort field names for wardrobe queries.
/// Values match the Cosmos DB document property paths exactly (camelCase).
/// </summary>
public static class WardrobeSortField
{
    public const string DateAdded   = "dateAdded";
    public const string WearCount   = "wearCount";
    public const string PriceAmount = "price.amount";

    public static readonly IReadOnlyCollection<string> Allowlist =
        [DateAdded, WearCount, PriceAmount];
}

/// <summary>
/// Encapsulates all filter, sort, and pagination parameters for a wardrobe query.
/// </summary>
public record WardrobeQuery
{
    // ── Filters ──────────────────────────────────────────────────────────────

    /// <summary>Exact-match on <c>category</c> (case-insensitive via LOWER() in Cosmos).</summary>
    public string?                       Category          { get; init; }

    /// <summary>Exact-match on <c>brand</c> (case-insensitive via LOWER() in Cosmos).</summary>
    public string?                       Brand             { get; init; }

    /// <summary>Filter by subjective condition grade.</summary>
    public ItemCondition?                Condition         { get; init; }

    /// <summary>Item must intersect at least one of these tags.</summary>
    public IReadOnlyCollection<string>?  Tags              { get; init; }

    /// <summary>Item must intersect at least one of these aesthetic tags.</summary>
    public IReadOnlyCollection<string>?  AestheticTags     { get; init; }

    /// <summary>Minimum purchase price (inclusive), applied to <c>price.amount</c>.</summary>
    public decimal?                      PriceMin          { get; init; }

    /// <summary>Maximum purchase price (inclusive), applied to <c>price.amount</c>.</summary>
    public decimal?                      PriceMax          { get; init; }

    /// <summary>Minimum wear count (inclusive).</summary>
    public int?                          MinWears          { get; init; }

    /// <summary>Maximum wear count (inclusive).</summary>
    public int?                          MaxWears          { get; init; }

    /// <summary>
    /// When <see langword="true"/>, includes items marked as wishlisted in the result set.
    /// When <see langword="false"/>, filters wishlist items out of results.
    /// </summary>
    public bool IncludeWishlisted { get; init; }

    // ── Sort ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Cosmos document path to sort by. Must be one of <see cref="WardrobeSortField.Allowlist"/>.
    /// Defaults to <see cref="WardrobeSortField.DateAdded"/>.
    /// </summary>
    public string  SortField         { get; init; } = WardrobeSortField.DateAdded;

    /// <summary>"asc" or "desc" (case-insensitive). Defaults to "desc".</summary>
    public string  SortDir           { get; init; } = "desc";

    // ── Pagination ────────────────────────────────────────────────────────────

    /// <summary>Maximum items to return per page. Clamped [1, 100].</summary>
    public int     PageSize          { get; init; } = 24;

    /// <summary>Opaque Cosmos DB continuation token from a prior response. Null for the first page.</summary>
    public string? ContinuationToken { get; init; }
}

/// <summary>
/// Paged result envelope returned by <see cref="IWardrobeRepository.GetAllAsync"/>.
/// </summary>
public record WardrobePagedResult(
    IReadOnlyList<ClothingItem> Items,
    string?                     NextContinuationToken);

/// <summary>
/// Paged result envelope returned by <see cref="IWardrobeRepository.GetDraftsAsync"/>.
/// </summary>
public record WardrobeDraftsResult(
    IReadOnlyList<ClothingItem> Items,
    string?                     NextContinuationToken);
