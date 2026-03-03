"""
User profile tool — fetches the authenticated user's profile from Cosmos.

Returns style preferences, body measurements, and location — giving the
stylist agent full personal context in a single tool call.
"""

import json
import logging

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig

from ..db import get_user_profiles_container

logger = logging.getLogger(__name__)


@tool
async def get_user_profile(config: RunnableConfig) -> str:
    """
    Retrieve the user's profile: body measurements, style preferences, favorite
    brands, preferred colours, and location city. Call this at the start of a
    session to personalise recommendations.
    """
    user_id: str = config["configurable"]["user_id"]

    try:
        container = get_user_profiles_container()
        profile = await container.read_item(item=user_id, partition_key=user_id)
    except Exception:
        return json.dumps({"note": "No profile found. The user hasn't filled in their profile yet."})

    # Return only the fields useful for styling decisions
    return json.dumps({
        "style_preferences": profile.get("stylePreferences") or [],
        "favorite_brands": profile.get("favoriteBrands") or [],
        "preferred_colours": profile.get("preferredColours") or [],
        "location_city": profile.get("locationCity"),
        "height_cm": profile.get("heightCm"),
        "preferred_size_system": profile.get("preferredSizeSystem", "US"),
        "currency_code": profile.get("currencyCode", "USD"),
        # Personalization graph fields (AI-inferred)
        "recommendation_opt_in": profile.get("recommendationOptIn", True),
        "style_confidence_profile": profile.get("styleConfidenceProfile"),
        "climate_zone": profile.get("climateZone"),
    }, ensure_ascii=False)
