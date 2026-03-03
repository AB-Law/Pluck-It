"""
Weekly/daily wardrobe digest agent.

Runs on a timer trigger (Monday 09:00 UTC by default). For each user:
  1. Computes a lightweight hash of their current wardrobe item IDs.
  2. Compares to the stored hash in UserProfile.wardrobeHashAtLastDigest.
  3. If unchanged — skips (no AI calls, no Cosmos writes).
  4. If changed — builds a wear-ranked top-50 item summary + loads recent
     feedback signals, then generates 3-5 purchase suggestions, each with
     an explicit rationale.
  5. Writes the digest result to the Digests container.
  6. Updates wardrobeHashAtLastDigest, styleConfidenceProfile, and
     climateZone on UserProfile.

Purchase suggestions are descriptive (no external links), e.g.:
  "A sand-coloured linen shirt would pair with 6 of your bottoms and suit
   your minimalist style in warmer weather."
  Rationale: "Your category data shows 0 linen / summer shirts despite
   a temperate climate and 4 active summer wear sessions."
"""

import hashlib
import json
import logging
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI

from .db import (
    get_wardrobe_container_sync,
    get_user_profiles_container_sync,
    get_digests_container_sync,
    get_digest_feedback_container_sync,
)

logger = logging.getLogger(__name__)

# Items fed into the LLM prompt — keeps prompt tokens bounded for p95 < 2.5 s AC.
_PROMPT_ITEM_LIMIT = 50


def _get_env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Missing env var: {name}")
    return v


def compute_wardrobe_hash(item_ids: list[str]) -> str:
    """SHA-256 of sorted, joined item IDs — cheap change detector."""
    combined = ",".join(sorted(item_ids))
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


def _build_digest_llm() -> AzureChatOpenAI:
    return AzureChatOpenAI(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
        api_version="2024-12-01-preview",
        temperature=0.5,
        max_tokens=800,
    )


def _recency_score(wear_count: int, last_worn_at: Optional[str]) -> float:
    """Recency-weighted wear score (mirror of wear_patterns.py logic for sync use)."""
    if wear_count == 0:
        return 0.0
    recency = 1.0
    if last_worn_at:
        try:
            dt = datetime.fromisoformat(last_worn_at.replace("Z", "+00:00"))
            days = (datetime.now(timezone.utc) - dt).days
            recency = max(0.1, 1.0 - days / 180.0)
        except Exception:
            pass
    return round(wear_count * recency, 3)


def _infer_climate_zone(location_city: Optional[str], wear_events_conditions: list[str]) -> Optional[str]:
    """
    Best-effort climate zone inference from city name + wear-event weather snapshots.
    Uses a nano-LLM call; returns None on any failure (non-blocking).
    """
    if not location_city:
        return None
    try:
        from collections import Counter as _Counter
        top_conditions = [c for c, _ in _Counter(wear_events_conditions).most_common(3)]
        prompt = (
            f"City: {location_city}. "
            f"Recent weather conditions worn in: {', '.join(top_conditions) if top_conditions else 'unknown'}. "
            "Reply with ONE word — the climate zone: temperate | tropical | continental | arid | polar. "
            "No explanation."
        )
        nano = AzureChatOpenAI(
            azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
            api_key=_get_env("AZURE_OPENAI_API_KEY"),
            azure_deployment=os.getenv("AZURE_OPENAI_NANO_DEPLOYMENT",
                                        os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini")),
            api_version="2024-12-01-preview",
            temperature=0,
            max_tokens=5,
        )
        result = nano.invoke(prompt).content.strip().lower()
        if result in {"temperate", "tropical", "continental", "arid", "polar"}:
            return result
    except Exception as exc:
        logger.debug("Climate zone inference failed (non-critical): %s", exc)
    return None


def run_digest_for_user(user_id: str, force: bool = False) -> Optional[dict]:
    """
    Synchronous digest run for a single user. Returns the digest dict or None
    if skipped (wardrobe unchanged) or on error.
    Set force=True to bypass the wardrobe hash guard (useful for manual/dev triggers).
    """
    # ── 1. Load wardrobe ──────────────────────────────────────────────────────
    try:
        wardrobe_container = get_wardrobe_container_sync()
        item_ids: list[str] = []
        wardrobe_items: list[dict] = []
        for item in wardrobe_container.query_items(
            query=(
                "SELECT c.id, c.category, c.colours, c.tags, c.brand, c.aestheticTags, "
                "c.wearCount, c.lastWornAt, c.wearEvents, c.price "
                "FROM c WHERE c.userId = @userId"
            ),
            parameters=[{"name": "@userId", "value": user_id}],
            enable_cross_partition_query=True,
        ):
            item_ids.append(item["id"])
            wardrobe_items.append(item)
    except Exception as exc:
        logger.warning("Digest: failed to load wardrobe for %s: %s", user_id, exc)
        return None

    if not item_ids:
        return None

    current_hash = compute_wardrobe_hash(item_ids)

    # ── 2. Load user profile + hash-guard ────────────────────────────────────
    profile_container = get_user_profiles_container_sync()
    try:
        profile = profile_container.read_item(item=user_id, partition_key=user_id)
    except Exception:
        profile = {}

    last_hash = profile.get("wardrobeHashAtLastDigest")
    if not force and last_hash == current_hash:
        logger.info("Digest: wardrobe unchanged for %s (hash %s), skipping.", user_id, current_hash)
        return None

    if not profile.get("recommendationOptIn", True):
        logger.info("Digest: user %s has opted out of recommendations, skipping.", user_id)
        return None

    style_prefs: list[str] = profile.get("stylePreferences") or []
    preferred_colours: list[str] = profile.get("preferredColours") or []
    fav_brands: list[str] = profile.get("favoriteBrands") or []
    location_city: Optional[str] = profile.get("locationCity")
    existing_climate_zone: Optional[str] = profile.get("climateZone")

    # ── 3. Build wear-ranked top-50 summary (caps prompt tokens for p95 AC) ──
    category_counts: Counter = Counter()
    wear_conditions: list[str] = []

    for item in wardrobe_items:
        cat = (item.get("category") or "other").lower()
        category_counts[cat] += 1

    scored = []
    for item in wardrobe_items:
        wear_count = item.get("wearCount", 0)
        last_worn = item.get("lastWornAt")
        score = _recency_score(wear_count, last_worn)
        cat = (item.get("category") or "other").lower()

        # Collect climate signals from wear events
        for ev in (item.get("wearEvents") or [])[-5:]:
            snap = ev.get("weatherSnapshot") or {}
            if snap.get("conditions"):
                wear_conditions.append(snap["conditions"].lower())

        price_obj = item.get("price") or {}
        price_amount = price_obj.get("amount")
        cpw = round(price_amount / wear_count, 2) if price_amount and wear_count > 0 else None

        scored.append({
            "category": cat,
            "brand": item.get("brand"),
            "aestheticTags": item.get("aestheticTags") or [],
            "wearCount": wear_count,
            "lastWornAt": last_worn,
            "score": score,
            "costPerWear": cpw,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_items = scored[:_PROMPT_ITEM_LIMIT]

    items_with_history = sum(1 for s in scored if s["wearCount"] > 0)
    sparse = items_with_history < 5

    # ── 4. Load recent feedback (last 90 days via TTL container) ─────────────
    liked_items: list[str] = []
    disliked_items: list[str] = []
    try:
        feedback_container = get_digest_feedback_container_sync()
        for fb in feedback_container.query_items(
            query="SELECT * FROM c WHERE c.userId = @userId ORDER BY c.createdAt DESC OFFSET 0 LIMIT 30",
            parameters=[{"name": "@userId", "value": user_id}],
            enable_cross_partition_query=True,
        ):
            if fb.get("signal") == "up":
                liked_items.append(fb.get("suggestionDescription", ""))
            elif fb.get("signal") == "down":
                disliked_items.append(fb.get("suggestionDescription", ""))
    except Exception as exc:
        logger.debug("Digest: could not load feedback for %s (non-critical): %s", user_id, exc)

    # ── 5. Infer climate zone if missing ─────────────────────────────────────
    climate_zone = existing_climate_zone
    if not climate_zone and location_city:
        climate_zone = _infer_climate_zone(location_city, wear_conditions)

    # ── 6. Build LLM prompt ───────────────────────────────────────────────────
    wardrobe_summary = json.dumps(dict(category_counts.most_common(12)))
    top_items_summary = json.dumps(top_items[:20])  # Further cap for prompt length

    profile_summary = (
        f"Styles: {', '.join(style_prefs) or 'not specified'}. "
        f"Preferred colours: {', '.join(preferred_colours) or 'not specified'}. "
        f"Favourite brands: {', '.join(fav_brands) or 'not specified'}. "
        f"Climate zone: {climate_zone or 'unknown'}. "
        f"Wear history: {items_with_history} of {len(wardrobe_items)} items worn at least once."
    )

    sparse_note = (
        "\nNote: this user has limited wear history. Broaden suggestions across all "
        "major categories rather than focusing on frequently-worn styles."
        if sparse else ""
    )

    feedback_note = ""
    if liked_items or disliked_items:
        feedback_note = (
            f"\nPrevious feedback — user LIKED: {'; '.join(liked_items[:5]) or 'none'}. "
            f"User DISLIKED: {'; '.join(disliked_items[:5]) or 'none'}. "
            "Avoid repeating disliked suggestions. Lean into liked styles."
        )

    prompt = f"""You are a personal stylist reviewing a wardrobe.

User profile: {profile_summary}
Wardrobe composition (category → item count): {wardrobe_summary}
Most-worn items (recency-weighted, top 20): {top_items_summary}
{sparse_note}{feedback_note}

Generate 3-5 specific purchase suggestions that would genuinely improve this wardrobe.
Prioritise suggestions that complement items the user already wears frequently (closet-first).
For each suggestion provide:
  - A clear description of the item (type, colour, style)
  - A concrete rationale (must reference a specific signal: wear frequency, climate, style gap, or occasion pattern)
  - Keep each suggestion to 1-2 sentences

Return a JSON array of objects: [{{"item": "...", "rationale": "..."}}]
Only return the JSON array, no other text."""

    # ── 7. Run LLM ────────────────────────────────────────────────────────────
    try:
        llm = _build_digest_llm()
        response = llm.invoke([
            SystemMessage(content="You are a fashion-forward personal stylist. Be specific and practical."),
            HumanMessage(content=prompt),
        ])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        suggestions = json.loads(raw)
        # Normalise legacy "reason" key to "rationale"
        for s in suggestions:
            if "reason" in s and "rationale" not in s:
                s["rationale"] = s.pop("reason")
    except Exception as exc:
        logger.error("Digest: LLM error for user %s: %s", user_id, exc)
        return None

    # ── 8. Compute styleConfidenceProfile ────────────────────────────────────
    # Score = fraction of suggestions that map to a category the user wears frequently.
    high_wear_categories = {
        cat for cat, cnt in category_counts.items()
        if cnt >= 3 and category_counts[cat] > 0
        and sum(s["wearCount"] for s in scored if s["category"] == cat) > 0
    }
    if suggestions and high_wear_categories:
        aligned = sum(
            1 for s in suggestions
            if any(kw in (s.get("item", "") + s.get("rationale", "")).lower()
                   for kw in high_wear_categories)
        )
        style_confidence = round(aligned / len(suggestions), 2)
    else:
        style_confidence = None

    digest_id = f"{user_id}-{current_hash}"
    digest = {
        "id": digest_id,
        "userId": user_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "wardrobeHash": current_hash,
        "suggestions": suggestions,
        "stylesConsidered": style_prefs,
        "totalItems": len(item_ids),
        "itemsWithWearHistory": items_with_history,
        "climateZone": climate_zone,
    }

    # ── 9. Save digest ────────────────────────────────────────────────────────
    try:
        digests_container = get_digests_container_sync()
        digests_container.upsert_item(digest)
    except Exception as exc:
        logger.error("Digest: failed to save digest for %s: %s", user_id, exc)

    # ── 10. Update UserProfile analytics fields ───────────────────────────────
    try:
        profile["wardrobeHashAtLastDigest"] = current_hash
        if style_confidence is not None:
            profile["styleConfidenceProfile"] = style_confidence
        if climate_zone and not existing_climate_zone:
            profile["climateZone"] = climate_zone
        profile_container.upsert_item(profile)
    except Exception as exc:
        logger.warning("Digest: failed to update profile for %s: %s", user_id, exc)

    logger.info("Digest: completed for user %s — %d suggestions.", user_id, len(suggestions))
    return digest


def run_weekly_digest() -> None:
    """
    Entry point for the timer trigger. Iterates all UserProfiles and runs digests
    for each user. Skips users whose wardrobes haven't changed.
    """
    logger.info("Weekly digest starting.")
    processed = 0
    skipped = 0

    try:
        profile_container = get_user_profiles_container_sync()
        all_profiles = list(profile_container.read_all_items())
    except Exception as exc:
        logger.error("Digest: failed to list profiles: %s", exc)
        return

    for profile in all_profiles:
        user_id = profile.get("id")
        if not user_id:
            continue
        result = run_digest_for_user(user_id)
        if result:
            processed += 1
        else:
            skipped += 1

    logger.info("Weekly digest complete. Processed: %d, Skipped: %d.", processed, skipped)
