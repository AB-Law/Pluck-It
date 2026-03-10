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
from typing import Optional

from .image_utils import hamming_distance

logger = logging.getLogger(__name__)

PHASH_THRESHOLD = 10  # bits — images are "same" if Hamming distance < this


class RunDeduplicator:
    """
    Stateful deduplicator scoped to a single scraper run.

    Load it once with existing Cosmos state, then call is_duplicate() for each
    candidate item.  Calling register() after inserting an item keeps it
    up-to-date within the run.
    """

    def __init__(self) -> None:
        self._seen_urls: set[str] = set()
        self._seen_phashes: list[str] = []   # list — we need Hamming checks

    # ── Population ────────────────────────────────────────────────────────────

    def load_from_cosmos(self, container, partition_key: str) -> None:
        """
        Pre-populate seen URLs and pHashes from an existing Cosmos container.
        Uses a cross-partition query scoped to partition_key (e.g. "global").
        """
        query = (
            "SELECT c.productUrl, c.pHash FROM c "
            "WHERE c.userId = @userId"
        )
        params = [{"name": "@userId", "value": partition_key}]
        try:
            items = list(container.query_items(
                query=query,
                parameters=params,
                enable_cross_partition_query=False,
            ))
            for doc in items:
                if doc.get("productUrl"):
                    self._seen_urls.add(doc["productUrl"])
                if doc.get("pHash"):
                    self._seen_phashes.append(doc["pHash"])
            logger.debug(
                "Deduplicator loaded %d URLs and %d pHashes",
                len(self._seen_urls),
                len(self._seen_phashes),
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
        return any(
            hamming_distance(phash, existing) < PHASH_THRESHOLD
            for existing in self._seen_phashes
        )

    # ── Registration ──────────────────────────────────────────────────────────

    def register(self, product_url: str, phash: Optional[str]) -> None:
        """Call after successfully inserting an item to prevent within-run dupes."""
        self._seen_urls.add(product_url)
        if phash:
            self._seen_phashes.append(phash)
