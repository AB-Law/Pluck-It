"""
Wardrobe gap analysis tool.

Compares the user's wardrobe composition against a baseline for their style
preferences and flags categories that are missing or under-represented.
Produces actionable purchase suggestions (no external links — just descriptive
recommendations like "A light-wash denim jacket would complement your 8 tops").
"""

import json
import logging
from collections import Counter
from typing import Optional

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig

from ..db import get_wardrobe_container, get_user_profiles_container

logger = logging.getLogger(__name__)

# Minimum recommended counts per category by style. Can be extended.
_STYLE_BASELINES: dict[str, dict[str, int]] = {
    "streetwear":    {"tops": 6, "bottoms": 4, "outerwear": 2, "shoes": 3, "accessories": 2},
    "minimalist":    {"tops": 5, "bottoms": 4, "outerwear": 1, "shoes": 2, "accessories": 1},
    "preppy":        {"tops": 5, "bottoms": 4, "outerwear": 2, "shoes": 3, "accessories": 3},
    "smart casual":  {"tops": 6, "bottoms": 4, "outerwear": 2, "shoes": 3, "accessories": 2},
    "athleisure":    {"tops": 6, "bottoms": 4, "activewear": 3, "shoes": 3, "accessories": 2},
    "bohemian":      {"tops": 5, "dresses": 3, "bottoms": 3, "outerwear": 1, "accessories": 4},
    "classic":       {"tops": 5, "bottoms": 4, "outerwear": 2, "shoes": 3, "accessories": 3},
    "techwear":      {"tops": 5, "bottoms": 4, "outerwear": 3, "shoes": 2, "accessories": 3},
    "y2k":           {"tops": 6, "bottoms": 4, "dresses": 2, "shoes": 3, "accessories": 4},
}

_DEFAULT_BASELINE = {"tops": 5, "bottoms": 4, "outerwear": 1, "shoes": 2, "accessories": 2}


def _merge_baselines(styles: list[str]) -> dict[str, int]:
    """Average the baselines for a user's multiple style preferences."""
    if not styles:
        return _DEFAULT_BASELINE
    totals: Counter = Counter()
    counts: Counter = Counter()
    for style in styles:
        baseline = _STYLE_BASELINES.get(style.lower(), _DEFAULT_BASELINE)
        for cat, val in baseline.items():
            totals[cat] += val
            counts[cat] += 1
    return {cat: round(totals[cat] / counts[cat]) for cat in totals}


@tool
async def analyze_wardrobe_gaps(config: RunnableConfig) -> str:
    """
    Analyse the user's wardrobe for gaps relative to their style preferences.
    Returns a list of under-represented categories with concrete purchase
    suggestion descriptions (e.g. "A black leather jacket would anchor your
    streetwear look and pair with 8 existing items"). Call this when the user
    asks what they should buy, or when you need to suggest what's missing.
    """
    user_id: str = config["configurable"]["user_id"]

    # Load style preferences
    styles: list[str] = []
    try:
        profiles = get_user_profiles_container()
        profile = await profiles.read_item(item=user_id, partition_key=user_id)
        styles = profile.get("stylePreferences") or []
        preferred_colours: list[str] = profile.get("preferredColours") or []
    except Exception:
        preferred_colours = []

    # Load wardrobe items — collect category counts and anchor item info.
    try:
        wardrobe = get_wardrobe_container()
        category_counts: Counter = Counter()
        all_items = []
        async for item in wardrobe.query_items(
            query="SELECT c.category, c.colours, c.tags, c.brand FROM c WHERE c.userId = @userId",
            parameters=[{"name": "@userId", "value": user_id}],
        ):
            cat = (item.get("category") or "uncategorised").lower()
            category_counts[cat] += 1
            all_items.append(item)
    except Exception as exc:
        logger.warning("Gap analysis error for user %s: %s", user_id, exc)
        return "Could not load wardrobe for gap analysis."

    if not all_items:
        return json.dumps({"gaps": [], "note": "Wardrobe is empty — start by uploading some items!"})

    # Build anchor context: dominant colours and notable pieces already owned.
    anchor_colours: list[str] = []
    anchor_pieces: list[str] = []
    for item in all_items:
        for c in (item.get("colours") or []):
            name = (c.get("name") if isinstance(c, dict) else str(c) or "").lower()
            if name and name not in anchor_colours:
                anchor_colours.append(name)
        brand = (item.get("brand") or "").strip()
        cat = (item.get("category") or "").lower()
        tags = item.get("tags") or []
        # Build a short human-readable label for the piece.
        label_parts = []
        if brand:
            label_parts.append(brand)
        label_parts.extend(t for t in tags[:3] if t)
        if cat:
            label_parts.append(cat[:-1] if cat.endswith("s") else cat)  # tops→top
        if label_parts:
            anchor_pieces.append(" ".join(label_parts))

    # Use preferred colours from profile, falling back to wardrobe anchor colours.
    palette = preferred_colours[:2] if preferred_colours else anchor_colours[:2]
    palette_hint = f" in {' or '.join(palette)}" if palette else ""

    baseline = _merge_baselines(styles)
    gaps = []

    # Category-specific suggestion templates anchored to the user's actual wardrobe.
    _CATEGORY_ITEMS: dict[str, list[str]] = {
        "bottoms":      ["cargo pants", "joggers", "slim jeans", "shorts", "chinos"],
        "shoes":        ["low-top sneakers", "high-top sneakers", "boots", "slides", "loafers"],
        "outerwear":    ["zip-up hoodie", "bomber jacket", "lightweight jacket", "puffer jacket"],
        "accessories":  ["cap", "crossbody bag", "chain", "belt", "beanie"],
        "tops":         ["graphic tee", "polo shirt", "long-sleeve tee", "hoodie"],
        "knitwear":     ["crew-neck sweater", "cardigan", "knit vest"],
        "activewear":   ["training shorts", "compression leggings", "athletic tee"],
        "dresses":      ["midi dress", "slip dress", "shirt dress"],
        "swimwear":     ["swim shorts", "bikini set", "one-piece swimsuit"],
    }

    style_ctx = f" for a {', '.join(styles)} look" if styles else ""
    anchor_ctx = f" to pair with your {anchor_pieces[0]}" if anchor_pieces else ""

    for category, recommended in baseline.items():
        current = category_counts.get(category, 0)
        if current < recommended:
            shortage = recommended - current
            item_types = _CATEGORY_ITEMS.get(category, [category])
            # Pick item-type examples up to the shortage count.
            examples = item_types[:shortage]
            example_str = " or ".join(
                f"{palette[0] + ' ' if palette else ''}{e}" for e in examples
            )
            suggestion = (
                f"You have {current} {category} (need ~{recommended}{style_ctx}). "
                f"Adding {shortage}: e.g. {example_str}{anchor_ctx}."
            )
            gaps.append({
                "category": category,
                "current": current,
                "recommended": recommended,
                "shortage": shortage,
                "example_items": [f"{palette[0] + ' ' if palette else ''}{e}" for e in examples],
                "suggestion": suggestion,
            })

    if not gaps:
        return json.dumps({
            "gaps": [],
            "note": f"Your wardrobe looks well-balanced for {', '.join(styles) if styles else 'your style'}!",
        })

    return json.dumps(
        {"gaps": gaps, "styles_considered": styles, "anchor_pieces": anchor_pieces[:3]},
        ensure_ascii=False,
        indent=2,
    )
