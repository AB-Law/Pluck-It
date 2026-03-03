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
  public double? BlackWearSharePct { get; set; }
  public double? Unworn90dPct { get; set; }
  public ExpensiveUnwornItem? MostExpensiveUnworn { get; set; }
  public bool SparseHistory { get; set; }
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
}

public class CpwForecast
{
  public decimal TargetCpw { get; set; }
  public string? ProjectedMonth { get; set; }
  public int? ProjectedWearsNeeded { get; set; }
}

