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

  public async Task<IReadOnlyCollection<ClothingItem>> GetAllAsync(
    string userId,
    string? category,
    IReadOnlyCollection<string>? tags,
    int page,
    int pageSize,
    CancellationToken cancellationToken = default)
  {
    var query = "SELECT * FROM c";
    var conditions = new List<string> { "c.userId = @userId" };
    var parameters = new Dictionary<string, object> { ["@userId"] = userId };

    if (!string.IsNullOrWhiteSpace(category))
    {
      conditions.Add("c.category = @category");
      parameters.Add("@category", category);
    }

    if (tags is { Count: > 0 })
    {
      conditions.Add("ARRAY_LENGTH(ARRAY_INTERSECT(c.tags, @tags)) > 0");
      parameters.Add("@tags", tags);
    }

    query += " WHERE " + string.Join(" AND ", conditions);

    query += " ORDER BY c.dateAdded DESC";

    var queryDefinition = new QueryDefinition(query);
    foreach (var kvp in parameters)
    {
      queryDefinition = queryDefinition.WithParameter(kvp.Key, kvp.Value);
    }

    var iterator = Container.GetItemQueryIterator<ClothingItem>(
      queryDefinition,
      requestOptions: new QueryRequestOptions
      {
        MaxItemCount = pageSize,
        PartitionKey = new PartitionKey(userId)
      });

    var results = new List<ClothingItem>();
    while (iterator.HasMoreResults && results.Count < pageSize * (page + 1))
    {
      var response = await iterator.ReadNextAsync(cancellationToken);
      results.AddRange(response);
    }

    return results
      .Skip(page * pageSize)
      .Take(pageSize)
      .ToList();
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
}

