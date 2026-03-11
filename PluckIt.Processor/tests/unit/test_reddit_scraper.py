"""
Unit tests for the Reddit scraper.

All HTTP calls are mocked — no real network requests.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from agents.scrapers.reddit_scraper import (
    RedditScraper,
    _extract_buy_links,
    _extract_tags_from_post,
    _is_direct_image,
    _extract_gallery_images,
)
from agents.scrapers.base import BuyLink


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_post(
    *,
    title="Fit check",
    url="https://i.redd.it/abc123.jpg",
    selftext="",
    score=200,
    permalink="/r/streetwear/comments/abc/fit_check/",
    is_gallery=False,
    media_metadata=None,
    link_flair_text=None,
    preview=None,
):
    post = {
        "title": title,
        "url": url,
        "selftext": selftext,
        "score": score,
        "permalink": permalink,
        "is_gallery": is_gallery,
        "id": "abc",
        "link_flair_text": link_flair_text,
    }
    if media_metadata:
        post["media_metadata"] = media_metadata
    if preview:
        post["preview"] = preview
    return post


def _reddit_listing(posts: list[dict]) -> dict:
    return {
        "data": {
            "children": [{"data": p} for p in posts]
        }
    }


# ── _is_direct_image ──────────────────────────────────────────────────────────

def test_is_direct_image_redd_it():
    assert _is_direct_image("https://i.redd.it/abc.jpg") is True


def test_is_direct_image_webp():
    assert _is_direct_image("https://i.redd.it/abc.webp") is True


def test_is_direct_image_preview_url_no_ext():
    # preview.redd.it URLs typically have no clean extension (token params)
    assert _is_direct_image("https://preview.redd.it/abc?width=640&s=tok") is False


def test_is_direct_image_reddit_link():
    assert _is_direct_image("https://www.reddit.com/r/streetwear/comments/abc/") is False


# ── _extract_buy_links (disabled) ─────────────────────────────────────────────

def test_extract_taobao_link():
    text = "Buy here: https://item.taobao.com/item.htm?id=123456789"
    links = _extract_buy_links(text)
    assert links == []


def test_extract_yupoo_link():
    text = "Album: https://mybrand.yupoo.com/albums/12345"
    links = _extract_buy_links(text)
    assert links == []


def test_extract_weidian_link():
    text = "Shop: https://weidian.com/item.html?itemID=9876"
    links = _extract_buy_links(text)
    assert links == []


def test_extract_multiple_links():
    text = (
        "Taobao: https://item.taobao.com/item.htm?id=111 "
        "Yupoo: https://store.yupoo.com/albums/999"
    )
    links = _extract_buy_links(text)
    assert links == []


def test_extract_no_links():
    assert _extract_buy_links("No links here, just text.") == []


def test_extract_deduplicates():
    url = "https://item.taobao.com/item.htm?id=123"
    text = f"{url} and again {url}"
    links = _extract_buy_links(text)
    assert links == []


# ── _extract_tags_from_post ───────────────────────────────────────────────────

def test_tags_from_subreddit():
    post = _make_post()
    tags = _extract_tags_from_post(post, "streetwear")
    assert "streetwear" in tags
    assert "urban" in tags


def test_tags_from_flair():
    post = _make_post(link_flair_text="Vintage")
    tags = _extract_tags_from_post(post, "malefashionadvice")
    assert "vintage" in tags


def test_tags_from_title_keyword():
    post = _make_post(title="Minimalist fit with linen shirt")
    tags = _extract_tags_from_post(post, "minimalism")
    assert "minimalist" in tags
    assert "linen" in tags


def test_tags_no_duplicates():
    post = _make_post(title="Streetwear fit check")
    tags = _extract_tags_from_post(post, "streetwear")
    assert len(tags) == len(set(tags))


# ── Gallery extraction ────────────────────────────────────────────────────────

def test_extract_gallery_images_valid():
    media_metadata = {
        "img1": {
            "status": "valid",
            "e": "Image",
            "s": {"u": "https://i.redd.it/gallery1.jpg", "x": 1080, "y": 1080},
            "p": [{"u": "https://preview.redd.it/gallery1.jpg?width=640&s=tok", "x": 640, "y": 640}],
        }
    }
    post = _make_post(is_gallery=True, media_metadata=media_metadata)
    results = _extract_gallery_images(post)
    assert len(results) == 1
    image_url, preview_url = results[0]
    assert "i.redd.it" in image_url       # direct URL stored
    assert "preview.redd.it" in preview_url  # preview URL for transient pHash only


def test_extract_gallery_skips_invalid():
    media_metadata = {
        "img1": {"status": "failed", "e": "Image", "s": {"u": "https://i.redd.it/x.jpg"}, "p": []},
    }
    post = _make_post(is_gallery=True, media_metadata=media_metadata)
    assert _extract_gallery_images(post) == []


# ── RedditScraper.scrape ──────────────────────────────────────────────────────

def _mock_httpx_response(data: dict):
    resp = MagicMock()
    resp.json.return_value = data
    resp.raise_for_status = MagicMock()
    return resp


def test_scrape_returns_items():
    posts = [
        _make_post(title="Clean fit", url="https://i.redd.it/clean.jpg", score=500),
        _make_post(title="Streetwear look", url="https://i.redd.it/sw.png", score=300),
    ]
    listing = _reddit_listing(posts)

    with patch("agents.scrapers.reddit_scraper.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get = MagicMock(return_value=_mock_httpx_response(listing))
        mock_client_cls.return_value = mock_client

        scraper = RedditScraper()
        items = scraper.scrape({"subreddit": "streetwear", "min_score": 100})

    assert len(items) == 2
    assert all(item.source_type == "reddit" for item in items)
    assert all("i.redd.it" in item.image_url for item in items)


def test_scrape_filters_low_score():
    posts = [
        _make_post(score=10),  # below min_score=100
        _make_post(title="High score", url="https://i.redd.it/high.jpg", score=500),
    ]
    listing = _reddit_listing(posts)

    with patch("agents.scrapers.reddit_scraper.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get = MagicMock(return_value=_mock_httpx_response(listing))
        mock_client_cls.return_value = mock_client

        scraper = RedditScraper()
        items = scraper.scrape({"subreddit": "streetwear", "min_score": 100})

    assert len(items) == 1
    assert items[0].title == "High score"


def test_scrape_skips_non_image_post():
    posts = [
        _make_post(url="https://www.youtube.com/watch?v=abc"),  # not an image
    ]
    listing = _reddit_listing(posts)

    with patch("agents.scrapers.reddit_scraper.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get = MagicMock(return_value=_mock_httpx_response(listing))
        mock_client_cls.return_value = mock_client

        scraper = RedditScraper()
        items = scraper.scrape({"subreddit": "streetwear", "min_score": 0})

    assert items == []


def test_scrape_does_not_extract_buy_links():
    posts = [
        _make_post(
            title="Reps haul",
            url="https://i.redd.it/reps.jpg",
            selftext="Buy: https://item.taobao.com/item.htm?id=999",
            score=300,
            permalink="/r/qualityreps/comments/abc/reps_haul/",
        )
    ]
    listing = _reddit_listing(posts)

    with patch("agents.scrapers.reddit_scraper.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get = MagicMock(return_value=_mock_httpx_response(listing))
        mock_client_cls.return_value = mock_client

        scraper = RedditScraper()
        items = scraper.scrape({"subreddit": "qualityreps", "min_score": 0})

    assert len(items) == 1
    assert items[0].buy_links == []


def test_scrape_http_error_returns_empty():
    import httpx as _httpx

    with patch("agents.scrapers.reddit_scraper.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        resp = MagicMock()
        resp.status_code = 429
        mock_client.get.side_effect = _httpx.HTTPStatusError(
            "Rate limited", request=MagicMock(), response=resp
        )
        mock_client_cls.return_value = mock_client

        scraper = RedditScraper()
        items = scraper.scrape({"subreddit": "streetwear"})

    assert items == []
