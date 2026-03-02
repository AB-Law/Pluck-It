"""
Mood tool — exposes current fashion trend moods to the stylist agent.

Allows the stylist to reference real, up-to-date fashion moods when building
outfit suggestions or explaining trend-driven style choices.
"""

import json
import logging

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig

from ..db import get_moods_container

logger = logging.getLogger(__name__)

# Maximum number of moods to return (keeps token usage bounded)
_MOOD_LIMIT = 10


@tool
async def get_trending_moods(primary_mood: str = "", config: RunnableConfig = None) -> str:
    """
    Retrieve current fashion trend moods extracted from fashion publications.
    Returns a list of moods with their style signals (colour palette, key pieces,
    silhouettes, fabrics). Optionally filter by primaryMood category.

    Available primaryMood categories:
      Minimalist, Maximalist, Romantic, Edgy, Preppy, Bohemian,
      Sporty, Classic, Streetwear, Coastal, Cottagecore, Dark Academia

    Use this tool when:
    - The user asks what's trending or fashionable right now.
    - You want to frame an outfit suggestion around a current aesthetic.
    - The user describes a vibe/mood and you want to match it to current trends.

    Returns a JSON array of mood objects, each with: name, primaryMood, subMoods,
    description, moodSignals (colorPalette, keyPieces, fabrics, silhouettes).
    """
    try:
        container = get_moods_container()

        if primary_mood.strip():
            query = (
                "SELECT c.name, c.primaryMood, c.subMoods, c.description, c.moodSignals, "
                "c.trendScore FROM c WHERE c.primaryMood = @primaryMood "
                "ORDER BY c.trendScore DESC OFFSET 0 LIMIT @limit"
            )
            parameters = [
                {"name": "@primaryMood", "value": primary_mood.strip()},
                {"name": "@limit",       "value": _MOOD_LIMIT},
            ]
        else:
            query = (
                "SELECT c.name, c.primaryMood, c.subMoods, c.description, c.moodSignals, "
                "c.trendScore FROM c "
                "ORDER BY c.trendScore DESC OFFSET 0 LIMIT @limit"
            )
            parameters = [{"name": "@limit", "value": _MOOD_LIMIT}]

        moods = []
        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            moods.append(item)

        if not moods:
            return json.dumps({
                "moods": [],
                "note": "No trend moods are available yet. Check back after the daily mood processing run.",
            })

        return json.dumps({"moods": moods}, ensure_ascii=False)

    except Exception as exc:
        logger.warning("get_trending_moods error: %s", exc)
        return "Could not retrieve trending moods at this time."
