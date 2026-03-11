"""
LLM-based CSS selector config generator for brand site scrapers.

Called ONCE when a user suggests a new brand — never at scrape time.
The LLM analyses the site's listing page HTML and produces a structured
SelectorConfig that the generic brand_scraper.py uses on every subsequent run.

Cost impact: one GPT-4.1-mini call per new brand, ~500–1000 tokens.
After that, scraping is deterministic and free of LLM calls.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Optional

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI

from ..url_security import validate_public_https_url

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
_FETCH_TIMEOUT = 20.0
# Keep HTML small — strip scripts/styles and truncate to this many chars
_HTML_CHAR_LIMIT = 12_000


def _get_env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Missing env var: {name}")
    return v


def _build_llm() -> AzureChatOpenAI:
    return AzureChatOpenAI(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
        api_version="2024-12-01-preview",
        temperature=0.0,
        max_tokens=800,
    )


# ── HTML fetching and cleaning ────────────────────────────────────────────────

def _fetch_html(url: str) -> str:
    """Fetch the listing page HTML, stripping scripts/styles/SVGs."""
    safe_url = validate_public_https_url(url)
    try:
        resp = httpx.get(safe_url, headers=_HEADERS, timeout=_FETCH_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
        html = resp.text
    except Exception as exc:
        raise RuntimeError(f"Could not fetch {safe_url}: {exc}") from exc

    # Strip noisy tags
    for tag in ("script", "style", "svg", "noscript", "iframe"):
        html = re.sub(rf"<{tag}[^>]*>.*?</{tag}>", " ", html, flags=re.DOTALL | re.IGNORECASE)

    # Collapse whitespace
    html = re.sub(r"\s+", " ", html).strip()

    # Truncate — the LLM only needs enough to identify the product grid pattern
    return html[:_HTML_CHAR_LIMIT]


# ── LLM prompt ────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a web scraping expert. Analyse the provided HTML snippet from a fashion brand's
product listing page and identify CSS selectors for extracting product data.

Return ONLY a valid JSON object with these keys (use null if a selector cannot be found):
{
  "productContainer": "<CSS selector for a single product card>",
  "title":            "<selector for product name, relative to container>",
  "price":            "<selector for price, relative to container>",
  "imageUrl":         "<selector for the main product image (img tag or background)>",
  "imageAttr":        "<attribute holding the image URL: 'src', 'data-src', 'data-lazy', etc.>",
  "productUrl":       "<selector for link to product detail page (a tag)>",
  "pagination":       {"type": "scroll"|"click"|"none", "nextSelector": "<selector or null>"},
  "notes":            "<brief note on any caveats or JS-rendered content>"
}

Rules:
- Selectors must be standard CSS (not XPath).
- If the page is fully JS-rendered and no products are visible in the HTML, set
  productContainer to null and note this in the notes field.
- Be conservative — prefer more specific selectors over broad ones.
- Return ONLY the JSON object, no markdown fences, no explanation.
"""


def _parse_llm_json(text: str) -> dict:
    """Extract the JSON object from the LLM response (strips stray markdown)."""
    # Strip ```json ... ``` if present
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    return json.loads(text)


# ── Public API ────────────────────────────────────────────────────────────────

def generate_selector_config(url: str, brand_name: str) -> dict:
    """
    Fetch *url*, pass the HTML to GPT-4.1-mini, and return a SelectorConfig dict.

    Raises RuntimeError if the page cannot be fetched or the LLM response
    cannot be parsed as valid JSON.

    This function is synchronous — call it via run_in_executor from async routes.
    """
    logger.info("Generating selector config for %s (%s)", brand_name, url)

    html = _fetch_html(url)
    logger.debug("Fetched %d chars of HTML from %s", len(html), url)

    llm = _build_llm()
    messages = [
        SystemMessage(content=_SYSTEM_PROMPT),
        HumanMessage(content=(
            f"Brand: {brand_name}\n"
            f"URL: {url}\n\n"
            f"HTML snippet:\n{html}"
        )),
    ]

    try:
        response = llm.invoke(messages)
        raw = response.content.strip()
    except Exception as exc:
        raise RuntimeError(f"LLM call failed for {brand_name}: {exc}") from exc

    logger.debug("LLM raw response for %s: %s", brand_name, raw[:500])

    try:
        config = _parse_llm_json(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Could not parse LLM response as JSON for {brand_name}: {exc}\nRaw: {raw[:300]}"
        ) from exc

    # Always record provenance
    config["sourceUrl"] = url
    config["generatedByLLM"] = True

    logger.info(
        "Config for %s: productContainer=%s, notes=%s",
        brand_name,
        config.get("productContainer"),
        config.get("notes"),
    )
    return config
