"""
Scraper Runner — orchestrates the full ingest pipeline.

Pipeline per source:
  1. Load active ScraperSources documents from Cosmos.
  2. Route to the correct BaseScraper implementation.
  3. Compute pHash transiently for each item (using preview_url if available,
     else image_url).  Image bytes are discarded immediately after hashing.
  4. Deduplicate against existing ScrapedItems (URL exact + pHash Hamming).
  5. Embed item text (title + description + tags) in batches of 50.
  6. Upsert ScrapedItems documents.

Image tagging strategy
──────────────────────
Tags are derived from text only (title, flair, subreddit) — zero LLM calls,
zero cost.  Image pixels are used exclusively for pHash deduplication.

Calling conventions
───────────────────
  run_global_scrapers()    — sync, called from the Azure Functions timer trigger.
  run_for_source(source_id) — sync, called on-demand (e.g. new subscription).
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

from langchain_openai import AzureOpenAIEmbeddings

from .db import get_scraper_sources_container_sync, get_scraped_items_container_sync
from .scrapers.base import ScrapedItemRaw
from .scrapers.deduplicator import RunDeduplicator
from .scrapers.image_utils import compute_phash
from .scrapers.reddit_scraper import RedditScraper

logger = logging.getLogger(__name__)

_EMBED_BATCH_SIZE = 50
_PHASH_WORKERS = 8       # concurrent transient image downloads for pHash
_USER_ID_GLOBAL = "global"


# ── Registry ──────────────────────────────────────────────────────────────────

_SCRAPER_REGISTRY: dict[str, type] = {
    "reddit": RedditScraper,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Missing env var: {name}")
    return v


def _build_embedder() -> AzureOpenAIEmbeddings:
    return AzureOpenAIEmbeddings(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small"),
        api_version="2023-05-15",
    )


def _item_text(raw: ScrapedItemRaw) -> str:
    """Text used for semantic embedding — tags + title + truncated description."""
    tag_str = " ".join(raw.tags)
    return f"{tag_str} {raw.title} {raw.description[:200]}".strip()


def _item_id(raw: ScrapedItemRaw) -> str:
    """Deterministic document ID: hash of source_id + product_url."""
    digest = hashlib.sha256(f"{raw.source_id}:{raw.product_url}".encode()).hexdigest()[:16]
    return f"{raw.source_type}-{digest}"


def _build_document(
    raw: ScrapedItemRaw,
    phash: Optional[str],
    embedding: list[float],
    user_id: str,
) -> dict:
    scraped_at = datetime.now(timezone.utc).isoformat()
    return {
        "id": _item_id(raw),
        "userId": user_id,
        "sourceId": raw.source_id,
        "sourceType": raw.source_type,
        "title": raw.title,
        "description": raw.description,
        "imageUrl": raw.image_url,
        # preview_url is intentionally NOT stored — it carries expiring tokens
        "productUrl": raw.product_url,
        "buyLinks": [{"platform": bl.platform, "url": bl.url, "label": bl.label} for bl in raw.buy_links],
        "price": raw.price,
        "brand": raw.brand,
        "tags": raw.tags,
        "galleryImages": raw.gallery_images,   # all images for gallery posts
        "commentText": raw.comment_text,        # top comment bodies (buy-link source)
        "pHash": phash,
        "embedding": embedding,
        "redditScore": raw.score_signal,   # Reddit upvote count — read-only provenance
        "scoreSignal": 0,                   # our own engagement signal (likes - dislikes)
        "scrapedAt": scraped_at,
        "sourceCreatedAt": raw.source_created_at or scraped_at,
        "imageExpired": False,
    }


# ── pHash computation (parallel, transient) ───────────────────────────────────

def _compute_phashes(
    items: list[ScrapedItemRaw],
) -> dict[str, Optional[str]]:
    """
    Returns a mapping of item_id → pHash for all items in parallel.
    Uses preview_url when available (better resolution for hashing),
    falls back to image_url.  Both are used transiently and discarded.
    """
    results: dict[str, Optional[str]] = {}

    def _hash_one(raw: ScrapedItemRaw) -> tuple[str, Optional[str]]:
        url = raw.preview_url or raw.image_url
        return _item_id(raw), compute_phash(url)

    with ThreadPoolExecutor(max_workers=_PHASH_WORKERS) as pool:
        futures = {pool.submit(_hash_one, raw): raw for raw in items}
        for future in as_completed(futures):
            try:
                item_id, phash = future.result()
                results[item_id] = phash
            except Exception as exc:  # noqa: BLE001
                raw = futures[future]
                logger.debug("pHash failed for %s: %s", raw.product_url, exc)
                results[_item_id(raw)] = None

    return results


# ── Core pipeline ─────────────────────────────────────────────────────────────

def _run_source(source_doc: dict) -> int:
    """
    Run the full ingest pipeline for a single source document.
    Returns the number of new items upserted.
    """
    source_id = source_doc["id"]
    source_type = source_doc["sourceType"]
    config = dict(source_doc.get("config", {}))
    config["source_id"] = source_id

    scraper_cls = _SCRAPER_REGISTRY.get(source_type)
    if scraper_cls is None:
        logger.warning("No scraper registered for source type '%s' (source: %s)", source_type, source_id)
        return 0

    scraper = scraper_cls()
    raw_items = scraper.scrape(config)
    if not raw_items:
        logger.info("Source %s: no items scraped", source_id)
        return 0

    return ingest_items(raw_items, source_doc, submitter_id="server")


def ingest_items(
    raw_items: list[ScrapedItemRaw],
    source_doc: dict,
    submitter_id: str,
    verified: bool = True,
) -> int:
    """
    Process raw items through the ingest pipeline: pHash, Dedup, Embedding, and Upsert.
    Returns the number of new items upserted.
    """
    source_id = source_doc["id"]
    is_global = source_doc.get("isGlobal", True)
    user_id = _USER_ID_GLOBAL if is_global else source_doc.get("createdBy", _USER_ID_GLOBAL)

    logger.info("Source %s: %d raw items before dedup", source_id, len(raw_items))

    # ── Deduplication setup ───────────────────────────────────────────────────
    items_container = get_scraped_items_container_sync()
    dedup = RunDeduplicator()
    dedup.load_from_cosmos(items_container, user_id)

    # ── pHash computation (parallel, transient) ───────────────────────────────
    phash_map = _compute_phashes(raw_items)

    # ── Filter duplicates ─────────────────────────────────────────────────────
    new_items: list[ScrapedItemRaw] = []
    for raw in raw_items:
        phash = phash_map.get(_item_id(raw))
        if dedup.is_duplicate(raw.product_url, phash):
            continue
        new_items.append(raw)
        dedup.register(raw.product_url, phash)

    if not new_items:
        logger.info("Source %s: all items were duplicates", source_id)
        return 0

    logger.info("Source %s: %d new items after dedup", source_id, len(new_items))

    # ── Batch embedding ───────────────────────────────────────────────────────
    embedder = _build_embedder()
    texts = [_item_text(raw) for raw in new_items]
    embeddings: list[list[float]] = []

    for i in range(0, len(texts), _EMBED_BATCH_SIZE):
        batch = texts[i : i + _EMBED_BATCH_SIZE]
        try:
            embeddings.extend(embedder.embed_documents(batch))
        except Exception as exc:  # noqa: BLE001
            logger.error("Embedding batch %d failed for source %s: %s", i, source_id, exc)
            # Fill with empty embeddings so we can still upsert (search won't work for these)
            embeddings.extend([[] for _ in batch])

    # ── Upsert to Cosmos ──────────────────────────────────────────────────────
    upserted = 0
    for raw, embedding in zip(new_items, embeddings):
        phash = phash_map.get(_item_id(raw))
        doc = _build_document(raw, phash, embedding, user_id)
        
        # Add metadata for auditing
        doc["submitterId"] = submitter_id
        doc["verified"] = verified
        
        try:
            items_container.upsert_item(doc)
            upserted += 1
        except Exception as exc:  # noqa: BLE001
            logger.error("Upsert failed for item %s: %s", doc["id"], exc)

    # ── Update source lastScrapedAt ───────────────────────────────────────────
    try:
        sources_container = get_scraper_sources_container_sync()
        source_doc["lastScrapedAt"] = datetime.now(timezone.utc).isoformat()
        sources_container.upsert_item(source_doc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not update lastScrapedAt for source %s: %s", source_id, exc)

    logger.info("Source %s: upserted %d new items", source_id, upserted)
    return upserted


# ── Public API ────────────────────────────────────────────────────────────────

def run_global_scrapers() -> None:
    """
    Run all active global scrapers.  Called by the daily timer trigger.
    """
    sources_container = get_scraper_sources_container_sync()
    query = "SELECT * FROM c WHERE c.isActive = true AND c.isGlobal = true"
    try:
        sources = list(sources_container.query_items(
            query=query,
        ))
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not load scraper sources: %s", exc)
        return

    logger.info("Running %d active global sources", len(sources))
    total = 0
    for source_doc in sources:
        try:
            total += _run_source(source_doc)
        except Exception as exc:  # noqa: BLE001
            logger.error("Source %s failed: %s", source_doc.get("id"), exc)

    logger.info("Scraper run complete — %d new items total", total)


def run_for_source(source_id: str) -> int:
    """
    Run a single source by ID.  Used for on-demand scraping (new subscription,
    new brand suggestion, manual trigger via API).
    """
    sources_container = get_scraper_sources_container_sync()
    try:
        # ScraperSources is partitioned by /sourceType; cross-partition query needed
        results = list(sources_container.query_items(
            query="SELECT * FROM c WHERE c.id = @id AND c.isActive = true",
            parameters=[{"name": "@id", "value": source_id}],
        ))
        if not results:
            logger.warning("Source %s not found or inactive", source_id)
            return 0
        return _run_source(results[0])
    except Exception as exc:  # noqa: BLE001
        logger.error("run_for_source(%s) failed: %s", source_id, exc)
        return 0
