using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

public sealed class InMemoryWearHistoryRepository : IWearHistoryRepository
{
  private readonly List<WearHistoryRecord> _records = [];

  public IReadOnlyList<WearHistoryRecord> Records => _records.AsReadOnly();

  public Task AddAsync(WearHistoryRecord record, CancellationToken cancellationToken = default)
  {
    _records.Add(record);
    return Task.CompletedTask;
  }

  public Task<IReadOnlyList<WearHistoryRecord>> GetByItemAsync(
    string itemId,
    string userId,
    DateTimeOffset? from = null,
    DateTimeOffset? to = null,
    int maxResults = 366,
    CancellationToken cancellationToken = default)
  {
    var q = _records.Where(r =>
      string.Equals(r.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
      string.Equals(r.ItemId, itemId, StringComparison.OrdinalIgnoreCase));

    if (from.HasValue) q = q.Where(r => r.OccurredAt >= from.Value);
    if (to.HasValue) q = q.Where(r => r.OccurredAt <= to.Value);

    var result = q.OrderByDescending(r => r.OccurredAt)
      .Take(Math.Clamp(maxResults, 1, 5000))
      .ToList();
    return Task.FromResult<IReadOnlyList<WearHistoryRecord>>(result);
  }
}

