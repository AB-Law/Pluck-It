using Microsoft.Azure.Cosmos;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class WearHistoryRepository : IWearHistoryRepository
{
  private readonly CosmosClient _client;
  private readonly string _databaseName;
  private readonly string _containerName;

  public WearHistoryRepository(CosmosClient client, string databaseName, string containerName)
  {
    _client = client ?? throw new ArgumentNullException(nameof(client));
    _databaseName = databaseName ?? throw new ArgumentNullException(nameof(databaseName));
    _containerName = containerName ?? throw new ArgumentNullException(nameof(containerName));
  }

  private Container Container => _client.GetContainer(_databaseName, _containerName);

  public async Task AddAsync(WearHistoryRecord record, CancellationToken cancellationToken = default)
  {
    await Container.UpsertItemAsync(record, new PartitionKey(record.UserId), cancellationToken: cancellationToken);
  }

  public async Task<IReadOnlyList<WearHistoryRecord>> GetByItemAsync(
    string itemId,
    string userId,
    DateTimeOffset? from = null,
    DateTimeOffset? to = null,
    int maxResults = 366,
    CancellationToken cancellationToken = default)
  {
    var safeMaxResults = Math.Clamp(maxResults, 1, 1000);

    var sql = "SELECT * FROM c WHERE c.userId = @userId AND c.itemId = @itemId";
    if (from.HasValue) sql += " AND c.occurredAt >= @from";
    if (to.HasValue) sql += " AND c.occurredAt <= @to";
    sql += " ORDER BY c.occurredAt DESC";

    var q = new QueryDefinition(sql)
      .WithParameter("@userId", userId)
      .WithParameter("@itemId", itemId);
    if (from.HasValue) q = q.WithParameter("@from", from.Value);
    if (to.HasValue) q = q.WithParameter("@to", to.Value);

    var results = new List<WearHistoryRecord>();
    var iterator = Container.GetItemQueryIterator<WearHistoryRecord>(
      q,
      requestOptions: new QueryRequestOptions
      {
        PartitionKey = new PartitionKey(userId),
        MaxItemCount = safeMaxResults,
      });

    while (iterator.HasMoreResults && results.Count < safeMaxResults)
    {
      var page = await iterator.ReadNextAsync(cancellationToken);
      results.AddRange(page);
    }

    return results.Take(safeMaxResults).ToList();
  }
}

