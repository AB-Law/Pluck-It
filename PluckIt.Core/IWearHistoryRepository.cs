namespace PluckIt.Core;

public interface IWearHistoryRepository
{
  Task AddAsync(WearHistoryRecord record, CancellationToken cancellationToken = default);

  Task<IReadOnlyList<WearHistoryRecord>> GetByItemAsync(
    string itemId,
    string userId,
    DateTimeOffset? from = null,
    DateTimeOffset? to = null,
    int maxResults = 366,
    CancellationToken cancellationToken = default);
}

