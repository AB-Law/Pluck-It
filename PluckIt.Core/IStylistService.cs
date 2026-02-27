using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

public interface IStylistService
{
  Task<IReadOnlyCollection<OutfitRecommendation>> GetRecommendationsAsync(
    IEnumerable<ClothingItem> wardrobe,
    StylistRequest request,
    CancellationToken cancellationToken = default);
}

