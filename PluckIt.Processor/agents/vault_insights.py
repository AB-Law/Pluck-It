"""
Deterministic vault insights + CPW intelligence engine.

No LLM calls. This module computes:
  - Behavioral insights (top color wear share, unworn in 90 days, most expensive unworn item)
  - Per-item CPW badges
  - Break-even milestone state
  - Forecast month to reach target CPW
"""

from __future__ import annotations

import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from .db import (
    get_wardrobe_container,
    get_wear_events_container,
    get_user_profiles_container,
)

_FX_LAST_REFRESH: Optional[datetime] = None
_FX_CACHE: dict[tuple[str, str], float] = {}
_KNOWN_COLORS = {
    "black", "white", "blue", "navy", "red", "green", "yellow", "orange",
    "pink", "purple", "brown", "beige", "grey", "gray", "cream", "olive",
    "maroon", "teal", "gold", "silver",
}


def _ensure_fx_cache() -> tuple[str, str]:
    global _FX_LAST_REFRESH, _FX_CACHE
    now = datetime.now(timezone.utc)
    if _FX_LAST_REFRESH and now - _FX_LAST_REFRESH < timedelta(hours=24):
        return _FX_LAST_REFRESH.date().isoformat(), "cache_hit"

    # Static fallback matrix for v1; can be swapped with real provider later.
    _FX_CACHE = {
        ("USD", "INR"): 83.0,
        ("EUR", "INR"): 90.0,
        ("GBP", "INR"): 105.0,
        ("INR", "USD"): 1 / 83.0,
        ("INR", "EUR"): 1 / 90.0,
        ("INR", "GBP"): 1 / 105.0,
        ("USD", "EUR"): 0.92,
        ("EUR", "USD"): 1.08,
        ("USD", "GBP"): 0.79,
        ("GBP", "USD"): 1.26,
    }
    _FX_LAST_REFRESH = now
    return now.date().isoformat(), "static_rates"


def _convert(amount: float, from_currency: Optional[str], to_currency: str) -> Optional[float]:
    t = to_currency.upper()
    if not from_currency:
        if t == "USD":
            return amount
        fallback_rate = _FX_CACHE.get(("USD", t))
        return amount * fallback_rate if fallback_rate is not None else None
    f = from_currency.upper()
    if f == t:
        return amount
    rate = _FX_CACHE.get((f, t))
    if rate is None:
        return None
    return amount * rate


def _parse_iso(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return None


def _to_float(value: object) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_color_name(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    text = str(raw).strip().lower()
    if not text:
        return None
    if text == "gray":
        return "grey"
    for token in text.replace("/", " ").replace("-", " ").split():
        if token == "gray":
            token = "grey"
        if token in _KNOWN_COLORS:
            return token
    return None


def _extract_color_from_colour_entry(entry: dict) -> Optional[str]:
    from_name = _normalize_color_name(entry.get("name"))
    if from_name:
        return from_name

    hexv = str(entry.get("hex") or "").lower().strip()
    if hexv in {"#000000", "#111111", "#1a1a1a"}:
        return "black"
    if hexv in {"#ffffff", "#f5f5f5", "#fafafa"}:
        return "white"
    if hexv in {"#808080", "#a9a9a9", "#c0c0c0"}:
        return "grey"
    return None


def _find_first_color(entries: list, extractor) -> Optional[str]:
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        color = extractor(entry)
        if color:
            return color
    return None


def _item_primary_color(item: dict) -> Optional[str]:
    colours = item.get("colours") or []
    tags = item.get("tags") or []

    color = _find_first_color(colours, _extract_color_from_colour_entry)
    if color:
        return color
    return _find_first_color(tags, _normalize_color_name)


def _months_since(date_added: Optional[str], now: datetime) -> int:
    dt = _parse_iso(date_added)
    if not dt:
        return 1
    months = (now.year - dt.year) * 12 + (now.month - dt.month)
    return max(months, 1)


def _add_months(now: datetime, months: int) -> datetime:
    month = now.month - 1 + months
    year = now.year + month // 12
    month = month % 12 + 1
    day = min(now.day, 28)
    return datetime(year, month, day, tzinfo=timezone.utc)


def _badge(cpw: Optional[float], wear_count: int, target_cpw: float) -> str:
    if wear_count <= 0:
        return "unworn"
    if cpw is None:
        return "unknown"
    if cpw > 1.5 * target_cpw:
        return "high"
    if cpw > target_cpw:
        return "medium"
    return "low"


async def compute_vault_insights(
    user_id: str,
    window_days: int = 90,
    target_cpw: float = 100.0,
) -> dict:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max(1, window_days))
    fx_date, fx_status = _ensure_fx_cache()

    currency = await _get_profile_currency(user_id)
    items, window_events = await _fetch_user_data(user_id, cutoff)

    if not items:
        return _insufficient_data_response(now, currency, fx_date, fx_status)

    # 1. Behavioral Insights
    item_by_id = {i.get("id"): i for i in items if i.get("id")}
    window_wears = Counter([e.get("itemId") for e in window_events if e.get("itemId")])
    
    top_color = _get_top_color_insight(window_events, item_by_id)
    unworn_90, most_exp_unworn = _get_unworn_insights(items, now, currency)
    items_with_history = sum(1 for i in items if int(i.get("wearCount") or 0) > 0)

    # 2. Per-item CPW Intel
    cpw_intel = [
        _compute_item_intel(item, target_cpw, currency, window_wears, now)
        for item in items
    ]

    return {
        "generatedAt": now.isoformat(),
        "currency": currency,
        "insufficientData": False,
        "fxDate": fx_date,
        "conversionStatus": fx_status,
        "behavioralInsights": {
            "topColorWearShare": top_color,
            "unworn90dPct": unworn_90,
            "mostExpensiveUnworn": most_exp_unworn,
            "sparseHistory": items_with_history < 5,
        },
        "cpwIntel": cpw_intel,
    }

async def _get_profile_currency(user_id: str) -> str:
    try:
        profiles = get_user_profiles_container()
        profile = await profiles.read_item(item=user_id, partition_key=user_id)
        return (profile.get("currencyCode") or "USD").upper()
    except Exception:
        return "USD"

async def _fetch_user_data(user_id: str, cutoff: datetime) -> tuple[list[dict], list[dict]]:
    wardrobe = get_wardrobe_container()
    wear_events = get_wear_events_container()
    
    items = []
    async for item in wardrobe.query_items(
        query="SELECT c.id, c.wearCount, c.lastWornAt, c.price, c.colours, c.tags, c.dateAdded FROM c WHERE c.userId = @userId",
        parameters=[{"name": "@userId", "value": user_id}],
    ):
        items.append(item)
        
    events = []
    async for ev in wear_events.query_items(
        query="SELECT c.itemId, c.occurredAt FROM c WHERE c.userId = @userId AND c.occurredAt >= @cutoff",
        parameters=[{"name": "@userId", "value": user_id}, {"name": "@cutoff", "value": cutoff.isoformat()}],
    ):
        events.append(ev)
        
    return items, events

def _insufficient_data_response(now, currency, fx_date, fx_status) -> dict:
    return {
        "generatedAt": now.isoformat(), "currency": currency, "insufficientData": True,
        "fxDate": fx_date, "conversionStatus": fx_status,
        "behavioralInsights": {"topColorWearShare": None, "unworn90dPct": None, "mostExpensiveUnworn": None, "sparseHistory": True},
        "cpwIntel": [],
    }

def _get_top_color_insight(events: list[dict], item_by_id: dict) -> Optional[dict]:
    counter = Counter()
    total = 0
    for ev in events:
        item = item_by_id.get(ev.get("itemId"))
        color = _item_primary_color(item) if item else None
        if color:
            counter[color] += 1
            total += 1
    if total > 0:
        top_color, count = counter.most_common(1)[0]
        return {"color": top_color, "pct": round((count / total) * 100.0, 1)}
    return None

def _normalize_price_dict(price_raw) -> dict:
    if isinstance(price_raw, dict):
        return price_raw
    return {"amount": price_raw}


def _converted_price(item: dict, currency: str) -> Optional[float]:
    price = _normalize_price_dict(item.get("price") or {})
    amount = _to_float(price.get("amount"))
    if amount is None:
        return None
    return _convert(amount, price.get("originalCurrency"), currency)


def _get_unworn_insights(items: list[dict], now: datetime, currency: str) -> tuple[Optional[float], Optional[dict]]:
    cutoff = now - timedelta(days=90)
    unworn_count = 0
    max_amount = -1.0
    most_expensive = None

    for item in items:
        wear_count = int(item.get("wearCount") or 0)
        last_worn = _parse_iso(item.get("lastWornAt"))
        if last_worn is None or last_worn < cutoff:
            unworn_count += 1

        if wear_count == 0:
            converted = _converted_price(item, currency)
            if converted is not None and converted > max_amount:
                max_amount = converted
                most_expensive = {"itemId": item.get("id"), "amount": round(converted, 2), "currency": currency}

    pct = round((unworn_count / len(items)) * 100.0, 1) if items else None
    return pct, most_expensive

def _compute_item_intel(item: dict, target_cpw: float, currency: str, window_wears: Counter, now: datetime) -> dict:
    item_id = item.get("id")
    wear_count = int(item.get("wearCount") or 0)
    converted = _converted_price(item, currency)
    cpw = round(converted / wear_count, 2) if converted is not None and wear_count > 0 else None
    
    forecast = None
    if converted is not None and target_cpw > 0:
        needed = int(math.ceil(converted / target_cpw))
        additional = max(needed - wear_count, 0)
        recent_rate = window_wears.get(item_id, 0) / 3.0
        wear_rate = recent_rate if recent_rate > 0 else max(0.3, wear_count / _months_since(item.get("dateAdded"), now))
        
        if wear_rate > 0:
            projected = _add_months(now, int(math.ceil(additional / wear_rate)))
            forecast = {"targetCpw": float(target_cpw), "projectedMonth": projected.strftime("%Y-%m"), "projectedWearsNeeded": additional}

    return {
        "itemId": item_id, "cpw": cpw, "badge": _badge(cpw, wear_count, target_cpw),
        "breakEvenReached": cpw is not None and wear_count > 0 and cpw <= target_cpw,
        "breakEvenTargetCpw": float(target_cpw), "forecast": forecast,
    }
