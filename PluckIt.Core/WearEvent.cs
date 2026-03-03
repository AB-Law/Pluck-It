using System;

namespace PluckIt.Core;

/// <summary>
/// A snapshot of weather conditions at the time a clothing item was worn.
/// Stored inline with each WearEvent to enable climate-based recommendation signals.
/// </summary>
public record WeatherSnapshot(
    /// <summary>Ambient temperature in Celsius.</summary>
    double TempCelsius,

    /// <summary>
    /// Short weather condition descriptor, e.g. "clear", "rain", "snow", "cloudy".
    /// Sourced from Open-Meteo WMO weather interpretation codes.
    /// </summary>
    string Conditions);

/// <summary>
/// Represents a single logged wear event for a clothing item.
/// Bounded to the last 30 events per item (trimmed by the LogWear function on write).
/// </summary>
public record WearEvent(
    /// <summary>UTC timestamp of when the item was worn.</summary>
    DateTimeOffset OccurredAt,

    /// <summary>
    /// Optional occasion context, e.g. "casual", "work", "formal", "gym", "date".
    /// Null when the user logs wear without specifying an occasion.
    /// </summary>
    string? Occasion,

    /// <summary>
    /// Optional weather snapshot captured at log time via the user's locationCity.
    /// Null when locationCity is not set on the profile or the weather call fails.
    /// </summary>
    WeatherSnapshot? WeatherSnapshot);

/// <summary>
/// Optional request body for PATCH /api/wardrobe/{id}/wear.
/// All fields are optional — omitting the body is equivalent to a plain tap with no context.
/// </summary>
public class WearLogRequest
{
    /// <summary>Occasion context for this wear, e.g. "casual", "work", "formal".</summary>
    public string? Occasion { get; set; }

    /// <summary>
    /// Optional weather conditions at the time of wear, supplied by the client.
    /// When null, no weather information is stored and the server does not attempt
    /// to fetch current weather from the user's profile or any external service.
    /// </summary>
    public WeatherSnapshot? WeatherSnapshot { get; set; }
}
