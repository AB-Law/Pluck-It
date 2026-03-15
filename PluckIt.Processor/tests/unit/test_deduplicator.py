"""
Unit tests for the RunDeduplicator.

No Cosmos or network calls — all state is injected directly.
"""

import pytest

from agents.scrapers.deduplicator import (
    PHASH_PREFIX_CHARS,
    PHASH_THRESHOLD,
    RunDeduplicator,
)


# ── URL dedup ─────────────────────────────────────────────────────────────────

def test_url_dedup_detects_exact_match():
    dedup = RunDeduplicator()
    dedup.register("https://reddit.com/abc", phash=None)
    assert dedup.is_duplicate("https://reddit.com/abc", phash=None) is True


def test_url_dedup_different_url_not_duplicate():
    dedup = RunDeduplicator()
    dedup.register("https://reddit.com/abc", phash=None)
    assert dedup.is_duplicate("https://reddit.com/xyz", phash=None) is False


def test_url_dedup_empty_state_not_duplicate():
    dedup = RunDeduplicator()
    assert dedup.is_duplicate("https://reddit.com/new", phash=None) is False


# ── pHash dedup ───────────────────────────────────────────────────────────────

def _make_dedup_with_phash(existing_hash: str) -> RunDeduplicator:
    dedup = RunDeduplicator()
    dedup.register("https://reddit.com/other", phash=existing_hash)
    return dedup


def _flip_bits(hash_value: str, bit_count: int) -> str:
    """Return `hash_value` with the lowest `bit_count` bits flipped."""
    if bit_count <= 0:
        return hash_value
    return f"{int(hash_value, 16) ^ ((1 << bit_count) - 1):0{len(hash_value)}x}"


def test_phash_dedup_identical_hash():
    """Hamming distance 0 — clearly duplicate."""
    h = "a" * 16  # 64-bit pHash hex
    dedup = _make_dedup_with_phash(h)
    assert dedup.is_duplicate("https://reddit.com/new", phash=h) is True


def test_phash_dedup_very_different_hash():
    """Very different image — not a duplicate."""
    existing = "0000000000000000"
    candidate = "ffffffffffffffff"
    dedup = _make_dedup_with_phash(existing)
    assert dedup.is_duplicate("https://reddit.com/new", phash=candidate) is False


def test_phash_dedup_nearby_prefix_variation_is_detected():
    """Flipping a top-bit prefix still counts as duplicate at threshold 5."""
    existing = "1111111111111111"
    candidate = f"{int(existing, 16) ^ (1 << 60):016x}"  # diff = 1 bit, different prefix
    dedup = _make_dedup_with_phash(existing)
    assert dedup.is_duplicate("https://reddit.com/new", phash=candidate) is True


def test_phash_dedup_at_threshold_boundary():
    """A candidate at exactly `PHASH_THRESHOLD` bits is not a duplicate."""
    hash_len = max(PHASH_PREFIX_CHARS, (PHASH_THRESHOLD + 3) // 4)
    existing = "a" * hash_len
    candidate = _flip_bits(existing, PHASH_THRESHOLD)
    dedup = _make_dedup_with_phash(existing)
    assert dedup.is_duplicate("https://reddit.com/new", phash=candidate) is False


def test_phash_dedup_just_under_threshold():
    """A candidate at one bit under `PHASH_THRESHOLD` is still duplicate."""
    hash_len = max(PHASH_PREFIX_CHARS, (PHASH_THRESHOLD + 3) // 4)
    existing = "a" * hash_len
    candidate = _flip_bits(existing, PHASH_THRESHOLD - 1)
    dedup = _make_dedup_with_phash(existing)
    assert dedup.is_duplicate("https://reddit.com/new", phash=candidate) is True


def test_phash_dedup_none_skipped():
    """None pHash should never cause a false positive."""
    dedup = RunDeduplicator()
    dedup.register("https://reddit.com/other", phash="a" * 16)
    assert dedup.is_duplicate("https://reddit.com/new", phash=None) is False


# ── load_from_cosmos ──────────────────────────────────────────────────────────

def test_load_from_cosmos_populates_state():
    docs = [
        {"productUrl": "https://reddit.com/post1", "pHash": "a" * 16},
        {"productUrl": "https://reddit.com/post2", "pHash": None},
    ]

    mock_container = type("C", (), {
        "query_items": lambda self, **kw: iter(docs),
    })()

    dedup = RunDeduplicator()
    dedup.load_from_cosmos(mock_container, partition_key="global")

    assert dedup.is_duplicate("https://reddit.com/post1", phash=None) is True
    assert dedup.is_duplicate("https://reddit.com/post3", phash=None) is False


def test_load_from_cosmos_handles_error_gracefully():
    class _BrokenContainer:
        def query_items(self, **kw):
            raise RuntimeError("Cosmos unavailable")

    dedup = RunDeduplicator()
    dedup.load_from_cosmos(_BrokenContainer(), partition_key="global")

    # Should still work with empty state after error
    assert dedup.is_duplicate("https://reddit.com/any", phash=None) is False


# ── register ──────────────────────────────────────────────────────────────────

def test_register_prevents_within_run_duplicate():
    dedup = RunDeduplicator()
    dedup.register("https://reddit.com/abc", phash="b" * 16)

    # Same URL — duplicate
    assert dedup.is_duplicate("https://reddit.com/abc", phash="c" * 16) is True


def test_register_multiple_items():
    dedup = RunDeduplicator()
    dedup.register("https://reddit.com/a", phash=None)
    dedup.register("https://reddit.com/b", phash=None)
    dedup.register("https://reddit.com/c", phash=None)

    assert dedup.is_duplicate("https://reddit.com/a", phash=None) is True
    assert dedup.is_duplicate("https://reddit.com/d", phash=None) is False
