"""
Weather tool — calls Open-Meteo (free, no API key required).

Geocodes the user's city via Open-Meteo's geocoding API, then fetches a
3-day forecast. The result is formatted as a human-readable string so the
LLM can reason about weather-appropriate outfit choices.
"""

import logging
from typing import Optional

import httpx
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig

from ..db import get_user_profiles_container

logger = logging.getLogger(__name__)

_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

_WMO_DESCRIPTIONS = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Icy fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    77: "Snow grains",
    80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
}


async def _geocode(city: str) -> Optional[tuple[float, float, str]]:
    """Return (lat, lon, resolved_name) or None if not found."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(_GEOCODE_URL, params={"name": city, "count": 1, "language": "en", "format": "json"})
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if not results:
                return None
            r = results[0]
            name = f"{r['name']}, {r.get('country', '')}"
            return r["latitude"], r["longitude"], name.strip(", ")
    except Exception as exc:
        logger.warning("Geocoding failed for '%s': %s", city, exc)
        return None


async def _forecast(lat: float, lon: float) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,weathercode,windspeed_10m,precipitation",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
        "timezone": "auto",
        "forecast_days": 3,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(_FORECAST_URL, params=params)
        resp.raise_for_status()
        return resp.json()


@tool
async def get_weather(config: RunnableConfig) -> str:
    """
    Get current weather and 3-day forecast for the user's saved city. Returns
    temperature, precipitation, wind speed, and a plain-English condition
    description. Use this when the user asks about weather-appropriate outfits or
    when suggesting what to wear today/this week.
    """
    user_id: str = config["configurable"]["user_id"]

    # Resolve city from user profile
    city: Optional[str] = None
    try:
        container = get_user_profiles_container()
        profile = await container.read_item(item=user_id, partition_key=user_id)
        city = profile.get("locationCity")
    except Exception:
        pass

    if not city:
        return (
            "No city is set in your profile. Go to Profile → Settings and add your "
            "location to get weather-based outfit suggestions."
        )

    geo = await _geocode(city)
    if not geo:
        return f"Could not find weather data for '{city}'. Try updating your city in Profile → Settings."

    lat, lon, resolved = geo
    try:
        data = await _forecast(lat, lon)
    except Exception as exc:
        logger.warning("Forecast failed for %s: %s", city, exc)
        return f"Weather data temporarily unavailable for {resolved}."

    current = data.get("current", {})
    daily = data.get("daily", {})

    temp = current.get("temperature_2m", "?")
    condition = _WMO_DESCRIPTIONS.get(current.get("weathercode", -1), "Unknown")
    wind = current.get("windspeed_10m", "?")
    precip = current.get("precipitation", 0)

    lines = [f"📍 {resolved}", f"Now: {temp}°C, {condition}, Wind {wind} km/h, Precip {precip} mm"]

    dates = daily.get("time", [])
    max_temps = daily.get("temperature_2m_max", [])
    min_temps = daily.get("temperature_2m_min", [])
    precip_sums = daily.get("precipitation_sum", [])
    codes = daily.get("weathercode", [])

    for i, date in enumerate(dates[:3]):
        desc = _WMO_DESCRIPTIONS.get(codes[i] if i < len(codes) else -1, "?")
        hi = max_temps[i] if i < len(max_temps) else "?"
        lo = min_temps[i] if i < len(min_temps) else "?"
        rain = precip_sums[i] if i < len(precip_sums) else 0
        lines.append(f"{date}: {desc}, {lo}–{hi}°C, Rain {rain} mm")

    return "\n".join(lines)
