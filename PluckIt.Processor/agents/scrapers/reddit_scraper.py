"""
Reddit scraper — uses Reddit's public JSON API (no credentials required).

Endpoint:  GET https://www.reddit.com/r/{subreddit}.json?sort=hot&limit=50
Auth:      None — Reddit serves JSON publicly.
Rate:      ~60 req / 10 min unauthenticated; sufficient for daily timer runs.
User-Agent: Must be set to avoid 429s.

Image URL strategy
──────────────────
Reddit exposes two kinds of image URLs:

  • i.redd.it/...jpg  — Direct CDN, NO tokens, NEVER expires.  We store this.
  • preview.redd.it/...jpg?width=...&...&s=<token>  — Resized preview with an
    expiring HMAC token.  We use this URL TRANSIENTLY for pHash computation
    (download while token is valid), then discard it.  Never stored.

Buy-link extraction
────────────────────
Subreddits like r/QualityReps contain taobao / yupoo / weidian / weidan links
in the post body (selftext) and in top-level comments.  We regex-extract these
and store them as structured BuyLink objects.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Optional
from urllib.parse import urlparse

import httpx

from .base import BaseScraper, BuyLink, ScrapedItemRaw

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_BASE_URL = "https://www.reddit.com"
_HEADERS = {
    "User-Agent": "PluckIt/1.0",
    "Accept": "application/json",
}
_TIMEOUT = 15.0
_REQUEST_DELAY = 2.0          # seconds between requests (polite crawling)

# Direct image extensions hosted on i.redd.it (stable, token-free)
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# Buy-link patterns found in QualityReps-style subreddits
_BUY_LINK_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("taobao",  re.compile(r"https?://(?:item\.taobao\.com|taobao\.com)\S+", re.I)),
    ("yupoo",   re.compile(r"https?://\S+\.yupoo\.com\S*", re.I)),
    ("weidian", re.compile(r"https?://(?:weidian\.com|weidian\.cc)\S+", re.I)),
    ("weidan",  re.compile(r"https?://\S*weidan\S*", re.I)),
    ("1688",    re.compile(r"https?://detail\.1688\.com\S+", re.I)),
]

# Subreddit → implicit aesthetic tags (avoids needing LLM for tagging)
_SUBREDDIT_TAGS: dict[str, list[str]] = {
    "streetwear":       ["streetwear", "urban", "casual"],
    "malefashionadvice": ["classic", "smart-casual", "everyday"],
    "femalefashionadvice": ["classic", "smart-casual", "everyday"],
    "rawdenim":         ["denim", "workwear", "casual"],
    "goodyearwelt":     ["classic", "heritage", "footwear"],
    "weddingplanning":  ["formal", "romantic", "occasion"],
    "thriftstore":      ["thrift", "vintage", "casual"],
    "qualityreps":      ["reps", "streetwear", "sneakers"],
    "fashionreps":      ["reps", "streetwear", "urban"],
    "minimalism":       ["minimalist", "clean", "neutral"],
    "sneakers":         ["sneakers", "streetwear", "footwear"],
    "classicmenswear":  ["classic", "tailored", "formal"],
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_direct_image(url: str) -> bool:
    """True if url points directly to an image file (no token expiry risk)."""
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in _IMAGE_EXTENSIONS)


def _is_reddit_gallery(post: dict) -> bool:
    return post.get("is_gallery", False) and "media_metadata" in post


def _extract_gallery_images(post: dict) -> list[tuple[str, Optional[str]]]:
    """
    Return list of (image_url, preview_url) pairs from a Reddit gallery post.
    image_url  — direct i.redd.it URL
    preview_url — first available resized preview (may have token)
    """
    results: list[tuple[str, Optional[str]]] = []
    media_metadata = post.get("media_metadata", {})
    for item in media_metadata.values():
        if item.get("status") != "valid" or item.get("e") != "Image":
            continue
        # Direct source URL (i.redd.it, no token)
        src = item.get("s", {})
        img_url = src.get("u", "").replace("&amp;", "&")
        if not img_url:
            continue
        # Best-quality resized preview (may carry token — transient only)
        previews = item.get("p", [])
        preview_url: Optional[str] = None
        if previews:
            preview_url = previews[-1].get("u", "").replace("&amp;", "&") or None
        results.append((img_url, preview_url))
    return results


def _extract_buy_links(text: str) -> list[BuyLink]:
    """Regex-scan *text* for known buy-link platforms."""
    links: list[BuyLink] = []
    seen: set[str] = set()
    for platform, pattern in _BUY_LINK_PATTERNS:
        for match in pattern.finditer(text):
            url = match.group(0).rstrip(")")  # strip trailing ) from markdown links
            if url not in seen:
                links.append(BuyLink(platform=platform, url=url))
                seen.add(url)
    return links


def _extract_tags_from_post(post: dict, subreddit: str) -> list[str]:
    """
    Build style tags from text signals — NO LLM calls.
    Sources: subreddit name, post flair, title keywords.
    """
    tags: list[str] = list(_SUBREDDIT_TAGS.get(subreddit.lower(), []))

    flair = (post.get("link_flair_text") or "").lower()
    if flair:
        tags.extend(flair.replace("/", " ").split())

    # Simple keyword extraction from title
    title = (post.get("title") or "").lower()
    keyword_map = {
        "vintage": "vintage", "thrift": "thrift", "grail": "grail",
        "minimal": "minimalist", "oversized": "oversized", "tailored": "tailored",
        "denim": "denim", "leather": "leather", "linen": "linen",
        "streetwear": "streetwear", "prep": "preppy", "workwear": "workwear",
        "casual": "casual", "formal": "formal", "athletic": "sporty",
        "sneaker": "sneakers", "boot": "boots", "loafer": "loafers",
    }
    for kw, tag in keyword_map.items():
        if kw in title and tag not in tags:
            tags.append(tag)

    return list(dict.fromkeys(tags))  # deduplicate, preserve order


def _fetch_top_comments_text(subreddit: str, post_id: str, client: httpx.Client) -> str:
    """Fetch the top-level comment bodies for buy-link extraction."""
    url = f"{_BASE_URL}/r/{subreddit}/comments/{post_id}.json?limit=10&depth=1"
    try:
        time.sleep(_REQUEST_DELAY)
        resp = client.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        # data[1] contains comments listing
        comments = data[1]["data"]["children"]
        texts = [
            c["data"].get("body", "")
            for c in comments
            if c.get("kind") == "t1"
        ]
        return "\n".join(texts)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not fetch comments for %s/%s: %s", subreddit, post_id, exc)
        return ""


# ── Scraper ───────────────────────────────────────────────────────────────────

class RedditScraper(BaseScraper):
    source_type = "reddit"

    def scrape(self, config: dict) -> list[ScrapedItemRaw]:
        """
        config keys:
          subreddit  (str)   — e.g. "streetwear"
          sort       (str)   — "hot" | "top" | "new"  (default: "hot")
          limit      (int)   — max posts to fetch      (default: 50, max: 100)
          min_score  (int)   — skip posts below this   (default: 50)
          fetch_comments (bool) — fetch comments for buy-link extraction (default: False)
        """
        subreddit = config["subreddit"]
        sort = config.get("sort", "hot")
        limit = min(int(config.get("limit", 50)), 100)
        min_score = int(config.get("min_score", 50))
        fetch_comments: bool = config.get("fetch_comments", False)
        source_id: str = config.get("source_id", f"reddit-{subreddit}")

        url = f"{_BASE_URL}/r/{subreddit}/{sort}.json?limit={limit}"
        results: list[ScrapedItemRaw] = []

        with httpx.Client() as client:
            try:
                resp = client.get(url, headers=_HEADERS, timeout=_TIMEOUT)
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                logger.error(
                    "Reddit HTTP %s for r/%s: %s",
                    exc.response.status_code, subreddit, exc,
                )
                return []
            except httpx.RequestError as exc:
                logger.error("Reddit request failed for r/%s: %s", subreddit, exc)
                return []

            data = resp.json()
            posts = data.get("data", {}).get("children", [])
            logger.info("Reddit r/%s: fetched %d posts", subreddit, len(posts))

            for child in posts:
                post = child.get("data", {})
                if post.get("score", 0) < min_score:
                    continue

                items = self._process_post(
                    post, subreddit, source_id, fetch_comments, client
                )
                results.extend(items)
                time.sleep(_REQUEST_DELAY)

        logger.info("Reddit r/%s: extracted %d image items", subreddit, len(results))
        return results

    def _process_post(
        self,
        post: dict,
        subreddit: str,
        source_id: str,
        fetch_comments: bool,
        client: httpx.Client,
    ) -> list[ScrapedItemRaw]:
        post_url = f"https://www.reddit.com{post.get('permalink', '')}"
        title = (post.get("title") or "").strip()
        description = (post.get("selftext") or "").strip()[:500]
        tags = _extract_tags_from_post(post, subreddit)
        score = post.get("score", 0)

        # Buy links from post body
        buy_links = _extract_buy_links(description)

        # Optionally fetch comment text for buy links (QualityReps-style subs)
        if fetch_comments and not buy_links:
            comment_text = _fetch_top_comments_text(subreddit, post["id"], client)
            buy_links = _extract_buy_links(comment_text)

        results: list[ScrapedItemRaw] = []

        # ── Gallery posts ──────────────────────────────────────────────────
        if _is_reddit_gallery(post):
            for image_url, preview_url in _extract_gallery_images(post):
                results.append(ScrapedItemRaw(
                    source_id=source_id,
                    source_type=self.source_type,
                    title=title,
                    description=description,
                    image_url=image_url,
                    product_url=post_url,
                    tags=tags,
                    buy_links=buy_links,
                    preview_url=preview_url,
                    score_signal=score,
                ))

        # ── Single direct image ────────────────────────────────────────────
        elif _is_direct_image(post.get("url", "")):
            post_url_direct = post["url"]
            # Preview URL for pHash (may carry token — transient only)
            preview_url: Optional[str] = None
            try:
                preview = post["preview"]["images"][0]["source"]["url"]
                preview_url = preview.replace("&amp;", "&")
            except (KeyError, IndexError, TypeError):
                pass

            results.append(ScrapedItemRaw(
                source_id=source_id,
                source_type=self.source_type,
                title=title,
                description=description,
                image_url=post_url_direct,   # stable i.redd.it URL
                product_url=post_url,
                tags=tags,
                buy_links=buy_links,
                preview_url=preview_url,     # transient, for pHash only
                score_signal=score,
            ))

        return results
