using System.Collections.Generic;
using System.Text.Json.Serialization;
using PluckIt.Core;
using PluckIt.Functions.Models;

namespace PluckIt.Functions.Serialization;

/// <summary>
/// Source-generated JSON context for all types serialized over HTTP or stored
/// in Cosmos DB. Required for Native AOT / trimming compatibility —
/// eliminates runtime reflection for serialization.
/// </summary>
[JsonSerializable(typeof(ClothingItem))]
[JsonSerializable(typeof(List<ClothingItem>))]
[JsonSerializable(typeof(WardrobePagedResult))]
[JsonSerializable(typeof(ClothingColour))]
[JsonSerializable(typeof(List<ClothingColour>))]
[JsonSerializable(typeof(ClothingSize))]
[JsonSerializable(typeof(ClothingPrice))]
[JsonSerializable(typeof(ItemCondition))]
[JsonSerializable(typeof(WearEvent))]
[JsonSerializable(typeof(WearLogRequest))]
[JsonSerializable(typeof(WeatherSnapshot))]
[JsonSerializable(typeof(List<WearEvent>))]
[JsonSerializable(typeof(WearHistoryRecord))]
[JsonSerializable(typeof(List<WearHistoryRecord>))]
[JsonSerializable(typeof(WearHistorySummary))]
[JsonSerializable(typeof(WearHistoryResponse))]
[JsonSerializable(typeof(StylingActivityType))]
[JsonSerializable(typeof(WearSuggestionStatus))]
[JsonSerializable(typeof(StylingActivityRecord))]
[JsonSerializable(typeof(List<StylingActivityRecord>))]
[JsonSerializable(typeof(StylingActivityRequest))]
[JsonSerializable(typeof(StylingActivityResponse))]
[JsonSerializable(typeof(WearSuggestionItem))]
[JsonSerializable(typeof(List<WearSuggestionItem>))]
[JsonSerializable(typeof(WearSuggestionsResponse))]
[JsonSerializable(typeof(UpdateWearSuggestionStatusRequest))]
[JsonSerializable(typeof(UpdateWearSuggestionStatusResponse))]
[JsonSerializable(typeof(VaultInsightsResponse))]
[JsonSerializable(typeof(VaultBehavioralInsights))]
[JsonSerializable(typeof(ExpensiveUnwornItem))]
[JsonSerializable(typeof(CpwIntelItem))]
[JsonSerializable(typeof(CpwForecast))]
[JsonSerializable(typeof(Collection))]
[JsonSerializable(typeof(List<Collection>))]
[JsonSerializable(typeof(OutfitRecommendation))]
[JsonSerializable(typeof(List<OutfitRecommendation>))]
[JsonSerializable(typeof(StylistRequest))]
[JsonSerializable(typeof(ClothingMetadata))]
[JsonSerializable(typeof(UserProfile))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(ProcessorResult))]
[JsonSerializable(typeof(ImageProcessingMessage))]
[JsonSerializable(typeof(HealthResponse))]
[JsonSerializable(typeof(ErrorResponse))]
[JsonSerializable(typeof(DraftStatus))]
[JsonSerializable(typeof(DraftStatus?))]
[JsonSerializable(typeof(WardrobeDraftsResult))]
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
internal partial class PluckItJsonContext : JsonSerializerContext { }

// Lightweight response records used only within the Functions project
internal record HealthResponse(string Status, string Service);
internal record ErrorResponse(string Error);
internal record ProcessorResult(string Id, string ImageUrl, string? MediaType);
