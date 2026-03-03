using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

public sealed class InMemoryStylingActivityRepository : IStylingActivityRepository
{
  private readonly List<StylingActivityRecord> _records = [];

  public IReadOnlyList<StylingActivityRecord> Records => _records.AsReadOnly();

  public Task<StylingActivityRecord> UpsertAsync(
    StylingActivityRecord record,
    CancellationToken cancellationToken = default)
  {
    var idx = _records.FindIndex(r =>
      string.Equals(r.Id, record.Id, StringComparison.OrdinalIgnoreCase) &&
      string.Equals(r.UserId, record.UserId, StringComparison.OrdinalIgnoreCase));
    if (idx >= 0) _records[idx] = record;
    else _records.Add(record);
    return Task.FromResult(record);
  }

  public Task<IReadOnlyList<StylingActivityRecord>> GetPendingSuggestionsAsync(
    string userId,
    DateTimeOffset nowUtc,
    int maxResults = 20,
    CancellationToken cancellationToken = default)
  {
    var result = _records
      .Where(r =>
        string.Equals(r.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
        r.Status == WearSuggestionStatus.Pending &&
        (!r.ExpiresAt.HasValue || r.ExpiresAt.Value >= nowUtc))
      .OrderByDescending(r => r.OccurredAt)
      .Take(Math.Clamp(maxResults, 1, 100))
      .ToList();
    return Task.FromResult<IReadOnlyList<StylingActivityRecord>>(result);
  }

  public Task<StylingActivityRecord?> GetByClientEventIdAsync(
    string userId,
    string clientEventId,
    CancellationToken cancellationToken = default)
  {
    var item = _records.FirstOrDefault(r =>
      string.Equals(r.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
      string.Equals(r.ClientEventId, clientEventId, StringComparison.Ordinal));
    return Task.FromResult(item);
  }

  public Task<StylingActivityRecord?> UpdateSuggestionStatusAsync(
    string suggestionId,
    string userId,
    WearSuggestionStatus status,
    string? linkedWearEventId = null,
    CancellationToken cancellationToken = default)
  {
    var item = _records.FirstOrDefault(r =>
      string.Equals(r.Id, suggestionId, StringComparison.OrdinalIgnoreCase) &&
      string.Equals(r.UserId, userId, StringComparison.OrdinalIgnoreCase));
    if (item is null) return Task.FromResult<StylingActivityRecord?>(null);

    item.Status = status;
    item.LinkedWearEventId = linkedWearEventId ?? item.LinkedWearEventId;
    item.LastUpdatedAt = DateTimeOffset.UtcNow;
    return Task.FromResult<StylingActivityRecord?>(item);
  }
}

