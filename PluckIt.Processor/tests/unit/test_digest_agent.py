"""
Unit tests for agents/digest_agent.py.

All Cosmos DB and LLM calls are mocked — no real I/O.
"""
import hashlib
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.digest_agent import compute_wardrobe_hash


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

    with (
        patch("agents.digest_agent.get_wardrobe_container_sync", return_value=sync_wardrobe),
        patch("agents.digest_agent.get_user_profiles_container_sync", return_value=sync_profiles),
        patch("agents.digest_agent.get_digests_container_sync", return_value=sync_digests),
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
