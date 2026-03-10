"""
Wardrobe tools for the stylist agent.

Two tools are exposed:
  1. search_wardrobe   — LLM-normalised search by natural language query.
  2. get_wardrobe_summary — aggregate stats (counts per category, colour distribution).

Both receive the authenticated userId via LangGraph's RunnableConfig.configurable.
Item data is trimmed to compact token-efficient representations — image URLs are
never sent to the LLM.
"""

import json
import logging
import os
from functools import lru_cache

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from langchain_openai import AzureChatOpenAI

from ..db import get_wardrobe_container

logger = logging.getLogger(__name__)

# Max items returned by search — keeps prompt tokens bounded.
_SEARCH_LIMIT = 30


def _get_env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


@lru_cache(maxsize=1)
def _get_llm() -> AzureChatOpenAI:
    return AzureChatOpenAI(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
        api_version="2024-12-01-preview",
        temperature=0,
    )


async def _expand_query(query: str) -> list[str]:
    """
    Use the LLM to normalise a natural-language wardrobe query into a flat list
    of canonical search terms (category names, colours, tags, brand fragments).
    Returns the original query tokens as fallback if the LLM call fails.

    Example: "slaughter gang tee" → ["tops", "graphic", "short sleeve", "slaughter", "gang"]
    """
    prompt = (
        "You are a wardrobe search assistant. Given a user's clothing description, "
        "return a JSON array of lowercase search terms that would match the item in a "
        "wardrobe database. Include: canonical category name (e.g. 'tops', 'bottoms', "
        "'outerwear', 'shoes', 'accessories'), likely colours, fabric/style tags, and "
        "any brand or text fragments. Do NOT include stop words. Output ONLY valid JSON, "
        "no explanation.\n\n"
        f"Description: \"{query}\"\n"
        "Output:"
    )
    try:
        llm = _get_llm()
        response = await llm.ainvoke(prompt)
        raw = response.content.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        terms = json.loads(raw)
        if isinstance(terms, list):
            return [str(t).lower() for t in terms if t]
    except Exception as exc:
        logger.warning("Query expansion failed for '%s': %s", query, exc)
    # Fallback: just split the raw query
    return query.lower().split()


def _compact(item: dict) -> dict:
    """Strip blob URLs and heavy fields; keep only what the LLM needs."""
    return {
        "id": item.get("id"),
        "category": item.get("category"),
        "brand": item.get("brand"),
        "colours": [c.get("name") for c in (item.get("colours") or [])],
        "tags": item.get("tags") or [],
        "condition": item.get("condition"),
        "size": item.get("size"),
        "notes": item.get("notes"),
    }


def _score_item(item: dict, terms: list[str]) -> int:
    """Return how many search terms match; 0 = no match."""
    item_id = (item.get("id") or "").lower()
    category = (item.get("category") or "").lower()
    brand = (item.get("brand") or "").lower()
    tags = " ".join(item.get("tags") or []).lower()
    colours = " ".join(c.get("name", "") for c in (item.get("colours") or [])).lower()
    notes = (item.get("notes") or "").lower()
    combined = f"{item_id} {category} {brand} {tags} {colours} {notes}"
    return sum(1 for t in terms if t in combined)


@tool
async def search_wardrobe(query: str, config: RunnableConfig) -> str:
    """
    Search the user's wardrobe using a natural language query. Understands
    colloquial terms like 'tee', 'sneakers', 'puffer', brand names, colours,
    and style descriptions. Returns a compact JSON list of matching items (up
    to 30). Use this when you need to find specific pieces.
    """
    user_id: str = config["configurable"]["user_id"]

    # Expand query via LLM to canonical wardrobe terms
    terms = await _expand_query(query)
    logger.info("search_wardrobe: query=%r expanded_terms=%s", query, terms)

    try:
        container = get_wardrobe_container()
        items_raw = []
        async for page in container.query_items(
            query="SELECT * FROM c WHERE c.userId = @userId ORDER BY c.dateAdded DESC",
            parameters=[{"name": "@userId", "value": user_id}],
        ):
            items_raw.append(page)
            if len(items_raw) >= 200:
                break
    except Exception as exc:
        logger.warning("Wardrobe search error for user %s: %s", user_id, exc)
        return "Could not access the wardrobe at this time."

    # Score and rank items by how many expanded terms they match
    scored = [(item, _score_item(item, terms)) for item in items_raw]
    scored.sort(key=lambda x: x[1], reverse=True)

    matched = [_compact(item) for item, score in scored if score > 0][:_SEARCH_LIMIT]

    if not matched:
        # Return all items so the LLM can reason about what's available
        all_compact = [_compact(i) for i in items_raw[:_SEARCH_LIMIT]]
        if not all_compact:
            return "The wardrobe is empty."
        return (
            f"No items closely matched '{query}', but here are all wardrobe items so you "
            f"can identify the closest match:\n" + json.dumps(all_compact, ensure_ascii=False)
        )

    return json.dumps(matched, ensure_ascii=False)


@tool
async def get_wardrobe_summary(config: RunnableConfig) -> str:
    """
    Get a high-level summary of the user's wardrobe: total item count, breakdown
    by category, and the most common colours. Use this for an overview before
    drilling into specifics with search_wardrobe.
    """
    user_id: str = config["configurable"]["user_id"]

    try:
        container = get_wardrobe_container()
        all_items = []
        async for item in container.query_items(
            query="SELECT c.category, c.colours FROM c WHERE c.userId = @userId",
            parameters=[{"name": "@userId", "value": user_id}],
        ):
            all_items.append(item)
    except Exception as exc:
        logger.warning("Wardrobe summary error for user %s: %s", user_id, exc)
        return "Could not retrieve wardrobe summary."

    if not all_items:
        return "The wardrobe is empty — no items have been uploaded yet."

    # Category counts
    from collections import Counter
    categories: Counter = Counter()
    colour_names: Counter = Counter()

    for item in all_items:
        cat = item.get("category") or "uncategorised"
        categories[cat.lower()] += 1
        for c in item.get("colours") or []:
            name = c.get("name") if isinstance(c, dict) else str(c)
            if name:
                colour_names[name.lower()] += 1

    summary = {
        "total_items": len(all_items),
        "by_category": dict(categories.most_common(15)),
        "top_colours": dict(colour_names.most_common(10)),
    }

    import json
    return json.dumps(summary, ensure_ascii=False)
