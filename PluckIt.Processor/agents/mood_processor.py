"""
Mood Processor Engine.

Scrapes curated fashion RSS feeds daily, extracts fashion mood signals from
article titles and summaries using an LLM, and persists structured Mood Objects
into the Cosmos DB Moods container.

Mood Object schema (Cosmos document):
  {
    "id":             "<primaryMood_lower>-<slug>",
    "primaryMood":    "Minimalist",
    "name":           "Quiet Luxury",
    "subMoods":       ["Understated", "Earthy"],
    "description":    "...",
    "moodSignals": {
      "colorPalette":  ["cream", "camel", "stone"],
      "patterns":      ["solid", "subtle texture"],
      "silhouettes":   ["relaxed tailoring", "wide-leg"],
      "fabrics":       ["cashmere", "linen", "silk"],
      "keyPieces":     ["cashmere turtleneck", "wide-leg trousers"]
    },
    "sources":        [{"title", "url", "publishedAt", "source"}, ...],
    "nameEmbedding":  [float, ...],
    "detectedAt":     "<ISO>",
    "updatedAt":      "<ISO>",
    "trendScore":     3
  }

Primary mood categories (fixed vocabulary):
  Minimalist, Maximalist, Romantic, Edgy, Preppy, Bohemian,
  Sporty, Classic, Streetwear, Coastal, Cottagecore, Dark Academia

Cross-run name consistency:
  1. Mood names embedded with text-embedding-3-small.
  2. Within-run: chunks with cos-sim >= 0.88 + same primaryMood merged.
  3. DB canonicalization:
     - cos-sim >= 0.92  : auto-rename, no LLM call
     - 0.85 <= sim < 0.92: mini LLM confirms + may improve description
     - cos-sim < 0.85   : new distinct mood
"""

import json
import logging
import asyncio
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

import feedparser
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings

from .db import get_moods_container

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

RSS_FEEDS: list[dict[str, str]] = [
    {"name": "Vogue",           "url": "https://www.vogue.com/feed/rss"},
    {"name": "Who What Wear",   "url": "https://www.whowhatwear.com/rss"},
    {"name": "The Cut",         "url": "https://www.thecut.com/rss"},
    {"name": "Refinery29",      "url": "https://www.refinery29.com/rss"},
    {"name": "Harper's Bazaar", "url": "https://www.harpersbazaar.com/rss"},
]

_MAX_ENTRIES_PER_FEED   = 50
_CHUNK_SIZE             = 25
_MAX_EXTRACTION_WORKERS = 5

_SIM_AUTO       = 0.92
_SIM_CHECK      = 0.85
_SIM_WITHIN_RUN = 0.88

PRIMARY_MOODS = [
    "Minimalist", "Maximalist", "Romantic", "Edgy", "Preppy",
    "Bohemian", "Sporty", "Classic", "Streetwear", "Coastal",
    "Cottagecore", "Dark Academia",
]


# ── Builders ──────────────────────────────────────────────────────────────────

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
        max_tokens=1500,
    )


def _build_confirm_llm() -> AzureChatOpenAI:
    """Mini model at temperature=0 used for canonicalization confirmation."""
    return AzureChatOpenAI(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
        api_version="2024-12-01-preview",
        temperature=0.0,
        max_tokens=200,
    )


def _build_embedder() -> AzureOpenAIEmbeddings:
    return AzureOpenAIEmbeddings(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small"),
        api_version="2023-05-15",
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot   = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0


def _mood_id(primary_mood: str, name: str) -> str:
    slug = name.lower().replace(" ", "-").replace("/", "-")
    return f"{primary_mood.lower()}-{slug}"


# ── Feed scraping ─────────────────────────────────────────────────────────────

def scrape_feeds() -> list[dict]:
    snippets: list[dict] = []
    for feed_cfg in RSS_FEEDS:
        try:
            parsed  = feedparser.parse(feed_cfg["url"])
            entries = parsed.entries[:_MAX_ENTRIES_PER_FEED]
            for entry in entries:
                title     = str(getattr(entry, "title",     "") or "")
                summary   = str(getattr(entry, "summary",   "") or "")
                url       = str(getattr(entry, "link",      "") or "")
                published = str(getattr(entry, "published", "") or "")
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


# ── LLM extraction ────────────────────────────────────────────────────────────

def _extraction_prompt(chunk_snippets: list[dict]) -> str:
    primary_moods_str = ", ".join(PRIMARY_MOODS)
    articles_text = "\n\n".join(
        f"[{i + 1}] {s['title']}\n{s['summary']}"
        for i, s in enumerate(chunk_snippets)
    )
    return f"""You are a fashion trend analyst for a wardrobe styling app.

Analyze the following fashion article snippets and identify distinct fashion MOODS.

PRIMARY MOOD CATEGORIES (use ONLY these): {primary_moods_str}

For each mood, output one JSON object with these exact fields:
- "name": concise mood name (2-4 words, e.g. "Quiet Luxury")
- "primaryMood": one of the primary categories above
- "subMoods": list of 2-4 specific style tags
- "description": 1-2 sentence description
- "moodSignals": object with keys:
    "colorPalette" (3-5 colours), "patterns" (list), "silhouettes" (list),
    "fabrics" (list), "keyPieces" (3-5 garments/accessories)
- "articleIndices": 1-based list of articles referencing this mood

Rules:
- Identify 2-6 distinct moods from these articles only.
- Do NOT invent moods not in the text.
- Merge articles about the same mood.
- Return ONLY a valid JSON array. No markdown, no explanation.

Articles:
{articles_text}

Output:"""


def _extract_chunk(chunk_snippets: list[dict], chunk_idx: int, llm: AzureChatOpenAI) -> list[dict]:
    if not chunk_snippets:
        return []
    try:
        response = llm.invoke([
            SystemMessage(content="You are an expert fashion trend analyst. Output only valid JSON."),
            HumanMessage(content=_extraction_prompt(chunk_snippets)),
        ])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        moods = json.loads(raw)
        if not isinstance(moods, list):
            logger.error("Chunk %d: LLM returned non-list (%s).", chunk_idx, type(moods))
            return []

        for mood in moods:
            indices  = mood.pop("articleIndices", []) or []
            resolved = []
            for idx in indices:
                if 1 <= idx <= len(chunk_snippets):
                    s = chunk_snippets[idx - 1]
                    resolved.append({
                        "title":       s["title"],
                        "url":         s["url"],
                        "publishedAt": s["published"],
                        "source":      s["source"],
                    })
            mood["resolvedSources"] = resolved
        return moods

    except Exception as exc:
        logger.error("Chunk %d extraction error: %s", chunk_idx, exc)
        return []


def _extract_all_parallel(snippets: list[dict], llm: AzureChatOpenAI) -> list[dict]:
    chunks    = [snippets[i:i + _CHUNK_SIZE] for i in range(0, len(snippets), _CHUNK_SIZE)]
    all_moods: list[dict] = []
    logger.info("Extracting moods from %d articles in %d chunks.", len(snippets), len(chunks))
    with ThreadPoolExecutor(max_workers=min(len(chunks), _MAX_EXTRACTION_WORKERS)) as pool:
        futures = {pool.submit(_extract_chunk, chunk, i, llm): i for i, chunk in enumerate(chunks)}
        for future in as_completed(futures):
            all_moods.extend(future.result())
    logger.info("Extraction complete: %d raw moods.", len(all_moods))
    return all_moods


# ── Within-run deduplication ──────────────────────────────────────────────────

def _append_unique_sources(target: dict, source: dict) -> None:
    seen_urls = {entry.get("url") for entry in target.get("resolvedSources", []) if entry.get("url")}
    for source_entry in source.get("resolvedSources", []):
        url = source_entry.get("url")
        if not url or url in seen_urls:
            continue
        target.setdefault("resolvedSources", []).append(source_entry)
        seen_urls.add(url)


def _dedup_primary_bucket(
    indices: list[int],
    moods: list[dict],
    embeddings: list[list[float]],
    merged_into: dict[int, int],
) -> None:
    for position, base_idx in enumerate(indices):
        if base_idx in merged_into:
            continue

        base_emb = embeddings[base_idx]
        if not base_emb:
            continue

        candidate_indices = [
            candidate_idx for candidate_idx in indices[position + 1 :]
            if candidate_idx not in merged_into and embeddings[candidate_idx]
        ]
        for candidate_idx in candidate_indices:
            similarity = _cosine_similarity(base_emb, embeddings[candidate_idx])
            if similarity < _SIM_WITHIN_RUN:
                continue

            merged_into[candidate_idx] = base_idx
            _append_unique_sources(moods[base_idx], moods[candidate_idx])
            logger.debug(
                "Within-run merge: '%s' + '%s' (sim=%.3f)",
                moods[base_idx]["name"], moods[candidate_idx]["name"], similarity,
            )


def _dedup_within_run(
    moods: list[dict],
    embedder: AzureOpenAIEmbeddings,
) -> tuple[list[dict], list[list[float]]]:
    if not moods:
        return [], []
    names = [m["name"] for m in moods]
    try:
        embeddings: list[list[float]] = embedder.embed_documents(names)
    except Exception as exc:
        logger.error("Within-run dedup: batch embedding failed: %s", exc)
        return moods, [[] for _ in moods]

    merged_into: dict[int, int] = {}
    indices_by_primary: dict[Optional[str], list[int]] = {}
    for idx, mood in enumerate(moods):
        indices_by_primary.setdefault(mood.get("primaryMood"), []).append(idx)

    for indices in indices_by_primary.values():
        if len(indices) < 2:
            continue
        _dedup_primary_bucket(indices, moods, embeddings, merged_into)

    kept    = [(i, moods[i], embeddings[i]) for i in range(len(moods)) if i not in merged_into]
    deduped = [m for _, m, _ in kept]
    embs    = [e for _, _, e in kept]
    logger.info("Within-run dedup: %d -> %d moods.", len(moods), len(deduped))
    return deduped, embs


# ── DB canonicalization ───────────────────────────────────────────────────────

async def _load_existing_moods_with_embeddings(
    primary_mood: str,
    container,
    embedder: AzureOpenAIEmbeddings,
) -> list[dict]:
    """Load prior moods and ensure name embeddings are available."""
    try:
        items = [item async for item in container.query_items(
            query="SELECT c.id, c.name, c.description, c.primaryMood, c.nameEmbedding FROM c",
            partition_key=primary_mood,
        )]
    except Exception as exc:
        logger.warning("Could not load existing moods for '%s': %s", primary_mood, exc)
        return []

    missing_idx = [i for i, item in enumerate(items) if not item.get("nameEmbedding")]
    if missing_idx:
        try:
            new_embs = embedder.embed_documents([items[i]["name"] for i in missing_idx])
            for i, emb in zip(missing_idx, new_embs):
                items[i]["nameEmbedding"] = emb
                try:
                    full_doc = await container.read_item(item=items[i]["id"], partition_key=primary_mood)
                    full_doc["nameEmbedding"] = emb
                    await container.upsert_item(full_doc)
                except Exception as bf_exc:
                    logger.debug("Embedding backfill for '%s' skipped: %s", items[i]["name"], bf_exc)
        except Exception as exc:
            logger.warning("Batch embedding backfill for '%s' failed: %s", primary_mood, exc)

    return [item for item in items if item.get("nameEmbedding")]


def _canonicalize_against_db(
    mood_data: dict,
    name_embedding: list[float],
    existing_moods: list[dict],
    confirm_llm: AzureChatOpenAI,
) -> dict:
    if not existing_moods or not name_embedding:
        return mood_data

    best_sim      = 0.0
    best_existing: Optional[dict] = None
    for existing in existing_moods:
        stored_emb = existing.get("nameEmbedding")
        if not stored_emb:
            continue
        sim = _cosine_similarity(name_embedding, stored_emb)
        if sim > best_sim:
            best_sim      = sim
            best_existing = existing

    if best_existing is None or best_sim < _SIM_CHECK:
        return mood_data

    existing_name = best_existing["name"]
    new_name      = mood_data["name"]

    if best_sim >= _SIM_AUTO:
        logger.info("Auto-canonicalized '%s' -> '%s' (sim=%.3f).", new_name, existing_name, best_sim)
        mood_data["name"] = existing_name
        return mood_data

    # 0.85-0.92 range: ask mini LLM to confirm
    try:
        check_prompt = (
            f"Compare these two fashion mood names:\n"
            f"  A: \"{existing_name}\" - {best_existing.get('description', '')}\n"
            f"  B: \"{new_name}\" - {mood_data.get('description', '')}\n"
            f"Both categorized as '{mood_data['primaryMood']}'.\n\n"
            f"Are A and B the same fashion aesthetic? "
            f'Output ONLY valid JSON: {{"same": true|false, "betterDescription": "<improved 1-2 sentence desc if same, else null>"}}'
        )
        resp = confirm_llm.invoke([
            SystemMessage(content="Fashion trend expert. Output only valid JSON."),
            HumanMessage(content=check_prompt),
        ])
        raw = resp.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        result      = json.loads(raw)
        is_same     = bool(result.get("same", False))
        better_desc = result.get("betterDescription") or None
        logger.info(
            "LLM check '%s' vs '%s': same=%s (sim=%.3f).", existing_name, new_name, is_same, best_sim,
        )
    except Exception as exc:
        logger.warning(
            "LLM canonicalization check failed for '%s': %s - treating as same.", new_name, exc,
        )
        is_same     = True
        better_desc = None

    if not is_same:
        return mood_data

    mood_data["name"] = existing_name
    if better_desc:
        mood_data["description"] = better_desc
    return mood_data


# ── Persistence ───────────────────────────────────────────────────────────────

async def upsert_mood(mood_data: dict, name_embedding: list[float], container) -> dict:
    """Persist a single mood upsert asynchronously, preserving merge behavior."""
    primary_mood     = mood_data.get("primaryMood", "Classic")
    name             = mood_data.get("name", "Unknown")
    doc_id           = _mood_id(primary_mood, name)
    resolved_sources = mood_data.get("resolvedSources") or []
    now_iso          = datetime.now(timezone.utc).isoformat()

    existing_score       = 0
    existing_sources: list[dict] = []
    existing_detected_at = now_iso
    try:
        existing             = await container.read_item(item=doc_id, partition_key=primary_mood)
        existing_score       = existing.get("trendScore", 0)
        existing_sources     = existing.get("sources") or []
        existing_detected_at = existing.get("detectedAt", now_iso)
    except Exception as read_exc:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError
        if not isinstance(read_exc, CosmosResourceNotFoundError):
            logger.error("Cosmos read failed for '%s' (non-404): %s — aborting upsert.", doc_id, read_exc)
            raise

    seen_urls      = {s["url"] for s in existing_sources if s.get("url")}
    merged_sources = existing_sources + [s for s in resolved_sources if s.get("url") not in seen_urls]

    document = {
        "id":            doc_id,
        "primaryMood":   primary_mood,
        "name":          name,
        "subMoods":      mood_data.get("subMoods") or [],
        "description":   mood_data.get("description", ""),
        "moodSignals":   mood_data.get("moodSignals") or {},
        "sources":       merged_sources[:20],
        "nameEmbedding": name_embedding,
        "detectedAt":    existing_detected_at,
        "updatedAt":     now_iso,
        "trendScore":    existing_score + len(resolved_sources),
    }

    await container.upsert_item(document)
    return document


# ── Shared pipeline ───────────────────────────────────────────────────────────

async def run_from_snippets_async(snippets: list[dict]) -> int:
    """
    Async pipeline shared by the daily timer and the sitemap seeder.
    Returns the number of mood documents saved.
    """
    if not snippets:
        logger.warning("run_from_snippets: empty snippet list.")
        return 0

    llm         = _build_llm()
    confirm_llm = _build_confirm_llm()
    embedder    = _build_embedder()
    container   = get_moods_container()

    all_moods = _extract_all_parallel(snippets, llm)
    if not all_moods:
        logger.warning("No moods extracted from %d snippets.", len(snippets))
        return 0

    deduped, embeddings = _dedup_within_run(all_moods, embedder)

    filtered_deduped: list[dict] = []
    filtered_embeddings: list[list[float]] = []
    for mood_data, name_embedding in zip(deduped, embeddings):
        primary = mood_data.get("primaryMood", "")
        if primary not in PRIMARY_MOODS:
            logger.warning("Unknown primaryMood '%s' for '%s' - skipping.", primary, mood_data.get("name"))
            continue
        filtered_deduped.append(mood_data)
        filtered_embeddings.append(name_embedding)

    deduped = filtered_deduped
    embeddings = filtered_embeddings

    unique_primaries = {m["primaryMood"] for m in deduped if m.get("primaryMood") in PRIMARY_MOODS}
    existing_by_primary: dict[str, list[dict]] = {}
    for primary in unique_primaries:
        existing_by_primary[primary] = await _load_existing_moods_with_embeddings(primary, container, embedder)

    canonicalized_indices: list[int] = []
    canonicalized_names: list[str] = []
    for idx, (mood_data, name_embedding) in enumerate(zip(deduped, embeddings)):
        primary = mood_data.get("primaryMood", "")
        original_name = mood_data["name"]
        mood_data = _canonicalize_against_db(
            mood_data, name_embedding, existing_by_primary.get(primary, []), confirm_llm,
        )

        if mood_data["name"] != original_name:
            canonicalized_indices.append(idx)
            canonicalized_names.append(mood_data["name"])

    if canonicalized_names:
        try:
            new_embeddings = embedder.embed_documents(canonicalized_names)
            if len(new_embeddings) != len(canonicalized_indices):
                logger.warning(
                    "Canonicalized mood re-embed count mismatch: got %d embeddings for %d names.",
                    len(new_embeddings),
                    len(canonicalized_indices),
                )
            else:
                for idx, name_embedding in zip(canonicalized_indices, new_embeddings, strict=True):
                    embeddings[idx] = name_embedding
        except Exception as exc:
            logger.debug("Batch re-embed after canonicalization failed: %s", exc)

    saved = 0
    for mood_data, name_embedding in zip(deduped, embeddings, strict=True):
        try:
            await upsert_mood(mood_data, name_embedding, container)
            saved += 1
        except Exception as exc:
            logger.error("Failed to upsert '%s': %s", mood_data.get("name"), exc)

    logger.info("run_from_snippets complete - %d/%d moods saved.", saved, len(deduped))
    return saved


def run_from_snippets(snippets: list[dict]) -> int:
    """
    Core pipeline shared by the daily timer and the sitemap seeder.
    Returns the number of mood documents saved.
    """
    return asyncio.run(run_from_snippets_async(snippets))


# ── Timer trigger entry point ─────────────────────────────────────────────────

def run_mood_processor() -> None:
    """Entry point called by the daily timer trigger."""
    logger.info("Mood processor starting (daily RSS run).")
    snippets = scrape_feeds()
    if not snippets:
        logger.warning("No snippets scraped - aborting.")
        return
    run_from_snippets(snippets)
