using System;
using System.Collections.Generic;

namespace PluckIt.Core;

public record ClothingColour(string Name, string Hex);

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
}

