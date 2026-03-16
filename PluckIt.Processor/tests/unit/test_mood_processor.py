"""
Unit tests for async mood processor database calls.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.mood_processor import _load_existing_moods_with_embeddings, _mood_id, run_from_snippets_async


def _to_async_items(items: list[dict]) -> object:
    async def _generator():
        for item in items:
            yield item

    return _generator()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_from_snippets_async_uses_async_container_for_upsert() -> None:
    container = AsyncMock()
    container.read_item.return_value = {
        "id": _mood_id("Minimalist", "Quiet Luxury"),
        "trendScore": 4,
        "sources": [],
        "detectedAt": "2026-03-01T00:00:00Z",
    }
    container.upsert_item = AsyncMock()
    embedder = MagicMock()
    embedder.embed_query.return_value = [0.5, 0.6]

    mood = {
        "name": "Quiet Luxury",
        "primaryMood": "Minimalist",
        "subMoods": ["Tailored", "Neutral"],
        "description": "Modern, calm tailoring.",
        "moodSignals": {"colorPalette": ["cream"]},
        "resolvedSources": [],
    }
    expected_id = _mood_id("Minimalist", "Quiet Luxury")

    with (
        patch("agents.mood_processor.get_moods_container", return_value=container),
        patch("agents.mood_processor._build_llm"),
        patch("agents.mood_processor._build_confirm_llm"),
        patch("agents.mood_processor._build_embedder", return_value=embedder),
        patch("agents.mood_processor._extract_all_parallel", return_value=[mood]),
        patch("agents.mood_processor._dedup_within_run", return_value=([mood], [[0.1, 0.2]])),
        patch("agents.mood_processor._load_existing_moods_with_embeddings", return_value=[]),
        patch("agents.mood_processor._canonicalize_against_db", side_effect=lambda mood_data, *_args, **_kwargs: mood_data),
    ):
        saved = await run_from_snippets_async([{"title": "Quiet Luxury"}, {"title": "Classic Outerwear"}])

    assert saved == 1
    container.read_item.assert_awaited_once_with(item=expected_id, partition_key="Minimalist")
    container.upsert_item.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_load_existing_moods_with_embeddings_backfills_embeddings() -> None:
    container = AsyncMock()
    container.query_items = MagicMock(return_value=_to_async_items([
        {
            "id": "minimalist-quiet-luxury",
            "name": "Quiet Luxury",
            "description": "Old",
            "primaryMood": "Minimalist",
            "nameEmbedding": None,
        },
    ]))
    container.read_item.return_value = {
        "id": "minimalist-quiet-luxury",
        "name": "Quiet Luxury",
        "description": "Old",
        "primaryMood": "Minimalist",
    }
    container.upsert_item = AsyncMock()
    embedder = MagicMock()
    embedder.embed_documents.return_value = [[0.55, 0.44]]

    result = await _load_existing_moods_with_embeddings("Minimalist", container, embedder)

    assert len(result) == 1
    assert result[0]["nameEmbedding"] == [0.55, 0.44]
    container.read_item.assert_awaited_once_with(item="minimalist-quiet-luxury", partition_key="Minimalist")
    container.upsert_item.assert_awaited_once()
