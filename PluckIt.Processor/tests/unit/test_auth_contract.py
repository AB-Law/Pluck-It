"""
Unit tests for mobile auth session endpoints:
- POST /api/auth/mobile-token
- POST /api/auth/refresh
- POST /api/auth/revoke
"""

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from unittest.mock import AsyncMock, patch
from collections.abc import Callable

import pytest


def _hash_token(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def _iso(value: datetime) -> str:
    return value.replace(microsecond=0, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _query_items_for(items: dict[str, list[dict]]) -> Callable[..., object]:
    async def query_items(**kwargs):
        query = kwargs.get("query", "") or ""
        if "refreshTokenHash" in query:
            source = items.get("by_refresh", [])
        elif "c.userId" in query or "userId" in query:
            source = items.get("by_user", [])
        else:
            source = []

        for item in source:
            yield item

    return query_items


@pytest.mark.unit
async def test_mobile_token_exchange_returns_session_tokens(async_client):
    container = AsyncMock()
    container.upsert_item = AsyncMock(return_value={})

    with (
        patch("function_app._verify_google_token", return_value="google-user-001"),
        patch("agents.db.get_refresh_tokens_container", return_value=container),
    ):
        response = await async_client.post(
            "/api/auth/mobile-token",
            json={"id_token": "google-token"},
        )

    assert response.status_code == 200
    payload = response.json()

    assert payload["access_token"].startswith("at-")
    assert payload["refresh_token"].startswith("rt-")
    assert payload["token_type"] == "Bearer"
    assert payload["refresh_token_rotation"] == "single-use"
    assert payload["refresh_token_revoke_on_logout"] is True
    assert payload["user_id"] == "google-user-001"
    container.upsert_item.assert_awaited_once()

    stored = container.upsert_item.await_args.args[0]
    assert stored["userId"] == "google-user-001"
    assert stored["accessToken"].startswith("at-")
    assert stored["refreshToken"].startswith("rt-")


@pytest.mark.unit
async def test_refresh_session_rotates_tokens_and_replaces_previous(async_client):
    now = datetime(2026, 3, 14, 12, 0, 0, tzinfo=timezone.utc)
    old_refresh_token = "rt-old"
    old_access_token = "at-old"
    existing_session = {
        "id": "session-old",
        "userId": "test-user-001",
        "accessToken": old_access_token,
        "accessTokenHash": _hash_token(old_access_token),
        "accessTokenExpiresAt": _iso(now + timedelta(minutes=30)),
        "refreshToken": old_refresh_token,
        "refreshTokenHash": _hash_token(old_refresh_token),
        "refreshTokenExpiresAt": _iso(now + timedelta(days=10)),
        "issuedAt": _iso(now),
        "revoked": False,
        "revokedOnLogout": True,
        "tokenRotation": "single-use",
    }

    container = AsyncMock()
    container.query_items = _query_items_for({"by_refresh": [existing_session]})
    container.upsert_item = AsyncMock(return_value={})

    with patch("agents.db.get_refresh_tokens_container", return_value=container):
        response = await async_client.post(
            "/api/auth/refresh",
            json={"refresh_token": old_refresh_token},
        )

    assert response.status_code == 200
    payload = response.json()

    assert payload["access_token"] != old_access_token
    assert payload["refresh_token"] != old_refresh_token

    assert container.upsert_item.await_count == 2
    old_persisted = container.upsert_item.await_args_list[0].args[0]
    new_persisted = container.upsert_item.await_args_list[1].args[0]

    assert old_persisted["revoked"] is True
    assert old_persisted["replacedWithRefreshTokenHash"] == new_persisted["refreshTokenHash"]
    assert new_persisted["previousRefreshTokenHash"] == _hash_token(old_refresh_token)
    assert payload["access_token"] == new_persisted["accessToken"]


@pytest.mark.unit
async def test_refresh_session_rejects_missing_refresh_token(async_client):
    response = await async_client.post(
        "/api/auth/refresh",
        json={},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Missing required field: refresh_token."


@pytest.mark.unit
async def test_refresh_session_rejects_expired_refresh_token(async_client):
    now = datetime(2026, 3, 14, 12, 0, 0, tzinfo=timezone.utc)
    old_refresh_token = "rt-expired"
    old_access_token = "at-expired"
    existing_session = {
        "id": "session-expired",
        "userId": "test-user-001",
        "accessToken": old_access_token,
        "accessTokenHash": _hash_token(old_access_token),
        "accessTokenExpiresAt": _iso(now - timedelta(hours=1)),
        "refreshToken": old_refresh_token,
        "refreshTokenHash": _hash_token(old_refresh_token),
        "refreshTokenExpiresAt": _iso(now - timedelta(minutes=1)),
        "issuedAt": _iso(now - timedelta(hours=1)),
        "revoked": False,
        "revokedOnLogout": True,
        "tokenRotation": "single-use",
    }

    container = AsyncMock()
    container.query_items = _query_items_for({"by_refresh": [existing_session]})
    container.upsert_item = AsyncMock(return_value={})

    with patch("agents.db.get_refresh_tokens_container", return_value=container):
        response = await async_client.post(
            "/api/auth/refresh",
            json={"refresh_token": old_refresh_token},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired refresh token."
    assert container.upsert_item.await_count == 1

    revoked_session = container.upsert_item.await_args_list[0].args[0]
    assert revoked_session["revoked"] is True
    assert revoked_session["refreshToken"] == old_refresh_token


@pytest.mark.unit
async def test_revoke_session_by_refresh_token_revokes_all_sessions(async_client):
    now = datetime(2026, 3, 14, 12, 0, 0, tzinfo=timezone.utc)
    token_to_revoke = "rt-revoke"
    active_session = {
        "id": "session-main",
        "userId": "test-user-002",
        "accessToken": "at-main",
        "accessTokenHash": _hash_token("at-main"),
        "accessTokenExpiresAt": _iso(now + timedelta(hours=1)),
        "refreshToken": token_to_revoke,
        "refreshTokenHash": _hash_token(token_to_revoke),
        "refreshTokenExpiresAt": _iso(now + timedelta(days=10)),
        "issuedAt": _iso(now),
        "revoked": False,
        "revokedOnLogout": True,
        "tokenRotation": "single-use",
    }
    secondary_session = {
        "id": "session-other",
        "userId": "test-user-002",
        "accessToken": "at-other",
        "accessTokenHash": _hash_token("at-other"),
        "accessTokenExpiresAt": _iso(now + timedelta(hours=1)),
        "refreshToken": "rt-other",
        "refreshTokenHash": _hash_token("rt-other"),
        "refreshTokenExpiresAt": _iso(now + timedelta(days=10)),
        "issuedAt": _iso(now),
        "revoked": False,
        "revokedOnLogout": True,
        "tokenRotation": "single-use",
    }

    container = AsyncMock()
    container.query_items = _query_items_for({"by_refresh": [active_session], "by_user": [active_session, secondary_session]})
    container.upsert_item = AsyncMock(return_value={})

    with patch("agents.db.get_refresh_tokens_container", return_value=container):
        response = await async_client.post(
            "/api/auth/revoke",
            json={"refresh_token": token_to_revoke},
        )

    assert response.status_code == 200
    assert response.json() == {"revoked": True}
    assert container.upsert_item.await_count == 2

    first = container.upsert_item.await_args_list[0].args[0]
    second = container.upsert_item.await_args_list[1].args[0]
    assert first["revoked"] is True
    assert second["revoked"] is True
    assert first["revokedOnLogout"] is True
    assert second["revokedOnLogout"] is True


@pytest.mark.unit
async def test_revoke_session_requires_identifier(async_client):
    response = await async_client.post(
        "/api/auth/revoke",
        json={},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Missing refresh_token or user_id."


