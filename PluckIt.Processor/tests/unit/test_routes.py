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

import pytest


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
    assert data["behavioralInsights"]["topColorWearShare"]["pct"] == 63.0


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

    async def _query(**kwargs):
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
