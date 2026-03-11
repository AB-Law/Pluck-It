from __future__ import annotations

from typing import Optional, List
from pydantic import BaseModel, HttpUrl, Field, validator
from .url_security import validate_public_https_url

class RedditPost(BaseModel):
    """
    Pydantic model for a single Reddit post from children[].data
    """
    id: str
    title: str
    subreddit: str
    permalink: str
    url: str
    score: int
    over_18: bool
    created_utc: float
    selftext: Optional[str] = ""
    is_gallery: Optional[bool] = False
    media_metadata: Optional[dict] = None
    gallery_data: Optional[dict] = None
    preview: Optional[dict] = None

    @validator("url", "permalink", pre=True)
    def validate_reddit_url(cls, v):
        if isinstance(v, str) and v.startswith("/"):
            return v
        if isinstance(v, str) and v.startswith("http"):
            try:
                return validate_public_https_url(v)
            except ValueError as e:
                raise ValueError(f"Invalid URL: {e}")
        return v

class RedditIngestBatch(BaseModel):
    """
    Request body for POST /api/scraper/ingest/reddit
    """
    source_id: str
    posts: List[RedditPost]
