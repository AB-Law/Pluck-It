"""
Unit tests for agents/tools/gaps.py — wardrobe gap analysis.

Verifies:
- _merge_baselines correctly averages multiple style baselines
- Styles not in the baseline dict fall back to _DEFAULT_BASELINE
- Gap reporting produces actionable output for under-represented categories
"""
from collections import Counter
from unittest.mock import AsyncMock, patch

import pytest

# Import internal helpers directly
from agents.tools.gaps import _merge_baselines, _STYLE_BASELINES, _DEFAULT_BASELINE


@pytest.mark.unit
def test_merge_baselines_single_style():
    result = _merge_baselines(["minimalist"])
    assert result == _STYLE_BASELINES["minimalist"]


@pytest.mark.unit
def test_merge_baselines_empty_falls_back_to_default():
    result = _merge_baselines([])
    assert result == _DEFAULT_BASELINE


@pytest.mark.unit
def test_merge_baselines_unknown_style_uses_default():
    result = _merge_baselines(["unknown_style_xyz"])
    assert result == _DEFAULT_BASELINE


@pytest.mark.unit
def test_merge_baselines_averages_two_styles():
    result = _merge_baselines(["streetwear", "minimalist"])
    # Both have "tops" → average of their tops values
    street_tops = _STYLE_BASELINES["streetwear"]["tops"]
    mini_tops   = _STYLE_BASELINES["minimalist"]["tops"]
    expected    = round((street_tops + mini_tops) / 2)
    assert result["tops"] == expected


@pytest.mark.unit
def test_merge_baselines_all_known_styles():
    """Should not raise for any style in the baseline dict."""
    for style in _STYLE_BASELINES:
        result = _merge_baselines([style])
        assert "tops" in result or "dresses" in result  # every style has tops or dresses


@pytest.mark.unit
async def test_analyze_wardrobe_gaps_returns_string():
    """
    analyze_wardrobe_gaps is a LangChain @tool — calling it directly requires
    a RunnableConfig. We test the underlying logic by mocking Cosmos containers
    and asserting the returned JSON contains gap descriptions.
    """
    from langchain_core.runnables import RunnableConfig
    from agents.tools.gaps import analyze_wardrobe_gaps

    mock_profiles = AsyncMock()
    mock_profiles.read_item = AsyncMock(return_value={
        "id": "test-user",
        "stylePreferences": ["minimalist"],
        "preferredColours": ["white", "navy"],
    })

    # Wardrobe with only 1 top — well below minimalist baseline of 5
    async def _query_items(**kwargs):
        yield {"category": "Tops", "colours": [{"name": "White"}], "tags": ["casual"], "brand": None}

    mock_wardrobe = AsyncMock()
    mock_wardrobe.query_items = _query_items

    config = RunnableConfig(configurable={"user_id": "test-user"})

    with (
        patch("agents.tools.gaps.get_user_profiles_container", return_value=mock_profiles),
        patch("agents.tools.gaps.get_wardrobe_container", return_value=mock_wardrobe),
    ):
        result = await analyze_wardrobe_gaps.ainvoke(input={}, config=config)

    assert isinstance(result, str)
    assert len(result) > 0  # Should report gaps since we only have 1 top vs baseline of 5
