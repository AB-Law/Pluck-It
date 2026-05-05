from __future__ import annotations

import asyncio
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from .db import get_user_profiles_container, get_wardrobe_container
from .image_taste_analyzer import analyze_image

_GARMENT_PHRASES = (
    "t shirt",
    "tee",
    "shirt",
    "hoodie",
    "sweater",
    "knit",
    "cardigan",
    "blazer",
    "jacket",
    "coat",
    "trousers",
    "pants",
    "jeans",
    "skirt",
    "dress",
    "shorts",
    "sneakers",
    "boots",
    "loafers",
    "heels",
    "bag",
)
_STYLE_STOPWORDS = {
    "and",
    "for",
    "the",
    "with",
    "from",
    "saved",
    "discover",
    "wishlist",
    "item",
    "look",
    "style",
    "outfit",
}
_COLOUR_WORDS = {
    "black", "white", "grey", "gray", "navy", "blue", "brown", "beige", "cream", "green",
    "olive", "red", "burgundy", "pink", "purple", "yellow", "orange", "camel", "tan",
    "charcoal", "silver", "gold", "off white", "off-white",
}


def _normalise(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.strip().split())


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _dedupe_preserve(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        raw = _normalise(value)
        if not raw:
            continue
        key = raw.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(raw)
    return result


def _capitalise_phrase(value: str) -> str:
    return " ".join(part.capitalize() for part in value.split())


def _title_terms(item: dict[str, Any]) -> list[str]:
    values = [
        _slug(_normalise(item.get("category"))),
        _slug(_normalise(item.get("notes"))),
        _slug(_normalise(item.get("brand"))),
    ]
    return [value for value in values if value]


def _extract_garments(item: dict[str, Any], analysis: dict[str, Any] | None) -> list[str]:
    garments: list[str] = []
    category = _normalise(item.get("category"))
    if category:
        garments.append(category)
    tags = item.get("tags") or []
    for tag in tags:
        slug = _slug(_normalise(tag))
        if slug in _GARMENT_PHRASES:
            garments.append(_capitalise_phrase(slug))
    searchable = " ".join(_title_terms(item))
    for phrase in _GARMENT_PHRASES:
        if phrase in searchable:
            garments.append(_capitalise_phrase(phrase))
    if analysis:
        for garment in analysis.get("garments", []) or []:
            garments.append(_capitalise_phrase(_slug(_normalise(garment))))
    return _dedupe_preserve(garments)


def _extract_style_keywords(item: dict[str, Any], analysis: dict[str, Any] | None) -> list[str]:
    keywords: list[str] = []
    for field in ("tags", "aestheticTags"):
        for value in item.get(field) or []:
            slug = _slug(_normalise(value))
            if slug and slug not in _STYLE_STOPWORDS and slug not in _COLOUR_WORDS and slug not in _GARMENT_PHRASES:
                keywords.append(_capitalise_phrase(slug))
    if analysis:
        for value in analysis.get("styleKeywords", []) or []:
            slug = _slug(_normalise(value))
            if slug and slug not in _STYLE_STOPWORDS:
                keywords.append(_capitalise_phrase(slug))
    return _dedupe_preserve(keywords)


def _extract_colours(item: dict[str, Any], analysis: dict[str, Any] | None) -> list[str]:
    colours: list[str] = []
    for colour in item.get("colours") or []:
        if isinstance(colour, dict):
            raw = _normalise(colour.get("name"))
            if raw:
                colours.append(_capitalise_phrase(_slug(raw)))
    if analysis:
        for colour in analysis.get("colors", []) or []:
            slug = _slug(_normalise(colour))
            if slug:
                colours.append(_capitalise_phrase(slug))
    return _dedupe_preserve(colours)


def _top_terms(values: list[str], limit: int) -> list[str]:
    counts = Counter(value.lower() for value in values if _normalise(value))
    canonical: dict[str, str] = {}
    for value in values:
        raw = _normalise(value)
        if raw:
            canonical.setdefault(raw.lower(), raw)
    ordered = sorted(counts.items(), key=lambda item: (-item[1], canonical[item[0]].lower()))
    return [canonical[key] for key, _count in ordered[:limit]]


async def _item_analysis(item: dict[str, Any]) -> dict[str, Any] | None:
    has_structured_signals = bool(item.get("tags") or item.get("colours") or item.get("category"))
    image_url = _normalise(item.get("imageUrl"))
    if has_structured_signals or not image_url:
        return None
    return await asyncio.to_thread(analyze_image, image_url)


def aggregate_wishlist_profile(items: list[dict[str, Any]], analyses: dict[str, dict[str, Any] | None] | None = None) -> dict[str, Any]:
    analyses = analyses or {}
    style_values: list[str] = []
    colour_values: list[str] = []
    brand_values: list[str] = []
    garment_values: list[str] = []

    for item in items:
        analysis = analyses.get(str(item.get("id")))
        style_values.extend(_extract_style_keywords(item, analysis))
        colour_values.extend(_extract_colours(item, analysis))
        brand = _normalise(item.get("brand"))
        if brand:
            brand_values.append(brand)
        garment_values.extend(_extract_garments(item, analysis))

    if not items:
        return {
            "wishlistStyleKeywords": [],
            "wishlistPreferredColours": [],
            "wishlistFavoriteBrands": [],
            "wishlistGarmentInterests": [],
            "wishlistProfileUpdatedAt": None,
        }

    return {
        "wishlistStyleKeywords": _top_terms(style_values, 8),
        "wishlistPreferredColours": _top_terms(colour_values, 6),
        "wishlistFavoriteBrands": _top_terms(brand_values, 6),
        "wishlistGarmentInterests": _top_terms(garment_values, 8),
        "wishlistProfileUpdatedAt": datetime.now(timezone.utc).isoformat(),
    }


async def recompute_wishlist_profile(
    user_id: str,
    *,
    wardrobe_container=None,
    profiles_container=None,
) -> dict[str, Any]:
    wardrobe_container = wardrobe_container or get_wardrobe_container()
    profiles_container = profiles_container or get_user_profiles_container()

    items: list[dict[str, Any]] = []
    async for item in wardrobe_container.query_items(
        query=(
            "SELECT * FROM c WHERE c.userId = @uid "
            "AND c.isWishlisted = true "
            "AND (NOT IS_DEFINED(c.draftStatus) OR IS_NULL(c.draftStatus))"
        ),
        parameters=[{"name": "@uid", "value": user_id}],
        partition_key=user_id,
    ):
        items.append(item)

    analyses = {
        str(item.get("id")): await _item_analysis(item)
        for item in items
    }
    wishlist_profile = aggregate_wishlist_profile(items, analyses)

    try:
        profile = await profiles_container.read_item(item=user_id, partition_key=user_id)
    except Exception:
        profile = {"id": user_id}

    profile.setdefault("stylePreferences", [])
    profile.setdefault("favoriteBrands", [])
    profile.setdefault("preferredColours", [])
    profile.update(wishlist_profile)
    await profiles_container.upsert_item(profile)
    return wishlist_profile
