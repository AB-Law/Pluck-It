"""
Sitemap Seeder.

One-time HTTP-triggered utility that bootstraps the Moods container by
scraping a larger corpus of past fashion articles from publication sitemaps
(rather than just the latest RSS entries).

Supports both sitemap index files and regular urlset sitemaps.
Google News sitemap <news:title> is used when available; otherwise a human-
readable title is derived from the URL slug.

Usage (via HTTP trigger):
  POST /api/admin/seed-moods
  Body (optional JSON): {"months_back": 3}
"""

import logging
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ── Sitemap sources ───────────────────────────────────────────────────────────

SITEMAP_SOURCES: list[dict[str, str]] = [
    {"name": "Vogue",           "url": "https://www.vogue.com/sitemap.xml"},
    {"name": "Harper's Bazaar", "url": "https://www.harpersbazaar.com/sitemap.xml"},
    {"name": "Who What Wear",   "url": "https://www.whowhatwear.com/sitemap-articles.xml"},
    {"name": "The Cut",         "url": "https://www.thecut.com/sitemap.xml"},
    {"name": "Refinery29",      "url": "https://www.refinery29.com/en-us/sitemap.xml"},
]

# XML namespaces used in sitemap formats
_NS_SM   = "http://www.sitemaps.org/schemas/sitemap/0.9"
_NS_NEWS = "http://www.google.com/schemas/sitemap-news/0.9"

_MAX_ARTICLES_PER_SOURCE = 300   # hard cap per sitemap to prevent runaway scraping
_REQUEST_TIMEOUT_SECS    = 15


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch_xml(url: str) -> Optional[ET.Element]:
    """Fetch URL and parse response as XML. Returns root element or None."""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "PluckItMoodSeedBot/1.0 (fashion trend indexer)"},
        )
        with urllib.request.urlopen(req, timeout=_REQUEST_TIMEOUT_SECS) as resp:
            return ET.fromstring(resp.read())
    except Exception as exc:
        logger.warning("Failed to fetch '%s': %s", url, exc)
        return None


def _slug_to_title(url: str) -> str:
    """Derive a human-readable title from a URL slug."""
    path = url.rstrip("/").split("/")[-1]
    path = re.sub(r"\.[a-z]{2,5}$", "", path)       # strip extension
    path = re.sub(r"-\d{6,}$", "", path)             # strip trailing IDs
    return path.replace("-", " ").replace("_", " ").strip().title()


def _local_name(tag: str) -> str:
    """Strip XML namespace from a tag to get the local name."""
    return tag.split("}")[-1] if "}" in tag else tag


# ── Sitemap parsing ───────────────────────────────────────────────────────────

def _parse_sitemap(
    source_name: str,
    root: ET.Element,
    cutoff: datetime,
    collected: list[dict],
) -> None:
    """
    Recursively parse a sitemap XML root.
    Populates `collected` in place with article snippet dicts.
    Respects _MAX_ARTICLES_PER_SOURCE; stops early if limit reached.
    """
    tag = _local_name(root.tag)

    if tag == "sitemapindex":
        # Sitemap index — recurse into child sitemaps that fall within our window
        for sitemap_el in root.iter(f"{{{_NS_SM}}}sitemap"):
            if len(collected) >= _MAX_ARTICLES_PER_SOURCE:
                break
            loc_el     = sitemap_el.find(f"{{{_NS_SM}}}loc")
            lastmod_el = sitemap_el.find(f"{{{_NS_SM}}}lastmod")
            if loc_el is None or not loc_el.text:
                continue
            # Skip sitemaps whose lastmod is before the cutoff (fast-path)
            if lastmod_el is not None and lastmod_el.text:
                try:
                    mod = datetime.fromisoformat(lastmod_el.text[:10]).replace(tzinfo=timezone.utc)
                    if mod < cutoff:
                        continue
                except ValueError:
                    pass
            child = _fetch_xml(loc_el.text.strip())
            if child is not None:
                _parse_sitemap(source_name, child, cutoff, collected)

    elif tag == "urlset":
        for url_el in root.iter(f"{{{_NS_SM}}}url"):
            if len(collected) >= _MAX_ARTICLES_PER_SOURCE:
                break
            loc_el = url_el.find(f"{{{_NS_SM}}}loc")
            if loc_el is None or not loc_el.text:
                continue
            url = loc_el.text.strip()

            # Date filter
            lastmod_el = url_el.find(f"{{{_NS_SM}}}lastmod")
            published  = ""
            if lastmod_el is not None and lastmod_el.text:
                published = lastmod_el.text.strip()
                try:
                    pub = datetime.fromisoformat(published[:10]).replace(tzinfo=timezone.utc)
                    if pub < cutoff:
                        continue
                except ValueError:
                    pass

            # Prefer <news:title> when the publication uses Google News sitemaps
            news_title_el = url_el.find(
                f"{{{_NS_NEWS}}}news/{{{_NS_NEWS}}}title"
            )
            if news_title_el is not None and news_title_el.text:
                title = news_title_el.text.strip()
            else:
                title = _slug_to_title(url)

            if not title or len(title) < 5:
                continue

            collected.append({
                "title":     title,
                "summary":   "",   # sitemaps don't carry article body; title is sufficient
                "url":       url,
                "published": published,
                "source":    source_name,
            })


def scrape_sitemaps(months_back: int = 3) -> list[dict]:
    """
    Scrape all configured sitemap sources and return article snippets
    published within the last `months_back` months.
    """
    cutoff      = datetime.now(timezone.utc) - timedelta(days=30 * months_back)
    all_snippets: list[dict] = []

    for source in SITEMAP_SOURCES:
        root = _fetch_xml(source["url"])
        if root is None:
            continue
        source_snippets: list[dict] = []
        _parse_sitemap(source["name"], root, cutoff, source_snippets)
        logger.info(
            "Sitemap '%s': %d articles since %s.",
            source["name"], len(source_snippets), cutoff.date(),
        )
        all_snippets.extend(source_snippets)

    logger.info("Sitemap scrape complete: %d total articles.", len(all_snippets))
    return all_snippets


# ── Entry point ───────────────────────────────────────────────────────────────

def run_sitemap_seeder(months_back: int = 3) -> dict:
    """
    Entry point for the HTTP-triggered one-time sitemap seeder.

    Scrapes configured sitemaps for the past `months_back` months, then
    runs the full mood extraction → dedup → canonicalization → upsert pipeline.

    Returns {"seeded": <int>, "snippets_processed": <int>}.
    """
    from .mood_processor import run_from_snippets

    logger.info("Sitemap seeder starting (months_back=%d).", months_back)

    snippets = scrape_sitemaps(months_back)
    if not snippets:
        logger.warning("Sitemap seeder: no articles scraped — nothing to do.")
        return {"seeded": 0, "snippets_processed": 0}

    saved = run_from_snippets(snippets)
    return {"seeded": saved, "snippets_processed": len(snippets)}
