"""
Root conftest — sets required environment variables BEFORE any module-level
code in function_app.py or agents/ runs.  All unit tests mock I/O at the
Cosmos / OpenAI boundary; no real external services are contacted.
"""
import os

# ── Environment stubs — must be set before any app imports ──────────────────
os.environ.setdefault("AZURE_OPENAI_ENDPOINT",    "https://test.openai.azure.com/")
os.environ.setdefault("AZURE_OPENAI_API_KEY",     "test-api-key-xxxx")
os.environ.setdefault("AZURE_OPENAI_DEPLOYMENT",  "gpt-4.1-mini")
os.environ.setdefault("COSMOS_DB_ENDPOINT",       "https://localhost:8081")
os.environ.setdefault("COSMOS_DB_KEY",            "test-cosmos-key==")
os.environ.setdefault("COSMOS_DB_DATABASE",       "PluckIt")
os.environ.setdefault("COSMOS_DB_CONTAINER",      "Wardrobe")
os.environ.setdefault("COSMOS_DB_USER_PROFILES_CONTAINER", "UserProfiles")
os.environ.setdefault("COSMOS_DB_CONVERSATIONS_CONTAINER", "Conversations")
os.environ.setdefault("COSMOS_DB_DIGESTS_CONTAINER",       "Digests")
os.environ.setdefault("STORAGE_ACCOUNT_NAME",     "testaccount")
os.environ.setdefault("STORAGE_ACCOUNT_KEY",      "dGVzdA==")
os.environ.setdefault("UPLOADS_CONTAINER_NAME",   "uploads")
os.environ.setdefault("ARCHIVE_CONTAINER_NAME",   "archive")
os.environ.setdefault("LOCAL_DEV_USER_ID",        "test-user-001")
os.environ.setdefault("CORS_ALLOWED_ORIGINS",     "*")

import asyncio
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Shared test constants ────────────────────────────────────────────────────
TEST_USER_ID = "test-user-001"


# ── FastAPI test client fixture (session-scoped) ─────────────────────────────

@pytest.fixture(scope="session")
def fastapi_app_with_auth_override():
    """
    Returns the FastAPI app with the auth dependency overridden to always
    return TEST_USER_ID — no real Google token validation.
    """
    from function_app import fastapi_app
    from agents.auth import get_user_id

    fastapi_app.dependency_overrides[get_user_id] = lambda: TEST_USER_ID
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest.fixture()
async def async_client(fastapi_app_with_auth_override):
    """AsyncClient backed by the FastAPI test app."""
    import httpx
    from httpx import ASGITransport
    async with httpx.AsyncClient(
        transport=ASGITransport(app=fastapi_app_with_auth_override),
        base_url="http://test",
    ) as client:
        yield client


# ── Cosmos container mocks ───────────────────────────────────────────────────

def _make_wardrobe_items(user_id: str = TEST_USER_ID, count: int = 3) -> list[dict]:
    return [
        {
            "id": f"item-{i:03d}",
            "userId": user_id,
            "imageUrl": f"https://blob.example.com/item-{i:03d}.png",
            "category": "Tops" if i % 2 == 0 else "Bottoms",
            "tags": ["casual", "cotton"] if i % 2 == 0 else ["denim", "slim"],
            "colours": [{"name": "White", "hex": "#FFFFFF"}],
            "brand": "TestBrand",
        }
        for i in range(1, count + 1)
    ]


@pytest.fixture()
def mock_wardrobe_container():
    """AsyncMock of the Cosmos wardrobe container."""
    container = AsyncMock()
    items = _make_wardrobe_items()

    async def _query_items(**kwargs):
        for item in items:
            yield item

    container.query_items = _query_items
    container.read_item = AsyncMock(return_value=items[0])
    container.upsert_item = AsyncMock(return_value=items[0])
    container._items = items
    return container


@pytest.fixture()
def mock_conversations_container():
    container = AsyncMock()
    container.read_item = AsyncMock(return_value={
        "id": TEST_USER_ID,
        "userId": TEST_USER_ID,
        "summary": "User prefers minimalist style.",
        "updatedAt": "2026-01-01T00:00:00Z",
    })
    container.upsert_item = AsyncMock(return_value={})
    return container


@pytest.fixture()
def mock_digests_container():
    container = AsyncMock()

    async def _query_items(**kwargs):
        yield {
            "id": "digest-001",
            "userId": TEST_USER_ID,
            "suggestions": [{"item": "A white linen shirt", "reason": "Versatile base"}],
            "generatedAt": "2026-01-06T09:00:00Z",
        }

    container.query_items = _query_items
    container.upsert_item = AsyncMock(return_value={})
    return container


@pytest.fixture()
def mock_user_profiles_container():
    container = AsyncMock()
    container.read_item = AsyncMock(return_value={
        "id": TEST_USER_ID,
        "stylePreferences": ["minimalist"],
        "preferredColours": ["white", "navy"],
        "locationCity": "London",
        "wardrobeHashAtLastDigest": None,
    })
    container.upsert_item = AsyncMock(return_value={})
    return container
