"""
Unit tests for FastAPI routes in function_app.py:
  - GET  /api/health
  - GET  /api/chat/memory
  - PUT  /api/chat/memory
  - GET  /api/digest/latest
  - GET  /api/insights/vault
  - POST /api/digest/run
  - GET  /api/digest/feedback
  - POST /api/digest/feedback
"""
from unittest.mock import AsyncMock, MagicMock, patch
from collections.abc import AsyncGenerator, Callable

from fastapi import HTTPException
import pytest


def _async_query(items: list[dict]) -> Callable[..., AsyncGenerator[dict, None]]:
    async def _query(**_kwargs: object) -> AsyncGenerator[dict, None]:
        for item in items:
            yield item

    return _query


@pytest.mark.unit
async def test_health_endpoint(async_client):
    response = await async_client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# ── Memory endpoints ─────────────────────────────────────────────────────────

@pytest.mark.unit
async def test_get_memory_returns_summary(async_client, mock_conversations_container):
    with patch("function_app.load_memory") as mock_load:
        from agents.memory import ConversationMemory
        mock_load.return_value = ConversationMemory(
            summary="User loves minimalism.",
            updated_at="2026-01-01T00:00:00Z",
        )
        response = await async_client.get("/api/chat/memory")

    assert response.status_code == 200
    data = response.json()
    assert data["summary"] == "User loves minimalism."
    assert data["updatedAt"] == "2026-01-01T00:00:00Z"


@pytest.mark.unit
async def test_put_memory_updates_summary(async_client):
    with patch("function_app.save_memory") as mock_save:
        mock_save.return_value = None
        response = await async_client.put(
            "/api/chat/memory",
            json={"summary": "Updated summary text."}
        )

    assert response.status_code == 200
    assert response.json()["status"] == "updated"
    mock_save.assert_called_once_with("test-user-001", "Updated summary text.")


@pytest.mark.unit
async def test_put_memory_rejects_too_long_summary(async_client):
    too_long = "x" * 2001
    response = await async_client.put("/api/chat/memory", json={"summary": too_long})
    assert response.status_code == 400


# ── Digest endpoint ───────────────────────────────────────────────────────────

@pytest.mark.unit
async def test_get_latest_digest_returns_suggestions(async_client, mock_digests_container):
    with patch("agents.db.get_digests_container", return_value=mock_digests_container):
        response = await async_client.get("/api/digest/latest")

    assert response.status_code == 200


@pytest.mark.unit
async def test_get_vault_insights_returns_payload(async_client):
    fake = {
        "generatedAt": "2026-03-04T10:00:00Z",
        "currency": "INR",
        "insufficientData": False,
        "behavioralInsights": {"topColorWearShare": {"color": "black", "pct": 63.0}},
        "cpwIntel": [],
    }
    with patch("agents.vault_insights.compute_vault_insights", new=AsyncMock(return_value=fake)):
        response = await async_client.get("/api/insights/vault?windowDays=90&targetCpw=100")

    assert response.status_code == 200
    data = response.json()
    assert data["currency"] == "INR"
    assert data["behavioralInsights"]["topColorWearShare"]["color"] == "black"
    assert data["behavioralInsights"]["topColorWearShare"]["pct"] == pytest.approx(63.0)


# ── POST /api/digest/run ─────────────────────────────────────────────────────

@pytest.mark.unit
async def test_post_digest_run_returns_ok_on_success(async_client):
    fake_digest = {
        "id": "test-user-001-abc123",
        "userId": "test-user-001",
        "suggestions": [{"item": "A navy blazer", "rationale": "Fills a formal-wear gap."}],
        "generatedAt": "2026-03-03T09:00:00Z",
        "wardrobeHash": "abc123",
        "stylesConsidered": ["minimalist"],
        "totalItems": 5,
    }
    with patch("agents.digest_agent.run_digest_for_user", return_value=fake_digest):
        response = await async_client.post("/api/digest/run")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "suggestions" in data["digest"]


@pytest.mark.unit
async def test_post_digest_run_returns_skipped_when_none(async_client):
    with patch("agents.digest_agent.run_digest_for_user", return_value=None):
        response = await async_client.post("/api/digest/run")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "skipped"


@pytest.mark.unit
async def test_post_digest_run_returns_generic_error_on_exception(async_client):
    """Internal exceptions must NOT leak detail to the client."""
    with patch("agents.digest_agent.run_digest_for_user", side_effect=RuntimeError("db connection failed")):
        response = await async_client.post("/api/digest/run")

    assert response.status_code == 500
    data = response.json()
    # Must NOT expose raw exception message
    assert "db connection failed" not in data.get("detail", "")
    assert data["detail"] == "Could not run digest."


# ── GET /api/digest/feedback ─────────────────────────────────────────────────

@pytest.mark.unit
async def test_get_digest_feedback_returns_list(async_client, mock_digest_feedback_container):
    with patch("agents.db.get_digest_feedback_container", return_value=mock_digest_feedback_container):
        response = await async_client.get("/api/digest/feedback", params={"digestId": "digest-001"})

    assert response.status_code == 200
    data = response.json()
    assert "feedback" in data
    assert isinstance(data["feedback"], list)


@pytest.mark.unit
async def test_get_digest_feedback_returns_stored_entries(async_client):
    mock_container = AsyncMock()

    async def _query(**kwargs: object) -> AsyncGenerator[dict, None]:
        yield {"suggestionIndex": 0, "signal": "up"}
        yield {"suggestionIndex": 1, "signal": "down"}

    mock_container.query_items = _query

    with patch("agents.db.get_digest_feedback_container", return_value=mock_container):
        response = await async_client.get("/api/digest/feedback", params={"digestId": "digest-001"})

    assert response.status_code == 200
    feedback = response.json()["feedback"]
    assert len(feedback) == 2
    assert feedback[0]["signal"] == "up"
    assert feedback[1]["signal"] == "down"


# ── POST /api/digest/feedback ─────────────────────────────────────────────────

@pytest.mark.unit
async def test_post_digest_feedback_up_signal(async_client, mock_digest_feedback_container):
    with patch("agents.db.get_digest_feedback_container", return_value=mock_digest_feedback_container):
        response = await async_client.post(
            "/api/digest/feedback",
            json={
                "digestId": "digest-001",
                "suggestionIndex": 0,
                "suggestionDescription": "A navy blazer",
                "signal": "up",
            },
        )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    mock_digest_feedback_container.upsert_item.assert_called_once()


@pytest.mark.unit
async def test_post_digest_feedback_down_signal(async_client, mock_digest_feedback_container):
    with patch("agents.db.get_digest_feedback_container", return_value=mock_digest_feedback_container):
        response = await async_client.post(
            "/api/digest/feedback",
            json={
                "digestId": "digest-001",
                "suggestionIndex": 2,
                "signal": "down",
            },
        )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.unit
async def test_post_digest_feedback_rejects_invalid_signal(async_client, mock_digest_feedback_container):
    """Signal values other than 'up'/'down' must return 400."""
    with patch("agents.db.get_digest_feedback_container", return_value=mock_digest_feedback_container):
        response = await async_client.post(
            "/api/digest/feedback",
            json={
                "digestId": "digest-001",
                "suggestionIndex": 0,
                "signal": "meh",
            },
        )

    assert response.status_code == 400


@pytest.mark.unit
async def test_list_moods_returns_items(async_client):
    container = MagicMock()
    container.query_items = _async_query([
        {"id": "minimalist-calm", "title": "Calm palette", "primaryMood": "minimalist", "_rid": "r1"},
        {"id": "minimalist-sheer", "title": "Sheer utility", "primaryMood": "minimalist", "_rid": "r2"},
    ])

    with patch("agents.db.get_moods_container", return_value=container):
        response = await async_client.get("/api/moods?primaryMood=Minimalist")

    assert response.status_code == 200
    payload = response.json()
    assert "primaryMoods" in payload
    assert len(payload["moods"]) == 2
    assert "_rid" not in payload["moods"][0]


@pytest.mark.unit
async def test_list_moods_rejects_invalid_mood(async_client):
    with patch("agents.db.get_moods_container", return_value=MagicMock()):
        response = await async_client.get("/api/moods?primaryMood=bizarro")

    assert response.status_code == 400


@pytest.mark.unit
async def test_get_mood_by_id_not_found(async_client):
    container = MagicMock()
    container.read_item = AsyncMock(side_effect=Exception("No item"))

    with patch("agents.db.get_moods_container", return_value=container):
        response = await async_client.get("/api/moods/does-not-exist")

    assert response.status_code == 404


@pytest.mark.unit
async def test_get_mood_by_id_returns_item(async_client):
    container = MagicMock()
    container.read_item = AsyncMock(return_value={
        "id": "minimalist-calm",
        "_rid": "r1",
        "title": "Calm palette",
        "primaryMood": "minimalist",
    })

    with patch("agents.db.get_moods_container", return_value=container):
        response = await async_client.get("/api/moods/minimalist-calm")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "minimalist-calm"
    assert "_rid" not in payload


@pytest.mark.unit
async def test_seed_sitemap_endpoint_async(async_client):
    with patch("agents.sitemap_seeder.run_sitemap_seeder", return_value=None):
        response = await async_client.post("/api/moods/seed")

    assert response.status_code == 200
    assert response.json() is None


@pytest.mark.unit
async def test_list_scraper_sources_includes_subscription_state(async_client):
    scraper_container = MagicMock()
    scraper_container.query_items = _async_query([
        {"id": "source-1", "url": "https://example.com", "selector": {"css": ".item"}},
    ])
    subscriptions_container = MagicMock()
    subscriptions_container.query_items = _async_query([])

    with patch("agents.db.get_scraper_sources_container", return_value=scraper_container), patch(
        "agents.db.get_user_source_subscriptions_container", return_value=subscriptions_container
    ):
        response = await async_client.get("/api/scraper/sources?userId=user-1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["sources"][0]["id"] == "source-1"
    assert payload["sources"][0]["subscribed"] is False
    assert payload["sources"][0]["needsClientIngest"] is False


@pytest.mark.unit
async def test_post_scraper_source_rejects_http_error(async_client):
    with patch(
        "function_app._validate_scraper_url",
        side_effect=HTTPException(status_code=400, detail="URL must use https"),
    ):
        response = await async_client.post(
            "/api/scraper/sources",
            json={"url": "http://bad.example", "source_type": "general", "name": "Bad"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "URL must use https"


@pytest.mark.unit
async def test_post_scraper_source_creates_source(async_client):
    container = MagicMock()
    container.upsert_item = AsyncMock()

    with patch("agents.db.get_scraper_sources_container", return_value=container), patch(
        "function_app._validate_scraper_url",
        return_value=None,
    ), patch("agents.scrapers.config_generator.generate_selector_config", return_value={"type": "generic"}):
        response = await async_client.post(
            "/api/scraper/sources",
            json={"url": "https://example.com", "source_type": "reddit", "name": "Example"},
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["sourceId"] == "brand-example"
    assert payload["name"] == "Example"
    container.upsert_item.assert_awaited()


@pytest.mark.unit
async def test_post_scraper_source_subscription(async_client):
    container = MagicMock()
    container.upsert_item = AsyncMock()

    with patch("agents.db.get_user_source_subscriptions_container", return_value=container), patch(
        "agents.db.get_scraper_sources_container",
        return_value=MagicMock(),
    ):
        response = await async_client.post(
            "/api/scraper/subscribe/source-1",
            json={},
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["subscribed"] is True
    assert payload["sourceId"] == "source-1"


@pytest.mark.unit
async def test_delete_scraper_source_subscription(async_client):
    container = MagicMock()
    container.read_item = AsyncMock(return_value={"id": "user-1-source-1", "isActive": True})
    container.upsert_item = AsyncMock()

    with patch("agents.db.get_user_source_subscriptions_container", return_value=container):
        response = await async_client.delete("/api/scraper/subscribe/source-1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["sourceId"] == "source-1"
    assert payload["subscribed"] is False
