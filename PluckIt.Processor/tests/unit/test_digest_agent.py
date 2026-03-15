"""
Unit tests for agents/digest_agent.py.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import hashlib
import json

from agents.digest_agent import (
    _PROMPT_ITEM_LIMIT,
    _load_user_wardrobe,
    _save_digest_and_update_profile,
    compute_wardrobe_hash,
    _load_user_wardrobe,
    run_digest_for_user_with_status,
    run_weekly_digest,
)


@pytest.mark.unit
def test_run_digest_for_user_with_status_fails_when_wardrobe_cannot_load():
    profile_container = MagicMock()
    profile_container.read_item.return_value = {
        "wardrobeHashAtLastDigest": "hash-old",
        "wardrobeFingerprint": "hash-new",
    }

    with (
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=profile_container),
        patch("agents.digest_agent._load_user_wardrobe", return_value=None),
    ):
        digest, outcome = run_digest_for_user_with_status("user-fail-load")

    assert digest is None
    assert outcome == "failed"


@pytest.mark.unit
def test_load_user_wardrobe_fetches_ids_then_top_scored_items():
    sync_wardrobe = MagicMock()

    def query_items(**kwargs):
        query = kwargs["query"]
        if query.startswith("SELECT c.id FROM c"):
            return iter([{"id": "item-1"}, {"id": "item-2"}, {"id": "item-3"}])
        return iter([
            {"id": "item-2", "category": "tops", "wearCount": 3},
            {"id": "item-1", "category": "bottoms", "wearCount": 5},
        ])

    sync_wardrobe.query_items.side_effect = query_items

    with patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe):
        wardrobe_data = _load_user_wardrobe("user-test")

    assert wardrobe_data is not None
    assert wardrobe_data["item_ids"] == ["item-1", "item-2", "item-3"]
    assert len(wardrobe_data["items"]) == 2
    assert wardrobe_data["items"][0]["id"] in {"item-1", "item-2"}
    second_call_args = sync_wardrobe.query_items.call_args_list[1][1]
    query = second_call_args["query"]
    params = second_call_args["parameters"]
    assert "ORDER BY c.wearCount DESC" in query
    assert "OFFSET 0 LIMIT @limit" in query
    assert {"name": "@limit", "value": _PROMPT_ITEM_LIMIT} in params


@pytest.mark.unit
def test_run_digest_for_user_with_status_skips_by_hash():
    profile_container = MagicMock()
    profile_container.read_item.return_value = {
        "id": "user-hash-match",
        "wardrobeHashAtLastDigest": "hash-123",
        "wardrobeFingerprint": "hash-123",
        "recommendationOptIn": True,
    }
    mock_load = MagicMock(return_value={"items": [], "item_ids": ["item-1"]})
    with (
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=profile_container),
        patch("agents.digest_agent._load_user_wardrobe", mock_load),
        patch("agents.digest_agent.compute_wardrobe_hash", return_value="hash-123"),
    ):
        digest, outcome = run_digest_for_user_with_status("user-hash-match")

    assert digest is None
    assert outcome == "skipped_by_hash"
    mock_load.assert_not_called()


@pytest.mark.unit
def test_run_digest_for_user_with_status_skips_by_opt_out():
    profile_container = MagicMock()
    profile_container.read_item.return_value = {
        "id": "user-opt-out",
        "wardrobeHashAtLastDigest": "other-hash",
        "recommendationOptIn": False,
    }
    with (
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=profile_container),
        patch("agents.digest_agent._load_user_wardrobe", return_value={"items": [], "item_ids": ["item-1"]}),
        patch("agents.digest_agent.compute_wardrobe_hash", return_value="hash-123"),
    ):
        digest, outcome = run_digest_for_user_with_status("user-opt-out")

    assert digest is None
    assert outcome == "skipped_by_opt_out"


@pytest.mark.unit
def test_run_digest_for_user_with_status_generates_digest():
    profile_container = MagicMock()
    profile_container.read_item.return_value = {
        "id": "user-generate",
        "wardrobeHashAtLastDigest": "old-hash",
        "recommendationOptIn": True,
        "climateZone": "temperate",
    }
    with (
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=profile_container),
        patch("agents.digest_agent._load_user_wardrobe", return_value={
            "items": [{"wearCount": 1}, {"wearCount": 2}],
            "item_ids": ["item-1", "item-2"],
        }),
        patch("agents.digest_agent.compute_wardrobe_hash", return_value="hash-456"),
        patch("agents.digest_agent._should_skip_digest", return_value=False),
        patch("agents.digest_agent._analyze_wardrobe", return_value=([], {}, [])),
        patch("agents.digest_agent._load_recent_feedback", return_value=([], [])),
        patch("agents.digest_agent._generate_suggestions", return_value=[{"item": "jacket", "rationale": "works great"}]),
        patch("agents.digest_agent._compute_style_confidence", return_value=0.77),
        patch("agents.digest_agent._create_digest_doc", return_value={"id": "d-1"}),
        patch("agents.digest_agent._save_digest_and_update_profile"),
    ):
        digest, outcome = run_digest_for_user_with_status("user-generate")

    assert digest == {"id": "d-1"}
    assert outcome == "generated"


@pytest.mark.unit
def test_run_digest_for_user_with_status_fails_when_save_fails():
    profile_container = MagicMock()
    profile_container.read_item.return_value = {
        "id": "user-save-fail",
        "wardrobeHashAtLastDigest": "old-hash",
        "recommendationOptIn": True,
        "climateZone": "temperate",
    }
    with (
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=profile_container),
        patch("agents.digest_agent._load_user_wardrobe", return_value={
            "items": [{"wearCount": 1}, {"wearCount": 2}],
            "item_ids": ["item-1", "item-2"],
        }),
        patch("agents.digest_agent.compute_wardrobe_hash", return_value="hash-456"),
        patch("agents.digest_agent._should_skip_digest", return_value=False),
        patch("agents.digest_agent._analyze_wardrobe", return_value=([], {}, [])),
        patch("agents.digest_agent._load_recent_feedback", return_value=([], [])),
        patch("agents.digest_agent._generate_suggestions", return_value=[{"item": "jacket", "rationale": "works great"}]),
        patch("agents.digest_agent._compute_style_confidence", return_value=0.77),
        patch("agents.digest_agent._create_digest_doc", return_value={"id": "d-1"}),
        patch("agents.digest_agent._save_digest_and_update_profile", return_value=False),
    ):
        digest, outcome = run_digest_for_user_with_status("user-save-fail")

    assert digest is None
    assert outcome == "failed"


@pytest.mark.unit
def test_save_digest_and_update_profile_returns_false_on_exception():
    profile_container = MagicMock()
    profile = {
        "id": "user-save-exc",
        "wardrobeHashAtLastDigest": "old-hash",
        "climateZone": "temperate",
    }
    digest = {"wardrobeHash": "new-hash"}
    failing_container = MagicMock()
    failing_container.upsert_item.side_effect = Exception("upsert failed")

    with patch("agents.digest_agent.get_digests_container_sync", return_value=failing_container):
        result = _save_digest_and_update_profile(profile_container, profile, digest, None, "temperate")

    assert result is False


@pytest.mark.unit
def test_save_digest_and_update_profile_updates_fingerprint():
    profile_container = MagicMock()
    profile = {
        "id": "user-save-exc",
        "wardrobeHashAtLastDigest": "old-hash",
        "climateZone": "temperate",
    }
    digest = {"wardrobeHash": "new-hash"}
    digests_container = MagicMock()

    with patch("agents.digest_agent.get_digests_container_sync", return_value=digests_container):
        result = _save_digest_and_update_profile(profile_container, profile, digest, None, "temperate")

    assert result is True
    assert profile["wardrobeFingerprint"] == "new-hash"
    profile_container.upsert_item.assert_called_once_with(profile)
    digests_container.upsert_item.assert_called_once_with(digest)


@pytest.mark.unit
def test_run_weekly_digest_tracks_outcomes_and_handles_failures():
    read_all_profiles = MagicMock(return_value=[
        {"id": "user-good"},
        {"id": "user-bad"},
        {"id": ""},
        {},
    ])
    profile_container = MagicMock()
    profile_container.read_all_items = read_all_profiles

    def _run_digest_side_effect(user_id: str):
        if user_id == "user-bad":
            raise RuntimeError("boom")
        return None, "generated"

    with (
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=profile_container),
        patch("agents.digest_agent.run_digest_for_user_with_status", side_effect=_run_digest_side_effect),
        patch("agents.digest_agent.logger.info") as mock_info,
    ):
        run_weekly_digest()

    assert mock_info.call_count >= 2
    last_call = mock_info.call_args_list[-1]
    assert "Weekly digest complete" in last_call.args[0]
@pytest.mark.unit
def test_run_digest_for_user_with_status_fails_when_no_suggestions():
    profile_container = MagicMock()
    profile_container.read_item.return_value = {
        "id": "user-no-suggestions",
        "wardrobeHashAtLastDigest": "old-hash",
        "recommendationOptIn": True,
        "climateZone": "temperate",
    }
    with (
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=profile_container),
        patch("agents.digest_agent._load_user_wardrobe", return_value={
            "items": [{"wearCount": 1}],
            "item_ids": ["item-1"],
        }),
        patch("agents.digest_agent.compute_wardrobe_hash", return_value="hash-456"),
        patch("agents.digest_agent._should_skip_digest", return_value=False),
        patch("agents.digest_agent._analyze_wardrobe", return_value=([], {}, [])),
        patch("agents.digest_agent._load_recent_feedback", return_value=([], [])),
        patch("agents.digest_agent._generate_suggestions", return_value=[]),
    ):
        digest, outcome = run_digest_for_user_with_status("user-no-suggestions")

    assert digest is None
    assert outcome == "failed"

# ── compute_wardrobe_hash ────────────────────────────────────────────────────

@pytest.mark.unit
def test_compute_wardrobe_hash_is_deterministic():
    ids = ["c", "a", "b"]
    h1 = compute_wardrobe_hash(ids)
    h2 = compute_wardrobe_hash(ids)
    assert h1 == h2


@pytest.mark.unit
def test_compute_wardrobe_hash_is_order_independent():
    """Hash must be the same regardless of input order."""
    assert compute_wardrobe_hash(["a", "b", "c"]) == compute_wardrobe_hash(["c", "a", "b"])


@pytest.mark.unit
def test_compute_wardrobe_hash_changes_on_different_items():
    assert compute_wardrobe_hash(["a", "b"]) != compute_wardrobe_hash(["a", "c"])


@pytest.mark.unit
def test_compute_wardrobe_hash_empty_list():
    h = compute_wardrobe_hash([])
    assert isinstance(h, str)
    assert len(h) == 16  # truncated to 16 chars


@pytest.mark.unit
def test_compute_wardrobe_hash_length_is_16():
    h = compute_wardrobe_hash(["item-1", "item-2"])
    assert len(h) == 16


# ── run_digest_for_user — hash unchanged → skip ──────────────────────────────

@pytest.mark.unit
def test_run_digest_skips_when_hash_unchanged():
    """
    If the stored wardrobeHashAtLastDigest matches the computed hash,
    run_digest_for_user should return None without calling the LLM.
    """
    item_ids = ["id-1", "id-2", "id-3"]
    current_hash = compute_wardrobe_hash(item_ids)

    fake_items = [{"id": i} for i in item_ids]

    # Mock wardrobe query
    sync_wardrobe = MagicMock()
    sync_wardrobe.query_items = MagicMock(return_value=iter(fake_items))

    # Mock profile with the matching hash already stored
    sync_profiles = MagicMock()
    sync_profiles.read_item = MagicMock(return_value={
        "id": "test-user",
        "wardrobeHashAtLastDigest": current_hash,
        "stylePreferences": [],
    })

    with (
        patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe),
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=sync_profiles),
    ):
        from agents.digest_agent import run_digest_for_user
        result = run_digest_for_user("test-user")

    assert result is None, "Should return None when wardrobe hash is unchanged"


@pytest.mark.unit
def test_run_digest_runs_when_hash_changed():
    """When the hash differs, run_digest_for_user calls the LLM and returns a dict."""
    item_ids = ["id-x", "id-y"]

    fake_items = [
        {"id": i, "category": "Tops", "colours": [], "tags": [], "brand": None}
        for i in item_ids
    ]

    sync_wardrobe = MagicMock()
    sync_wardrobe.query_items = MagicMock(return_value=iter(fake_items))

    sync_profiles = MagicMock()
    sync_profiles.read_item = MagicMock(return_value={
        "id": "test-user",
        "wardrobeHashAtLastDigest": "old-hash-xxxxxxxx",  # stale
        "stylePreferences": ["minimalist"],
    })
    sync_profiles.upsert_item = MagicMock()

    sync_digests = MagicMock()
    sync_digests.upsert_item = MagicMock()

    fake_llm_response = MagicMock()
    fake_llm_response.content = json.dumps([
        {"item": "A white linen shirt", "reason": "Versatile"}
    ])
    fake_llm = MagicMock()
    fake_llm.invoke = MagicMock(return_value=fake_llm_response)

    sync_feedback = MagicMock()
    sync_feedback.query_items = MagicMock(return_value=iter([]))

    with (
        patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe),
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=sync_profiles),
        patch("agents.digest_agent.get_digests_container_sync", return_value=sync_digests),
        patch("agents.digest_agent.get_digest_feedback_container_sync", return_value=sync_feedback),
        patch("agents.digest_agent._build_digest_llm", return_value=fake_llm),
    ):
        from agents.digest_agent import run_digest_for_user
        result = run_digest_for_user("test-user")

    assert result is not None
    assert "suggestions" in result
    assert isinstance(result["suggestions"], list)
    sync_digests.upsert_item.assert_called_once()
    sync_profiles.upsert_item.assert_called_once()


@pytest.mark.unit
def test_run_digest_handles_empty_wardrobe():
    """Empty wardrobe should still succeed (returns None due to no items to hash)."""
    sync_wardrobe = MagicMock()
    sync_wardrobe.query_items = MagicMock(return_value=iter([]))

    sync_profiles = MagicMock()
    sync_profiles.read_item = MagicMock(return_value={
        "id": "test-user",
        "wardrobeHashAtLastDigest": None,
        "stylePreferences": [],
    })

    with (
        patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe),
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=sync_profiles),
    ):
        from agents.digest_agent import run_digest_for_user
        # No items → hash of empty list → hash will match any "old" value if also empty
        # The function should return None (nothing to digest)
        result = run_digest_for_user("test-user")

    # Empty wardrobe: hash computed and compared; nothing to generate
    assert result is None


# ── Feedback integration ─────────────────────────────────────────────────────

@pytest.mark.unit
def test_run_digest_includes_liked_feedback_in_prompt():
    """Liked/disliked feedback should appear in the LLM prompt."""
    item_ids = ["id-a", "id-b"]

    fake_items = [
        {"id": i, "category": "Tops", "colours": [], "tags": [], "brand": None}
        for i in item_ids
    ]

    sync_wardrobe = MagicMock()
    sync_wardrobe.query_items = MagicMock(return_value=iter(fake_items))

    sync_profiles = MagicMock()
    sync_profiles.read_item = MagicMock(return_value={
        "id": "test-user",
        "wardrobeHashAtLastDigest": "old-hash",
        "stylePreferences": ["minimalist"],
    })
    sync_profiles.upsert_item = MagicMock()

    sync_digests = MagicMock()
    sync_digests.upsert_item = MagicMock()

    # Simulate feedback: one liked, one disliked
    sync_feedback = MagicMock()
    sync_feedback.query_items = MagicMock(return_value=iter([
        {"signal": "up",   "suggestionDescription": "A navy cashmere sweater"},
        {"signal": "down", "suggestionDescription": "A graphic tee"},
    ]))

    captured_prompts: list[str] = []

    fake_llm_response = MagicMock()
    fake_llm_response.content = json.dumps([{"item": "White Oxford shirt", "rationale": "Gap"}])
    fake_llm = MagicMock()

    def _capture_invoke(messages):
        for msg in messages:
            captured_prompts.append(msg.content)
        return fake_llm_response

    fake_llm.invoke = _capture_invoke

    with (
        patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe),
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=sync_profiles),
        patch("agents.digest_agent.get_digests_container_sync", return_value=sync_digests),
        patch("agents.digest_agent.get_digest_feedback_container_sync", return_value=sync_feedback),
        patch("agents.digest_agent._build_digest_llm", return_value=fake_llm),
    ):
        from agents.digest_agent import run_digest_for_user
        result = run_digest_for_user("test-user")

    assert result is not None
    full_prompt = " ".join(captured_prompts)
    assert "navy cashmere sweater" in full_prompt, "Liked feedback must appear in prompt"
    assert "graphic tee" in full_prompt, "Disliked feedback must appear in prompt"


@pytest.mark.unit
def test_run_digest_skips_when_recommendation_opt_out():
    """User with recommendationOptIn=False should get None without any LLM call."""
    item_ids = ["id-1", "id-2"]
    fake_items = [{"id": i, "category": "Tops"} for i in item_ids]

    sync_wardrobe = MagicMock()
    sync_wardrobe.query_items = MagicMock(return_value=iter(fake_items))

    sync_profiles = MagicMock()
    sync_profiles.read_item = MagicMock(return_value={
        "id": "test-user",
        "wardrobeHashAtLastDigest": "old-hash",
        "recommendationOptIn": False,
        "stylePreferences": [],
    })

    fake_llm = MagicMock()

    with (
        patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe),
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=sync_profiles),
        patch("agents.digest_agent._build_digest_llm", return_value=fake_llm),
    ):
        from agents.digest_agent import run_digest_for_user
        result = run_digest_for_user("test-user")

    assert result is None, "Opted-out user should return None"
    fake_llm.invoke.assert_not_called()


@pytest.mark.unit
def test_load_user_wardrobe_prefetches_ids_and_limits_prompt_items():
    sync_wardrobe = MagicMock()
    sync_wardrobe.query_items.side_effect = [
        iter([{"id": "id-low-signal"}, {"id": "id-high-signal"}, {"id": "id-unworn"}]),
        iter([
            {"id": "id-high-signal", "wearCount": 5, "category": "tops"},
            {"id": "id-low-signal", "wearCount": 2, "category": "shoes"},
        ]),
    ]

    with patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe):
        result = _load_user_wardrobe("user-1")

    assert result == {
        "item_ids": ["id-low-signal", "id-high-signal", "id-unworn"],
        "items": [
            {"id": "id-high-signal", "wearCount": 5, "category": "tops"},
            {"id": "id-low-signal", "wearCount": 2, "category": "shoes"},
        ],
    }

    assert sync_wardrobe.query_items.call_count == 2

    first_call_args = sync_wardrobe.query_items.call_args_list[0].kwargs
    second_call_args = sync_wardrobe.query_items.call_args_list[1].kwargs
    first_query = first_call_args["query"]
    first_params = first_call_args["parameters"]
    second_query = second_call_args["query"]
    second_params = second_call_args["parameters"]

    assert "SELECT c.id FROM c WHERE c.userId = @userId" in first_query
    assert {"name": "@userId", "value": "user-1"} in first_params
    assert "ORDER BY c.wearCount DESC" in second_query
    assert "IS_DEFINED(c.wearCount)" in second_query
    assert "c.wearCount > 0" in second_query
    assert {"name": "@userId", "value": "user-1"} in second_params
    assert {"name": "@limit", "value": _PROMPT_ITEM_LIMIT} in second_params


@pytest.mark.unit
def test_load_user_wardrobe_returns_no_items_without_second_query_when_no_items():
    sync_wardrobe = MagicMock()
    sync_wardrobe.query_items.return_value = iter([])

    with patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe):
        result = _load_user_wardrobe("user-empty")

    assert result == {"items": [], "item_ids": []}
    assert sync_wardrobe.query_items.call_count == 1
