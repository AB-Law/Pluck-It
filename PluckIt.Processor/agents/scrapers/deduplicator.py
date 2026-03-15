"""
Deduplication helpers for the scraper ingest pipeline.

Two levels:
  1. URL dedup  — exact match on product_url (cheapest, checked first).
  2. pHash dedup — Hamming distance < PHASH_THRESHOLD across items in the same
                   partition (userId="global" for shared sources).

The deduplicator loads existing hashes/URLs from Cosmos once per scraper run
and keeps them in memory for the duration of that run.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from itertools import combinations
from typing import Optional

from .image_utils import hamming_distance

logger = logging.getLogger(__name__)

PHASH_THRESHOLD = 5  # bits — images are "same" if Hamming distance < this
PHASH_PREFIX_CHARS = 4  # first 16 bits (4 hex chars) of each pHash
PHASH_PREFIX_BITS = PHASH_PREFIX_CHARS * 4


@lru_cache(maxsize=None)
def _candidate_buckets_cached(bucket: str) -> tuple[str, ...]:
    """
    Return all pHash prefix buckets within PHASH_THRESHOLD bit distance.

    Cached at module scope so lookup results do not retain `self` in cache keys.
    """
    if len(bucket) < PHASH_PREFIX_CHARS:
        return (bucket,)

    try:
        base = int(bucket, 16)
    except ValueError:
        return (bucket,)
    candidates: set[int] = {base}
    bits = range(PHASH_PREFIX_BITS)

    for distance in range(1, PHASH_THRESHOLD + 1):
        for flips in combinations(bits, distance):
            mask = 0
            for bit in flips:
                mask |= 1 << bit
            candidates.add(base ^ mask)

    max_value = (1 << PHASH_PREFIX_BITS) - 1
    return tuple(
        f"{value:0{PHASH_PREFIX_CHARS}x}"
        for value in candidates
        if value <= max_value
    )


class RunDeduplicator:
    """
    Stateful deduplicator scoped to a single scraper run.

    Load it once with existing Cosmos state, then call is_duplicate() for each
    candidate item.  Calling register() after inserting an item keeps it
    up-to-date within the run.
    """

    def __init__(self) -> None:
        self._seen_urls: set[str] = set()
        self._seen_phashes_by_prefix: dict[str, list[str]] = {}

    # ── Population ────────────────────────────────────────────────────────────

    def load_from_cosmos(self, container, partition_key: str) -> None:
        """
        Pre-populate seen URLs and pHashes from an existing Cosmos container.
        Prefer a single-partition query (fast), then fall back to
        cross-partition if the container partition key differs.
        """
        query = (
            "SELECT c.productUrl, c.pHash FROM c "
            "WHERE c.userId = @userId"
        )
        params = [{"name": "@userId", "value": partition_key}]
        try:
            try:
                items = list(container.query_items(
                    query=query,
                    parameters=params,
                    partition_key=partition_key,
                ))
            except Exception:
                items = list(container.query_items(
                    query=query,
                    parameters=params,
                ))
            for doc in items:
                if doc.get("productUrl"):
                    self._seen_urls.add(doc["productUrl"])
                if doc.get("pHash"):
                    self._register_phash(doc["pHash"])
            logger.debug(
                "Deduplicator loaded %d URLs and %d pHashes",
                len(self._seen_urls),
                sum(len(bucket) for bucket in self._seen_phashes_by_prefix.values()),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not pre-load dedup state from Cosmos: %s", exc)

    # ── Checks ────────────────────────────────────────────────────────────────

    def is_duplicate(
        self,
        product_url: str,
        phash: Optional[str],
    ) -> bool:
        if product_url in self._seen_urls:
            return True
        if phash and self._is_phash_duplicate(phash):
            return True
        return False

    def _is_phash_duplicate(self, phash: str) -> bool:
        bucket = self._phash_bucket(phash)
        return any(
            hamming_distance(phash, existing) < PHASH_THRESHOLD
            for candidate_bucket in _candidate_buckets_cached(bucket)
            for existing in self._seen_phashes_by_prefix.get(candidate_bucket, [])
        )

    # ── Registration ──────────────────────────────────────────────────────────

    def register(self, product_url: str, phash: Optional[str]) -> None:
        """Call after successfully inserting an item to prevent within-run dupes."""
        self._seen_urls.add(product_url)
        if phash:
            self._register_phash(phash)

    # ── Internal indexing ─────────────────────────────────────────────────────

    def _phash_bucket(self, phash: str) -> str:
        """Return the pHash bucket key for quick Hamming-distance candidate filtering."""
        return phash[:PHASH_PREFIX_CHARS].lower()

    def _register_phash(self, phash: str) -> None:
        """Add a pHash to its prefix bucket."""
        bucket = self._phash_bucket(phash)
        self._seen_phashes_by_prefix.setdefault(bucket, []).append(phash)

