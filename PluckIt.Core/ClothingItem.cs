using System;
using System.Collections.Generic;

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

public class ClothingItem
{
  public string Id { get; set; } = default!;
  public string UserId { get; set; } = string.Empty;
  public string ImageUrl { get; set; } = default!;
  public IReadOnlyCollection<string> Tags { get; set; } = Array.Empty<string>();
  public IReadOnlyCollection<ClothingColour> Colours { get; set; } = Array.Empty<ClothingColour>();
  public string? Brand { get; set; }
  public string? Category { get; set; }
  public decimal? Price { get; set; }
  public string? Notes { get; set; }
  public DateTimeOffset? DateAdded { get; set; }

  // User-enriched in the "Enrich Your Item" modal after upload
  public string? PurchaseDate { get; set; }                          // ISO date, e.g. "2024-11-20"
  public IReadOnlyCollection<string>? CareInfo { get; set; }         // "dry_clean" | "wash" | "iron" | "bleach"
  public string? Condition { get; set; }                             // "New" | "Excellent" | "Good" | "Fair"
  public ClothingSize? Size { get; set; }
}

