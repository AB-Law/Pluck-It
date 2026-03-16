"""Unit tests for mood processor canonicalization embedding behavior."""

from unittest.mock import MagicMock, patch

from agents import mood_processor


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

    with patch("agents.mood_processor._build_llm", return_value=MagicMock()), \
            patch("agents.mood_processor._build_confirm_llm", return_value=MagicMock()), \
            patch("agents.mood_processor._build_embedder", return_value=embedder), \
            patch("agents.mood_processor.get_moods_container_sync", return_value=MagicMock()), \
            patch("agents.mood_processor._extract_all_parallel", return_value=moods), \
            patch("agents.mood_processor._dedup_within_run", return_value=(moods, initial_embeddings)), \
            patch("agents.mood_processor._load_existing_moods_with_embeddings", return_value=[]), \
            patch(
                "agents.mood_processor._canonicalize_against_db",
                side_effect=lambda mood, *_args, **_kwargs: _canonicalize_name(mood),
            ), \
            patch("agents.mood_processor.upsert_mood") as upsert_mood:
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


def _canonicalize_name(mood: dict, *_args, **_kwargs) -> dict:
    if mood["name"] == "Quiet Luxury":
        mood["name"] = "Modern Luxury"
    return mood


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

    with patch("agents.mood_processor._build_llm", return_value=MagicMock()), \
            patch("agents.mood_processor._build_confirm_llm", return_value=MagicMock()), \
            patch("agents.mood_processor._build_embedder", return_value=embedder), \
            patch("agents.mood_processor.get_moods_container_sync", return_value=MagicMock()), \
            patch("agents.mood_processor._extract_all_parallel", return_value=moods), \
            patch("agents.mood_processor._dedup_within_run", return_value=(moods, initial_embeddings)), \
            patch("agents.mood_processor._load_existing_moods_with_embeddings", return_value=[]), \
            patch("agents.mood_processor._canonicalize_against_db", side_effect=_canonicalize_name), \
            patch("agents.mood_processor.upsert_mood") as upsert_mood:
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

    with patch("agents.mood_processor._build_llm", return_value=MagicMock()), \
            patch("agents.mood_processor._build_confirm_llm", return_value=MagicMock()), \
            patch("agents.mood_processor._build_embedder", return_value=embedder), \
            patch("agents.mood_processor.get_moods_container_sync", return_value=MagicMock()), \
            patch("agents.mood_processor._extract_all_parallel", return_value=moods), \
            patch("agents.mood_processor._dedup_within_run", return_value=(moods, initial_embeddings)), \
            patch("agents.mood_processor._load_existing_moods_with_embeddings", return_value=[]), \
            patch(
                "agents.mood_processor._canonicalize_against_db",
                side_effect=lambda mood, *_args, **_kwargs: mood,
            ), \
            patch("agents.mood_processor.upsert_mood"):
        result = mood_processor.run_from_snippets([{"title": "a", "summary": "", "url": "u", "published": "", "source": "r"}])

    assert result == 1
    embedder.embed_documents.assert_not_called()
