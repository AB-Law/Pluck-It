"""
Transient image utilities for the scraper pipeline.

All operations here are in-memory only — nothing is written to Blob Storage.
The only output is a perceptual hash (pHash) hex string used for deduplication.

Why we download at scrape time:
  - Reddit preview URLs (preview.redd.it) carry short-lived tokens.
    We must compute the pHash while the token is still valid.
  - Direct i.redd.it URLs don't expire, so pHash can be recomputed anytime,
    but we do it upfront to keep the pipeline uniform.
"""

from __future__ import annotations

import logging
from io import BytesIO
from typing import Optional

import httpx
from PIL import Image

from ..url_security import validate_public_https_url

logger = logging.getLogger(__name__)

_HEADERS = {"User-Agent": "PluckIt/1.0"}
_TIMEOUT = 10.0          # seconds
_MAX_DIM = 256           # resize before hashing — sufficient for pHash accuracy


def compute_phash(url: str) -> Optional[str]:
    """
    Download an image from *url* transiently and return its pHash hex string.

    Returns None on any error (network timeout, non-image content, etc.).
    The downloaded bytes are discarded immediately after hashing.
    """
    try:
        import imagehash  # imported here so missing dep surfaces at use-time
    except ImportError:
        logger.warning("imagehash not installed — pHash dedup disabled")
        return None

    try:
        safe_url = validate_public_https_url(url)
        resp = httpx.get(safe_url, headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()

        img = Image.open(BytesIO(resp.content)).convert("RGB")
        # Downscale before hashing to normalise resolution differences
        img.thumbnail((_MAX_DIM, _MAX_DIM))
        return str(imagehash.phash(img))

    except httpx.HTTPStatusError as exc:
        logger.debug("pHash fetch HTTP %s for %s", exc.response.status_code, url)
    except httpx.RequestError as exc:
        logger.debug("pHash fetch network error for %s: %s", url, exc)
    except Exception as exc:  # noqa: BLE001
        logger.debug("pHash computation failed for %s: %s", url, exc)

    return None


def hamming_distance(hash_a: str, hash_b: str) -> int:
    """
    Bit-level Hamming distance between two pHash hex strings.
    Returns a large number if the hashes are incomparable lengths.
    """
    if len(hash_a) != len(hash_b):
        return 999
    try:
        import imagehash
        return imagehash.hex_to_hash(hash_a) - imagehash.hex_to_hash(hash_b)
    except Exception:  # noqa: BLE001
        try:
            return bin(int(hash_a, 16) ^ int(hash_b, 16)).count("1")
        except ValueError:
            return 999
