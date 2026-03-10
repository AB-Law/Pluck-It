"""
Vision-based taste analysis for liked/disliked Discover feed items.

Called once per upvote — runs async so the feedback HTTP response is immediate.
Uses GPT-4.1-mini with vision to extract visual style descriptors from the image.

Cost: ~$0.001–0.003 per image (gpt-4.1-mini pricing).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI

from .url_security import validate_public_https_url

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a fashion stylist analysing an outfit photo.
Extract concise style descriptors that capture what a person who liked or disliked this image would care about.

Return ONLY a JSON object with these keys:
{
  "styleKeywords": ["<up to 8 specific style/aesthetic descriptors>"],
  "colors":        ["<up to 4 dominant color names>"],
  "garments":      ["<up to 4 garment types visible>"],
  "brand":         "<brand name if visible, else null>"
}

Rules:
- styleKeywords: specific aesthetics like "quiet luxury", "oversized silhouette", "earth tones", "relaxed tailoring"
  NOT broad genres like "streetwear" or "casual" unless truly dominant.
- colors: simple names like "camel", "off-white", "charcoal", "rust".
- garments: e.g. "wide-leg trousers", "linen shirt", "leather jacket".
- Return ONLY the JSON, no markdown fences, no explanation.
- If the image is not a fashion/outfit photo, return empty arrays and null brand.
"""


_llm: AzureChatOpenAI | None = None


def _get_llm() -> AzureChatOpenAI:
    global _llm
    if _llm is None:
        _llm = AzureChatOpenAI(
            azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            azure_deployment=os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
            api_version="2024-12-01-preview",
            temperature=0.0,
            max_tokens=300,
        )
    return _llm


def _parse_json(text: str) -> dict:
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    return json.loads(text)


def analyze_image(image_url: str) -> dict:
    """
    Synchronous — run via run_in_executor from async routes.

    Returns a dict with keys: styleKeywords, colors, garments, brand.
    Returns empty result on any failure (never raises).
    """
    _empty: dict = {"styleKeywords": [], "colors": [], "garments": [], "brand": None}

    if not image_url:
        return _empty

    try:
        safe_image_url = validate_public_https_url(image_url)
    except ValueError:
        logger.warning("Image taste analysis rejected non-public URL: %s", image_url[:80])
        return _empty

    try:
        llm = _get_llm()
        message = HumanMessage(
            content=[
                {
                    "type": "image_url",
                    "image_url": {"url": safe_image_url, "detail": "low"},
                },
                {
                    "type": "text",
                    "text": "Analyse this outfit image and return the JSON descriptor.",
                },
            ]
        )
        response = llm.invoke([SystemMessage(content=_SYSTEM_PROMPT), message])
        result = _parse_json(response.content.strip())

        # Normalise — ensure expected keys exist
        result.setdefault("styleKeywords", [])
        result.setdefault("colors", [])
        result.setdefault("garments", [])
        result.setdefault("brand", None)
        return result

    except Exception as exc:  # noqa: BLE001
        logger.warning("Image taste analysis failed for %s: %s", image_url[:80], exc)
        return _empty


def build_taste_inferred(analysis: dict) -> dict:
    """
    Convert image analysis result to the shape _update_user_profile expects:
    { styleKeywords: [...], brands: [...] }
    """
    keywords = (
        analysis.get("styleKeywords", [])
        + analysis.get("colors", [])
        + analysis.get("garments", [])
    )
    brand = analysis.get("brand")
    return {
        "styleKeywords": [k for k in keywords if k],
        "brands": [brand] if brand else [],
    }
