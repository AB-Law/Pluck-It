using System.Text.Json.Serialization;

namespace PluckIt.Core;

public class VaultInsightsResponse
{
  public DateTimeOffset GeneratedAt { get; set; }
  public string Currency { get; set; } = "USD";
  public bool InsufficientData { get; set; }
  public string? FxDate { get; set; }
  public string? ConversionStatus { get; set; }
  public VaultBehavioralInsights BehavioralInsights { get; set; } = new();
  public IReadOnlyList<CpwIntelItem> CpwIntel { get; set; } = [];
}

public class VaultBehavioralInsights
{
  public TopColorWearShare? TopColorWearShare { get; set; }
  public double? Unworn90dPct { get; set; }
  public ExpensiveUnwornItem? MostExpensiveUnworn { get; set; }
  public bool SparseHistory { get; set; }
}

public class TopColorWearShare
{
  public string Color { get; set; } = default!;
  public double Pct { get; set; }
}

public class ExpensiveUnwornItem
{
  public string ItemId { get; set; } = default!;
  public decimal Amount { get; set; }
  public string Currency { get; set; } = "USD";
}

public class CpwIntelItem
{
  public string ItemId { get; set; } = default!;
  public decimal? Cpw { get; set; }
  public string Badge { get; set; } = "unworn";
  public bool BreakEvenReached { get; set; }
  public decimal BreakEvenTargetCpw { get; set; }
  public CpwForecast? Forecast { get; set; }
  /// <summary>Recent rolling wear-rate direction versus historical behavior.</summary>
  public WearRateTrendType? WearRateTrend { get; set; }
  /// <summary>Recent rolling wear rate used for trend and projection logic.</summary>
  public decimal? RecentWearRate { get; set; }
  /// <summary>Historical average wear rate over the item's ownership window.</summary>
  public decimal? HistoricalWearRate { get; set; }
  /// <summary>Recent minus historical wear-rate delta.</summary>
  public decimal? WearRateDelta { get; set; }
}

public class CpwForecast
{
  public decimal TargetCpw { get; set; }
  public string? ProjectedMonth { get; set; }
  public int? ProjectedWearsNeeded { get; set; }
  /// <summary>Recent rolling wear rate used for projection text and confidence checks.</summary>
  public decimal? RecentWearRate { get; set; }
  /// <summary>Historical average wear rate used to contextualize trend direction.</summary>
  public decimal? HistoricalWearRate { get; set; }
  /// <summary>Recent rolling wear-rate direction versus historical behavior.</summary>
  public WearRateTrendType? WearRateTrend { get; set; }
}

/// <summary>Normalized direction values for CPW wear-rate trend signals.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum WearRateTrendType
{
  Up,
  Down,
  Stable,
}
