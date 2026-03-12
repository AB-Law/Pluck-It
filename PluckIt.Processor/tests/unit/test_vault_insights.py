import sys
import types
from unittest.mock import AsyncMock, patch

import pytest

# Stub azure-cosmos imports so this unit file runs without optional sdk installs.
azure_mod = types.ModuleType("azure")
cosmos_mod = types.ModuleType("azure.cosmos")
cosmos_aio_mod = types.ModuleType("azure.cosmos.aio")
cosmos_mod.CosmosClient = object
cosmos_aio_mod.CosmosClient = object
sys.modules.setdefault("azure", azure_mod)
sys.modules.setdefault("azure.cosmos", cosmos_mod)
sys.modules.setdefault("azure.cosmos.aio", cosmos_aio_mod)


def _async_iter(items):
    async def _gen(**kwargs):
        for i in items:
            yield i
    return _gen


@pytest.mark.unit
async def test_compute_vault_insights_handles_empty_wardrobe():
    from agents.vault_insights import compute_vault_insights

    wardrobe = AsyncMock()
    wardrobe.query_items = _async_iter([])

    events = AsyncMock()
    events.query_items = _async_iter([])

    profiles = AsyncMock()
    profiles.read_item = AsyncMock(return_value={"currencyCode": "INR"})

    with (
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=events),
        patch("agents.vault_insights.get_user_profiles_container", return_value=profiles),
    ):
        result = await compute_vault_insights("test-user")

    assert result["insufficientData"] is True
    assert result["cpwIntel"] == []


@pytest.mark.unit
async def test_compute_vault_insights_computes_cpw_badges():
    from agents.vault_insights import compute_vault_insights

    wardrobe_items = [
        {
            "id": "item-1",
            "wearCount": 2,
            "lastWornAt": "2026-03-01T00:00:00Z",
            "dateAdded": "2025-01-01T00:00:00Z",
            "price": {"amount": 1000, "originalCurrency": "INR"},
            "colours": [{"name": "Black", "hex": "#000000"}],
            "tags": [],
        },
        {
            "id": "item-2",
            "wearCount": 0,
            "lastWornAt": None,
            "dateAdded": "2026-01-01T00:00:00Z",
            "price": {"amount": 500, "originalCurrency": "INR"},
            "colours": [{"name": "White", "hex": "#FFFFFF"}],
            "tags": [],
        },
    ]
    window_events = [
        {"itemId": "item-1", "occurredAt": "2026-03-02T00:00:00Z"},
        {"itemId": "item-1", "occurredAt": "2026-03-03T00:00:00Z"},
    ]

    wardrobe = AsyncMock()
    wardrobe.query_items = _async_iter(wardrobe_items)

    events = AsyncMock()
    events.query_items = _async_iter(window_events)

    profiles = AsyncMock()
    profiles.read_item = AsyncMock(return_value={"currencyCode": "INR"})

    with (
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=events),
        patch("agents.vault_insights.get_user_profiles_container", return_value=profiles),
    ):
        result = await compute_vault_insights("test-user", target_cpw=100)

    assert result["insufficientData"] is False
    assert result["behavioralInsights"]["topColorWearShare"]["color"] == "black"
    assert result["behavioralInsights"]["topColorWearShare"]["pct"] == pytest.approx(100.0)
    intel = {x["itemId"]: x for x in result["cpwIntel"]}
    assert intel["item-1"]["cpw"] == pytest.approx(500.0)
    assert intel["item-1"]["badge"] == "high"
    assert intel["item-2"]["badge"] == "unworn"


@pytest.mark.unit
async def test_compute_vault_insights_falls_back_missing_original_currency_to_usd_then_converts():
    from agents.vault_insights import compute_vault_insights

    wardrobe_items = [
        {
            "id": "item-1",
            "wearCount": 1,
            "lastWornAt": "2026-03-01T00:00:00Z",
            "dateAdded": "2025-01-01T00:00:00Z",
            "price": {"amount": 100},
            "colours": [{"name": "Black", "hex": "#000000"}],
            "tags": [],
        },
    ]
    window_events = [
        {"itemId": "item-1", "occurredAt": "2026-03-02T00:00:00Z"},
    ]

    wardrobe = AsyncMock()
    wardrobe.query_items = _async_iter(wardrobe_items)

    events = AsyncMock()
    events.query_items = _async_iter(window_events)

    profiles = AsyncMock()
    profiles.read_item = AsyncMock(return_value={"currencyCode": "INR"})

    with (
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=events),
        patch("agents.vault_insights.get_user_profiles_container", return_value=profiles),
    ):
        result = await compute_vault_insights("test-user", target_cpw=100)

    assert result["insufficientData"] is False
    intel = {x["itemId"]: x for x in result["cpwIntel"]}
    assert intel["item-1"]["cpw"] == pytest.approx(8300.0)
    assert intel["item-1"]["forecast"] is not None
    assert result["behavioralInsights"]["topColorWearShare"]["color"] == "black"
    assert result["behavioralInsights"]["topColorWearShare"]["pct"] == pytest.approx(100.0)


@pytest.mark.unit
async def test_compute_vault_insights_treats_missing_original_currency_as_usd():
    from agents.vault_insights import compute_vault_insights

    wardrobe_items = [
        {
            "id": "item-1",
            "wearCount": 1,
            "lastWornAt": "2026-03-01T00:00:00Z",
            "dateAdded": "2025-01-01T00:00:00Z",
            "price": {"amount": 100},
            "colours": [{"name": "Black", "hex": "#000000"}],
            "tags": [],
        },
    ]
    window_events = [
        {"itemId": "item-1", "occurredAt": "2026-03-02T00:00:00Z"},
    ]

    wardrobe = AsyncMock()
    wardrobe.query_items = _async_iter(wardrobe_items)

    events = AsyncMock()
    events.query_items = _async_iter(window_events)

    profiles = AsyncMock()
    profiles.read_item = AsyncMock(return_value={"currencyCode": "USD"})

    with (
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=events),
        patch("agents.vault_insights.get_user_profiles_container", return_value=profiles),
    ):
        result = await compute_vault_insights("test-user", target_cpw=100)

    assert result["insufficientData"] is False
    assert result["cpwIntel"][0]["cpw"] == pytest.approx(100.0)
    assert result["cpwIntel"][0]["forecast"] is not None


@pytest.mark.unit
async def test_compute_vault_insights_allows_zero_price_values():
    from agents.vault_insights import compute_vault_insights

    wardrobe_items = [
        {
            "id": "item-1",
            "wearCount": 1,
            "lastWornAt": "2026-03-01T00:00:00Z",
            "dateAdded": "2026-02-01T00:00:00Z",
            "price": {"amount": 0, "originalCurrency": "USD"},
            "colours": [{"name": "Black", "hex": "#000000"}],
            "tags": [],
        },
    ]
    window_events = [
        {"itemId": "item-1", "occurredAt": "2026-03-02T00:00:00Z"},
    ]

    wardrobe = AsyncMock()
    wardrobe.query_items = _async_iter(wardrobe_items)

    events = AsyncMock()
    events.query_items = _async_iter(window_events)

    profiles = AsyncMock()
    profiles.read_item = AsyncMock(return_value={"currencyCode": "USD"})

    with (
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=events),
        patch("agents.vault_insights.get_user_profiles_container", return_value=profiles),
    ):
        result = await compute_vault_insights("test-user", target_cpw=100)

    assert result["insufficientData"] is False
    assert result["cpwIntel"][0]["cpw"] == pytest.approx(0.0)
    assert result["cpwIntel"][0]["forecast"] is not None


@pytest.mark.unit
async def test_compute_vault_insights_safely_handles_non_numeric_price_amount():
    from agents.vault_insights import compute_vault_insights

    wardrobe_items = [
        {
            "id": "item-1",
            "wearCount": 1,
            "lastWornAt": "2026-03-01T00:00:00Z",
            "dateAdded": "2026-02-01T00:00:00Z",
            "price": {"amount": "not-a-number", "originalCurrency": "USD"},
            "colours": [{"name": "Black", "hex": "#000000"}],
            "tags": [],
        },
    ]
    window_events = [
        {"itemId": "item-1", "occurredAt": "2026-03-02T00:00:00Z"},
    ]

    wardrobe = AsyncMock()
    wardrobe.query_items = _async_iter(wardrobe_items)

    events = AsyncMock()
    events.query_items = _async_iter(window_events)

    profiles = AsyncMock()
    profiles.read_item = AsyncMock(return_value={"currencyCode": "USD"})

    with (
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=events),
        patch("agents.vault_insights.get_user_profiles_container", return_value=profiles),
    ):
        result = await compute_vault_insights("test-user", target_cpw=100)

    assert result["insufficientData"] is False
    assert result["cpwIntel"][0]["cpw"] is None
    assert result["cpwIntel"][0]["forecast"] is None
