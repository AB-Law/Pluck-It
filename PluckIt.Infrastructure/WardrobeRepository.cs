using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class WardrobeRepository : IWardrobeRepository
{
  private readonly CosmosClient _client;
  private readonly string _databaseName;
  private readonly string _containerName;

  public WardrobeRepository(CosmosClient client, string databaseName, string containerName)
  {
    _client = client ?? throw new ArgumentNullException(nameof(client));
    _databaseName = databaseName ?? throw new ArgumentNullException(nameof(databaseName));
    _containerName = containerName ?? throw new ArgumentNullException(nameof(containerName));
  }

  private Container Container => _client.GetContainer(_databaseName, _containerName);

  // Maps the allowlisted sort-field identifiers to Cosmos SQL field references.
  private static readonly Dictionary<string, string> SortFieldMap =
    new(StringComparer.OrdinalIgnoreCase)
    {
      [WardrobeSortField.DateAdded]   = "c.dateAdded",
      [WardrobeSortField.WearCount]   = "c.wearCount",
      [WardrobeSortField.PriceAmount] = "c.price.amount",
    };

  public async Task<WardrobePagedResult> GetAllAsync(
    string userId,
    WardrobeQuery query,
    CancellationToken cancellationToken = default)
  {
    var sql        = "SELECT * FROM c";
    var conditions = new List<string> { "c.userId = @userId" };
    var parameters = new Dictionary<string, object> { ["@userId"] = userId };

    // ── Filters ────────────────────────────────────────────────────────────

    if (!string.IsNullOrWhiteSpace(query.Category))
    {
      conditions.Add("LOWER(c.category) = LOWER(@category)");
      parameters.Add("@category", query.Category.Trim());
    }

    if (!string.IsNullOrWhiteSpace(query.Brand))
    {
      // Case-insensitive brand match via LOWER()
      conditions.Add("LOWER(c.brand) = LOWER(@brand)");
      parameters.Add("@brand", query.Brand.Trim());
    }

    if (query.Condition.HasValue)
    {
      conditions.Add("c.condition = @condition");
      parameters.Add("@condition", query.Condition.Value.ToString());
    }

    if (query.Tags is { Count: > 0 })
    {
      conditions.Add("ARRAY_LENGTH(ARRAY_INTERSECT(c.tags, @tags)) > 0");
      parameters.Add("@tags", query.Tags);
    }

    if (query.AestheticTags is { Count: > 0 })
    {
      conditions.Add("ARRAY_LENGTH(ARRAY_INTERSECT(c.aestheticTags, @aestheticTags)) > 0");
      parameters.Add("@aestheticTags", query.AestheticTags);
    }

    if (query.PriceMin.HasValue)
    {
      conditions.Add("c.price.amount >= @priceMin");
      parameters.Add("@priceMin", query.PriceMin.Value);
    }

    if (query.PriceMax.HasValue)
    {
      conditions.Add("c.price.amount <= @priceMax");
      parameters.Add("@priceMax", query.PriceMax.Value);
    }

    if (query.MinWears.HasValue)
    {
      conditions.Add("c.wearCount >= @minWears");
      parameters.Add("@minWears", query.MinWears.Value);
    }

    if (query.MaxWears.HasValue)
    {
      conditions.Add("c.wearCount <= @maxWears");
      parameters.Add("@maxWears", query.MaxWears.Value);
    }

    if (!query.IncludeWishlisted)
    {
      // Default API behavior should hide wishlist items unless caller explicitly opts in.
      conditions.Add("(NOT IS_DEFINED(c.isWishlisted) OR IS_NULL(c.isWishlisted) OR c.isWishlisted = false)");
    }

    // Exclude upload drafts — items where draftStatus is defined and non-null
    conditions.Add("(NOT IS_DEFINED(c.draftStatus) OR IS_NULL(c.draftStatus))");

    sql += " WHERE " + string.Join(" AND ", conditions);

    // ── Sort ──────────────────────────────────────────────────────────────

    var sortField = SortFieldMap.GetValueOrDefault(query.SortField, "c.dateAdded");
    var sortDir   = string.Equals(query.SortDir, "asc", StringComparison.OrdinalIgnoreCase)
        ? "ASC" : "DESC";

    sql += $" ORDER BY {sortField} {sortDir}";

    // ── Build query definition ────────────────────────────────────────────

    var queryDefinition = new QueryDefinition(sql);
    foreach (var kvp in parameters)
      queryDefinition = queryDefinition.WithParameter(kvp.Key, kvp.Value);

    // ── Continuation-token paging ─────────────────────────────────────────

    var pageSize = Math.Clamp(query.PageSize, 1, 100);
    var iterator = Container.GetItemQueryIterator<ClothingItem>(
      queryDefinition,
      continuationToken: query.ContinuationToken,
      requestOptions: new QueryRequestOptions
      {
        MaxItemCount = pageSize,
        PartitionKey = new PartitionKey(userId),
      });

    if (!iterator.HasMoreResults)
      return new WardrobePagedResult([], null);

    var page = await iterator.ReadNextAsync(cancellationToken);
    return new WardrobePagedResult(page.ToList(), page.ContinuationToken);
  }

  public async Task<ClothingItem?> GetByIdAsync(
    string id,
    string userId,
    CancellationToken cancellationToken = default)
  {
    try
    {
      var response = await Container.ReadItemAsync<ClothingItem>(
        id,
        new PartitionKey(userId),
        cancellationToken: cancellationToken);
      return response.Resource;
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
    {
      return null;
    }
  }

  public async Task UpsertAsync(
    ClothingItem item,
    CancellationToken cancellationToken = default)
  {
    await Container.UpsertItemAsync(
      item,
      new PartitionKey(item.UserId),
      cancellationToken: cancellationToken);
  }

    public async Task DeleteAsync(
    string id,
    string userId,
    CancellationToken cancellationToken = default)
  {
    try
    {
      await Container.DeleteItemAsync<ClothingItem>(
        id,
        new PartitionKey(userId),
        cancellationToken: cancellationToken);
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
    {
      // Already deleted — treat as success
    }
  }

  public async Task<ClothingItem?> AppendWearEventAsync(
    string itemId,
    string userId,
    WearEvent ev,
    string? clientEventId = null,
    int maxEvents = 30,
    CancellationToken cancellationToken = default)
  {
    // Read current item to build trimmed event list
    var item = await GetByIdAsync(itemId, userId, cancellationToken);
    if (item is null) return null;

    // Idempotency: duplicate client event ids must not increment twice.
    if (!string.IsNullOrWhiteSpace(clientEventId) &&
        string.Equals(item.LastWearActionId, clientEventId, StringComparison.Ordinal))
      return item;

    // Build new events list: append + trim oldest beyond maxEvents
    var events = new List<WearEvent>(item.WearEvents ?? []) { ev };
    if (events.Count > maxEvents)
      events = events.OrderByDescending(e => e.OccurredAt).Take(maxEvents).ToList();

    // Compute new wear count from the current item to avoid relying on Increment
    // for missing fields — Cosmos Patch Increment fails if the field doesn't exist.
    var newWearCount = item.WearCount + 1;

    // Apply all changes via Cosmos Patch API (atomic, no full-document round-trip for the write)
    var patchOps = new List<PatchOperation>
    {
      PatchOperation.Set("/wearCount", newWearCount),
      PatchOperation.Set("/lastWornAt", ev.OccurredAt),
      PatchOperation.Set("/wearEvents", events),
    };
    if (!string.IsNullOrWhiteSpace(clientEventId))
      patchOps.Add(PatchOperation.Set("/lastWearActionId", clientEventId));

    var response = await Container.PatchItemAsync<ClothingItem>(
      itemId,
      new PartitionKey(userId),
      patchOps,
      cancellationToken: cancellationToken);

    return response.Resource;
  }

  public async Task<WardrobeDraftsResult> GetDraftsAsync(
    string userId,
    int pageSize = 50,
    string? continuationToken = null,
    CancellationToken cancellationToken = default)
  {
    const string sql = """
      SELECT * FROM c
      WHERE c.userId = @userId
        AND IS_DEFINED(c.draftStatus)
        AND NOT IS_NULL(c.draftStatus)
      ORDER BY c.draftCreatedAt DESC
      """;

    var queryDefinition = new QueryDefinition(sql)
        .WithParameter("@userId", userId);

    var clampedSize = Math.Clamp(pageSize, 1, 50);
    var iterator = Container.GetItemQueryIterator<ClothingItem>(
      queryDefinition,
      continuationToken: continuationToken,
      requestOptions: new QueryRequestOptions
      {
        MaxItemCount = clampedSize,
        PartitionKey = new PartitionKey(userId),
      });

    if (!iterator.HasMoreResults)
      return new WardrobeDraftsResult([], null);

    var page = await iterator.ReadNextAsync(cancellationToken);
    return new WardrobeDraftsResult(page.ToList(), page.ContinuationToken);
  }

  public async Task<bool> SetDraftTerminalAsync(
    string itemId,
    string userId,
    DraftStatus terminalStatus,
    string? processedBlobUrl,
    ClothingMetadata? metadata,
    string? errorMessage,
    CancellationToken cancellationToken = default)
  {
    var now = DateTimeOffset.UtcNow;
    var ops = new List<PatchOperation>
    {
      PatchOperation.Set("/draftStatus", terminalStatus.ToString()),
      PatchOperation.Set("/draftUpdatedAt", now),
    };

    if (terminalStatus == DraftStatus.Ready)
    {
      if (!string.IsNullOrEmpty(processedBlobUrl))
        ops.Add(PatchOperation.Set("/imageUrl", processedBlobUrl));
      if (metadata is not null)
      {
        ops.Add(PatchOperation.Set("/brand",    (object?)metadata.Brand));
        ops.Add(PatchOperation.Set("/category", (object?)metadata.Category));
        ops.Add(PatchOperation.Set("/tags",     metadata.Tags));
        ops.Add(PatchOperation.Set("/colours",  metadata.Colours));
      }
    }

    if (terminalStatus == DraftStatus.Failed)
      ops.Add(PatchOperation.Set("/draftError", errorMessage ?? "Unknown error"));

    var options = new PatchItemRequestOptions
    {
      FilterPredicate = "FROM c WHERE c.draftStatus = 'Processing'"
    };

    try
    {
      await Container.PatchItemAsync<ClothingItem>(
        itemId, new PartitionKey(userId), ops, options, cancellationToken);
      return true;
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.PreconditionFailed)
    {
      // Predicate missed — item already transitioned (accepted, retried, or deleted).
      // Silently discard this late write.
      return false;
    }
  }

  public async Task<ClothingItem?> AcceptDraftAsync(
    string itemId,
    string userId,
    DateTimeOffset finalizedAt,
    CancellationToken cancellationToken = default)
  {
    var ops = new List<PatchOperation>
    {
      PatchOperation.Remove("/draftStatus"),
      PatchOperation.Remove("/draftUpdatedAt"),
      PatchOperation.Remove("/draftCreatedAt"),
      PatchOperation.Remove("/rawImageBlobUrl"),
      PatchOperation.Set("/dateAdded", finalizedAt),
    };

    // Remove draftError only if it exists (patch Remove on a missing field throws)
    // We handle this by attempting the full patch; since we know Ready items
    // never have draftError set, this is safe.

    var options = new PatchItemRequestOptions
    {
      FilterPredicate = "FROM c WHERE c.draftStatus = 'Ready'"
    };

    try
    {
      var result = await Container.PatchItemAsync<ClothingItem>(
        itemId, new PartitionKey(userId), ops, options, cancellationToken);
      return result.Resource;
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.PreconditionFailed)
    {
      // Item is not in Ready state — race condition or wrong state.
      return null;
    }
  }

  public async Task<IReadOnlyList<ClothingItem>> GetByDraftStatusAsync(
    DraftStatus status,
    DateTimeOffset olderThan,
    int maxItems = 200,
    CancellationToken cancellationToken = default)
  {
    // draftUpdatedAt takes priority; fall back to draftCreatedAt for items that were
    // never updated (i.e. still stuck in Processing since first write).
    const string sql = """
      SELECT * FROM c
      WHERE IS_DEFINED(c.draftStatus)
        AND c.draftStatus = @status
        AND (c.draftUpdatedAt < @cutoff OR (NOT IS_DEFINED(c.draftUpdatedAt) AND c.draftCreatedAt < @cutoff))
      """;

    var queryDefinition = new QueryDefinition(sql)
        .WithParameter("@status", status.ToString())
        .WithParameter("@cutoff", olderThan);

    var iterator = Container.GetItemQueryIterator<ClothingItem>(
      queryDefinition,
      requestOptions: new QueryRequestOptions
      {
        MaxItemCount = maxItems,
        // No PartitionKey — cross-partition query intentional for cleanup timer
      });

    var results = new List<ClothingItem>();
    while (iterator.HasMoreResults && results.Count < maxItems)
    {
      var page = await iterator.ReadNextAsync(cancellationToken);
      results.AddRange(page);
    }
    return results;
  }
}
