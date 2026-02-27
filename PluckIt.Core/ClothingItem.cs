using System;
using System.Collections.Generic;

namespace PluckIt.Core;

public class ClothingItem
{
  public string Id { get; set; } = default!;
  public string ImageUrl { get; set; } = default!;
  public IReadOnlyCollection<string> Tags { get; set; } = Array.Empty<string>();
  public string? Brand { get; set; }
  public string? Category { get; set; }
  public DateTimeOffset DateAdded { get; set; }
}

