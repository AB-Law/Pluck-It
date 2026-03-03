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
      parameters.Add("@priceMin", (double)query.PriceMin.Value);
    }

    if (query.PriceMax.HasValue)
    {
      conditions.Add("c.price.amount <= @priceMax");
      parameters.Add("@priceMax", (double)query.PriceMax.Value);
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
    int maxEvents = 30,
    CancellationToken cancellationToken = default)
  {
    // Read current item to build trimmed event list
    var item = await GetByIdAsync(itemId, userId, cancellationToken);
    if (item is null) return null;

    // Build new events list: append + trim oldest beyond maxEvents
    var events = new List<WearEvent>(item.WearEvents) { ev };
    if (events.Count > maxEvents)
      events = events.OrderByDescending(e => e.OccurredAt).Take(maxEvents).ToList();

    // Apply all changes via Cosmos Patch API (atomic, no full-document round-trip for the write)
    var patchOps = new List<PatchOperation>
    {
      PatchOperation.Increment("/wearCount", 1),
      PatchOperation.Set("/lastWornAt", ev.OccurredAt),
      PatchOperation.Set("/wearEvents", events),
    };

    var response = await Container.PatchItemAsync<ClothingItem>(
      itemId,
      new PartitionKey(userId),
      patchOps,
      cancellationToken: cancellationToken);

    return response.Resource;
  }
}

