using System.Linq;
using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

/// <summary>
/// Fake <see cref="IStylistService"/> that returns two hardcoded <see cref="OutfitRecommendation"/> objects.
/// Swap <see cref="Response"/> to test different combinations.
/// </summary>
public sealed class FakeStylistService : IStylistService
{
    public List<ClothingItem>? LastWardrobe { get; private set; }
    public StylistRequest? LastRequest { get; private set; }

    public IReadOnlyCollection<OutfitRecommendation> Response { get; set; } =
    [
        new OutfitRecommendation
        {
            Id = "rec-1",
            Title = "Casual Monday",
            Description = "Pair the white tee with dark jeans.",
            ClothingItemIds = ["item-1", "item-2"]
        },
        new OutfitRecommendation
        {
            Id = "rec-2",
            Title = "Smart Casual",
            Description = "Oxford shirt with chinos and loafers.",
            ClothingItemIds = ["item-3", "item-4"]
        }
    ];

    public int CallCount { get; private set; }

    public Task<IReadOnlyCollection<OutfitRecommendation>> GetRecommendationsAsync(
        IEnumerable<ClothingItem> wardrobe,
        StylistRequest request,
        CancellationToken cancellationToken = default)
    {
        CallCount++;
        LastWardrobe = wardrobe.ToList();
        LastRequest = request;
        return Task.FromResult(Response);
    }
}
