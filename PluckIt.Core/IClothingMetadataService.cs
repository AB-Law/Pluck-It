using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

public record ClothingMetadata(
  string? Brand,
  string? Category,
  IReadOnlyCollection<string> Tags,
  IReadOnlyCollection<ClothingColour> Colours);

public interface IClothingMetadataService
{
  Task<ClothingMetadata> ExtractMetadataAsync(BinaryData imageData, string mediaType, CancellationToken cancellationToken = default);
}
