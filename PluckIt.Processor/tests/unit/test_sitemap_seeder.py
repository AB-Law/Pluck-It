"""
Unit tests for sitemap seeder parsing and orchestration helpers.
"""

import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from unittest.mock import patch

from agents.sitemap_seeder import (
    _is_within_cutoff,
    _parse_sitemap_index,
    _parse_urlset,
    _slug_to_title,
    run_sitemap_seeder,
    scrape_sitemaps,
)


def test_slug_to_title_strips_extension_and_suffix() -> None:
    slug = _slug_to_title("https://example.com/fashion/denim-mini-collection-123456")
    assert slug == "Denim Mini Collection"


def test_is_within_cutoff_handles_empty_and_invalid_dates() -> None:
    cutoff = datetime(2026, 3, 10, tzinfo=timezone.utc)

    assert _is_within_cutoff(None, cutoff) is True
    assert _is_within_cutoff("not-a-date", cutoff) is True
    assert _is_within_cutoff("2026-03-09", cutoff) is False
    assert _is_within_cutoff("2026-03-11", cutoff) is True


def test_parse_urlset_collects_news_title_and_skips_old_entries() -> None:
    xml = """
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
            xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
      <url>
        <loc>https://example.com/fashion/bright-layers</loc>
        <news:news><news:title>Bright Layers</news:title></news:news>
      </url>
      <url>
        <loc>https://example.com/fashion/low-activity</loc>
        <lastmod>2025-01-01</lastmod>
      </url>
      <url>
        <loc>https://example.com/fashion/modern-tailoring</loc>
        <lastmod>2026-03-11</lastmod>
      </url>
    </urlset>
    """
    root = ET.fromstring(xml)
    collected: list[dict] = []
    cutoff = datetime(2026, 3, 10, tzinfo=timezone.utc)

    _parse_urlset("Fashion", root, cutoff, collected)

    assert len(collected) == 2
    assert collected[0]["title"] == "Bright Layers"
    assert collected[1]["title"] == "Modern Tailoring"


def test_parse_sitemap_index_parses_child_sitemaps() -> None:
    index_xml = """
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap>
        <loc>https://example.com/chunk-1.xml</loc>
      </sitemap>
      <sitemap>
        <loc>https://example.com/chunk-2.xml</loc>
      </sitemap>
    </sitemapindex>
    """
    child_xml = """
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url>
        <loc>https://example.com/fashion/chunked-article</loc>
        <lastmod>2026-03-11</lastmod>
      </url>
    </urlset>
    """
    root = ET.fromstring(index_xml)
    child_root = ET.fromstring(child_xml)

    with patch("agents.sitemap_seeder._fetch_xml", side_effect=[child_root, child_root]):
        collected: list[dict] = []
        _parse_sitemap_index("Fashion", root, datetime(2026, 3, 10, tzinfo=timezone.utc), collected)

    assert len(collected) == 2
    assert collected[0]["url"] == "https://example.com/fashion/chunked-article"
    assert collected[1]["url"] == "https://example.com/fashion/chunked-article"


def test_scrape_sitemaps_returns_empty_when_sources_unavailable() -> None:
    with patch("agents.sitemap_seeder._fetch_xml", return_value=None):
        result = scrape_sitemaps(3)
    assert result == []


def test_run_sitemap_seeder_uses_ingestion_summary() -> None:
    with patch("agents.sitemap_seeder.scrape_sitemaps", return_value=[{"title": "one", "published": "", "url": "https://example.com/a", "source": "x"}]):
        with patch("agents.mood_processor.run_from_snippets", return_value=5) as run_from_snippets:
            result = run_sitemap_seeder(months_back=3)

    run_from_snippets.assert_called_once_with([{"title": "one", "published": "", "url": "https://example.com/a", "source": "x"}])
    assert result == {"seeded": 5, "snippets_processed": 1}


def test_run_sitemap_seeder_returns_zero_when_nothing_to_process() -> None:
    with patch("agents.sitemap_seeder.scrape_sitemaps", return_value=[]):
        result = run_sitemap_seeder(months_back=2)

    assert result == {"seeded": 0, "snippets_processed": 0}

