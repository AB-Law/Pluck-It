"""
Unit tests for agents/tools/wardrobe.py — compact helper and summary.
"""
from unittest.mock import AsyncMock, patch
import pytest

from agents.tools.wardrobe import _compact


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
async def test_search_wardrobe_returns_compact_items():
    """search_wardrobe should call the LLM for query expansion and return compact items."""
    from langchain_core.runnables import RunnableConfig
    from agents.tools.wardrobe import search_wardrobe

    # Mock query expansion LLM
    fake_llm = patch("agents.tools.wardrobe._get_llm")

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
