namespace PluckIt.Core;

/// <summary>
/// Full-fidelity wear history record persisted in a dedicated WearEvents container.
/// </summary>
public class WearHistoryRecord
{
  public string Id { get; set; } = default!;
  public string UserId { get; set; } = default!;
  public string ItemId { get; set; } = default!;
  public DateTimeOffset OccurredAt { get; set; }
  public string? Source { get; set; }
  public string? Occasion { get; set; }
  public WeatherSnapshot? WeatherSnapshot { get; set; }
  public string? StylingActivityId { get; set; }
  public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class WearHistorySummary
{
  public int TotalInRange { get; set; }
  public DateTimeOffset? TrackedFrom { get; set; }
  public int LegacyUntrackedCount { get; set; }
}

public class WearHistoryResponse
{
  public string ItemId { get; set; } = default!;
  public IReadOnlyList<WearHistoryRecord> Events { get; set; } = [];
  public WearHistorySummary Summary { get; set; } = new();
}

public static class WearLogSources
{
  public const string VaultCard = "vault_card";
  public const string ItemDrawer = "item_drawer";
  public const string SuggestionPrompt = "suggestion_prompt";
  public const string Unknown = "unknown";
}
