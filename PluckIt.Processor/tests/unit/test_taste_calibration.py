"""
Unit tests for the taste calibration module.

All Cosmos calls are mocked at the db accessor boundary.
"""

from unittest.mock import MagicMock, patch

import pytest

from agents.taste_calibration import (
    _infer_from_mood_cards,
    _infer_from_images,
    _diverse_sample,
    _load_mood_cards,
)


# ── _diverse_sample ───────────────────────────────────────────────────────────

def test_diverse_sample_returns_n_items():
    docs = [{"id": str(i), "sourceId": f"src-{i % 3}"} for i in range(30)]
    result = _diverse_sample(docs, 10)
    assert len(result) == 10


def test_diverse_sample_covers_sources():
    docs = [{"id": str(i), "sourceId": f"src-{i % 3}"} for i in range(30)]
    result = _diverse_sample(docs, 9)
    source_ids = {d["sourceId"] for d in result}
    assert len(source_ids) >= 2  # at least 2 different sources represented


def test_diverse_sample_fewer_than_n():
    docs = [{"id": "1", "sourceId": "src-a"}]
    result = _diverse_sample(docs, 10)
    assert len(result) == 1


def test_diverse_sample_empty():
    assert _diverse_sample([], 10) == []


# ── _infer_from_mood_cards (Phase 1) ──────────────────────────────────────────

def test_infer_phase1_liked_cards():
    session = {
        "phase": 1,
        "responses": [
            {"cardPrimaryMood": "Minimalist", "signal": "up"},
            {"cardPrimaryMood": "Streetwear", "signal": "up"},
            {"cardPrimaryMood": "Bohemian", "signal": "down"},
        ],
    }
    result = _infer_from_mood_cards(session)
    assert "Minimalist" in result["styleKeywords"]
    assert "Streetwear" in result["styleKeywords"]
    assert "Bohemian" not in result["styleKeywords"]
    assert result["brands"] == []


def test_infer_phase1_all_down():
    session = {
        "phase": 1,
        "responses": [
            {"cardPrimaryMood": "Edgy", "signal": "down"},
        ],
    }
    result = _infer_from_mood_cards(session)
    assert result["styleKeywords"] == []


def test_infer_phase1_no_responses():
    session = {"phase": 1, "responses": []}
    result = _infer_from_mood_cards(session)
    assert result["styleKeywords"] == []


# ── _infer_from_images (Phase 2) ──────────────────────────────────────────────

def _make_image_session(liked_ids, image_items):
    return {
        "phase": 2,
        "responses": [
            {"scrapedItemId": id_, "signal": "up"}
            for id_ in liked_ids
        ],
        "imageItems": image_items,
    }


def test_infer_phase2_aggregates_tags():
    items = [
        {"scrapedItemId": "a", "tags": ["minimalist", "neutral"], "title": "Clean fit"},
        {"scrapedItemId": "b", "tags": ["minimalist", "linen"], "title": "Linen shirt"},
        {"scrapedItemId": "c", "tags": ["maximalist", "bold"], "title": "Bold look"},
    ]
    session = _make_image_session(["a", "b"], items)
    result = _infer_from_images(session)

    # minimalist appears in both liked items — should be top tag
    assert "minimalist" in result["styleKeywords"]
    # maximalist is from a disliked item — should not appear
    assert "maximalist" not in result["styleKeywords"]


def test_infer_phase2_no_likes():
    items = [
        {"scrapedItemId": "a", "tags": ["streetwear"], "title": "Hoodie"},
    ]
    session = _make_image_session([], items)
    result = _infer_from_images(session)
    assert result["styleKeywords"] == []
    assert result["brands"] == []


def test_infer_phase2_top_tags_capped_at_5():
    items = [
        {"scrapedItemId": str(i), "tags": [f"tag{i}", "common"], "title": f"Item {i}"}
        for i in range(10)
    ]
    session = _make_image_session([str(i) for i in range(10)], items)
    result = _infer_from_images(session)
    assert len(result["styleKeywords"]) <= 5


# ── _load_mood_cards fallback ─────────────────────────────────────────────────

def test_load_mood_cards_fallback_on_cosmos_error():
    """When Cosmos is unreachable, _load_mood_cards returns the 12 static archetypes."""
    with patch("agents.taste_calibration.get_moods_container_sync") as mock_get:
        mock_container = MagicMock()
        mock_container.query_items.side_effect = RuntimeError("Cosmos down")
        mock_get.return_value = mock_container

        cards = _load_mood_cards()

    assert len(cards) == 12
    primary_moods = {c["primaryMood"] for c in cards}
    assert "Minimalist" in primary_moods
    assert "Streetwear" in primary_moods
    assert "Dark Academia" in primary_moods


def test_load_mood_cards_deduplicates_by_primary_mood():
    """If Cosmos has multiple docs per primaryMood, only the highest trendScore is kept."""
    docs = [
        {"primaryMood": "Minimalist", "name": "Quiet Luxury", "trendScore": 5,
         "description": "", "moodSignals": {}, "subMoods": []},
        {"primaryMood": "Minimalist", "name": "Clean Lines", "trendScore": 2,
         "description": "", "moodSignals": {}, "subMoods": []},
        {"primaryMood": "Streetwear", "name": "Urban Core", "trendScore": 3,
         "description": "", "moodSignals": {}, "subMoods": []},
    ]

    with patch("agents.taste_calibration.get_moods_container_sync") as mock_get:
        mock_container = MagicMock()
        mock_container.query_items.return_value = iter(docs)
        mock_get.return_value = mock_container

        cards = _load_mood_cards()

    primary_moods = [c["primaryMood"] for c in cards]
    assert primary_moods.count("Minimalist") == 1

    minimalist_card = next(c for c in cards if c["primaryMood"] == "Minimalist")
    assert minimalist_card["name"] == "Quiet Luxury"  # highest trendScore wins
