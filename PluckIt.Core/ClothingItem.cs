using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace PluckIt.Core;

public record ClothingColour(string Name, string Hex);

/// <summary>
/// Clothing size, structured by category type.
/// All fields are optional — only the relevant fields for the item's category will be populated.
/// - Tops / Knitwear / Outerwear / Dresses / Activewear / Swimwear / Underwear → Letter
/// - Bottoms → Waist + Inseam
/// - Footwear → ShoeSize
/// System is sourced from the user's profile preference ("US" | "EU" | "UK").
/// </summary>
public class ClothingSize
{
  /// <summary>Letter size: XS, S, M, L, XL, XXL, XXXL</summary>
  public string? Letter { get; set; }

  /// <summary>Trouser waist in inches (e.g. 32)</summary>
  public int? Waist { get; set; }

  /// <summary>Trouser inseam in inches (e.g. 30)</summary>
  public int? Inseam { get; set; }

  /// <summary>Shoe size as a decimal (e.g. 10.5)</summary>
  public decimal? ShoeSize { get; set; }

  /// <summary>Measurement system the values are expressed in: "US" | "EU" | "UK"</summary>
  public string? System { get; set; }
}

/// <summary>
/// Structured pricing information for a clothing item.
/// StoredAmount is in OriginalCurrency; the UI converts to the user's preferred currency at display time.
/// </summary>
public class ClothingPrice
{
  /// <summary>Purchase price in OriginalCurrency.</summary>
  public decimal Amount { get; set; }

  /// <summary>ISO 4217 currency code at time of purchase, e.g. "USD", "INR", "GBP".</summary>
  public string OriginalCurrency { get; set; } = "USD";

  /// <summary>ISO date string of the purchase, e.g. "2024-11-20". Mirrors the top-level PurchaseDate.</summary>
  public string? PurchaseDate { get; set; }
}

/// <summary>Subjective condition grade for a clothing item.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ItemCondition>))]
public enum ItemCondition
{
  New,
  Excellent,
  Good,
  Fair
}

/// <summary>
/// Lifecycle state for upload drafts. Null on finalized wardrobe items.
/// Processing → Ready (success) or Failed (error). Failed → Processing again via retry.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<DraftStatus>))]
public enum DraftStatus
{
  Processing,
  Ready,
  Failed
}

public class ClothingItem
{
  public string Id { get; set; } = default!;
  public string UserId { get; set; } = string.Empty;
  public string ImageUrl { get; set; } = default!;
  public IReadOnlyCollection<string> Tags { get; set; } = Array.Empty<string>();
  public IReadOnlyCollection<ClothingColour> Colours { get; set; } = Array.Empty<ClothingColour>();
  public string? Brand { get; set; }
  public string? Category { get; set; }

  /// <summary>
  /// Structured price object — replaces the old flat decimal Price field.
  /// Clients reading the old flat field will migrate on next PUT.
  /// </summary>
  public ClothingPrice? Price { get; set; }

  public string? Notes { get; set; }
  public DateTimeOffset? DateAdded { get; set; }

  // ── Digital Vault analytics ──────────────────────────────────────────────
  /// <summary>Number of times this item has been worn. Incremented via PATCH /wardrobe/{id}/wear.</summary>
  public int WearCount { get; set; } = 0;

  // ── Semantic Search ───────────────────────────────────────────────────────
  /// <summary>Vector embedding (e.g. 1024-dim from Cohere) representing the visual content of the item.</summary>
  public float[]? ImageEmbedding { get; set; }

  /// <summary>UTC timestamp of the most recent wear event. Null if never worn.</summary>
  public DateTimeOffset? LastWornAt { get; set; }

  /// <summary>
  /// Rolling log of the last ≤30 wear events (oldest trimmed on overflow).
  /// Each event captures when, what occasion, and optionally the weather conditions.
  /// </summary>
  public List<WearEvent> WearEvents { get; set; } = [];

  /// <summary>
  /// Last client-supplied wear action id processed for this item.
  /// Used as a lightweight idempotency guard for repeated PATCH /wardrobe/{id}/wear calls.
  /// </summary>
  public string? LastWearActionId { get; set; }

  /// <summary>Estimated current resale/market value in the item's OriginalCurrency.</summary>
  public decimal? EstimatedMarketValue { get; set; }

  // ── Enrichment metadata (populated in the "Enrich Your Item" modal) ───────
  public string? PurchaseDate { get; set; }                                // ISO date, e.g. "2024-11-20"
  public IReadOnlyCollection<string>? CareInfo { get; set; }               // "dry_clean" | "wash" | "iron" | "bleach"
  public ItemCondition? Condition { get; set; }
  public ClothingSize? Size { get; set; }

  /// <summary>
  /// Aesthetic / style tags, e.g. ["Formal", "Luxe", "Casual", "Urban"].
  /// Used for Digital Vault smart-group filtering and AI stylist context.
  /// </summary>
  public IReadOnlyCollection<string>? AestheticTags { get; set; }

  // ── Draft lifecycle fields (null on all finalized wardrobe items) ─────────

  /// <summary>Present only while item is an upload draft. Null once accepted.</summary>
  public DraftStatus? DraftStatus { get; set; }

  /// <summary>Human-readable error message when DraftStatus == Failed.</summary>
  public string? DraftError { get; set; }

  /// <summary>Raw (unprocessed) image blob URL. Used for server-side retry. Removed on accept.</summary>
  public string? RawImageBlobUrl { get; set; }

  /// <summary>UTC timestamp when this draft was first created. Used as cleanup baseline.</summary>
  public DateTimeOffset? DraftCreatedAt { get; set; }

  /// <summary>UTC timestamp of the most recent draft state transition. Used as staleness clock.</summary>
  public DateTimeOffset? DraftUpdatedAt { get; set; }
}
