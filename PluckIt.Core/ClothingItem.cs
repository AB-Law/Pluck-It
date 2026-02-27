using System;
using System.Collections.Generic;

namespace PluckIt.Core;

public record ClothingColour(string Name, string Hex);

public class ClothingItem
{
  public string Id { get; set; } = default!;
  public string ImageUrl { get; set; } = default!;
  public IReadOnlyCollection<string> Tags { get; set; } = Array.Empty<string>();
  public IReadOnlyCollection<ClothingColour> Colours { get; set; } = Array.Empty<ClothingColour>();
  public string? Brand { get; set; }
  public string? Category { get; set; }
  public decimal? Price { get; set; }
  public string? Notes { get; set; }
  public DateTimeOffset DateAdded { get; set; }
}

