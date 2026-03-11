"""
Unit tests for the scraped-items search tool helpers.
"""

import json
import os
import asyncio
from collections.abc import AsyncGenerator, Callable
from unittest.mock import MagicMock, patch

import pytest

from agents.tools.scraped_items import (
    _cosine_similarity,
    _get_env,
    search_scraped_items,
)


def _async_query(items: list[dict]) -> Callable[..., AsyncGenerator[dict, None]]:
    async def _query(**_kwargs: object) -> AsyncGenerator[dict, None]:
        for item in items:
            yield item

    return _query


def test_cosine_similarity_returns_0_for_empty_vectors() -> None:
    assert _cosine_similarity([], []) == pytest.approx(0.0)
    assert _cosine_similarity([1.0], []) == pytest.approx(0.0)


def test_cosine_similarity_computes_expected_value() -> None:
    score = _cosine_similarity([1.0, 0.0], [1.0, 0.0])
    assert score == pytest.approx(1.0)


async def test_scraped_items_search_returns_empty_message_when_no_candidates() -> None:
    class _Embedder:
        async def aembed_query(self, _query: str) -> list[float]:
            await asyncio.sleep(0)
            return [0.2, 0.3, 0.4]

    container = MagicMock()
    container.query_items = _async_query([])

    with patch("agents.tools.scraped_items._build_embedder", return_value=_Embedder()):
        with patch("agents.tools.scraped_items.get_scraped_items_container", return_value=container):
            payload = await search_scraped_items.ainvoke({"query": "sunset jackets"})

    assert payload == (
        '{"items": [], '
        '"note": "No scraped items available yet. Check back after the daily scraper run."}'
    )


async def test_scraped_items_search_filters_and_ranks_candidates() -> None:
    class _Embedder:
        async def aembed_query(self, _query: str) -> list[float]:
            await asyncio.sleep(0)
            return [1.0, 0.0]

    documents = [
        {
            "id": "doc-strong",
            "title": "High contrast jacket",
            "imageUrl": "https://example.com/jacket.jpg",
            "productUrl": "https://shop.example.com/jacket",
            "buyLinks": [],
            "tags": ["jacket", "outerwear"],
            "sourceId": "source-1",
            "scoreSignal": 21,
            "embedding": [1.0, 0.0],
        },
        {
            "id": "doc-weak",
            "title": "Noisy sneakers",
            "imageUrl": "https://example.com/shoes.jpg",
            "productUrl": "https://shop.example.com/shoes",
            "buyLinks": ["https://buy.example.com/1"],
            "tags": ["shoe"],
            "sourceId": "source-2",
            "scoreSignal": 9,
            "embedding": [0.0, 1.0],
        },
    ]

    container = MagicMock()
    container.query_items = _async_query(documents)

    with patch("agents.tools.scraped_items._build_embedder", return_value=_Embedder()):
        with patch("agents.tools.scraped_items.get_scraped_items_container", return_value=container):
            payload = await search_scraped_items.ainvoke({"query": "light jacket"})

    data = json.loads(payload)
    assert len(data["items"]) == 1
    assert data["items"][0]["title"] == "High contrast jacket"
    assert "No closely matching items found. Try a broader style query." not in payload


async def test_scraped_items_search_returns_error_when_embedding_fails() -> None:
    class _BadEmbedder:
        async def aembed_query(self, _query: str) -> list[float]:
            await asyncio.sleep(0)
            raise RuntimeError("embedding service down")

    with patch("agents.tools.scraped_items._build_embedder", return_value=_BadEmbedder()):
        payload = await search_scraped_items.ainvoke({"query": "whatever"})

    assert payload == '{"items": [], "note": "Could not embed query."}'


@pytest.mark.unit
async def test_scraped_items_search_returns_top_ranked_product_payload() -> None:
    class _Embedder:
        async def aembed_query(self, _query: str) -> list[float]:
            await asyncio.sleep(0)
            return [1.0, 0.0]

    documents = [
        {"id": "best", "title": "Textured linen blazer", "imageUrl": "https://example.com/blazer.jpg", "productUrl": "https://shop.example.com/blazer", "buyLinks": ["https://buy.example.com/blazer"], "tags": ["blazer", "linen"], "sourceId": "global-1", "scoreSignal": 42, "embedding": [1.0, 0.0]},
        {"id": "next", "title": "Lightweight suede jacket", "imageUrl": "https://example.com/jacket.jpg", "productUrl": "https://shop.example.com/jacket", "buyLinks": ["https://buy.example.com/jacket"], "tags": ["jacket", "fall"], "sourceId": "global-1", "scoreSignal": 38, "embedding": [0.95, 0.0]},
        {"id": "cool", "title": "Smart relaxed blazer", "imageUrl": "https://example.com/smart.jpg", "productUrl": "https://shop.example.com/smart", "buyLinks": ["https://buy.example.com/smart"], "tags": ["blazer", "casual"], "sourceId": "global-2", "scoreSignal": 36, "embedding": [0.90, 0.0]},
        {"id": "nice", "title": "Weekend utility blazer", "imageUrl": "https://example.com/weekend.jpg", "productUrl": "https://shop.example.com/weekend", "buyLinks": ["https://buy.example.com/weekend"], "tags": ["blazer", "weekend"], "sourceId": "global-2", "scoreSignal": 30, "embedding": [0.85, 0.0]},
        {"id": "fallback", "title": "Neutral street blazer", "imageUrl": "https://example.com/street.jpg", "productUrl": "https://shop.example.com/street", "buyLinks": ["https://buy.example.com/street"], "tags": ["blazer", "neutral"], "sourceId": "global-3", "scoreSignal": 29, "embedding": [0.80, 0.0]},
        {"id": "low", "title": "Ignored low-score cardigan", "imageUrl": "https://example.com/cardigan.jpg", "productUrl": "https://shop.example.com/cardigan", "buyLinks": ["https://buy.example.com/cardigan"], "tags": ["cardigan"], "sourceId": "global-4", "scoreSignal": 15, "embedding": [0.20, 0.0]},
    ]

    container = MagicMock()
    container.query_items = _async_query(documents)

    with patch("agents.tools.scraped_items._build_embedder", return_value=_Embedder()):
        with patch("agents.tools.scraped_items.get_scraped_items_container", return_value=container):
            payload = await search_scraped_items.ainvoke({"query": "soft neutral blazer for spring"})

    data = json.loads(payload)
    assert len(data["items"]) == 5
    assert [item["title"] for item in data["items"]] == [
        "Textured linen blazer",
        "Lightweight suede jacket",
        "Smart relaxed blazer",
        "Weekend utility blazer",
        "Neutral street blazer",
    ]
    first = data["items"][0]
    assert first["title"] == "Textured linen blazer"
    assert first["imageUrl"] == "https://example.com/blazer.jpg"
    assert first["productUrl"] == "https://shop.example.com/blazer"
    assert first["buyLinks"] == ["https://buy.example.com/blazer"]
    assert "tags" in first
    assert first["sourceId"] == "global-1"
    assert first["scoreSignal"] == 42


def test_get_env_raises_when_missing_env_var() -> None:
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(RuntimeError, match="Missing env var: TESTING_ONLY"):
            _get_env("TESTING_ONLY")

