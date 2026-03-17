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
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI

from .db import (
    get_wardrobe_container_sync,
    get_user_profiles_container_sync,
    get_digests_container_sync,
    get_digest_feedback_container_sync,
)

logger = logging.getLogger(__name__)

# Keep one shared digest LLM instance per process for batch runs.
_DIGEST_LLM: AzureChatOpenAI | None = None

# Items fed into the LLM prompt — keeps prompt tokens bounded for p95 < 2.5 s AC.
_PROMPT_ITEM_LIMIT = 50
_DigestOutcome = Literal["skipped_by_hash", "skipped_by_opt_out", "generated", "failed"]


def _build_digest_langfuse_callbacks(trace_id: str | None = None, *, user_id: str | None = None) -> list[Any]:
    """Build optional Langfuse callbacks using function_app shared settings."""
    try:
        from function_app import _build_langfuse_callbacks as shared_build
    except Exception as exc:
        logger.warning("Digest: unable to import shared Langfuse callback builder: %s", exc)
        return []

    try:
        return shared_build(
            trace_id,
            user_id=user_id,
            metadata={"component": "digest", "trace_label": "wardrobe-digest"},
        )
    except Exception as exc:
        logger.warning("Digest: shared Langfuse callback builder failed: %s", exc)
        return []


def _flush_digest_langfuse_callbacks(callbacks: list[Any]) -> None:
    """Flush optional Langfuse callbacks if available."""
    if not callbacks:
        return

    try:
        from function_app import _flush_langfuse_callbacks as shared_flush
    except Exception as exc:
        logger.warning("Digest: unable to import shared Langfuse callback flusher: %s", exc)
        return

    try:
        shared_flush(callbacks)
    except Exception as exc:
        logger.warning("Digest: shared Langfuse callback flush failed: %s", exc)


def _get_env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Missing env var: {name}")
    return v


def compute_wardrobe_hash(item_ids: list[str]) -> str:
    """SHA-256 of sorted, joined item IDs — cheap change detector."""
    combined = ",".join(sorted(item_ids))
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


def _build_digest_llm(
    *,
    trace_id: str | None = None,
    user_id: str | None = None,
    callbacks: list[Any] | None = None,
    azure_deployment: str | None = None,
    temperature: float = 0.5,
    max_tokens: int = 800,
) -> AzureChatOpenAI:
    """Build the digest LLM client."""
    if callbacks is None:
        callbacks = _build_digest_langfuse_callbacks(trace_id, user_id=user_id)

    llm_kwargs = {
        "azure_endpoint": _get_env("AZURE_OPENAI_ENDPOINT"),
        "api_key": _get_env("AZURE_OPENAI_API_KEY"),
        "azure_deployment": azure_deployment or _get_env("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
        "api_version": "2024-12-01-preview",
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if callbacks:
        llm_kwargs["callbacks"] = callbacks
    return AzureChatOpenAI(**llm_kwargs)


def _get_digest_llm() -> AzureChatOpenAI:
    """Return a singleton Azure Chat client for digest generation."""
    global _DIGEST_LLM
    if _DIGEST_LLM is None:
        logger.debug("Initializing shared digest LLM instance.")
        _DIGEST_LLM = _build_digest_llm()
    return _DIGEST_LLM


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


def _infer_climate_zone(
    location_city: Optional[str],
    wear_events_conditions: list[str],
    *,
    callbacks: list[Any] | None = None,
    trace_id: str | None = None,
    user_id: str | None = None,
) -> Optional[str]:
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
        nano = _build_digest_llm(
            trace_id=trace_id,
            user_id=user_id,
            callbacks=callbacks,
            temperature=0,
            max_tokens=5,
            azure_deployment=os.getenv(
                "AZURE_OPENAI_NANO_DEPLOYMENT",
                os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
            ),
        )
        result = nano.invoke(prompt).content.strip().lower()
        if result in {"temperate", "tropical", "continental", "arid", "polar"}:
            return result
    except Exception as exc:
        logger.debug("Climate zone inference failed (non-critical): %s", exc)
    return None


def run_digest_for_user(
    user_id: str,
    force: bool = False,
    trace_id: str | None = None,
) -> Optional[dict]:
    """
    Synchronous digest run for a single user. Returns the digest dict or None
    if skipped (wardrobe unchanged) or on error.
    """
    result, _ = run_digest_for_user_with_status(user_id, force=force, trace_id=trace_id)
    return result


def run_digest_for_user_with_status(
    user_id: str,
    force: bool = False,
    trace_id: str | None = None,
) -> tuple[Optional[dict], _DigestOutcome]:
    """
    Same as `run_digest_for_user`, plus internal status for scheduler metrics.

    Status values:
      - skipped_by_hash: no change in wardrobe hash
      - skipped_by_opt_out: user disabled recommendations
      - generated: digest generated and persisted
      - failed: no digest produced due runtime issues or LLM empty output
    """
    # 1. Load profile to check lightweight skip signals before expensive wardrobe load.
    profile_container = get_user_profiles_container_sync()
    profile = _get_user_profile(profile_container, user_id)
    if not force and profile.get("wardrobeHashAtLastDigest") == profile.get("wardrobeFingerprint"):
        return None, "skipped_by_hash"
    if not force and not profile.get("recommendationOptIn", True):
        return None, "skipped_by_opt_out"

    # 2. Load data
    wardrobe_data = _load_user_wardrobe(user_id)
    if wardrobe_data is None:
        return None, "failed"
    if not wardrobe_data["item_ids"]:
        return None, "skipped_by_hash"

    # 3. Skip checks
    current_hash = compute_wardrobe_hash(wardrobe_data["item_ids"])
    if _should_skip_digest(profile, current_hash, force):
        return None, "skipped_by_hash"
    ranked_items, category_counts, climate_signals = _analyze_wardrobe(wardrobe_data["items"])
    liked, disliked = _load_recent_feedback(user_id)
    
    climate_zone = profile.get("climateZone")
    trace_id = trace_id or str(uuid.uuid4())
    callbacks = _build_digest_langfuse_callbacks(trace_id, user_id=user_id)
    suggestions: list = []
    try:
        if not climate_zone and profile.get("locationCity"):
            climate_zone = _infer_climate_zone(
                profile["locationCity"],
                climate_signals,
                callbacks=callbacks,
                trace_id=trace_id,
                user_id=user_id,
            )

        # 4. Generate Suggestions via LLM
        items_with_history = sum(1 for s in ranked_items if s["wearCount"] > 0)
        suggestions = _generate_suggestions(
            profile, ranked_items, category_counts, liked, disliked,
            climate_zone, items_with_history, len(wardrobe_data["item_ids"]),
            trace_id=trace_id,
            user_id=user_id,
            callbacks=callbacks,
        )
    finally:
        _flush_digest_langfuse_callbacks(callbacks)
    if not suggestions:
        return None, "failed"

    # 5. Finalize and Save
    style_confidence = _compute_style_confidence(suggestions, category_counts, ranked_items)
    digest = _create_digest_doc(user_id, current_hash, suggestions, items_with_history, 
                                wardrobe_data["item_ids"], profile, climate_zone)
    
    if not _save_digest_and_update_profile(profile_container, profile, digest, style_confidence, climate_zone):
        return None, "failed"
    
    return digest, "generated"

def _load_user_wardrobe(user_id: str) -> Optional[dict]:
    try:
        container = get_wardrobe_container_sync()
        ids = [
            item["id"]
            for item in container.query_items(
                query="SELECT c.id FROM c WHERE c.userId = @userId",
                parameters=[{"name": "@userId", "value": user_id}],
            )
        ]
        if not ids:
            return {"items": [], "item_ids": []}

        items = []
        for item in container.query_items(
            query="SELECT c.id, c.category, c.colours, c.tags, c.brand, c.aestheticTags, "
                  "c.wearCount, c.lastWornAt, c.wearEvents, c.price "
                  "FROM c WHERE c.userId = @userId AND IS_DEFINED(c.wearCount) AND c.wearCount > 0 "
                  "ORDER BY c.wearCount DESC OFFSET 0 LIMIT @limit",
            parameters=[{"name": "@userId", "value": user_id}, {"name": "@limit", "value": _PROMPT_ITEM_LIMIT}],
        ):
            items.append(item)
        return {"items": items, "item_ids": ids}
    except Exception as exc:
        logger.warning("Digest: failed to load wardrobe for %s: %s", user_id, exc)
    return None

def _get_user_profile(container: any, user_id: str) -> dict:
    try:
        return container.read_item(item=user_id, partition_key=user_id)
    except Exception:
        return {}

def _should_skip_digest(profile: dict, current_hash: str, force: bool) -> bool:
    if not force and profile.get("wardrobeHashAtLastDigest") == current_hash:
        return True
    return False

def _extract_price_amount(price_raw) -> Optional[float]:
    if isinstance(price_raw, dict):
        return price_raw.get("amount")
    if isinstance(price_raw, (int, float)):
        return price_raw
    return None


def _collect_climate_signals(item: dict) -> list[str]:
    events = sorted(item.get("wearEvents") or [], key=lambda e: e.get("occurredAt") or "", reverse=True)
    return [
        (ev.get("weatherSnapshot") or {}).get("conditions", "").lower()
        for ev in events[:5]
        if (ev.get("weatherSnapshot") or {}).get("conditions")
    ]


def _analyze_wardrobe(items: list[dict]) -> tuple[list[dict], Counter, list[str]]:
    counts = Counter()
    signals = []
    scored = []
    for item in items:
        cat = (item.get("category") or "other").lower()
        counts[cat] += 1

        wear_count = item.get("wearCount", 0)
        score = _recency_score(wear_count, item.get("lastWornAt"))
        signals.extend(_collect_climate_signals(item))

        price_amount = _extract_price_amount(item.get("price"))
        cpw = round(price_amount / wear_count, 2) if price_amount and wear_count > 0 else None

        scored.append({
            "category": cat, "brand": item.get("brand"), "aestheticTags": item.get("aestheticTags") or [],
            "wearCount": wear_count, "lastWornAt": item.get("lastWornAt"), "score": score, "costPerWear": cpw,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:_PROMPT_ITEM_LIMIT], counts, signals

def _load_recent_feedback(user_id: str) -> tuple[list[str], list[str]]:
    liked, disliked = [], []
    try:
        container = get_digest_feedback_container_sync()
        for fb in container.query_items(
            query="SELECT * FROM c WHERE c.userId = @userId ORDER BY c.createdAt DESC OFFSET 0 LIMIT 30",
            parameters=[{"name": "@userId", "value": user_id}],
        ):
            if fb.get("signal") == "up":
                liked.append(fb.get("suggestionDescription", ""))
            elif fb.get("signal") == "down":
                disliked.append(fb.get("suggestionDescription", ""))
    except Exception:
        pass
    return liked, disliked

def _generate_suggestions(
    profile,
    scored,
    counts,
    liked,
    disliked,
    climate,
    worn_count,
    total_count,
    *,
    trace_id: str | None = None,
    user_id: str | None = None,
    callbacks: list[Any] | None = None,
) -> list:
    try:
        sparse = worn_count < 5
        style_prefs = profile.get("stylePreferences") or []
        profile_summary = (
            f"Styles: {', '.join(style_prefs) or 'none'}. "
            f"Colours: {', '.join(profile.get('preferredColours') or []) or 'none'}. "
            f"Climate: {climate or 'unknown'}. Wear: {worn_count}/{total_count} worn."
        )
        feedback_note = f"\nLiked: {'; '.join(liked[:5])}. Disliked: {'; '.join(disliked[:5])}." if liked or disliked else ""
        sparse_note = "\nNote: limited wear history. Broaden suggestions." if sparse else ""

        prompt = f"""Personal stylist. Profile: {profile_summary}
Wardrobe: {json.dumps(dict(counts.most_common(12)))}
Top items: {json.dumps(scored[:20])}
{sparse_note}{feedback_note}
3-5 purchase suggestions (item, rationale) in JSON array format."""

        llm = _get_digest_llm()
        invoke_kwargs: dict[str, Any] = {}
        if callbacks is not None:
            metadata: dict[str, str] = {}
            if trace_id is not None:
                metadata["trace_id"] = trace_id
            if user_id is not None:
                metadata["user_id"] = user_id
            invoke_config = {"callbacks": callbacks}
            if metadata:
                invoke_config["metadata"] = metadata
            invoke_kwargs["config"] = invoke_config
        resp = llm.invoke(
            [SystemMessage(content="Stylist. JSON only."), HumanMessage(content=prompt)],
            **invoke_kwargs,
        )
        raw = resp.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        suggestions = json.loads(raw)
        for s in suggestions:
            if "reason" in s and "rationale" not in s:
                s["rationale"] = s.pop("reason")
        return suggestions
    except Exception as exc:
        logger.error("Digest: LLM error: %s", exc)
    return []

def _compute_style_confidence(suggestions, counts, scored) -> Optional[float]:
    high_wear_cats = {c for c, n in counts.items() if n >= 3 and sum(s["wearCount"] for s in scored if s["category"] == c) > 0}
    if not suggestions or not high_wear_cats:
        return None
    aligned = sum(1 for s in suggestions if any(kw in (s.get("item", "") + s.get("rationale", "")).lower() for kw in high_wear_cats))
    return round(aligned / len(suggestions), 2)

def _create_digest_doc(user_id, current_hash, suggestions, worn_count, all_ids, profile, climate) -> dict:
    return {
        "id": f"{user_id}-{current_hash}",
        "userId": user_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "wardrobeHash": current_hash,
        "suggestions": suggestions,
        "stylesConsidered": profile.get("stylePreferences") or [],
        "totalItems": len(all_ids),
        "itemsWithWearHistory": worn_count,
        "climateZone": climate,
    }

def _save_digest_and_update_profile(profile_container, profile, digest, confidence, climate):
    try:
        get_digests_container_sync().upsert_item(digest)
        profile["wardrobeHashAtLastDigest"] = digest["wardrobeHash"]
        profile["wardrobeFingerprint"] = digest["wardrobeHash"]
        if confidence is not None:
            profile["styleConfidenceProfile"] = confidence
        if climate and not profile.get("climateZone"):
            profile["climateZone"] = climate
        profile_container.upsert_item(profile)
        return True
    except Exception as exc:
        logger.warning("Digest: final save failed: %s", exc)
        return False


def run_weekly_digest() -> None:
    """
    Entry point for the timer trigger. Iterates all UserProfiles and runs digests
    for each user. Skips users whose wardrobes haven't changed.
    """
    from collections import Counter

    logger.info("Weekly digest starting.")
    outcome_counter: Counter[str] = Counter()

    try:
        profile_container = get_user_profiles_container_sync()
        profiles_cursor = profile_container.query_items(
            query="SELECT c.id FROM c",
            max_item_count=500,
        )
    except Exception as exc:
        logger.error("Digest: failed to list profiles (%s): %s", type(exc).__name__, exc)
        return

    for profile in profiles_cursor:
        user_id = profile.get("id")
        if not user_id:
            continue
        try:
            _, outcome = run_digest_for_user_with_status(user_id)
        except Exception as exc:
            logger.exception("Digest scheduler failure for user %s: %s", user_id, exc)
            outcome = "failed"
        outcome_counter[outcome] += 1

    logger.info(
        "Weekly digest complete. Outcomes: skipped_by_hash=%d, skipped_by_opt_out=%d, "
        "generated=%d, failed=%d.",
        outcome_counter["skipped_by_hash"],
        outcome_counter["skipped_by_opt_out"],
        outcome_counter["generated"],
        outcome_counter["failed"],
    )
