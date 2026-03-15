using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

/// <summary>
/// Fake <see cref="IClothingMetadataService"/> that returns configurable canned metadata.
/// Default response: one colour, two tags, category "Tops".
/// </summary>
public sealed class FakeClothingMetadataService : IClothingMetadataService
{
    public ClothingMetadata Response { get; set; } = new(
        Brand:    "TestBrand",
        Category: "Tops",
        Tags:     ["casual", "cotton"],
        Colours:  [new ClothingColour("White", "#FFFFFF")]
    );
    public bool ThrowOnCall { get; set; }

    /// <summary>Number of times <see cref="ExtractMetadataAsync"/> was called.</summary>
    public int CallCount { get; private set; }

    public Task<ClothingMetadata> ExtractMetadataAsync(
        BinaryData imageData,
        string mediaType,
        CancellationToken cancellationToken = default)
    {
        CallCount++;
        if (ThrowOnCall)
        {
            throw new InvalidOperationException("Metadata extraction failed.");
        }
        return Task.FromResult(Response);
    }
}
