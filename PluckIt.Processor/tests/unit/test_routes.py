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
import asyncio
from types import SimpleNamespace
from contextlib import suppress
from unittest.mock import ANY, AsyncMock, MagicMock, patch
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from function_app import _build_json_etag

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


# ── Chat endpoint ─────────────────────────────────────────────────────────────


@pytest.mark.unit
async def test_post_chat_body_trace_id_is_forwarded_to_stylist_agent(async_client):
    async def fake_chat_stream() -> AsyncIterator[str]:
        yield "data: {\"type\":\"token\",\"content\":\"hello\"}\n\n"
        yield "data: {\"type\":\"done\"}\n\n"

    with (
        patch("function_app.load_memory", new=AsyncMock(return_value=SimpleNamespace(summary=""))),
        patch("function_app.stream_stylist_response") as mock_stream_stylist_response,
        patch("function_app.maybe_summarize", new=AsyncMock(return_value=None)),
    ):
        mock_stream_stylist_response.return_value = fake_chat_stream()
        response = await async_client.post(
            "/api/chat",
            json={
                "message": "hello",
                "recentMessages": [],
                "selectedItemIds": None,
                "traceId": "trace-body-1",
            },
        )

    assert response.status_code == 200
    body = (await response.aread()).decode()
    assert '"traceId": "trace-body-1"' in body
    call_kwargs = mock_stream_stylist_response.call_args.kwargs
    assert call_kwargs["trace_id"] == "trace-body-1"


@pytest.mark.unit
async def test_post_chat_uses_x_trace_header_when_body_missing(async_client):
    async def fake_chat_stream() -> AsyncIterator[str]:
        yield "data: {\"type\":\"token\",\"content\":\"hello\"}\n\n"
        yield "data: {\"type\":\"done\"}\n\n"

    with (
        patch("function_app.load_memory", new=AsyncMock(return_value=SimpleNamespace(summary=""))),
        patch("function_app.stream_stylist_response") as mock_stream_stylist_response,
        patch("function_app.maybe_summarize", new=AsyncMock(return_value=None)),
    ):
        mock_stream_stylist_response.return_value = fake_chat_stream()
        response = await async_client.post(
            "/api/chat",
            headers={"X-Trace-Id": "trace-header-1"},
            json={"message": "hello", "recentMessages": [], "selectedItemIds": None},
        )

    assert response.status_code == 200
    body = (await response.aread()).decode()
    assert '"traceId": "trace-header-1"' in body
    call_kwargs = mock_stream_stylist_response.call_args.kwargs
    assert call_kwargs["trace_id"] == "trace-header-1"


@pytest.mark.unit
async def test_post_chat_includes_trace_id_in_memory_update_event(async_client):
    async def fake_chat_stream() -> AsyncIterator[str]:
        yield "data: {\"type\":\"token\",\"content\":\"hello\"}\n\n"
        yield "data: {\"type\":\"done\"}\n\n"

    with (
        patch("function_app.load_memory", new=AsyncMock(return_value=SimpleNamespace(summary=""))),
        patch("function_app.stream_stylist_response") as mock_stream_stylist_response,
        patch("function_app.maybe_summarize", new=AsyncMock(return_value="summary now")),
    ):
        mock_stream_stylist_response.return_value = fake_chat_stream()
        response = await async_client.post(
            "/api/chat",
            json={
                "message": "hello",
                "recentMessages": [],
                "selectedItemIds": None,
                "traceId": "trace-memory-1",
            },
        )

    assert response.status_code == 200
    body = (await response.aread()).decode()
    assert '"type": "memory_update"' in body
    assert '"traceId": "trace-memory-1"' in body
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
    assert "etag" in response.headers
    assert response.headers["cache-control"] == "no-cache, no-store, max-age=0, must-revalidate"


@pytest.mark.unit
async def test_get_latest_digest_returns_304_when_match(async_client, mock_digests_container):
    with patch("agents.db.get_digests_container", return_value=mock_digests_container):
        first = await async_client.get("/api/digest/latest")

    payload = {"digest": {
        "id": "digest-001",
        "userId": "test-user-001",
        "suggestions": [{"item": "A white linen shirt", "reason": "Versatile base"}],
        "generatedAt": "2026-01-06T09:00:00Z",
    }}
    expected_etag = _build_json_etag(payload)

    assert first.headers["etag"] == expected_etag

    with patch("agents.db.get_digests_container", return_value=mock_digests_container):
        second = await async_client.get("/api/digest/latest", headers={"if-none-match": expected_etag})

    assert second.status_code == 304


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


@pytest.mark.unit
async def test_get_vault_insights_returns_304_when_match(async_client):
    fake = {
        "generatedAt": "2026-03-04T10:00:00Z",
        "currency": "INR",
        "insufficientData": False,
        "behavioralInsights": {"topColorWearShare": {"color": "black", "pct": 63.0}},
        "cpwIntel": [],
    }
    expected_etag = _build_json_etag(fake)
    with patch("agents.vault_insights.compute_vault_insights", new=AsyncMock(return_value=fake)):
        first = await async_client.get("/api/insights/vault?windowDays=90&targetCpw=100")

    assert first.status_code == 200
    assert first.headers["etag"] == expected_etag
    assert first.headers["cache-control"] == "no-cache, no-store, max-age=0, must-revalidate"

    with patch("agents.vault_insights.compute_vault_insights", new=AsyncMock(return_value=fake)):
        second = await async_client.get(
            "/api/insights/vault?windowDays=90&targetCpw=100",
            headers={"if-none-match": expected_etag},
        )

    assert second.status_code == 304


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


@pytest.mark.unit
async def test_post_scraper_item_feedback_up_queues_background_taste_job(async_client):
    container = MagicMock()
    container.read_item = AsyncMock(return_value={"id": "item-001", "imageUrl": "https://cdn.example.com/item.png", "galleryImages": ["https://cdn.example.com/item-a.png", "https://cdn.example.com/item-b.png"], "scoreSignal": 0})
    container.upsert_item = AsyncMock(return_value={"id": "item-001", "scoreSignal": 1})

    with patch("agents.db.get_scraped_items_container", return_value=container), patch(
        "function_app._maybe_enqueue_taste_job", return_value=True
    ) as mock_enqueue:
        response = await async_client.post(
            "/api/scraper/items/item-001/feedback",
            json={"signal": "up", "galleryImageIndex": 1},
        )

    assert response.status_code == 200
    assert response.json() == {"itemId": "item-001", "signal": "up", "scoreSignal": 1}
    container.read_item.assert_awaited_once_with(item="item-001", partition_key="global")
    mock_enqueue.assert_called_once_with(
        user_id="test-user-001",
        item_id="item-001",
        image_url="https://cdn.example.com/item-b.png",
        gallery_image_index=1,
        signal="up",
    )


@pytest.mark.unit
async def test_post_scraper_item_feedback_down_skips_taste_job(async_client):
    container = MagicMock()
    container.read_item = AsyncMock(return_value={"id": "item-001", "imageUrl": "https://cdn.example.com/item.png", "scoreSignal": 0})
    container.upsert_item = AsyncMock(return_value={"id": "item-001", "scoreSignal": -1})

    with patch("agents.db.get_scraped_items_container", return_value=container), patch(
        "function_app._maybe_enqueue_taste_job"
    ) as mock_enqueue:
        response = await async_client.post(
            "/api/scraper/items/item-001/feedback",
            json={"signal": "down"},
        )

    assert response.status_code == 200
    assert response.json() == {"itemId": "item-001", "signal": "down", "scoreSignal": -1}
    mock_enqueue.assert_not_called()


@pytest.mark.unit
async def test_feedback_rejects_invalid_signal(async_client):
    response = await async_client.post(
        "/api/scraper/items/item-001/feedback",
        json={"signal": "meh"},
    )

    assert response.status_code == 400


@pytest.mark.unit
def test_maybe_enqueue_taste_job_dedupe_guard():
    from function_app import (
        _maybe_enqueue_taste_job,
        _TASTE_JOB_COMPLETED,
        _TASTE_JOB_IN_FLIGHT,
    )

    _TASTE_JOB_IN_FLIGHT.clear()
    _TASTE_JOB_COMPLETED.clear()

    queue: list[dict] = []

    class _Queue:
        def put_nowait(self, item: dict) -> None:
            queue.append(item)

    with patch("function_app._ensure_taste_worker_running"), patch("function_app._get_taste_job_queue", return_value=_Queue()):
        first = _maybe_enqueue_taste_job(
            user_id="user-001",
            item_id="item-001",
            image_url="https://cdn.example.com/item.png",
            gallery_image_index=0,
            signal="up",
        )
        duplicate = _maybe_enqueue_taste_job(
            user_id="user-001",
            item_id="item-001",
            image_url="https://cdn.example.com/item.png",
            gallery_image_index=0,
            signal="up",
        )

    assert first is True
    assert duplicate is False
    assert len(queue) == 1
    assert any("job_id" in item for item in queue)


@pytest.mark.unit
async def test_run_in_executor_with_retry_retries_and_succeeds():
    import function_app

    calls: dict[str, int] = {"count": 0}

    def _operation() -> str:
        calls["count"] += 1
        if calls["count"] < 2:
            raise RuntimeError("transient")
        return "ok"

    with patch("function_app.random.uniform", return_value=0.0):
        result = await function_app._run_in_executor_with_retry(
            _operation,
            operation_name="test-op",
            max_attempts=3,
            base_delay_seconds=0.0,
        )

    assert result == "ok"
    assert calls["count"] == 2


@pytest.mark.unit
async def test_run_in_executor_with_retry_bubbles_after_exhaustion():
    import function_app

    calls: dict[str, int] = {"count": 0}

    def _operation() -> str:
        calls["count"] += 1
        raise RuntimeError("always-fails")

    with patch("function_app.random.uniform", return_value=0.0):
        with pytest.raises(RuntimeError):
            await function_app._run_in_executor_with_retry(
                _operation,
                operation_name="test-op",
                max_attempts=2,
                base_delay_seconds=0.0,
            )

    assert calls["count"] == 2


@pytest.mark.unit
async def test_run_taste_profile_job_updates_profile_when_inferred_data_exists():
    import function_app

    job = {
        "job_id": "job-abc",
        "user_id": "test-user-001",
        "item_id": "item-001",
        "image_url": "https://cdn.example.com/item.png",
    }

    def _fake_retry(operation, *, operation_name, max_attempts, base_delay_seconds):
        if "analyze_image" in operation_name:
            return {
                "styleKeywords": ["minimal", "cotton"],
                "colors": ["white"],
                "garments": ["shirt"],
                "brand": "Test",
            }
        return None

    with patch(
        "function_app._run_in_executor_with_retry",
        new=AsyncMock(side_effect=_fake_retry),
    ) as mock_retry:
        await function_app._run_taste_profile_job(job)

    assert mock_retry.call_count == 2
    mock_retry.assert_any_call(
        ANY,
        operation_name="analyze_image:item-001:job-abc",
        max_attempts=3,
        base_delay_seconds=function_app._TASTE_JOB_BASE_BACKOFF_SECONDS,
    )
    mock_retry.assert_any_call(
        ANY,
        operation_name="update_user_profile:item-001:job-abc",
        max_attempts=2,
        base_delay_seconds=function_app._TASTE_JOB_BASE_BACKOFF_SECONDS * 2,
    )


@pytest.mark.unit
async def test_taste_job_worker_logs_and_continues_on_failure():
    import function_app

    queue = asyncio.Queue()
    await queue.put({"job_id": "job-1", "user_id": "u-1", "item_id": "item-1", "image_url": "https://cdn.example.com/1.png"})
    await queue.put({"job_id": "job-2", "user_id": "u-1", "item_id": "item-2", "image_url": "https://cdn.example.com/2.png"})

    def _run_taste_profile_job_side_effect(job: dict[str, object]) -> None:
        if job["job_id"] == "job-1":
            raise RuntimeError("transient job failure")

    with patch("function_app._get_taste_job_queue", return_value=queue), patch(
        "function_app._run_taste_profile_job",
        side_effect=_run_taste_profile_job_side_effect,
    ) as mock_run:
        worker_task = asyncio.create_task(function_app._taste_job_worker())
        await queue.join()
        worker_task.cancel()
        with suppress(asyncio.CancelledError):
            await worker_task

    assert mock_run.call_count == 2


@pytest.mark.unit
async def test_taste_job_worker_persists_pending_jobs_on_cancellation():
    import function_app

    queue = asyncio.Queue()
    await queue.put({"job_id": "job-1", "user_id": "u-1", "item_id": "item-1", "image_url": "https://cdn.example.com/1.png"})
    await queue.put({"job_id": "job-2", "user_id": "u-1", "item_id": "item-2", "image_url": "https://cdn.example.com/2.png"})
    job_started = asyncio.Event()

    async def _block_job(_: dict[str, object]) -> None:
        job_started.set()
        await asyncio.Future()

    with patch("function_app._get_taste_job_queue", return_value=queue), patch(
        "function_app._run_taste_profile_job",
        side_effect=_block_job,
    ) as mock_run, patch("function_app._persist_taste_job") as mock_persist:
        worker_task = asyncio.create_task(function_app._taste_job_worker())
        await job_started.wait()
        worker_task.cancel()
        with suppress(asyncio.CancelledError):
            await worker_task

    assert mock_run.call_count == 1
    assert mock_persist.call_count == 2


@pytest.mark.unit
async def test_taste_job_worker_marks_completed_only_on_success():
    import function_app

    queue = asyncio.Queue()
    await queue.put({"job_id": "job-fail", "user_id": "u-1", "item_id": "item-1", "image_url": "https://cdn.example.com/1.png"})

    with patch("function_app._get_taste_job_queue", return_value=queue), patch(
        "function_app._run_taste_profile_job",
        side_effect=RuntimeError("failure"),
    ), patch("function_app._mark_taste_job_completed") as mark_completed:
        worker_task = asyncio.create_task(function_app._taste_job_worker())
        await queue.join()
        worker_task.cancel()
        with suppress(asyncio.CancelledError):
            await worker_task

    mark_completed.assert_not_called()
