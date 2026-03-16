"""
Wardrobe tools for the stylist agent.

Two tools are exposed:
  1. search_wardrobe   — LLM-normalised search by natural language query.
  2. get_wardrobe_summary — aggregate stats (counts per category, colour distribution).

Both receive the authenticated userId via LangGraph's RunnableConfig.configurable.
Item data is trimmed to compact token-efficient representations — image URLs are
never sent to the LLM.
"""

import json
import re
import logging
import os
import threading
import time
from functools import lru_cache
from collections import Counter, OrderedDict
from collections.abc import Iterable

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from langchain_openai import AzureChatOpenAI

from ..db import get_wardrobe_container

logger = logging.getLogger(__name__)

# Max items returned by search — keeps prompt tokens bounded.
_SEARCH_LIMIT = 30
_QUERY_CANDIDATE_LIMIT = 200
_QUERY_TERM_CACHE_TTL_SECONDS = 30 * 60
_QUERY_TERM_CACHE_MAX_ENTRIES = 128

# `query -> [terms]`, with expiry timestamps (monotonic seconds).
_EXPANDED_QUERY_CACHE: OrderedDict[str, tuple[float, list[str]]] = OrderedDict()
_CACHE_LOCK = threading.Lock()

_CATEGORY_ALIASES = {
    "top": "tops",
    "tops": "tops",
    "topwear": "tops",
    "tee": "tops",
    "tees": "tops",
    "tshirt": "tops",
    "t-shirt": "tops",
    "bottom": "bottoms",
    "bottoms": "bottoms",
    "pant": "bottoms",
    "pants": "bottoms",
    "trouser": "bottoms",
    "trousers": "bottoms",
    "legging": "bottoms",
    "leggings": "bottoms",
    "shoe": "shoes",
    "shoes": "shoes",
    "sock": "accessories",
    "socks": "accessories",
    "outer": "outerwear",
    "outerwear": "outerwear",
    "outerware": "outerwear",
    "accessory": "accessories",
    "accessories": "accessories",
}

_CONDITION_ALIASES = {"new", "excellent", "good", "fair", "brandnew"}
_FILTER_NOISE_WORDS = {
    "a",
    "and",
    "an",
    "any",
    "for",
    "from",
    "in",
    "the",
    "to",
    "with",
    "without",
    "wear",
    "wearing",
    "like",
    "look",
    "worn",
    "show",
    "find",
    "me",
    "my",
    "i",
    "need",
}


def _get_env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


@lru_cache(maxsize=1)
def _get_llm() -> AzureChatOpenAI:
    return AzureChatOpenAI(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
        api_version="2024-12-01-preview",
        temperature=0,
    )


def _normalise_term(raw: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in (raw or "").lower())
    return " ".join(safe.split())


def _require_user_id(config: RunnableConfig) -> str:
    if not isinstance(config, dict):
        raise TypeError(
            "Invalid tool config provided; expected a mapping with key 'configurable.user_id'."
        )

    configurable = config.get("configurable")
    if not isinstance(configurable, dict):
        raise ValueError(
            "Missing required config key 'configurable.user_id' in RunnableConfig."
        )

    user_id = configurable.get("user_id")
    if not user_id:
        raise ValueError(
            "Missing required config key 'configurable.user_id' in RunnableConfig."
        )
    return str(user_id)


def _evict_expired_cache(now: float) -> None:
    with _CACHE_LOCK:
        expired_keys = []
        for key, (_, expiry) in _EXPANDED_QUERY_CACHE.items():
            if expiry <= now:
                expired_keys.append(key)
        for key in expired_keys:
            _EXPANDED_QUERY_CACHE.pop(key, None)


def _get_cached_query_terms(cache_key: str) -> list[str] | None:
    now = time.monotonic()
    _evict_expired_cache(now)
    with _CACHE_LOCK:
        cached = _EXPANDED_QUERY_CACHE.get(cache_key)
        if not cached:
            return None
        value, expiry = cached
        if expiry <= now:
            _EXPANDED_QUERY_CACHE.pop(cache_key, None)
            return None
        _EXPANDED_QUERY_CACHE.move_to_end(cache_key)
        return list(value)


def _set_cached_query_terms(cache_key: str, terms: list[str], now: float) -> None:
    with _CACHE_LOCK:
        _EXPANDED_QUERY_CACHE[cache_key] = (list(terms), now + _QUERY_TERM_CACHE_TTL_SECONDS)
        _EXPANDED_QUERY_CACHE.move_to_end(cache_key)
        while len(_EXPANDED_QUERY_CACHE) > _QUERY_TERM_CACHE_MAX_ENTRIES:
            _EXPANDED_QUERY_CACHE.popitem(last=False)


async def _expand_query(query: str) -> list[str]:
    """
    Use the LLM to normalise a natural-language wardrobe query into a flat list
    of canonical search terms (category names, colours, tags, brand fragments).
    Returns the original query tokens as fallback if the LLM call fails.

    Example: "slaughter gang tee" → ["tops", "graphic", "short sleeve", "slaughter", "gang"]
    """
    prompt = (
        "You are a wardrobe search assistant. Given a user's clothing description, "
        "return a JSON array of lowercase search terms that would match the item in a "
        "wardrobe database. Include: canonical category name (e.g. 'tops', 'bottoms', "
        "'outerwear', 'shoes', 'accessories'), likely colours, fabric/style tags, and "
        "any brand or text fragments. Do NOT include stop words. Output ONLY valid JSON, "
        "no explanation.\n\n"
        f"Description: \"{query}\"\n"
        "Output:"
    )
    try:
        llm = _get_llm()
        response = await llm.ainvoke(prompt)
        raw = response.content.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        terms = json.loads(raw)
        if isinstance(terms, list):
            return [str(t).lower() for t in terms if t]
    except Exception as exc:
        logger.warning("Query expansion failed for '%s': %s", query, exc)
    # Fallback: just split the raw query
    return query.lower().split()


def _extract_filter_terms(terms: Iterable[str]) -> tuple[list[str], list[str], list[str]]:
    normalised_terms = (_normalise_term(raw_term) for raw_term in terms)
    filtered_terms = [term for term in normalised_terms if term]

    category_terms = (
        _CATEGORY_ALIASES[term]
        for term in filtered_terms
        if term in _CATEGORY_ALIASES
    )
    condition_terms = (term for term in filtered_terms if term in _CONDITION_ALIASES)
    noise_filter = _FILTER_NOISE_WORDS | set(_CATEGORY_ALIASES.keys()) | _CONDITION_ALIASES
    text_terms = (
        term for term in filtered_terms
        if term not in noise_filter and len(term) > 2
    )

    return (
        list(dict.fromkeys(category_terms))[:2],
        list(dict.fromkeys(condition_terms))[:2],
        list(dict.fromkeys(text_terms))[:2],
    )


def _build_wardrobe_query(
    user_id: str,
    category_terms: list[str],
    condition_terms: list[str],
    text_terms: list[str],
) -> tuple[str, list[dict]]:
    query = (
        "SELECT c.id, c.category, c.brand, c.tags, c.colours, "
        "c.condition, c.size, c.notes FROM c WHERE c.userId = @userId"
    )
    parameters = [{"name": "@userId", "value": user_id}]

    clauses: list[str] = []

    if category_terms:
        or_clauses = []
        for idx, category in enumerate(category_terms):
            param = f"@category{idx}"
            or_clauses.append(f"LOWER(c.category) = {param}")
            parameters.append({"name": param, "value": category})
        clauses.append(f"({' OR '.join(or_clauses)})")

    if condition_terms:
        or_clauses = []
        for idx, condition in enumerate(condition_terms):
            param = f"@condition{idx}"
            or_clauses.append(f"LOWER(c.condition) = {param}")
            parameters.append({"name": param, "value": condition})
        clauses.append(f"({' OR '.join(or_clauses)})")

    if text_terms:
        or_clauses = []
        for idx, term in enumerate(text_terms):
            param = f"@term{idx}"
            or_clauses.append(
                "("
                f"CONTAINS(LOWER(c.id), {param}) OR "
                f"CONTAINS(LOWER(c.category), {param}) OR "
                f"CONTAINS(LOWER(c.brand), {param}) OR "
                f"EXISTS(SELECT VALUE t FROM t IN c.tags WHERE CONTAINS(LOWER(t), {param})) OR "
                f"EXISTS(SELECT VALUE colour FROM colour IN c.colours "
                f"WHERE CONTAINS(LOWER(colour.name), {param})) OR "
                f"CONTAINS(LOWER(c.notes), {param})"
                ")"
            )
            parameters.append({"name": param, "value": term})
        clauses.append(f"({' OR '.join(or_clauses)})")

    if clauses:
        query = f"{query} AND {' AND '.join(clauses)}"

    query = f"{query} OFFSET 0 LIMIT {_QUERY_CANDIDATE_LIMIT}"
    return query, parameters


async def _load_candidates(container, query: str, parameters: list[dict]) -> list[dict]:
    items = []
    async for item in container.query_items(query=query, parameters=parameters):
        items.append(item)
        if len(items) >= _QUERY_CANDIDATE_LIMIT:
            break
    return items


async def _expand_query_cached(query: str) -> list[str]:
    # Cache expansion results by canonical query text to share across users/sessions.
    cache_key = _normalise_term(query)
    cached_terms = _get_cached_query_terms(cache_key)
    if cached_terms is not None:
        logger.info("search_wardrobe: query expansion cache hit for shared query key")
        return cached_terms

    terms = await _expand_query(query)
    now = time.monotonic()
    _set_cached_query_terms(cache_key, terms, now)
    logger.info("search_wardrobe: query expansion cache miss for shared query key")
    return terms


def _compact(item: dict) -> dict:
    """Strip blob URLs and heavy fields; keep only what the LLM needs."""
    return {
        "id": item.get("id"),
        "category": item.get("category"),
        "brand": item.get("brand"),
        "colours": [c.get("name") for c in (item.get("colours") or [])],
        "tags": item.get("tags") or [],
        "condition": item.get("condition"),
        "size": item.get("size"),
        "notes": item.get("notes"),
    }


def _score_item(item: dict, terms: list[str]) -> int:
    """Return how many search terms match; 0 = no match."""
    item_text = " ".join(
        (
            _normalise_term(item.get("id") or ""),
            _normalise_term(item.get("category") or ""),
            _normalise_term(item.get("brand") or ""),
            " ".join(
                _normalise_term(str(tag)) for tag in (item.get("tags") or []) if tag
            ),
            " ".join(
                _normalise_term(
                    str(colour.get("name", "")) if isinstance(colour, dict) else str(colour)
                )
                for colour in (item.get("colours") or [])
            ),
            _normalise_term(item.get("notes") or ""),
        )
    )

    token_set = set(item_text.split())
    return sum(
        1
        for term in terms
        if _is_term_match(_normalise_term(term), item_text, token_set)
    )


def _is_term_match(term: str, item_text: str, tokens: set[str]) -> bool:
    if not term:
        return False
    if " " in term:
        return bool(re.search(rf"\b{re.escape(term)}\b", item_text))
    return term in tokens


@tool
async def search_wardrobe(query: str, config: RunnableConfig) -> str:
    """
    Search the user's wardrobe using a natural language query. Understands
    colloquial terms like 'tee', 'sneakers', 'puffer', brand names, colours,
    and style descriptions. Returns a compact JSON list of matching items (up
    to 30). Use this when you need to find specific pieces.
    """
    user_id = _require_user_id(config)

    # Expand query via LLM to canonical wardrobe terms
    terms = await _expand_query_cached(query)
    logger.info("search_wardrobe: query=%r expanded_terms=%s", query, terms)

    category_terms, condition_terms, text_terms = _extract_filter_terms(terms)

    try:
        container = get_wardrobe_container()
        filtered_query, filtered_params = _build_wardrobe_query(
            user_id,
            category_terms,
            condition_terms,
            text_terms,
        )
        items_raw = await _load_candidates(
            container=container,
            query=filtered_query,
            parameters=filtered_params,
        )

        # Fallback to broad scan if filters over-prune.
        if not items_raw and (category_terms or condition_terms or text_terms):
            logger.info(
                "search_wardrobe: filtered query returned 0 items, falling back to broad scan"
            )
            all_query, all_params = _build_wardrobe_query(user_id, [], [], [])
            items_raw = await _load_candidates(
                container=container,
                query=all_query,
                parameters=all_params,
            )
    except Exception as exc:
        logger.warning("Wardrobe search error for user %s: %s", user_id, exc)
        return "Could not access the wardrobe at this time."

    # Score and rank items by how many expanded terms they match
    scored = [(item, _score_item(item, terms)) for item in items_raw]
    scored.sort(key=lambda x: x[1], reverse=True)

    matched = [_compact(item) for item, score in scored if score > 0][:_SEARCH_LIMIT]

    if not matched:
        # Return all items so the LLM can reason about what's available
        all_compact = [_compact(i) for i in items_raw[:_SEARCH_LIMIT]]
        if not all_compact:
            return "The wardrobe is empty."
        return (
            f"No items closely matched '{query}', but here are all wardrobe items so you "
            f"can identify the closest match:\n" + json.dumps(all_compact, ensure_ascii=False)
        )

    return json.dumps(matched, ensure_ascii=False)


@tool
async def get_wardrobe_summary(config: RunnableConfig) -> str:
    """
    Get a high-level summary of the user's wardrobe: total item count, breakdown
    by category, and the most common colours. Use this for an overview before
    drilling into specifics with search_wardrobe.
    """
    user_id = _require_user_id(config)

    try:
        container = get_wardrobe_container()
        all_items = []
        async for item in container.query_items(
            query="SELECT c.category, c.colours FROM c WHERE c.userId = @userId",
            parameters=[{"name": "@userId", "value": user_id}],
        ):
            all_items.append(item)
    except Exception as exc:
        logger.warning("Wardrobe summary error for user %s: %s", user_id, exc)
        return "Could not retrieve wardrobe summary."

    if not all_items:
        return "The wardrobe is empty — no items have been uploaded yet."

    categories: Counter = Counter()
    colour_names: Counter = Counter()

    for item in all_items:
        cat = item.get("category") or "uncategorised"
        categories[cat.lower()] += 1
        for c in item.get("colours") or []:
            name = c.get("name") if isinstance(c, dict) else str(c)
            if name:
                colour_names[name.lower()] += 1

    summary = {
        "total_items": len(all_items),
        "by_category": dict(categories.most_common(15)),
        "top_colours": dict(colour_names.most_common(10)),
    }

    return json.dumps(summary, ensure_ascii=False)
