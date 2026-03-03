namespace PluckIt.Core;

/// <summary>
/// Stores a user's physical measurements, display preferences, and style identity.
/// Persisted in Cosmos DB in the user-profiles container (partition key: /id = userId).
/// </summary>
public class UserProfile
{
  /// <summary>Cosmos document id AND the user's Google sub (userId).</summary>
  public string Id { get; set; } = default!;

  // ── Body measurements (all metric, optional) ─────────────────────────────

  /// <summary>Height in centimetres.</summary>
  public decimal? HeightCm { get; set; }

  /// <summary>Weight in kilograms.</summary>
  public decimal? WeightKg { get; set; }

  /// <summary>Chest/bust circumference in centimetres.</summary>
  public decimal? ChestCm { get; set; }

  /// <summary>Natural waist circumference in centimetres.</summary>
  public decimal? WaistCm { get; set; }

  /// <summary>Hip circumference in centimetres.</summary>
  public decimal? HipsCm { get; set; }

  /// <summary>Inseam length in centimetres.</summary>
  public decimal? InseamCm { get; set; }

  // ── Display preferences ──────────────────────────────────────────────────

  /// <summary>ISO 4217 currency code, e.g. "USD", "EUR", "INR". Defaults to "USD".</summary>
  public string CurrencyCode { get; set; } = "USD";

  /// <summary>Preferred clothing size system: "US" | "EU" | "UK". Defaults to "US".</summary>
  public string PreferredSizeSystem { get; set; } = "US";

  // ── Style identity (used by the AI stylist agent) ────────────────────────

  /// <summary>
  /// One or more aesthetic styles the user identifies with.
  /// e.g. ["streetwear", "preppy", "minimalist", "smart casual", "athleisure",
  ///        "bohemian", "classic", "techwear", "y2k"]
  /// </summary>
  public List<string> StylePreferences { get; set; } = [];

  /// <summary>
  /// Brands the user gravitates toward, used for personalised purchase suggestions.
  /// e.g. ["Nike", "COS", "Zara"]
  /// </summary>
  public List<string> FavoriteBrands { get; set; } = [];

  /// <summary>
  /// Colours the user tends to prefer when picking clothes.
  /// Free-form strings: "earth tones", "black", "pastels", etc.
  /// </summary>
  public List<string> PreferredColours { get; set; } = [];

  /// <summary>
  /// City used by the stylist agent's weather tool to surface climate-appropriate suggestions.
  /// e.g. "London", "New York"
  /// </summary>
  public string? LocationCity { get; set; }

  // ── Wardrobe change detection (used by the digest agent) ─────────────────

  /// <summary>
  /// Lightweight hash of all wardrobe item IDs at the time of the last digest run.
  /// The digest agent skips the full analysis when the hash is unchanged.
  /// </summary>
  public string? WardrobeHashAtLastDigest { get; set; }

  // ── Personalization graph fields (AI-inferred, never user-declared) ────────

  /// <summary>
  /// Whether the user has opted in to personalized recommendations.
  /// Defaults to true. When false the digest and stylist agents skip preference scoring.
  /// </summary>
  public bool RecommendationOptIn { get; set; } = true;

  /// <summary>
  /// AI-inferred style confidence score in the range [0, 1].
  /// Represents how strongly the user's wear history aligns with their declared style preferences.
  /// Updated after each digest run. Null until at least one digest has run.
  /// </summary>
  public double? StyleConfidenceProfile { get; set; }

  /// <summary>
  /// AI-inferred climate zone based on LocationCity and seasonal wear patterns.
  /// e.g. "temperate", "tropical", "continental", "arid".
  /// Null until inferred. Invalidated when LocationCity changes.
  /// </summary>
  public string? ClimateZone { get; set; }
}
