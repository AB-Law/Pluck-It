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
    if amount is None:
        return None
    if not from_currency:
        return None
    f = from_currency.upper()
    t = to_currency.upper()
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


def _item_primary_color(item: dict) -> Optional[str]:
    colours = item.get("colours") or []
    tags = item.get("tags") or []

    for c in colours:
        if isinstance(c, dict):
            from_name = _normalize_color_name(c.get("name"))
            if from_name:
                return from_name

            hexv = str(c.get("hex") or "").lower().strip()
            # Lightweight named buckets for common dark/light neutrals.
            if hexv in {"#000000", "#111111", "#1a1a1a"}:
                return "black"
            if hexv in {"#ffffff", "#f5f5f5", "#fafafa"}:
                return "white"
            if hexv in {"#808080", "#a9a9a9", "#c0c0c0"}:
                return "grey"

    for t in tags:
        from_tag = _normalize_color_name(t)
        if from_tag:
            return from_tag

    return None


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

    wardrobe = get_wardrobe_container()
    wear_events = get_wear_events_container()
    profiles = get_user_profiles_container()

    profile_currency = "USD"
    try:
        profile = await profiles.read_item(item=user_id, partition_key=user_id)
        profile_currency = (profile.get("currencyCode") or "USD").upper()
    except Exception:
        pass

    items: list[dict] = []
    async for item in wardrobe.query_items(
        query=(
            "SELECT c.id, c.wearCount, c.lastWornAt, c.price, c.colours, c.tags, c.dateAdded "
            "FROM c WHERE c.userId = @userId"
        ),
        parameters=[{"name": "@userId", "value": user_id}],
    ):
        items.append(item)

    if not items:
        return {
            "generatedAt": now.isoformat(),
            "currency": profile_currency,
            "insufficientData": True,
            "fxDate": fx_date,
            "conversionStatus": fx_status,
            "behavioralInsights": {
                "topColorWearShare": None,
                "unworn90dPct": None,
                "mostExpensiveUnworn": None,
                "sparseHistory": True,
            },
            "cpwIntel": [],
        }

    window_events: list[dict] = []
    async for ev in wear_events.query_items(
        query=(
            "SELECT c.itemId, c.occurredAt FROM c WHERE c.userId = @userId "
            "AND c.occurredAt >= @cutoff"
        ),
        parameters=[
            {"name": "@userId", "value": user_id},
            {"name": "@cutoff", "value": cutoff.isoformat()},
        ],
    ):
        window_events.append(ev)

    item_by_id = {i.get("id"): i for i in items if i.get("id")}
    window_wears = Counter([e.get("itemId") for e in window_events if e.get("itemId")])

    denominator = 0
    color_counter: Counter[str] = Counter()
    for ev in window_events:
        item = item_by_id.get(ev.get("itemId"))
        if not item:
            continue
        color = _item_primary_color(item)
        if not color:
            continue
        denominator += 1
        color_counter[color] += 1

    top_color_share = None
    if denominator > 0 and color_counter:
        top_color, top_count = color_counter.most_common(1)[0]
        top_color_share = {
            "color": top_color,
            "pct": round((top_count / denominator) * 100.0, 1),
        }

    unworn_cutoff = now - timedelta(days=90)
    unworn_count = 0
    for item in items:
        last_worn = _parse_iso(item.get("lastWornAt"))
        if last_worn is None or last_worn < unworn_cutoff:
            unworn_count += 1
    unworn_90 = round((unworn_count / len(items)) * 100.0, 1) if items else None

    most_expensive_unworn = None
    max_amount = -1.0
    for item in items:
        if int(item.get("wearCount") or 0) > 0:
            continue
        price = item.get("price") or {}
        if not isinstance(price, dict):
            price = {"amount": price}
        amount = price.get("amount")
        if amount is None:
            continue
        converted = _convert(float(amount), price.get("originalCurrency"), profile_currency)
        if converted is None:
            continue
        if converted > max_amount:
            max_amount = converted
            most_expensive_unworn = {
                "itemId": item.get("id"),
                "amount": round(converted, 2),
                "currency": profile_currency,
            }

    cpw_intel = []
    items_with_history = 0
    for item in items:
        item_id = item.get("id")
        wear_count = int(item.get("wearCount") or 0)
        if wear_count > 0:
            items_with_history += 1

        price = item.get("price") or {}
        if not isinstance(price, dict):
            price = {"amount": price}
        amount = price.get("amount")
        converted = _convert(float(amount), price.get("originalCurrency"), profile_currency) if amount is not None else None

        cpw = None
        if converted is not None and wear_count > 0:
            cpw = round(converted / max(wear_count, 1), 2)

        break_even = cpw is not None and wear_count > 0 and cpw <= target_cpw

        forecast = None
        if converted is not None and target_cpw > 0:
            required_wears = int(math.ceil(converted / target_cpw))
            additional = max(required_wears - wear_count, 0)
            rate_recent = window_wears.get(item_id, 0) / 3.0
            if rate_recent > 0:
                wear_rate = rate_recent
            else:
                wear_rate = max(0.3, wear_count / _months_since(item.get("dateAdded"), now))

            if wear_rate > 0:
                months_to_target = int(math.ceil(additional / wear_rate))
                projected = _add_months(now, months_to_target)
                forecast = {
                    "targetCpw": float(target_cpw),
                    "projectedMonth": projected.strftime("%Y-%m"),
                    "projectedWearsNeeded": additional,
                }

        cpw_intel.append({
            "itemId": item_id,
            "cpw": cpw,
            "badge": _badge(cpw, wear_count, target_cpw),
            "breakEvenReached": break_even,
            "breakEvenTargetCpw": float(target_cpw),
            "forecast": forecast,
        })

    return {
        "generatedAt": now.isoformat(),
        "currency": profile_currency,
        "insufficientData": False,
        "fxDate": fx_date,
        "conversionStatus": fx_status,
        "behavioralInsights": {
            "topColorWearShare": top_color_share,
            "unworn90dPct": unworn_90,
            "mostExpensiveUnworn": most_expensive_unworn,
            "sparseHistory": items_with_history < 5,
        },
        "cpwIntel": cpw_intel,
    }
