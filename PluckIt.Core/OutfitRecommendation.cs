using System.Collections.Generic;

namespace PluckIt.Core;

public class OutfitRecommendation
{
  public string Id { get; set; } = default!;
  public string Title { get; set; } = default!;
  public string Description { get; set; } = default!;
  public IReadOnlyCollection<string> ClothingItemIds { get; set; } = new List<string>();
}

public class StylistRequest
{
  public string? StylePrompt { get; set; }
  public string? Occasion { get; set; }
  public IReadOnlyCollection<string>? PreferredColors { get; set; }
  public IReadOnlyCollection<string>? ExcludedColors { get; set; }
  public int? PageSize { get; set; }
  public int? MinWears { get; set; }
  public int? MaxWears { get; set; }
  public string? Category { get; set; }
}

