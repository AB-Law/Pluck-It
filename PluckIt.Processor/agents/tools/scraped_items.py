"""
Scraped items search tool — exposes the ScrapedItems corpus to the stylist agent.

Embeds the query text and does cosine similarity search over stored item
embeddings.  Returns the top matches with image URLs, buy links, and tags.

Use this tool when the user asks to discover new items, find something to buy,
or when the stylist wants to surface real products that match a style direction.
"""

from __future__ import annotations

import json
import logging
import math
import os
from typing import Optional

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langchain_openai import AzureOpenAIEmbeddings

from ..db import get_scraped_items_container

logger = logging.getLogger(__name__)

_TOP_K = 5
_MIN_SCORE = 0.3       # minimum cosine similarity to include in results
_CANDIDATE_LIMIT = 200  # how many docs to load for in-memory ranking


def _get_env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Missing env var: {name}")
    return v


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0


def _build_embedder() -> AzureOpenAIEmbeddings:
    return AzureOpenAIEmbeddings(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small"),
        api_version="2023-05-15",
    )


@tool
async def search_scraped_items(query: str, config: RunnableConfig = None) -> str:
    """
    Search the scraped fashion item corpus for items matching a style query.
    Returns real products with image URLs, buy links (when available), and tags.

    Use this tool when:
    - The user asks to find something to buy or discover new pieces.
    - You want to suggest a specific product that matches a style direction.
    - The user asks about items from a particular subreddit or brand source.

    Args:
        query: Natural language style query, e.g. "oversized minimalist trench coat"
               or "streetwear sneakers with taobao links"

    Returns a JSON array of up to 5 matching items, each with:
      title, imageUrl, productUrl, buyLinks, tags, sourceId, scoreSignal.
    """
    try:
        embedder = _build_embedder()
        query_embedding: list[float] = await embedder.aembed_query(query)
    except Exception as exc:
        logger.warning("search_scraped_items: embedding failed: %s", exc)
        return json.dumps({"items": [], "note": "Could not embed query."})

    try:
        container = get_scraped_items_container()

        # Load candidates — global items only for now (user-scoped items coming in Phase 5)
        candidates: list[dict] = []
        async for doc in container.query_items(
            query=(
                "SELECT c.id, c.title, c.imageUrl, c.productUrl, c.buyLinks, "
                "c.tags, c.sourceId, c.scoreSignal, c.embedding "
                "FROM c WHERE c.userId = 'global' AND c.imageExpired = false "
                f"ORDER BY c.scoreSignal DESC OFFSET 0 LIMIT {_CANDIDATE_LIMIT}"
            ),
        ):
            candidates.append(doc)

        if not candidates:
            return json.dumps({
                "items": [],
                "note": "No scraped items available yet. Check back after the daily scraper run.",
            })

        # Score by cosine similarity
        scored: list[tuple[float, dict]] = []
        for doc in candidates:
            emb = doc.get("embedding") or []
            sim = _cosine_similarity(query_embedding, emb)
            if sim >= _MIN_SCORE:
                scored.append((sim, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:_TOP_K]

        if not top:
            return json.dumps({
                "items": [],
                "note": "No closely matching items found. Try a broader style query.",
            })

        results = []
        for _sim, doc in top:
            results.append({
                "title": doc.get("title", ""),
                "imageUrl": doc.get("imageUrl", ""),
                "productUrl": doc.get("productUrl", ""),
                "buyLinks": doc.get("buyLinks", []),
                "tags": doc.get("tags", []),
                "sourceId": doc.get("sourceId", ""),
                "scoreSignal": doc.get("scoreSignal", 0),
            })

        return json.dumps({"items": results}, ensure_ascii=False)

    except Exception as exc:
        logger.warning("search_scraped_items: query failed: %s", exc)
        return "Could not search scraped items at this time."
