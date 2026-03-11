"""
Root conftest — sets required environment variables BEFORE any module-level
code in function_app.py or agents/ runs.  All unit tests mock I/O at the
Cosmos / OpenAI boundary; no real external services are contacted.
"""
import os
import sys
import types

# ── Environment stubs — must be set before any app imports ──────────────────
os.environ.setdefault("AZURE_OPENAI_ENDPOINT",    "https://test.openai.azure.com/")
os.environ.setdefault("AZURE_OPENAI_API_KEY",     "test-api-key-xxxx")
os.environ.setdefault("AZURE_OPENAI_DEPLOYMENT",  "gpt-4.1-mini")
os.environ.setdefault("COSMOS_DB_ENDPOINT",       "https://localhost:8081")
os.environ.setdefault("COSMOS_DB_KEY",            "test-cosmos-key==")
os.environ.setdefault("COSMOS_DB_DATABASE",       "PluckIt")
os.environ.setdefault("COSMOS_DB_CONTAINER",      "Wardrobe")
os.environ.setdefault("COSMOS_DB_WEAR_EVENTS_CONTAINER", "WearEvents")
os.environ.setdefault("COSMOS_DB_STYLING_ACTIVITY_CONTAINER", "StylingActivity")
os.environ.setdefault("COSMOS_DB_USER_PROFILES_CONTAINER", "UserProfiles")
os.environ.setdefault("COSMOS_DB_CONVERSATIONS_CONTAINER", "Conversations")
os.environ.setdefault("COSMOS_DB_DIGESTS_CONTAINER",       "Digests")
os.environ.setdefault("COSMOS_DB_DIGEST_FEEDBACK_CONTAINER", "DigestFeedback")
os.environ.setdefault("COSMOS_DB_MOODS_CONTAINER",          "Moods")
os.environ.setdefault("COSMOS_DB_SCRAPER_SOURCES_CONTAINER",            "ScraperSources")
os.environ.setdefault("COSMOS_DB_SCRAPED_ITEMS_CONTAINER",              "ScrapedItems")
os.environ.setdefault("COSMOS_DB_USER_SOURCE_SUBSCRIPTIONS_CONTAINER",  "UserSourceSubscriptions")
os.environ.setdefault("COSMOS_DB_TASTE_CALIBRATION_CONTAINER",          "TasteCalibration")
os.environ.setdefault("STORAGE_ACCOUNT_NAME",     "testaccount")
os.environ.setdefault("STORAGE_ACCOUNT_KEY",      "dGVzdA==")
os.environ.setdefault("UPLOADS_CONTAINER_NAME",   "uploads")
os.environ.setdefault("ARCHIVE_CONTAINER_NAME",   "archive")
os.environ.setdefault("LOCAL_DEV_USER_ID",        "test-user-001")
os.environ.setdefault("CORS_ALLOWED_ORIGINS",     "http://localhost:3000")

# ── Optional azure sdk stubs for local unit runs without azure packages ─────
try:
    import azure.functions  # type: ignore # noqa: F401
except Exception:
    azure_mod = types.ModuleType("azure")
    functions_mod = types.ModuleType("azure.functions")
    cosmos_mod = types.ModuleType("azure.cosmos")
    cosmos_aio_mod = types.ModuleType("azure.cosmos.aio")

    class _DummyAsgiFunctionApp:
        def __init__(self, *args, **kwargs):
            # Intentionally a no-op initializer: tests only require a constructible
            # ASGI app object for decorator compatibility.
            self._args = args
            self._kwargs = kwargs

        def _make_decorator(self, trigger_name: str):
            def _decorator(fn):
                setattr(fn, "_azure_trigger_type", trigger_name)
                return fn
            return _decorator

        def function_name(self, *args, **kwargs):
            return self._make_decorator("function_name")

        def blob_trigger(self, *args, **kwargs):
            return self._make_decorator("blob_trigger")

        def timer_trigger(self, *args, **kwargs):
            return self._make_decorator("timer_trigger")

    class _AuthLevel:
        ANONYMOUS = "anonymous"

    functions_mod.AsgiFunctionApp = _DummyAsgiFunctionApp
    functions_mod.AuthLevel = _AuthLevel
    functions_mod.InputStream = object
    functions_mod.TimerRequest = object
    cosmos_mod.CosmosClient = object
    cosmos_mod.PartitionKey = object
    cosmos_aio_mod.CosmosClient = object

    sys.modules.setdefault("azure", azure_mod)
    sys.modules.setdefault("azure.functions", functions_mod)
    sys.modules.setdefault("azure.cosmos", cosmos_mod)
    sys.modules.setdefault("azure.cosmos.aio", cosmos_aio_mod)

if "pillow_heif" not in sys.modules:
    pillow_heif_mod = types.ModuleType("pillow_heif")

    def _register_heif_opener() -> None:
        return None

    pillow_heif_mod.register_heif_opener = _register_heif_opener
    sys.modules.setdefault("pillow_heif", pillow_heif_mod)

if "feedparser" not in sys.modules:
    feedparser_mod = types.ModuleType("feedparser")

    def _parse(*args, **kwargs):
        return {"entries": []}

    feedparser_mod.parse = _parse
    sys.modules.setdefault("feedparser", feedparser_mod)

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


@pytest.fixture()
def mock_digest_feedback_container():
    """AsyncMock of the DigestFeedback Cosmos container."""
    container = AsyncMock()

    async def _empty_query(**kwargs):
            for _ in []:
                yield _

    container.query_items = _empty_query
    container.upsert_item = AsyncMock(return_value={})
    return container
