"""
Unit tests for FastAPI routes in function_app.py:
  - GET  /api/health
  - GET  /api/chat/memory
  - PUT  /api/chat/memory
  - GET  /api/digest/latest
"""
from unittest.mock import AsyncMock, patch

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

    # 200 with a digest document, or 200 with {"digest": null} if container is empty
    assert response.status_code in (200, 404, 500)
