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
from typing import Optional

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

    container = get_wardrobe_container()

    # Query wardrobe — include wear analytics fields only (no image URLs)
    cosmos_query = (
        "SELECT c.id, c.category, c.brand, c.aestheticTags, c.tags, "
        "c.wearCount, c.lastWornAt, c.wearEvents, c.price "
        "FROM c WHERE c.userId = @userId"
    )
    params = [{"name": "@userId", "value": user_id}]

    # Optional category/occasion filter passed as natural-language hint (not SQL)
    # The tool returns the full summary; the agent decides what's relevant.

    items = []
    try:
        async for item in container.query_items(
            query=cosmos_query,
            parameters=params,
        ):
            items.append(item)
    except Exception as exc:
        logger.error("wear_patterns: Cosmos query failed: %s", exc)
        return json.dumps({"error": str(exc)})

    if not items:
        return json.dumps({"sparse": True, "message": "Wardrobe is empty.", "items": []})

    # ── Per-item scoring ──────────────────────────────────────────────────────
    scored = []
    occasions_counter: Counter = Counter()
    climate_counter: Counter = Counter()
    category_wear: defaultdict[str, int] = defaultdict(int)

    for item in items:
        wear_count: int = item.get("wearCount", 0)
        last_worn: Optional[str] = item.get("lastWornAt")
        days_since = _recency_days(last_worn)
        score = _score_item(wear_count, days_since)
        category = (item.get("category") or "other").lower()
        category_wear[category] += wear_count

        # Extract occasion and climate signals from the most recent wear events.
        # Sort explicitly by occurredAt descending — the write path trims with
        # OrderByDescending so list order is not guaranteed oldest→newest.
        wear_events = item.get("wearEvents") or []
        sorted_wear_events = sorted(
            wear_events,
            key=lambda e: e.get("occurredAt") or "",
            reverse=True,
        )
        for ev in sorted_wear_events[:10]:
            if ev.get("occasion"):
                occasions_counter[ev["occasion"].lower()] += 1
            snap = ev.get("weatherSnapshot")
            if snap and snap.get("conditions"):
                climate_counter[snap["conditions"].lower()] += 1

        # Price/cost-per-wear
        price_obj = item.get("price") or {}
        price_amount = price_obj.get("amount")
        cpw = _cost_per_wear(price_amount, wear_count)

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

    # ── Sparse wardrobe detection ─────────────────────────────────────────────
    items_with_history = sum(1 for s in scored if s["wearCount"] > 0)
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
    top_items = scored[:_SUMMARY_LIMIT]

    # Top occasions and climate conditions (global across all items)
    top_occasions = [occ for occ, _ in occasions_counter.most_common(5)]
    top_conditions = [cond for cond, _ in climate_counter.most_common(3)]

    # Category-level wear frequency summary
    category_summary = {
        cat: {"totalWears": cnt, "avgScore": round(
            sum(s["score"] for s in scored if s["category"] == cat) /
            max(1, sum(1 for s in scored if s["category"] == cat)), 3
        )}
        for cat, cnt in sorted(category_wear.items(), key=lambda x: -x[1])
    }

    return json.dumps({
        "sparse": False,
        "totalItems": len(items),
        "itemsWithWearHistory": items_with_history,
        "topOccasions": top_occasions,
        "topClimateConditions": top_conditions,
        "categoryWearSummary": category_summary,
        "topRankedItems": top_items,
    }, default=str)
