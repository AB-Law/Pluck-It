using System.Collections.Generic;
using System.Text.Json.Serialization;
using PluckIt.Core;

namespace PluckIt.Functions.Serialization;

/// <summary>
/// Source-generated JSON context for all types serialized over HTTP or stored
/// in Cosmos DB. Required for Native AOT / trimming compatibility —
/// eliminates runtime reflection for serialization.
/// </summary>
[JsonSerializable(typeof(ClothingItem))]
[JsonSerializable(typeof(List<ClothingItem>))]
[JsonSerializable(typeof(ClothingColour))]
[JsonSerializable(typeof(List<ClothingColour>))]
[JsonSerializable(typeof(OutfitRecommendation))]
[JsonSerializable(typeof(List<OutfitRecommendation>))]
[JsonSerializable(typeof(StylistRequest))]
[JsonSerializable(typeof(ClothingMetadata))]
[JsonSerializable(typeof(ProcessorResult))]
[JsonSerializable(typeof(HealthResponse))]
[JsonSerializable(typeof(ErrorResponse))]
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
internal partial class PluckItJsonContext : JsonSerializerContext { }

// Lightweight response records used only within the Functions project
internal record HealthResponse(string Status, string Service);
internal record ErrorResponse(string Error);
internal record ProcessorResult(string Id, string ImageUrl);
