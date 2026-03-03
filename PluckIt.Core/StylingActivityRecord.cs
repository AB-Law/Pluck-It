using System.Text.Json.Serialization;

namespace PluckIt.Core;

[JsonConverter(typeof(JsonStringEnumConverter<StylingActivityType>))]
public enum StylingActivityType
{
  AddedToStyleBoard,
}

[JsonConverter(typeof(JsonStringEnumConverter<WearSuggestionStatus>))]
public enum WearSuggestionStatus
{
  Pending,
  Accepted,
  Dismissed,
  Expired,
}

/// <summary>
/// Captures styling activity and optional wear-suggestion lifecycle state.
/// Stored in dedicated StylingActivity container.
/// </summary>
public class StylingActivityRecord
{
  public string Id { get; set; } = default!;
  public string UserId { get; set; } = default!;
  public string ItemId { get; set; } = default!;
  public string? ClientEventId { get; set; }
  public StylingActivityType ActivityType { get; set; } = StylingActivityType.AddedToStyleBoard;
  public string? Source { get; set; }
  public DateTimeOffset OccurredAt { get; set; }
  public WearSuggestionStatus Status { get; set; } = WearSuggestionStatus.Pending;
  public string? SuggestionMessage { get; set; }
  public DateTimeOffset? ExpiresAt { get; set; }
  public string? LinkedWearEventId { get; set; }
  public DateTimeOffset LastUpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class StylingActivityRequest
{
  public string? ClientEventId { get; set; }
  public string ItemId { get; set; } = string.Empty;
  public StylingActivityType ActivityType { get; set; } = StylingActivityType.AddedToStyleBoard;
  public string? Source { get; set; }
  public DateTimeOffset? OccurredAt { get; set; }
}

public record StylingActivityResponse(string Status, string ActivityId);

public class WearSuggestionItem
{
  public string SuggestionId { get; set; } = default!;
  public string ItemId { get; set; } = default!;
  public string Message { get; set; } = default!;
  public DateTimeOffset ActivityAt { get; set; }
  public DateTimeOffset? ExpiresAt { get; set; }
}

public class WearSuggestionsResponse
{
  public IReadOnlyList<WearSuggestionItem> Suggestions { get; set; } = [];
}

public class UpdateWearSuggestionStatusRequest
{
  public WearSuggestionStatus Status { get; set; }
}

public record UpdateWearSuggestionStatusResponse(string Status);

