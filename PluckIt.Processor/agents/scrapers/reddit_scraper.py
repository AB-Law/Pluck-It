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

Buy-link extraction is intentionally disabled.
We only ingest post/image metadata from Reddit.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx

from .base import BaseScraper, ScrapedItemRaw

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_BASE_URL = "https://www.reddit.com"
_HEADERS = {
    "User-Agent": os.getenv(
        "REDDIT_USER_AGENT",
        "script:pluckit-scraper:1.0 (by /u/PluckItBot)",
    ),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}
_TIMEOUT = 15.0
_REQUEST_DELAY = 2.0          # seconds between requests (polite crawling)

# Direct image extensions hosted on i.redd.it (stable, token-free)
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

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


def _extract_buy_links(_: str) -> list:
    """Compatibility shim: buy-link extraction is disabled for Reddit."""
    return []


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
        """
        subreddit = config["subreddit"]
        sort = config.get("sort", "hot")
        limit = min(int(config.get("limit", 50)), 100)
        min_score = int(config.get("min_score", 50))
        source_id: str = config.get("source_id", f"reddit-{subreddit}")

        url = f"{_BASE_URL}/r/{subreddit}/{sort}.json?limit={limit}"

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

            raw_posts = [child.get("data", {}) for child in posts]
            return self.process_posts(raw_posts, subreddit, source_id, min_score)

    def process_posts(
        self,
        posts: list[dict],
        subreddit: str,
        source_id: str,
        min_score: int = 0,
    ) -> list[ScrapedItemRaw]:
        """Process a list of raw Reddit post objects into ScrapedItemRaw."""
        results: list[ScrapedItemRaw] = []
        for post in posts:
            if post.get("score", 0) < min_score:
                continue

            items = self.process_post(post, subreddit, source_id)
            results.extend(items)
        return results

    def process_post(
        self,
        post: dict,
        subreddit: str,
        source_id: str,
    ) -> list[ScrapedItemRaw]:
        """Process a single raw Reddit post into one or more ScrapedItemRaw."""
        actual_sub = post.get("subreddit", "").lower()
        if actual_sub and actual_sub != subreddit.lower():
            logger.warning("Subreddit mismatch: expected %s, got %s", subreddit, actual_sub)
            return []

        if post.get("over_18", False):
            return []

        post_url = f"https://www.reddit.com{post.get('permalink', '')}"
        
        if not post.get("permalink", "").lower().startswith(f"/r/{subreddit.lower()}/"):
            logger.warning("Permalink mismatch for subreddit %s: %s", subreddit, post.get("permalink"))
            return []

        title = (post.get("title") or "").strip()
        description = (post.get("selftext") or "").strip()[:500]
        tags = _extract_tags_from_post(post, subreddit)
        score = post.get("score", 0)
        created_utc = post.get("created_utc")
        source_created_at: Optional[str] = None
        if isinstance(created_utc, (int, float)):
            source_created_at = datetime.fromtimestamp(created_utc, timezone.utc).isoformat()

        buy_links = []
        comment_text = ""

        results: list[ScrapedItemRaw] = []

        # ── Gallery posts ──────────────────────────────────────────────────
        if _is_reddit_gallery(post):
            gallery_pairs = _extract_gallery_images(post)
            if gallery_pairs:
                # Security: validate all gallery images are on trusted domains
                valid_gallery: list[tuple[str, Optional[str]]] = []
                for img, prev in gallery_pairs:
                    if _is_trusted_reddit_domain(img):
                        valid_gallery.append((img, prev))
                
                if valid_gallery:
                    first_img, first_preview = valid_gallery[0]
                    results.append(ScrapedItemRaw(
                        source_id=source_id,
                        source_type=self.source_type,
                        title=title,
                        description=description,
                        image_url=first_img,
                        product_url=post_url,
                        tags=tags,
                        buy_links=buy_links,
                        preview_url=first_preview,
                        gallery_images=[img for img, _ in valid_gallery],
                        comment_text=comment_text[:1000],
                        score_signal=score,
                        source_created_at=source_created_at,
                    ))

        # ── Single direct image ────────────────────────────────────────────
        elif _is_direct_image(post.get("url", "")):
            img_url = post["url"]
            if not _is_trusted_reddit_domain(img_url):
                return []

            # Preview URL for pHash (may carry token — transient only)
            preview_url: Optional[str] = None
            try:
                preview = post["preview"]["images"][0]["source"]["url"]
                preview_url = preview.replace("&amp;", "&")
                if preview_url and not _is_trusted_reddit_domain(preview_url):
                    preview_url = None
            except (KeyError, IndexError, TypeError):
                pass

            results.append(ScrapedItemRaw(
                source_id=source_id,
                source_type=self.source_type,
                title=title,
                description=description,
                image_url=img_url,   # stable i.redd.it URL
                product_url=post_url,
                tags=tags,
                buy_links=buy_links,
                preview_url=preview_url,     # transient, for pHash only
                gallery_images=[],
                comment_text=comment_text[:1000],
                score_signal=score,
                source_created_at=source_created_at,
            ))

        return results


def _is_trusted_reddit_domain(url: str) -> bool:
    """True if the URL is on an official Reddit content domain."""
    parsed = urlparse(url)
    return parsed.netloc.lower() in {
        "i.redd.it",
        "www.reddit.com",
        "preview.redd.it",
        "reddit.com",
    }
