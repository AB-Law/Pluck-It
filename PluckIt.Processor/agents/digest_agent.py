"""
Weekly/daily wardrobe digest agent.

Runs on a timer trigger (Monday 09:00 UTC by default). For each user:
  1. Computes a lightweight hash of their current wardrobe item IDs.
  2. Compares to the stored hash in UserProfile.wardrobeHashAtLastDigest.
  3. If unchanged — skips (no AI calls, no Cosmos writes).
  4. If changed — runs a gap analysis + generates 3-5 purchase suggestions.
  5. Writes the digest result to the Digests container.
  6. Updates the wardrobeHashAtLastDigest on UserProfile.

Purchase suggestions are descriptive (no external links), e.g.:
  "A sand-coloured linen shirt would pair with 6 of your bottoms and suit
   your minimalist style in warmer weather."

Subscription gating can be added later by checking a `tier` field on UserProfile.
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI

from .db import (
    get_wardrobe_container_sync,
    get_user_profiles_container_sync,
    get_digests_container_sync,
)

logger = logging.getLogger(__name__)


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
        max_tokens=600,
    )


def run_digest_for_user(user_id: str) -> Optional[dict]:
    """
    Synchronous digest run for a single user. Returns the digest dict or None
    if skipped (wardrobe unchanged) or on error.
    """
    # Load wardrobe item IDs
    try:
        wardrobe_container = get_wardrobe_container_sync()
        item_ids = []
        wardrobe_items = []
        for item in wardrobe_container.query_items(
            query="SELECT c.id, c.category, c.colours, c.tags, c.brand FROM c WHERE c.userId = @userId",
            parameters=[{"name": "@userId", "value": user_id}],
            enable_cross_partition_query=True,
        ):
            item_ids.append(item["id"])
            wardrobe_items.append(item)
    except Exception as exc:
        logger.warning("Digest: failed to load wardrobe for %s: %s", user_id, exc)
        return None

    if not item_ids:
        return None  # Nothing to digest

    current_hash = compute_wardrobe_hash(item_ids)

    # Load user profile + check hash
    profile_container = get_user_profiles_container_sync()
    try:
        profile = profile_container.read_item(item=user_id, partition_key=user_id)
    except Exception:
        profile = {}

    last_hash = profile.get("wardrobeHashAtLastDigest")
    if last_hash == current_hash:
        logger.info("Digest: wardrobe unchanged for %s (hash %s), skipping.", user_id, current_hash)
        return None

    style_prefs: list[str] = profile.get("stylePreferences") or []
    preferred_colours: list[str] = profile.get("preferredColours") or []
    fav_brands: list[str] = profile.get("favoriteBrands") or []

    # Compact wardrobe summary for the prompt
    from collections import Counter
    category_counts: Counter = Counter()
    for item in wardrobe_items:
        cat = (item.get("category") or "other").lower()
        category_counts[cat] += 1

    wardrobe_summary = json.dumps(dict(category_counts.most_common(12)))
    profile_summary = (
        f"Styles: {', '.join(style_prefs) or 'not specified'}. "
        f"Preferred colours: {', '.join(preferred_colours) or 'not specified'}. "
        f"Favourite brands: {', '.join(fav_brands) or 'not specified'}."
    )

    prompt = f"""You are a personal stylist reviewing a wardrobe.

User profile: {profile_summary}
Wardrobe composition (category → item count): {wardrobe_summary}

Generate 3-5 specific purchase suggestions that would genuinely improve this wardrobe.
For each suggestion provide:
  - A clear description of the item (type, colour, style)
  - Why it would work for this person (pairs with existing items, fits their style, fills a gap)
  - Keep each suggestion to 1-2 sentences

Return a JSON array of objects: [{{"item": "...", "reason": "..."}}]
Only return the JSON array, no other text."""

    try:
        llm = _build_digest_llm()
        response = llm.invoke([
            SystemMessage(content="You are a fashion-forward personal stylist. Be specific and practical."),
            HumanMessage(content=prompt),
        ])
        raw = response.content.strip()
        # Strip code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        suggestions = json.loads(raw)
    except Exception as exc:
        logger.error("Digest: LLM error for user %s: %s", user_id, exc)
        return None

    digest = {
        "id": f"{user_id}-{current_hash}",
        "userId": user_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "wardrobeHash": current_hash,
        "suggestions": suggestions,
        "stylesConsidered": style_prefs,
        "totalItems": len(item_ids),
    }

    # Save digest
    try:
        digests_container = get_digests_container_sync()
        digests_container.upsert_item(digest)
    except Exception as exc:
        logger.error("Digest: failed to save digest for %s: %s", user_id, exc)

    # Update wardrobeHashAtLastDigest on UserProfile
    try:
        profile["wardrobeHashAtLastDigest"] = current_hash
        profile_container.upsert_item(profile)
    except Exception as exc:
        logger.warning("Digest: failed to update profile hash for %s: %s", user_id, exc)

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
