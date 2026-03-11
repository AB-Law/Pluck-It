"""
Wear patterns tool for the personalization graph.

Analyses the user's actual wear history (wearCount, lastWornAt, wearEvents) to
produce a structured signal summary that the stylist and digest agents can use
to:
  - Prioritise items already in the closet (≥90% closet-first AC)
  - Understand per-category wear cadence for gap analysis
  - Compute cost-per-wear as a value signal
  - Surface occasion and climate patterns from wear events

Sparse wardrobe fallback: if fewer than 5 items have any wear events the tool
returns {"sparse": true, ...} so agents can broaden rather than over-fit.
"""

import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig

from ..db import get_wardrobe_container

logger = logging.getLogger(__name__)

# Minimum items with wear history before we consider the signals meaningful.
_SPARSE_THRESHOLD = 5

# Cap on items included in the ranked summary to limit prompt tokens while
# still surfacing the most relevant items for recommendation.
_SUMMARY_LIMIT = 50


def _recency_days(last_worn_at: Optional[str]) -> Optional[int]:
    """Days since last worn, or None if never worn."""
    if not last_worn_at:
        return None
    try:
        dt = datetime.fromisoformat(last_worn_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return None


def _cost_per_wear(price_amount: Optional[float], wear_count: int) -> Optional[float]:
    """Computed cost-per-wear; None if no price or never worn."""
    if price_amount and wear_count > 0:
        return round(price_amount / wear_count, 2)
    return None


def _score_item(wear_count: int, days_since_worn: Optional[int]) -> float:
    """
    Recency-weighted wear score.
    Heavily worn + recently worn → high score (good closet-first candidate).
    Never worn → 0.
    """
    if wear_count == 0:
        return 0.0
    recency_factor = 1.0
    if days_since_worn is not None:
        # Decay by ~50% every 90 days, floor at 0.1
        recency_factor = max(0.1, 1.0 - (days_since_worn / 180.0))
    return round(wear_count * recency_factor, 3)


async def _load_wardrobe_items(user_id: str) -> list[dict[str, Any]]:
    container = get_wardrobe_container()
    items: list[dict[str, Any]] = []

    async for item in container.query_items(
        query="SELECT c.id, c.category, c.brand, c.aestheticTags, c.tags, "
        "c.wearCount, c.lastWornAt, c.wearEvents, c.price FROM c WHERE c.userId = @userId",
        parameters=[{"name": "@userId", "value": user_id}],
    ):
        items.append(item)

    return items


def _update_event_context(
    wear_events: list[dict[str, Any]],
    occasions_counter: Counter,
    climate_counter: Counter,
) -> None:
    sorted_wear_events = sorted(
        wear_events,
        key=lambda e: e.get("occurredAt") or "",
        reverse=True,
    )
    for event in sorted_wear_events[:10]:
        occasion = event.get("occasion")
        if occasion:
            occasions_counter[occasion.lower()] += 1
        snapshot = event.get("weatherSnapshot")
        conditions = snapshot.get("conditions") if snapshot else None
        if conditions:
            climate_counter[conditions.lower()] += 1


def _build_scored_items(items: list[dict[str, Any]]) -> tuple[
    list[dict[str, Any]],
    defaultdict[str, int],
    Counter,
    Counter,
    int,
]:
    scored: list[dict[str, Any]] = []
    occasions_counter: Counter = Counter()
    climate_counter: Counter = Counter()
    category_wear: defaultdict[str, int] = defaultdict(int)
    items_with_history = 0

    for item in items:
        wear_count: int = item.get("wearCount", 0)
        last_worn: Optional[str] = item.get("lastWornAt")
        days_since = _recency_days(last_worn)
        score = _score_item(wear_count, days_since)
        category = (item.get("category") or "other").lower()
        category_wear[category] += wear_count
        if wear_count > 0:
            items_with_history += 1

        _update_event_context(
            item.get("wearEvents") or [],
            occasions_counter,
            climate_counter,
        )

        cpw = _cost_per_wear((item.get("price") or {}).get("amount"), wear_count)

        scored.append({
            "id": item["id"],
            "category": category,
            "brand": item.get("brand"),
            "aestheticTags": item.get("aestheticTags") or [],
            "wearCount": wear_count,
            "lastWornAt": last_worn,
            "daysSinceLastWorn": days_since,
            "score": score,
            "costPerWear": cpw,
        })

    return scored, category_wear, occasions_counter, climate_counter, items_with_history


def _build_category_summary(
    category_wear: defaultdict[str, int],
    scored: list[dict[str, Any]],
) -> dict[str, dict[str, float]]:
    score_totals: Counter = Counter()
    score_counts: Counter = Counter()

    for item in scored:
        category = item["category"]
        score_totals[category] += item["score"]
        score_counts[category] += 1

    return {
        cat: {
            "totalWears": cnt,
            "avgScore": round(score_totals[cat] / max(1, score_counts[cat]), 3),
        }
        for cat, cnt in sorted(category_wear.items(), key=lambda x: -x[1])
    }


@tool
async def get_wear_patterns(query: str = "", config: RunnableConfig = None) -> str:
    """
    Analyse the user's wear history and return a structured wear-pattern summary.

    Includes:
    - Per-category wear frequency and dominant occasion/climate signals
    - Top-50 most relevant owned items (recency-weighted wear score)
    - Cost-per-wear for items with price data
    - Sparse-wardrobe flag when fewer than 5 items have wear history

    Use this tool at the start of a digest run or when the user asks about
    how often they wear certain items or what they actually use most.

    Args:
        query: Optional category or occasion filter (empty = all items).
    """
    user_id: str = (config or {}).get("configurable", {}).get("user_id", "")
    if not user_id:
        return json.dumps({"error": "user_id not available in config"})

    # Optional category/occasion filter passed as natural-language hint (not SQL)
    # The tool returns the full summary; the agent decides what's relevant.

    try:
        items = await _load_wardrobe_items(user_id)
    except Exception as exc:
        logger.error("wear_patterns: Cosmos query failed: %s", exc)
        return json.dumps({"error": str(exc)})

    if not items:
        return json.dumps({"sparse": True, "message": "Wardrobe is empty.", "items": []})

    scored, category_wear, occasions_counter, climate_counter, items_with_history = (
        _build_scored_items(items)
    )

    # ── Sparse wardrobe detection ─────────────────────────────────────────────
    if items_with_history < _SPARSE_THRESHOLD:
        return json.dumps({
            "sparse": True,
            "message": (
                f"Only {items_with_history} of {len(items)} items have wear history. "
                "Broaden recommendations to cover all major categories rather than "
                "focusing on heavily-worn items."
            ),
            "totalItems": len(items),
            "categoryBreakdown": dict(category_wear),
        })

    # ── Build ranked top-N summary ────────────────────────────────────────────
    scored.sort(key=lambda x: x["score"], reverse=True)
    scored.sort(key=lambda x: x["score"], reverse=True)
    top_items = scored[:_SUMMARY_LIMIT]

    # Top occasions and climate conditions (global across all items)
    top_occasions = [occ for occ, _ in occasions_counter.most_common(5)]
    top_conditions = [cond for cond, _ in climate_counter.most_common(3)]

    # Category-level wear frequency summary
    category_summary = _build_category_summary(category_wear, scored)

    return json.dumps({
        "sparse": False,
        "totalItems": len(items),
        "itemsWithWearHistory": items_with_history,
        "topOccasions": top_occasions,
        "topClimateConditions": top_conditions,
        "categoryWearSummary": category_summary,
        "topRankedItems": top_items,
    }, default=str)
