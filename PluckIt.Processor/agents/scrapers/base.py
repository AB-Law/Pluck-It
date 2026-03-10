"""
Base types shared across all scraper modules.

ScrapedItemRaw is the normalised output of any scraper before persistence.
It contains only data derivable from the source — no embeddings, no pHash.
Those are added by scraper_runner during the ingest pipeline.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class BuyLink:
    platform: str   # "taobao" | "yupoo" | "weidian" | "weidan" | "unknown"
    url: str


@dataclass
class ScrapedItemRaw:
    """
    Normalised output from any scraper.

    image_url   — direct, stable CDN URL (i.redd.it, brand CDN, etc.).
                  NEVER a token-bearing preview URL.
    preview_url — short-lived URL used transiently for pHash computation only.
                  Caller must compute pHash immediately; never store this field.
    """
    source_id: str          # matches ScraperSources document id
    source_type: str        # "reddit" | "brand_site" | "pinterest"
    title: str
    description: str
    image_url: str
    product_url: str
    tags: list[str]         # extracted from text (title, flair, subreddit)
    buy_links: list[BuyLink] = field(default_factory=list)
    preview_url: Optional[str] = None   # transient only — never persisted
    score_signal: int = 0               # upvotes / engagement metric
    brand: Optional[str] = None
    price: Optional[str] = None


class BaseScraper(ABC):
    source_type: str

    @abstractmethod
    def scrape(self, config: dict) -> list[ScrapedItemRaw]:
        """Fetch items from the source described by config."""
        ...

    def is_healthy(self) -> bool:
        """Quick liveness check — override for sources with health endpoints."""
        return True
