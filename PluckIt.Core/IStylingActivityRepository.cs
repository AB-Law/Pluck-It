namespace PluckIt.Core;

public interface IStylingActivityRepository
{
  Task<StylingActivityRecord> UpsertAsync(
    StylingActivityRecord record,
    CancellationToken cancellationToken = default);

  Task<IReadOnlyList<StylingActivityRecord>> GetPendingSuggestionsAsync(
    string userId,
    DateTimeOffset nowUtc,
    int maxResults = 20,
    CancellationToken cancellationToken = default);

  Task<StylingActivityRecord?> GetByClientEventIdAsync(
    string userId,
    string clientEventId,
    CancellationToken cancellationToken = default);

  Task<StylingActivityRecord?> UpdateSuggestionStatusAsync(
    string suggestionId,
    string userId,
    WearSuggestionStatus status,
    string? linkedWearEventId = null,
    CancellationToken cancellationToken = default);
}

