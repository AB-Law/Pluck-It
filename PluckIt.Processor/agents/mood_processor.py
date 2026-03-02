"""
Mood Processor Engine.

Scrapes curated fashion RSS feeds daily, extracts fashion mood signals from
article titles and summaries using an LLM, and persists structured Mood Objects
into the Cosmos DB Moods container.

Mood Object schema (Cosmos document):
  {
    "id":           "<primaryMood>-<slug>",   -- partition key = primaryMood
    "primaryMood":  "Minimalist",             -- top-level mood category
    "name":         "Quiet Luxury",           -- specific mood name
    "subMoods":     ["Understated", "Earthy"],
    "description":  "...",
    "moodSignals": {
      "colorPalette":  ["cream", "camel", "stone"],
      "patterns":      ["solid", "subtle texture"],
      "silhouettes":   ["relaxed tailoring", "wide-leg"],
      "fabrics":       ["cashmere", "linen", "silk"],
      "keyPieces":     ["cashmere turtleneck", "wide-leg trousers"]
    },
    "sources": [
      {"title": "...", "url": "...", "publishedAt": "..."}
    ],
    "detectedAt":   "<ISO>",
    "updatedAt":    "<ISO>",
    "trendScore":   3   -- number of sources that mention this mood
  }

Primary mood categories (fixed vocabulary — prevents unbounded proliferation):
  Minimalist, Maximalist, Romantic, Edgy, Preppy, Bohemian,
  Sporty, Classic, Streetwear, Coastal, Cottagecore, Dark Academia
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import feedparser
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI

from .db import get_moods_container_sync

logger = logging.getLogger(__name__)

# ── RSS feeds to scrape ───────────────────────────────────────────────────────

RSS_FEEDS: list[dict[str, str]] = [
    {"name": "Vogue",          "url": "https://www.vogue.com/feed/rss"},
    {"name": "Who What Wear",  "url": "https://www.whowhatwear.com/rss"},
    {"name": "The Cut",        "url": "https://www.thecut.com/rss"},
    {"name": "Refinery29",     "url": "https://www.refinery29.com/rss"},
    {"name": "Harper's Bazaar","url": "https://www.harpersbazaar.com/rss"},
]

# Number of entries to read per feed (keeps LLM input bounded)
_MAX_ENTRIES_PER_FEED = 20

# Fixed vocabulary of primary moods — prevents the LLM from inventing new ones.
PRIMARY_MOODS = [
    "Minimalist", "Maximalist", "Romantic", "Edgy", "Preppy",
    "Bohemian", "Sporty", "Classic", "Streetwear", "Coastal",
    "Cottagecore", "Dark Academia",
]


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
        temperature=0.3,
        max_tokens=800,
    )


def _mood_id(primary_mood: str, name: str) -> str:
    """Deterministic document ID derived from primaryMood + name."""
    slug = name.lower().replace(" ", "-").replace("/", "-")
    return f"{primary_mood.lower()}-{slug}"


# ── Feed scraping ─────────────────────────────────────────────────────────────

def scrape_feeds() -> list[dict]:
    """
    Fetch all configured RSS feeds and return a flat list of article snippets.
    Each entry: {"title", "summary", "url", "published", "source"}.
    """
    snippets: list[dict] = []
    for feed_cfg in RSS_FEEDS:
        try:
            parsed = feedparser.parse(feed_cfg["url"])
            entries = parsed.entries[:_MAX_ENTRIES_PER_FEED]
            for entry in entries:
                title = getattr(entry, "title", "") or ""
                summary = getattr(entry, "summary", "")
                url = getattr(entry, "link", "") or ""
                published = getattr(entry, "published", "") or ""
                # Skip entries that are clearly not fashion-trend articles
                if not title.strip():
                    continue
                snippets.append({
                    "title":     title.strip(),
                    "summary":   summary[:400].strip(),
                    "url":       url,
                    "published": published,
                    "source":    feed_cfg["name"],
                })
        except Exception as exc:
            logger.warning("Failed to scrape feed '%s': %s", feed_cfg["name"], exc)

    logger.info("Scraped %d article snippets from %d feeds.", len(snippets), len(RSS_FEEDS))
    return snippets


# ── LLM mood extraction ───────────────────────────────────────────────────────

def extract_moods_from_snippets(snippets: list[dict]) -> list[dict]:
    """
    Call the LLM once with a batch of article snippets and return a list of
    extracted Mood Objects (without Cosmos metadata).
    """
    if not snippets:
        return []

    articles_text = "\n\n".join(
        f"[{i+1}] {s['title']}\n{s['summary']}"
        for i, s in enumerate(snippets)
    )

    primary_moods_str = ", ".join(PRIMARY_MOODS)

    prompt = f"""You are a fashion trend analyst for a wardrobe styling app.

Analyze the following fashion article snippets and identify distinct fashion MOODS being discussed.

PRIMARY MOOD CATEGORIES (use ONLY these): {primary_moods_str}

For each mood you detect, produce one JSON object with these exact fields:
- "name": a concise human-readable mood name (2-4 words, e.g. "Quiet Luxury", "Coastal Grandmother")
- "primaryMood": one of the primary mood categories above
- "subMoods": list of 2-4 more specific mood tags (e.g. ["Understated", "Monochromatic"])
- "description": 1-2 sentence description of this aesthetic
- "moodSignals": object with:
    - "colorPalette": list of 3-5 colour names
    - "patterns": list of pattern/texture descriptors
    - "silhouettes": list of silhouette/fit descriptors
    - "fabrics": list of fabric names
    - "keyPieces": list of 3-5 specific garment/accessory examples
- "articleIndices": list of article numbers (1-based) that mention this mood

Rules:
- Identify 3-8 distinct moods total across all articles.
- Do NOT invent moods not supported by the text.
- If multiple articles describe the same mood, merge them into one object.
- Return ONLY a valid JSON array of mood objects, no other text.

Articles:
{articles_text}

Output:"""

    try:
        llm = _build_llm()
        response = llm.invoke([
            SystemMessage(content="You are an expert fashion trend analyst. Output only valid JSON."),
            HumanMessage(content=prompt),
        ])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        moods = json.loads(raw)
        if not isinstance(moods, list):
            logger.error("LLM returned non-list mood extraction: %s", type(moods))
            return []
        return moods
    except Exception as exc:
        logger.error("Mood extraction LLM error: %s", exc)
        return []


# ── Mood persistence ──────────────────────────────────────────────────────────

def upsert_mood(mood_data: dict, snippets: list[dict]) -> dict:
    """
    Build a full Mood document and upsert it into Cosmos.
    If an existing document with the same ID exists, increment trendScore
    and merge new sources.
    """
    primary_mood = mood_data.get("primaryMood", "Classic")
    name = mood_data.get("name", "Unknown")
    doc_id = _mood_id(primary_mood, name)

    # Resolve source articles for this mood
    article_indices = mood_data.get("articleIndices") or []
    sources = []
    for idx in article_indices:
        if 1 <= idx <= len(snippets):
            s = snippets[idx - 1]
            sources.append({
                "title":       s["title"],
                "url":         s["url"],
                "publishedAt": s["published"],
                "source":      s["source"],
            })

    container = get_moods_container_sync()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Try to load existing doc to merge trend score and sources
    existing_score = 0
    existing_sources: list[dict] = []
    try:
        existing = container.read_item(item=doc_id, partition_key=primary_mood)
        existing_score = existing.get("trendScore", 0)
        existing_sources = existing.get("sources") or []
    except Exception:
        pass  # New mood — no existing document

    # Deduplicate sources by URL
    seen_urls = {s["url"] for s in existing_sources if s.get("url")}
    merged_sources = existing_sources + [s for s in sources if s.get("url") not in seen_urls]

    document = {
        "id":          doc_id,
        "primaryMood": primary_mood,
        "name":        name,
        "subMoods":    mood_data.get("subMoods") or [],
        "description": mood_data.get("description", ""),
        "moodSignals": mood_data.get("moodSignals") or {},
        "sources":     merged_sources[:20],  # cap at 20 to keep document size bounded
        "detectedAt":  existing_sources[0].get("publishedAt") if existing_sources else now_iso,
        "updatedAt":   now_iso,
        "trendScore":  existing_score + len(sources),
    }

    container.upsert_item(document)
    return document


# ── Main entry point ──────────────────────────────────────────────────────────

def run_mood_processor() -> None:
    """
    Entry point for the daily timer trigger.
    1. Scrape RSS feeds.
    2. Extract moods with LLM.
    3. Upsert each mood into Cosmos.
    """
    logger.info("Mood processor starting.")

    snippets = scrape_feeds()
    if not snippets:
        logger.warning("No snippets scraped — aborting mood processing run.")
        return

    moods = extract_moods_from_snippets(snippets)
    if not moods:
        logger.warning("No moods extracted from snippets.")
        return

    saved = 0
    for mood_data in moods:
        # Validate primaryMood is in allowed vocabulary
        primary = mood_data.get("primaryMood", "")
        if primary not in PRIMARY_MOODS:
            logger.warning(
                "Mood '%s' has unknown primaryMood '%s' — skipping.",
                mood_data.get("name"), primary,
            )
            continue
        try:
            upsert_mood(mood_data, snippets)
            saved += 1
        except Exception as exc:
            logger.error("Failed to upsert mood '%s': %s", mood_data.get("name"), exc)

    logger.info("Mood processor complete — %d moods saved.", saved)
