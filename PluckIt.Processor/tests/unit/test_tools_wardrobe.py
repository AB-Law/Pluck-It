"""
Unit tests for agents/tools/wardrobe.py — compact helper and summary.
"""
from unittest.mock import AsyncMock, patch
import pytest
import asyncio

from agents.tools import wardrobe

from agents.tools.wardrobe import _compact, _extract_filter_terms


@pytest.fixture(autouse=True)
def reset_wardrobe_cache():
    with wardrobe._CACHE_LOCK:
        wardrobe._EXPANDED_QUERY_CACHE.clear()
    try:
        yield
    finally:
        with wardrobe._CACHE_LOCK:
            wardrobe._EXPANDED_QUERY_CACHE.clear()


@pytest.mark.unit
def test_compact_strips_image_url():
    """Image URLs must never be sent to the LLM (token waste + privacy)."""
    item = {
        "id": "abc",
        "userId": "user-1",
        "imageUrl": "https://secret-blob.example.com/abc.png",
        "category": "Tops",
        "brand": "Zara",
        "tags": ["casual", "cotton"],
        "colours": [{"name": "White", "hex": "#FFFFFF"}],
        "wearCount": 3,
    }
    result = _compact(item)
    assert "imageUrl" not in result
    assert "userId" not in result


@pytest.mark.unit
def test_compact_preserves_llm_relevant_fields():
    item = {
        "id": "abc",
        "category": "Tops",
        "brand": "Zara",
        "tags": ["casual"],
        "colours": [{"name": "White"}],
        "wearCount": 5,
        "imageUrl": "https://...",
        "userId": "x",
    }
    result = _compact(item)
    assert result.get("id") == "abc"
    assert result.get("category") == "Tops"
    assert result.get("brand") == "Zara"
    # wearCount is stripped by _compact — only LLM-relevant fields are kept
    assert "wearCount" not in result


@pytest.mark.unit
def test_extract_filter_terms_maps_sock_to_accessories():
    category_terms, _, _ = _extract_filter_terms(["sock", "socks", "denim"])
    assert category_terms == ["accessories"]


@pytest.mark.unit
async def test_get_wardrobe_summary_counts_categories():
    from langchain_core.runnables import RunnableConfig
    from agents.tools.wardrobe import get_wardrobe_summary

    async def _items(**kwargs):
        for cat in ["Tops", "Tops", "Bottoms", "Tops", "Outerwear"]:
            yield {"category": cat, "colours": [{"name": "White"}]}

    mock_container = AsyncMock()
    mock_container.query_items = _items

    config = RunnableConfig(configurable={"user_id": "test-user"})

    with patch("agents.tools.wardrobe.get_wardrobe_container", return_value=mock_container):
        result = await get_wardrobe_summary.ainvoke(input={}, config=config)

    assert "tops" in result.lower()
    assert "bottoms" in result.lower()
    assert "3" in result  # 3 Tops (counted as "tops" in summary)


@pytest.mark.unit
async def test_search_wardrobe_requires_configurable_user_id():
    """Missing configurable.user_id should raise a readable validation error."""
    from langchain_core.runnables import RunnableConfig
    from agents.tools.wardrobe import search_wardrobe

    with patch(
        "agents.tools.wardrobe._expand_query",
        return_value=["tops"],
    ):
        with pytest.raises(
            ValueError,
            match="configurable.user_id",
        ):
            await search_wardrobe.ainvoke(input={"query": "denim tops"}, config=RunnableConfig(configurable={}))


@pytest.mark.unit
async def test_wardrobe_summary_requires_configurable_user_id():
    """Missing configurable.user_id should raise a readable validation error."""
    from langchain_core.runnables import RunnableConfig
    from agents.tools.wardrobe import get_wardrobe_summary

    with pytest.raises(
        ValueError,
        match="configurable.user_id",
    ):
        await get_wardrobe_summary.ainvoke(input={}, config=RunnableConfig(configurable={}))


@pytest.mark.unit
async def test_search_wardrobe_returns_compact_items():
    """search_wardrobe should call the LLM for query expansion and return compact items."""
    from langchain_core.runnables import RunnableConfig
    from agents.tools.wardrobe import search_wardrobe

    async def _items(**kwargs):
        yield {"id": "x1", "category": "Tops", "tags": ["denim"], "colours": [], "brand": "Levi's",
               "userId": "u", "imageUrl": "https://...", "wearCount": 0}

    mock_container = AsyncMock()
    mock_container.query_items = _items

    config = RunnableConfig(configurable={"user_id": "test-user"})

    # Stub _expand_query to avoid actual LLM call
    with (
        patch("agents.tools.wardrobe._expand_query", return_value=["denim"]),
        patch("agents.tools.wardrobe.get_wardrobe_container", return_value=mock_container),
    ):
        result = await search_wardrobe.ainvoke(input={"query": "denim jeans"}, config=config)

    assert isinstance(result, str)
    assert "x1" in result
    # Image URL must not appear in LLM context
    assert "imageUrl" not in result


@pytest.mark.unit
async def test_search_wardrobe_queries_projected_fields_and_limit():
    """Wardrobe search should request only compact fields and respect candidate limit."""
    from langchain_core.runnables import RunnableConfig
    from agents.tools.wardrobe import search_wardrobe

    seen_queries: list[str] = []

    async def _query_items(**kwargs):
        seen_queries.append(kwargs["query"])
        yield {
            "id": "x1",
            "category": "Tops",
            "brand": "Levi's",
            "tags": ["denim"],
            "colours": [{"name": "Blue", "hex": "#0000FF"}],
            "condition": "Good",
            "size": "M",
            "notes": "blue denim tee",
        }

    mock_container = AsyncMock()
    mock_container.query_items = _query_items

    config = RunnableConfig(configurable={"user_id": "test-user"})

    with (
        patch("agents.tools.wardrobe._expand_query", return_value=["tops"]),
        patch("agents.tools.wardrobe.get_wardrobe_container", return_value=mock_container),
    ):
        result = await search_wardrobe.ainvoke(input={"query": "denim tops"}, config=config)

    query_text = (seen_queries[0] or "").lower()
    assert "select c.id" in query_text
    assert "select *" not in query_text
    assert f"offset 0 limit {wardrobe._QUERY_CANDIDATE_LIMIT}" in query_text
    assert "from c where c.userid" in query_text
    assert "x1" in result


@pytest.mark.unit
async def test_search_wardrobe_falls_back_if_filtered_candidates_are_empty():
    """Over-constraining filters should fall back to a broad query, not an empty result."""
    from langchain_core.runnables import RunnableConfig
    from agents.tools.wardrobe import search_wardrobe

    observed_queries: list[str] = []

    async def _query_items(**kwargs):
        query = kwargs["query"]
        observed_queries.append(query)
        if "lower(c.category)" in query.lower():
            return
        yield {
            "id": "x1",
            "category": "Tops",
            "brand": "Levi's",
            "tags": ["denim"],
            "colours": [{"name": "Blue", "hex": "#0000FF"}],
            "condition": "Good",
            "size": "M",
            "notes": "blue denim tee",
        }

    mock_container = AsyncMock()
    mock_container.query_items = _query_items

    config = RunnableConfig(configurable={"user_id": "test-user"})

    with (
        patch("agents.tools.wardrobe._expand_query", return_value=["tops"]),
        patch("agents.tools.wardrobe.get_wardrobe_container", return_value=mock_container),
    ):
        result = await search_wardrobe.ainvoke(input={"query": "tops"}, config=config)

    assert len(observed_queries) >= 2
    assert "lower(c.category)" in (observed_queries[0] or "").lower()
    assert "lower(c.category)" not in (observed_queries[-1] or "").lower()
    assert "x1" in result


def _build_large_wardrobe_items(count: int) -> list[dict]:
    return [
        {
            "id": f"item-{idx}",
            "category": "Tops",
            "brand": "Brand A" if idx % 2 == 0 else "Brand B",
            "tags": ["denim", "casual"],
            "colours": [{"name": "Blue", "hex": "#0000FF"}],
            "condition": "Good",
            "size": "M",
            "notes": "blue denim tee",
        }
        for idx in range(count)
    ]


@pytest.mark.unit
async def test_search_wardrobe_query_cache_reduces_latency_for_repeated_prompts():
    """The same normalised query should reuse the expansion cache across users/sessions."""
    from langchain_core.runnables import RunnableConfig
    from agents.tools.wardrobe import search_wardrobe

    calls = {"count": 0}
    large_wardrobe = _build_large_wardrobe_items(220)

    async def _slow_expand_query(_query: str) -> list[str]:
        calls["count"] += 1
        await asyncio.sleep(0.01)
        return ["tops"]

    async def _query_items(**_kwargs):
        for item in large_wardrobe:
            yield item

    mock_container = AsyncMock()
    mock_container.query_items = _query_items

    async def _timed_search(user_id: str, session_id: str, query: str) -> None:
        await search_wardrobe.ainvoke(
            input={"query": query},
            config=RunnableConfig(configurable={"user_id": user_id, "session_id": session_id}),
        )

    with (
        patch("agents.tools.wardrobe._expand_query", side_effect=_slow_expand_query),
        patch("agents.tools.wardrobe.get_wardrobe_container", return_value=mock_container),
    ):
        await _timed_search("user-a", "session-a", "Blue Denim Tops")
        await _timed_search("user-b", "session-b", "blue denim tops")
        await _timed_search("user-c", "session-c", "blue denim tops!")

        # Seeded by first request, warm on all users/sessions.
        await _timed_search("user-d", "session-d", "blue denim tops")
        for idx in range(5):
            await _timed_search(f"user-repeat-{idx}", f"session-repeat-{idx}", "blue denim tops")

    assert calls["count"] == 1
