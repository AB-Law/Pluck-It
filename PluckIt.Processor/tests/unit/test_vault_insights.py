import sys
import types
from datetime import datetime, timedelta, timezone
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


def _capturing_async_iter(capture: dict, key: str, items):
    async def _gen(**kwargs):
        capture[key] = kwargs
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
async def test_compute_vault_insights_includes_wear_rate_trends():
    from agents.vault_insights import compute_vault_insights

    wardrobe_items = [
        {
            "id": "item-1",
            "wearCount": 4,
            "lastWornAt": "2026-03-01T00:00:00Z",
            "dateAdded": "2024-12-01T00:00:00Z",
            "price": {"amount": 1000, "originalCurrency": "USD"},
            "colours": [{"name": "Blue", "hex": "#0000FF"}],
            "tags": [],
        }
    ]
    window_events = [
        {"itemId": "item-1", "occurredAt": "2026-03-02T00:00:00Z"},
        {"itemId": "item-1", "occurredAt": "2026-03-03T00:00:00Z"},
        {"itemId": "item-1", "occurredAt": "2026-03-04T00:00:00Z"},
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
    row = {x["itemId"]: x for x in result["cpwIntel"]}["item-1"]
    assert row["wearRateTrend"] == "up"
    assert row["recentWearRate"] is not None
    assert row["historicalWearRate"] is not None
    assert row["wearRateDelta"] == pytest.approx(row["recentWearRate"] - row["historicalWearRate"], rel=1e-2)
    assert row["forecast"] is not None
    assert row["forecast"]["wearRateTrend"] == "up"
    assert row["forecast"]["recentWearRate"] == pytest.approx(row["recentWearRate"], rel=1e-2)
    assert row["forecast"]["historicalWearRate"] == pytest.approx(row["historicalWearRate"], rel=1e-2)


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


@pytest.mark.unit
async def test_compute_vault_insights_returns_cached_payload_when_fingerprint_matches():
    from agents.vault_insights import compute_vault_insights

    future_expires_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    cached_payload = {
        "generatedAt": "2026-03-12T00:00:00+00:00",
        "currency": "USD",
        "insufficientData": False,
        "fxDate": "2026-03-12",
        "conversionStatus": "static_rates",
        "behavioralInsights": {
            "topColorWearShare": {"color": "black", "pct": 55.0},
            "unworn90dPct": 12.5,
            "mostExpensiveUnworn": {"itemId": "item-1", "amount": 42.0, "currency": "USD"},
            "sparseHistory": True,
        },
        "cpwIntel": [
            {
                "itemId": "item-1",
                "cpw": 10.0,
                "badge": "low",
                "breakEvenReached": False,
                "breakEvenTargetCpw": 100.0,
                "recentWearRate": 0.5,
                "historicalWearRate": 0.2,
                "wearRateTrend": "up",
                "wearRateDelta": 0.3,
                "forecast": None,
            }
        ],
    }
    cache_record = {
        "id": "test-user|90|100",
        "userId": "test-user",
        "windowDays": 90,
        "targetCpw": 100.0,
        "wardrobeFingerprint": "fp-123",
        "payload": cached_payload,
        "expiresAt": future_expires_at,
    }

    cache = AsyncMock()
    cache.query_items = _async_iter([cache_record])
    wardrobe = AsyncMock()
    wardrobe.query_items = _async_iter([])
    events = AsyncMock()
    events.query_items = _async_iter([])
    profiles = AsyncMock()
    profiles.read_item = AsyncMock(return_value={"currencyCode": "USD", "wardrobeFingerprint": "fp-123"})

    with (
        patch("agents.vault_insights.get_vault_insights_cache_container", return_value=cache),
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=events),
        patch("agents.vault_insights.get_user_profiles_container", return_value=profiles),
    ):
        result = await compute_vault_insights("test-user")

    assert result == cached_payload


@pytest.mark.unit
async def test_compute_vault_insights_writes_cache_entry_on_miss():
    from agents.vault_insights import compute_vault_insights

    wardrobe_items = [
        {
            "id": "item-1",
            "wearCount": 1,
            "lastWornAt": "2026-03-01T00:00:00Z",
            "dateAdded": "2026-02-01T00:00:00Z",
            "price": {"amount": 100, "originalCurrency": "USD"},
            "colours": [{"name": "Black", "hex": "#000000"}],
            "tags": [],
        }
    ]
    window_events = [
        {"itemId": "item-1", "occurredAt": "2026-03-02T00:00:00Z"},
    ]

    wardrobe = AsyncMock()
    wardrobe.query_items = _async_iter(wardrobe_items)
    events = AsyncMock()
    events.query_items = _async_iter(window_events)
    profiles = AsyncMock()
    profiles.read_item = AsyncMock(
        return_value={"currencyCode": "USD", "wardrobeFingerprint": "fp-456"}
    )
    cache = AsyncMock()
    cache.query_items = _async_iter([])
    cache.upsert_item = AsyncMock()

    with (
        patch("agents.vault_insights.get_vault_insights_cache_container", return_value=cache),
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=events),
        patch("agents.vault_insights.get_user_profiles_container", return_value=profiles),
    ):
        result = await compute_vault_insights("test-user")

    assert result["currency"] == "USD"
    cache.upsert_item.assert_called_once()
    cached_payload = cache.upsert_item.call_args.args[0]
    assert cached_payload["cacheTtlMs"] == 1_800_000


@pytest.mark.unit
async def test_fetch_user_data_applies_query_limits_with_parameters():
    from agents.vault_insights import _fetch_user_data

    cutoff = datetime(2026, 3, 16, 0, 0, 0, tzinfo=timezone.utc)
    captured_queries = {}

    wardrobe = AsyncMock()
    wardrobe.query_items = _capturing_async_iter(
        captured_queries, "wardrobe", []
    )
    wear_events = AsyncMock()
    wear_events.query_items = _capturing_async_iter(
        captured_queries, "wear_events", []
    )

    with (
        patch("agents.vault_insights.get_wardrobe_container", return_value=wardrobe),
        patch("agents.vault_insights.get_wear_events_container", return_value=wear_events),
    ):
        await _fetch_user_data("test-user", cutoff)

    wardrobe_query = captured_queries["wardrobe"]["query"]
    wear_events_query = captured_queries["wear_events"]["query"]

    assert "OFFSET 0 LIMIT 1000" in wardrobe_query
    assert "LIMIT 5000" in wear_events_query
    assert "@userId" in wardrobe_query
    assert "@userId" in wear_events_query
    assert "@cutoff" in wear_events_query
    assert "test-user" not in wear_events_query

    wardrobe_params = captured_queries["wardrobe"]["parameters"]
    wear_event_params = captured_queries["wear_events"]["parameters"]
    assert wardrobe_params == [{"name": "@userId", "value": "test-user"}]
    assert wear_event_params == [
        {"name": "@userId", "value": "test-user"},
        {"name": "@cutoff", "value": cutoff.isoformat()},
    ]
