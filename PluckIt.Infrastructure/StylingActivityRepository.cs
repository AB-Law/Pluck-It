using System.Net;
using Microsoft.Azure.Cosmos;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class StylingActivityRepository : IStylingActivityRepository
{
  private readonly CosmosClient _client;
  private readonly string _databaseName;
  private readonly string _containerName;

  public StylingActivityRepository(CosmosClient client, string databaseName, string containerName)
  {
    _client = client ?? throw new ArgumentNullException(nameof(client));
    _databaseName = databaseName ?? throw new ArgumentNullException(nameof(databaseName));
    _containerName = containerName ?? throw new ArgumentNullException(nameof(containerName));
  }

  private Container Container => _client.GetContainer(_databaseName, _containerName);

  public async Task<StylingActivityRecord> UpsertAsync(
    StylingActivityRecord record,
    CancellationToken cancellationToken = default)
  {
    var response = await Container.UpsertItemAsync(
      record,
      new PartitionKey(record.UserId),
      cancellationToken: cancellationToken);
    return response.Resource;
  }

  public async Task<IReadOnlyList<StylingActivityRecord>> GetPendingSuggestionsAsync(
    string userId,
    DateTimeOffset nowUtc,
    int maxResults = 20,
    CancellationToken cancellationToken = default)
  {
    var q = new QueryDefinition(
      "SELECT * FROM c WHERE c.userId = @userId AND c.status = @status " +
      "AND (NOT IS_DEFINED(c.expiresAt) OR IS_NULL(c.expiresAt) OR c.expiresAt >= @now) " +
      "ORDER BY c.occurredAt DESC")
      .WithParameter("@userId", userId)
      .WithParameter("@status", WearSuggestionStatus.Pending.ToString())
      .WithParameter("@now", nowUtc);

    var results = new List<StylingActivityRecord>();
    var iterator = Container.GetItemQueryIterator<StylingActivityRecord>(
      q,
      requestOptions: new QueryRequestOptions
      {
        PartitionKey = new PartitionKey(userId),
        MaxItemCount = Math.Clamp(maxResults, 1, 100),
      });

    while (iterator.HasMoreResults && results.Count < maxResults)
    {
      var page = await iterator.ReadNextAsync(cancellationToken);
      results.AddRange(page);
    }

    return results.Take(maxResults).ToList();
  }

  public async Task<StylingActivityRecord?> GetByClientEventIdAsync(
    string userId,
    string clientEventId,
    CancellationToken cancellationToken = default)
  {
    var q = new QueryDefinition(
      "SELECT TOP 1 * FROM c WHERE c.userId = @userId AND c.clientEventId = @clientEventId")
      .WithParameter("@userId", userId)
      .WithParameter("@clientEventId", clientEventId);

    var iterator = Container.GetItemQueryIterator<StylingActivityRecord>(
      q,
      requestOptions: new QueryRequestOptions
      {
        PartitionKey = new PartitionKey(userId),
        MaxItemCount = 1,
      });

    if (!iterator.HasMoreResults) return null;
    var page = await iterator.ReadNextAsync(cancellationToken);
    return page.FirstOrDefault();
  }

  public async Task<StylingActivityRecord?> UpdateSuggestionStatusAsync(
    string suggestionId,
    string userId,
    WearSuggestionStatus status,
    string? linkedWearEventId = null,
    CancellationToken cancellationToken = default)
  {
    try
    {
      var item = await Container.ReadItemAsync<StylingActivityRecord>(
        suggestionId,
        new PartitionKey(userId),
        cancellationToken: cancellationToken);

      var patch = new List<PatchOperation>
      {
        PatchOperation.Set("/status", status.ToString()),
        PatchOperation.Set("/lastUpdatedAt", DateTimeOffset.UtcNow),
      };
      if (!string.IsNullOrWhiteSpace(linkedWearEventId))
        patch.Add(PatchOperation.Set("/linkedWearEventId", linkedWearEventId));

      var response = await Container.PatchItemAsync<StylingActivityRecord>(
        item.Resource.Id,
        new PartitionKey(userId),
        patch,
        cancellationToken: cancellationToken);

      return response.Resource;
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
    {
      return null;
    }
  }
}

