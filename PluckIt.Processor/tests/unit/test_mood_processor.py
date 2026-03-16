"""Unit tests for mood processor async/sync behavior."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents import mood_processor
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
        patch("agents.mood_processor._load_existing_moods_with_embeddings", new_callable=AsyncMock, return_value=[]),
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


def _canonicalize_name(mood: dict, *_args, **_kwargs) -> dict:
    if mood["name"] == "Quiet Luxury":
        mood["name"] = "Modern Luxury"
    return mood


def test_run_from_snippets_batches_reembed_calls_for_canonicalized_names() -> None:
    moods = [
        {
            "name": "Quiet Luxury",
            "primaryMood": "Minimalist",
            "resolvedSources": [{"url": "https://example.com/a"}],
        },
        {
            "name": "Street Utility",
            "primaryMood": "Streetwear",
            "resolvedSources": [{"url": "https://example.com/b"}],
        },
    ]
    initial_embeddings = [[0.9], [0.1]]

    embedder = MagicMock()
    embedder.embed_documents.return_value = [[0.2]]

    with (
            patch("agents.mood_processor._build_llm", return_value=MagicMock()),
            patch("agents.mood_processor._build_confirm_llm", return_value=MagicMock()),
            patch("agents.mood_processor._build_embedder", return_value=embedder),
            patch("agents.mood_processor.get_moods_container", return_value=AsyncMock()),
            patch("agents.mood_processor._extract_all_parallel", return_value=moods),
            patch("agents.mood_processor._dedup_within_run", return_value=(moods, initial_embeddings)),
            patch("agents.mood_processor._load_existing_moods_with_embeddings", new_callable=AsyncMock, return_value=[]),
            patch(
                "agents.mood_processor._canonicalize_against_db",
                side_effect=lambda mood, *_args, **_kwargs: _canonicalize_name(mood),
            ),
            patch("agents.mood_processor.upsert_mood", new_callable=AsyncMock) as upsert_mood,
    ):
        result = mood_processor.run_from_snippets([{"title": "a", "summary": "", "url": "u", "published": "", "source": "r"}])

    assert result == 2
    embedder.embed_documents.assert_called_once_with(["Modern Luxury"])
    embedder.embed_query.assert_not_called()

    first_saved = upsert_mood.call_args_list[0].args
    second_saved = upsert_mood.call_args_list[1].args
    assert first_saved[1] == [0.2]
    assert second_saved[1] == [0.1]
    assert first_saved[0]["name"] == "Modern Luxury"
    assert second_saved[0]["name"] == "Street Utility"


def test_run_from_snippets_falls_back_to_original_embeddings_on_reembed_failure() -> None:
    moods = [
        {
            "name": "Quiet Luxury",
            "primaryMood": "Minimalist",
            "resolvedSources": [{"url": "https://example.com/a"}],
        },
        {
            "name": "Street Utility",
            "primaryMood": "Streetwear",
            "resolvedSources": [{"url": "https://example.com/b"}],
        },
    ]
    initial_embeddings = [[0.9], [0.1]]

    embedder = MagicMock()
    embedder.embed_documents.side_effect = [RuntimeError("embeddings unavailable")]

    with (
            patch("agents.mood_processor._build_llm", return_value=MagicMock()),
            patch("agents.mood_processor._build_confirm_llm", return_value=MagicMock()),
            patch("agents.mood_processor._build_embedder", return_value=embedder),
            patch("agents.mood_processor.get_moods_container", return_value=AsyncMock()),
            patch("agents.mood_processor._extract_all_parallel", return_value=moods),
            patch("agents.mood_processor._dedup_within_run", return_value=(moods, initial_embeddings)),
            patch("agents.mood_processor._load_existing_moods_with_embeddings", new_callable=AsyncMock, return_value=[]),
            patch("agents.mood_processor._canonicalize_against_db", side_effect=_canonicalize_name),
            patch("agents.mood_processor.upsert_mood", new_callable=AsyncMock) as upsert_mood,
    ):
        result = mood_processor.run_from_snippets([{"title": "a", "summary": "", "url": "u", "published": "", "source": "r"}])

    assert result == 2
    embedder.embed_documents.assert_called_once_with(["Modern Luxury"])
    assert upsert_mood.call_args_list[0].args[1] == [0.9]
    assert upsert_mood.call_args_list[1].args[1] == [0.1]


def test_run_from_snippets_does_not_reembed_if_not_canonicalized() -> None:
    moods = [
        {
            "name": "Quiet Luxury",
            "primaryMood": "Minimalist",
            "resolvedSources": [{"url": "https://example.com/a"}],
        },
    ]
    initial_embeddings = [[0.9]]

    embedder = MagicMock()

    with (
            patch("agents.mood_processor._build_llm", return_value=MagicMock()),
            patch("agents.mood_processor._build_confirm_llm", return_value=MagicMock()),
            patch("agents.mood_processor._build_embedder", return_value=embedder),
            patch("agents.mood_processor.get_moods_container", return_value=AsyncMock()),
            patch("agents.mood_processor._extract_all_parallel", return_value=moods),
            patch("agents.mood_processor._dedup_within_run", return_value=(moods, initial_embeddings)),
            patch("agents.mood_processor._load_existing_moods_with_embeddings", new_callable=AsyncMock, return_value=[]),
            patch(
                "agents.mood_processor._canonicalize_against_db",
                side_effect=lambda mood, *_args, **_kwargs: mood,
            ),
            patch("agents.mood_processor.upsert_mood", new_callable=AsyncMock),
    ):
        result = mood_processor.run_from_snippets([{"title": "a", "summary": "", "url": "u", "published": "", "source": "r"}])

    assert result == 1
    embedder.embed_documents.assert_not_called()


def test_run_from_snippets_skips_unknown_primary_moods() -> None:
    moods = [
        {
            "name": "Mysterious Style",
            "primaryMood": "Unknown",
            "resolvedSources": [{"url": "https://example.com/mystery"}],
        },
    ]
    initial_embeddings = [[0.9]]
    embedder = MagicMock()

    with (
        patch("agents.mood_processor._build_llm", return_value=MagicMock()),
        patch("agents.mood_processor._build_confirm_llm", return_value=MagicMock()),
        patch("agents.mood_processor._build_embedder", return_value=embedder),
        patch("agents.mood_processor.get_moods_container", return_value=AsyncMock()),
        patch("agents.mood_processor._extract_all_parallel", return_value=moods),
        patch("agents.mood_processor._dedup_within_run", return_value=(moods, initial_embeddings)),
        patch("agents.mood_processor._load_existing_moods_with_embeddings", new_callable=AsyncMock, return_value=[]),
        patch("agents.mood_processor._canonicalize_against_db", side_effect=lambda mood, *_args, **_kwargs: mood),
        patch("agents.mood_processor.upsert_mood", new_callable=AsyncMock) as upsert_mood,
    ):
        result = mood_processor.run_from_snippets([
            {"title": "a", "summary": "", "url": "u", "published": "", "source": "r"},
        ])

    assert result == 0
    upsert_mood.assert_not_called()
