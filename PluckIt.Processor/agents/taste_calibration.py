"""
Taste Calibration — two-phase style quiz.

Phase 1 (always available, zero cost):
  Shows the 12 style archetype cards from the existing Moods container.
  Each card is text + color palette + key pieces — no images needed.
  User selects 3-5 archetypes that resonate.
  This immediately populates UserProfile.StylePreferences.

Phase 2 (after first scrape):
  Shows real outfit images from ScrapedItems (global partition).
  Gated on ScrapedItems count > 0 in Cosmos.
  User gives thumbs-up / thumbs-down on 10 images.
  Results refine StylePreferences and FavoriteBrands.

The quiz session is stored in TasteCalibration container.
On completion, UserProfile is updated via the Cosmos UserProfiles container.
"""

from __future__ import annotations

import logging
import random
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from .db import (
    get_moods_container_sync,
    get_scraped_items_container_sync,
    get_taste_calibration_container_sync,
    get_user_profiles_container_sync,
)

logger = logging.getLogger(__name__)

_QUIZ_IMAGE_COUNT = 10
_MOOD_CARD_COUNT = 12


# ── Session management ────────────────────────────────────────────────────────

def get_or_create_quiz_session(user_id: str) -> dict:
    """
    Return the active (incomplete) quiz session for user_id, or create one.
    Determines which phase to use based on ScrapedItems availability.
    """
    container = get_taste_calibration_container_sync()

    # Check for existing incomplete session
    existing = list(container.query_items(
        query=(
            "SELECT * FROM c WHERE c.userId = @uid AND c.isComplete = false "
            "ORDER BY c.createdAt DESC OFFSET 0 LIMIT 1"
        ),
        parameters=[{"name": "@uid", "value": user_id}],
    ))
    if existing:
        return existing[0]

    # Determine phase
    phase = _determine_phase()
    session = _build_session(user_id, phase)
    container.upsert_item(session)
    return session


def _determine_phase() -> int:
    """
    Phase 1 if no ScrapedItems exist yet (first-run), Phase 2 otherwise.
    """
    try:
        items_container = get_scraped_items_container_sync()
        results = list(items_container.query_items(
            query="SELECT TOP 1 c.id FROM c WHERE c.userId = 'global'",
        ))
        return 2 if results else 1
    except Exception:  # noqa: BLE001
        return 1  # safe fallback


def _build_session(user_id: str, phase: int) -> dict:
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    session: dict = {
        "id": f"{user_id}-{session_id}",
        "userId": user_id,
        "sessionId": session_id,
        "phase": phase,
        "isComplete": False,
        "createdAt": now,
        "completedAt": None,
        "inferredTastes": None,
    }

    if phase == 1:
        session["cards"] = _load_mood_cards()
        session["targetResponses"] = len(session["cards"])
        session["responses"] = []       # list of {cardPrimaryMood, signal}
    else:
        session["imageItems"] = _load_quiz_images()
        session["targetResponses"] = _QUIZ_IMAGE_COUNT
        session["responses"] = []       # list of {scrapedItemId, imageUrl, signal}

    return session


# ── Phase 1: mood archetype cards ─────────────────────────────────────────────

def _load_mood_cards() -> list[dict]:
    """
    Load all primary mood archetypes from Cosmos Moods container.
    Returns a card per primaryMood (deduplicated by primaryMood, highest trendScore wins).
    """
    try:
        container = get_moods_container_sync()
        docs = list(container.query_items(
            query="SELECT * FROM c ORDER BY c.trendScore DESC",
        ))
        # One card per primaryMood — pick highest trendScore
        seen: dict[str, dict] = {}
        for doc in docs:
            pm = doc.get("primaryMood", "")
            if pm and pm not in seen:
                seen[pm] = doc

        cards = []
        for doc in seen.values():
            signals = doc.get("moodSignals", {})
            cards.append({
                "primaryMood": doc["primaryMood"],
                "name": doc.get("name", doc["primaryMood"]),
                "description": doc.get("description", ""),
                "colorPalette": signals.get("colorPalette", []),
                "keyPieces": signals.get("keyPieces", []),
                "subMoods": doc.get("subMoods", []),
            })
        return cards

    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not load mood cards from Cosmos: %s", exc)
        # Fallback: static archetype list so quiz always works
        return [
            {"primaryMood": m, "name": m, "description": "", "colorPalette": [], "keyPieces": [], "subMoods": []}
            for m in [
                "Minimalist", "Maximalist", "Romantic", "Edgy", "Preppy",
                "Bohemian", "Sporty", "Classic", "Streetwear", "Coastal",
                "Cottagecore", "Dark Academia",
            ]
        ]


# ── Phase 2: scraped outfit images ────────────────────────────────────────────

def _load_quiz_images() -> list[dict]:
    """
    Pick N diverse scraped images from the global partition.
    Diversity: sample across different source IDs and tag clusters.
    """
    try:
        container = get_scraped_items_container_sync()
        # Fetch a larger pool then sample for diversity
        docs = list(container.query_items(
            query=(
                "SELECT c.id, c.imageUrl, c.title, c.tags, c.sourceId "
                "FROM c WHERE c.userId = 'global' AND c.imageExpired = false "
                "ORDER BY c.scoreSignal DESC OFFSET 0 LIMIT 100"
            ),
        ))
        if not docs:
            return []

        selected = _diverse_sample(docs, _QUIZ_IMAGE_COUNT)
        return [
            {
                "scrapedItemId": d["id"],
                "imageUrl": d["imageUrl"],
                "title": d.get("title", ""),
                "tags": d.get("tags", []),
                "sourceId": d.get("sourceId", ""),
            }
            for d in selected
        ]
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not load quiz images: %s", exc)
        return []


def _diverse_sample(docs: list[dict], n: int) -> list[dict]:
    """
    Sample n items ensuring coverage across source IDs.
    Falls back to random sample if not enough sources.
    """
    by_source: dict[str, list[dict]] = {}
    for doc in docs:
        src = doc.get("sourceId", "unknown")
        by_source.setdefault(src, []).append(doc)

    result: list[dict] = []
    sources = list(by_source.keys())
    secrets.SystemRandom().shuffle(sources)

    # Round-robin across sources
    while len(result) < n and any(by_source.values()):
        for src in sources:
            if len(result) >= n:
                break
            if by_source[src]:
                result.append(by_source[src].pop(0))

    return result


# ── Recording responses ───────────────────────────────────────────────────────

def record_response(user_id: str, session_id: str, response: dict) -> dict:
    """
    Append a response to the session.
    response: {cardPrimaryMood?, scrapedItemId?, signal: "up"|"down"}
    Returns the updated session document.
    """
    container = get_taste_calibration_container_sync()
    session_doc_id = f"{user_id}-{session_id}"

    # Load session (partition key = userId)
    session = container.read_item(item=session_doc_id, partition_key=user_id)
    session["responses"].append({**response, "respondedAt": datetime.now(timezone.utc).isoformat()})
    container.upsert_item(session)
    return session


# ── Completing the quiz ───────────────────────────────────────────────────────

def complete_quiz(user_id: str, session_id: str) -> dict:
    """
    Finalise the quiz session.
    Infer tastes from responses, update UserProfile, mark session complete.
    Returns the inferred tastes dict.
    """
    container = get_taste_calibration_container_sync()
    session_doc_id = f"{user_id}-{session_id}"
    session = container.read_item(item=session_doc_id, partition_key=user_id)

    inferred = (
        _infer_from_mood_cards(session)
        if session["phase"] == 1
        else _infer_from_images(session)
    )

    session["inferredTastes"] = inferred
    session["isComplete"] = True
    session["completedAt"] = datetime.now(timezone.utc).isoformat()
    container.upsert_item(session)

    _update_user_profile(user_id, inferred)
    return inferred


def _infer_from_mood_cards(session: dict) -> dict:
    """Phase 1: user selected (signal='up') archetypes → StylePreferences."""
    liked = [
        r["cardPrimaryMood"]
        for r in session.get("responses", [])
        if r.get("signal") == "up" and r.get("cardPrimaryMood")
    ]
    return {"styleKeywords": liked, "brands": []}


def _infer_from_images(session: dict) -> dict:
    """
    Phase 2: aggregate tags from liked images → StylePreferences.
    Aggregate brand mentions from liked image titles → FavoriteBrands.
    """
    tag_counts: dict[str, int] = {}
    brands: list[str] = []

    liked_ids = {
        r["scrapedItemId"]
        for r in session.get("responses", [])
        if r.get("signal") == "up"
    }

    for item in session.get("imageItems", []):
        if item["scrapedItemId"] not in liked_ids:
            continue
        for tag in item.get("tags", []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
        # Simple brand extraction from title
        for word in item.get("title", "").split():
            if word[0].isupper() and len(word) > 3:
                brands.append(word)

    # Top tags by frequency
    top_tags = sorted(tag_counts, key=tag_counts.__getitem__, reverse=True)[:5]
    # Deduplicate brands, keep most-common
    brand_counts: dict[str, int] = {}
    for b in brands:
        brand_counts[b] = brand_counts.get(b, 0) + 1
    top_brands = sorted(brand_counts, key=brand_counts.__getitem__, reverse=True)[:3]

    return {"styleKeywords": top_tags, "brands": top_brands}


def _update_user_profile(user_id: str, inferred: dict) -> None:
    """
    Merge inferred tastes into UserProfile.StylePreferences and FavoriteBrands.
    Only adds new values — never removes existing user-declared preferences.
    """
    try:
        profiles_container = get_user_profiles_container_sync()
        profile = profiles_container.read_item(item=user_id, partition_key=user_id)

        existing_styles: list[str] = profile.get("stylePreferences", [])
        new_styles = [
            kw for kw in inferred.get("styleKeywords", [])
            if kw.lower() not in [s.lower() for s in existing_styles]
        ]
        profile["stylePreferences"] = existing_styles + new_styles

        existing_brands: list[str] = profile.get("favoriteBrands", [])
        new_brands = [
            b for b in inferred.get("brands", [])
            if b.lower() not in [x.lower() for x in existing_brands]
        ]
        profile["favoriteBrands"] = existing_brands + new_brands

        profiles_container.upsert_item(profile)
        logger.info(
            "Updated UserProfile %s: +%d styles, +%d brands",
            user_id, len(new_styles), len(new_brands),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not update UserProfile %s: %s", user_id, exc)
