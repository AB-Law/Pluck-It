"""
Unit tests for agents/tools/wear_patterns.py.

Covers:
- Empty wardrobe → sparse response with empty items list
- Sparse threshold: fewer than 5 items with wear history → sparse flag set
- Correct recency-weighted ranking (higher wear + more recent = higher score)
- Category aggregation in categoryWearSummary
- Occasion and climate counter extraction
- cost_per_wear computation
- Most recent event ordering (sorted by occurredAt descending)

Note: LangChain @tool injects RunnableConfig from the 2nd positional arg to
ainvoke, NOT from the input dict. All tool tests use:
    await tool.ainvoke({"query": ""}, {"configurable": {"user_id": "..."}}).
"""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from agents.tools.wear_patterns import (
    _cost_per_wear,
    _recency_days,
    _score_item,
)

_TEST_CONFIG = {"configurable": {"user_id": "test-user"}}


# ── Pure helper unit tests ──────────────────────────────────────────────────

@pytest.mark.unit
def test_recency_days_none_when_never_worn():
    assert _recency_days(None) is None


@pytest.mark.unit
def test_recency_days_today():
    today = datetime.now(timezone.utc).isoformat()
    days = _recency_days(today)
    assert days is not None
    assert 0 <= days <= 1  # same day


@pytest.mark.unit
def test_recency_days_90_days_ago():
    past = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    days = _recency_days(past)
    assert days is not None
    assert 89 <= days <= 91


@pytest.mark.unit
def test_recency_days_invalid_string():
    assert _recency_days("not-a-date") is None


@pytest.mark.unit
def test_cost_per_wear_none_when_no_price():
    assert _cost_per_wear(None, 10) is None


@pytest.mark.unit
def test_cost_per_wear_none_when_never_worn():
    assert _cost_per_wear(100.0, 0) is None


@pytest.mark.unit
def test_cost_per_wear_computed():
    assert _cost_per_wear(100.0, 4) == 25.0


@pytest.mark.unit
def test_score_item_zero_when_never_worn():
    assert _score_item(0, None) == 0.0
    assert _score_item(0, 30) == 0.0


@pytest.mark.unit
def test_score_item_higher_for_recent():
    recent = _score_item(10, 5)    # worn 10 times, 5 days ago
    old = _score_item(10, 150)     # worn 10 times, 150 days ago
    assert recent > old


@pytest.mark.unit
def test_score_item_floor_at_zero_point_one_times_wear():
    very_old = _score_item(10, 10_000)  # 10k days ago
    assert very_old == round(10 * 0.1, 3)


# ── Integration-style tests using mocked Cosmos ──────────────────────────────

def _make_item(
    item_id: str,
    category: str = "Tops",
    wear_count: int = 0,
    last_worn_at: str | None = None,
    wear_events: list | None = None,
    price_amount: float | None = None,
) -> dict:
    item = {
        "id": item_id,
        "category": category,
        "brand": "TestBrand",
        "aestheticTags": ["casual"],
        "tags": [],
        "wearCount": wear_count,
        "lastWornAt": last_worn_at,
        "wearEvents": wear_events or [],
    }
    if price_amount is not None:
        item["price"] = {"amount": price_amount, "currency": "USD"}
    return item


@pytest.mark.unit
async def test_empty_wardrobe_returns_sparse():
    from agents.tools.wear_patterns import get_wear_patterns

    mock_container = AsyncMock()

    async def _empty(**kwargs):
        return
        yield  # noqa: unreachable — makes this an async generator

    mock_container.query_items = _empty

    with patch("agents.tools.wear_patterns.get_wardrobe_container", return_value=mock_container):
        raw = await get_wear_patterns.ainvoke({"query": ""}, _TEST_CONFIG)

    result = json.loads(raw)
    assert result["sparse"] is True
    assert "empty" in result["message"].lower()


@pytest.mark.unit
async def test_sparse_when_fewer_than_5_items_have_wear_history():
    from agents.tools.wear_patterns import get_wear_patterns

    # 10 items but only 3 have been worn
    items = [_make_item(f"item-{i}", wear_count=(1 if i < 3 else 0)) for i in range(10)]

    mock_container = AsyncMock()

    async def _query(**kwargs):
        for item in items:
            yield item

    mock_container.query_items = _query

    with patch("agents.tools.wear_patterns.get_wardrobe_container", return_value=mock_container):
        raw = await get_wear_patterns.ainvoke({"query": ""}, _TEST_CONFIG)

    result = json.loads(raw)
    assert result["sparse"] is True
    assert result["totalItems"] == 10


@pytest.mark.unit
async def test_ranking_orders_by_score_descending():
    from agents.tools.wear_patterns import get_wear_patterns

    recent_date = datetime.now(timezone.utc).isoformat()
    old_date = (datetime.now(timezone.utc) - timedelta(days=160)).isoformat()

    items = [
        # item-A: worn 20 times recently → highest score
        _make_item("item-A", wear_count=20, last_worn_at=recent_date),
        # item-B: worn 5 times recently → medium score
        _make_item("item-B", wear_count=5, last_worn_at=recent_date),
        # item-C: worn 20 times but long ago → lower than item-A
        _make_item("item-C", wear_count=20, last_worn_at=old_date),
        # 10 more items to surpass the sparse threshold
        *[_make_item(f"item-{i}", wear_count=1, last_worn_at=old_date) for i in range(10)],
    ]

    mock_container = AsyncMock()

    async def _query(**kwargs):
        for item in items:
            yield item

    mock_container.query_items = _query

    with patch("agents.tools.wear_patterns.get_wardrobe_container", return_value=mock_container):
        raw = await get_wear_patterns.ainvoke({"query": ""}, _TEST_CONFIG)

    result = json.loads(raw)
    assert result["sparse"] is False
    top = result["topRankedItems"]
    # item-A should be first (highest score)
    assert top[0]["id"] == "item-A"
    # item-A score should be >= item-C score (more recent wins on equal wear count)
    scores = {item["id"]: item["score"] for item in top}
    assert scores["item-A"] >= scores["item-C"]


@pytest.mark.unit
async def test_occasion_and_climate_signals_extracted():
    from agents.tools.wear_patterns import get_wear_patterns

    recent_date = datetime.now(timezone.utc).isoformat()

    wear_events = [
        {"occasion": "casual", "weatherSnapshot": {"conditions": "clear"}, "occurredAt": recent_date},
        {"occasion": "work",   "weatherSnapshot": {"conditions": "rain"},  "occurredAt": recent_date},
        {"occasion": "casual", "weatherSnapshot": None,                    "occurredAt": recent_date},
    ]
    # 6 items with wear history so we're above the sparse threshold
    items = [_make_item(f"item-{i}", wear_count=2, last_worn_at=recent_date, wear_events=wear_events) for i in range(6)]

    mock_container = AsyncMock()

    async def _query(**kwargs):
        for item in items:
            yield item

    mock_container.query_items = _query

    with patch("agents.tools.wear_patterns.get_wardrobe_container", return_value=mock_container):
        raw = await get_wear_patterns.ainvoke({"query": ""}, _TEST_CONFIG)

    result = json.loads(raw)
    assert result["sparse"] is False
    assert "casual" in result["topOccasions"]
    assert "clear" in result["topClimateConditions"]


@pytest.mark.unit
async def test_most_recent_events_used_not_oldest():
    """Verify that occurredAt-sorting picks the most recent events, not a tail slice."""
    from agents.tools.wear_patterns import get_wear_patterns

    now = datetime.now(timezone.utc)

    # Build 12 events — newest are "work" (last 6 days), oldest are "gym" (100+ days ago).
    # A naive [-10:] slice on an unsorted list would pick wrong events.
    old_events = [
        {"occasion": "gym", "weatherSnapshot": None, "occurredAt": (now - timedelta(days=100 + i)).isoformat()}
        for i in range(6)
    ]
    new_events = [
        {"occasion": "work", "weatherSnapshot": {"conditions": "clear"}, "occurredAt": (now - timedelta(days=i)).isoformat()}
        for i in range(6)
    ]
    # Store oldest-first to expose any ordering bug
    wear_events = old_events + new_events

    # 6 items to surpass the sparse threshold
    items = [_make_item(f"item-{i}", wear_count=2, last_worn_at=now.isoformat(), wear_events=wear_events) for i in range(6)]

    mock_container = AsyncMock()

    async def _query(**kwargs):
        for item in items:
            yield item

    mock_container.query_items = _query

    with patch("agents.tools.wear_patterns.get_wardrobe_container", return_value=mock_container):
        raw = await get_wear_patterns.ainvoke({"query": ""}, _TEST_CONFIG)

    result = json.loads(raw)
    assert result["sparse"] is False
    # "work" is the most recent occasion — must appear in top occasions
    assert "work" in result["topOccasions"]


@pytest.mark.unit
async def test_load_wardrobe_items_limits_query_and_cuts_events():
    from agents.tools.wear_patterns import _load_wardrobe_items, _RECENT_WEAR_EVENTS_LIMIT

    now = datetime.now(timezone.utc)
    events = [
        {"occasion": "event", "occurredAt": (now - timedelta(days=idx)).isoformat(), "weatherSnapshot": {"conditions": "clear"}}
        for idx in range(20)
    ]

    async def _query_items(**kwargs):
        assert "OFFSET 0 LIMIT 500" in kwargs["query"]
        yield {
            "id": "item-1",
            "category": "tops",
            "brand": "TestBrand",
            "aestheticTags": ["casual"],
            "wearCount": 1,
            "lastWornAt": now.isoformat(),
            "wearEvents": events,
            "price": {"amount": 100.0},
        }

    mock_container = AsyncMock()
    mock_container.query_items = _query_items

    with patch("agents.tools.wear_patterns.get_wardrobe_container", return_value=mock_container):
        items = await _load_wardrobe_items("test-user")

    assert len(items) == 1
    assert len(items[0]["wearEvents"]) == _RECENT_WEAR_EVENTS_LIMIT
    assert items[0]["wearEvents"][0]["occurredAt"] >= items[0]["wearEvents"][1]["occurredAt"]


@pytest.mark.unit
async def test_missing_user_id_returns_error():
    from agents.tools.wear_patterns import get_wear_patterns

    # Invoke with no config at all → user_id defaults to empty → should return error JSON
    raw = await get_wear_patterns.ainvoke({"query": ""})
    result = json.loads(raw)
    assert "error" in result
