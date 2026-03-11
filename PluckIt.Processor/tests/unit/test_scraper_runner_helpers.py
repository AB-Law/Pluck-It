import hashlib
import pytest
from datetime import datetime, timezone
from dataclasses import dataclass
from unittest.mock import patch

from agents.scrapers.base import ScrapedItemRaw
from agents.scraper_runner import _item_text, _item_id, _build_document

def create_mock_item() -> ScrapedItemRaw:
    return ScrapedItemRaw(
        source_id="src-123",
        source_type="reddit",
        title="Test Title",
        description="This is a very long description that might need truncation in some parts but here it is just a normal length string. " * 3,
        image_url="https://example.com/img.jpg",
        preview_url="https://example.com/preview.jpg",
        product_url="https://example.com/product",
        buy_links=[],
        price=19.99,
        brand="Gucci",
        tags=["fashion", "streetwear"],
        gallery_images=["img1.jpg", "img2.jpg"],
        comment_text=["comment 1", "comment 2"],
        score_signal=42,
        source_created_at="2024-01-01T12:00:00Z"
    )

def test_item_text_combines_fields() -> None:
    raw = create_mock_item()
    result = _item_text(raw)
    
    # Should contain tags, title, and first 200 chars of description
    assert result.startswith("fashion streetwear Test Title This is a very long description")
    # Tags + space + Title + space + 200 chars max
    expected_len = len("fashion streetwear") + 1 + len("Test Title") + 1 + 200
    assert len(result) <= expected_len

def test_item_text_handles_empty_fields() -> None:
    raw = ScrapedItemRaw(
        source_id="src", source_type="reddit", title="", description="",
        image_url="", product_url="", buy_links=[], tags=[], gallery_images=[], comment_text=[]
    )
    assert _item_text(raw) == ""

def test_item_id_is_deterministic() -> None:
    raw = create_mock_item()
    result1 = _item_id(raw)
    result2 = _item_id(raw)
    assert result1 == result2

    # Verify format: sourceType-16charHash
    assert result1.startswith("reddit-")
    hash_part = result1.split("-")[1]
    assert len(hash_part) == 16
    
    # Verify hash is actually sha256(source_id:product_url)[:16]
    expected_digest = hashlib.sha256("src-123:https://example.com/product".encode()).hexdigest()[:16]
    assert hash_part == expected_digest

@patch("agents.scraper_runner.datetime")
def test_build_document_creates_cosmos_format(mock_datetime) -> None:
    mock_now = datetime(2025, 1, 1, tzinfo=timezone.utc)
    mock_datetime.now.return_value = mock_now
    
    raw = create_mock_item()
    embedding = [0.1, 0.2, 0.3]
    doc = _build_document(raw, "phash123", embedding, "user-456")
    
    assert doc["id"] == _item_id(raw)
    assert doc["userId"] == "user-456"
    assert doc["sourceId"] == "src-123"
    assert doc["sourceType"] == "reddit"
    assert doc["title"] == "Test Title"
    assert doc["description"] == raw.description
    assert doc["imageUrl"] == "https://example.com/img.jpg"
    assert "previewUrl" not in doc  # Explicitly excluded
    assert doc["productUrl"] == "https://example.com/product"
    assert doc["buyLinks"] == []
    assert doc["price"] == 19.99
    assert doc["brand"] == "Gucci"
    assert doc["tags"] == ["fashion", "streetwear"]
    assert doc["galleryImages"] == ["img1.jpg", "img2.jpg"]
    assert doc["commentText"] == ["comment 1", "comment 2"]
    assert doc["pHash"] == "phash123"
    assert doc["embedding"] == embedding
    assert doc["redditScore"] == 42
    assert doc["scoreSignal"] == 0
    assert doc["scrapedAt"] == mock_now.isoformat()
    assert doc["sourceCreatedAt"] == "2024-01-01T12:00:00Z"
    assert doc["imageExpired"] is False

@patch("agents.scraper_runner.datetime")
def test_build_document_fallback_created_at(mock_datetime) -> None:
    mock_now = datetime(2025, 1, 1, tzinfo=timezone.utc)
    mock_datetime.now.return_value = mock_now
    
    raw = create_mock_item()
    raw.source_created_at = None
    
    doc = _build_document(raw, None, [], "global")
    assert doc["scrapedAt"] == mock_now.isoformat()
    assert doc["sourceCreatedAt"] == mock_now.isoformat() # Falls back to scrapedAt
