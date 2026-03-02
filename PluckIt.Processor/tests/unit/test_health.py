"""
Tests for the health endpoint and basic FastAPI app wiring.
These are lightweight smoke tests with no Cosmos/OpenAI calls.
"""
import pytest


@pytest.mark.unit
async def test_health_returns_ok(async_client):
    response = await async_client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "pluckit" in data["service"].lower()


@pytest.mark.unit
async def test_health_no_auth_required(async_client):
    """Health endpoint must be accessible without any auth header."""
    response = await async_client.get("/api/health")
    assert response.status_code == 200
