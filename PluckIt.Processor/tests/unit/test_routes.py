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
import base64
import json
import os
import time
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock, patch
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from function_app import _build_json_etag, _infer_clothing_metadata

from fastapi import HTTPException
import pytest


def _async_query(items: list[dict]) -> Callable[..., AsyncGenerator[dict, None]]:
    async def _query(**_kwargs: object) -> AsyncGenerator[dict, None]:
        for item in items:
            yield item

    return _query


def _build_test_jwt(audience: str, issuer: str, alg: str, exp_offset: int = 300) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": alg, "typ": "JWT"}).encode("ascii")).decode("ascii").rstrip("=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"aud": audience, "iss": issuer, "exp": int(time.time()) + exp_offset}).encode("ascii")
    ).decode("ascii").rstrip("=")
    signature = base64.urlsafe_b64encode(b"signature").decode("ascii").rstrip("=")
    return f"{header}.{payload}.{signature}"


@pytest.mark.unit
async def test_health_endpoint(async_client):
    response = await async_client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.unit
async def test_post_extract_metadata_valid_payload_returns_deterministic_shape(async_client):
    async_image = base64.b64encode(b"fake-image").decode("ascii")

    with patch("function_app._infer_clothing_metadata") as mock_infer:
        mock_infer.return_value = {
            "brand": "Acme",
            "category": "Outerwear",
            "tags": ["cotton", "oversized", "casual"],
            "colours": [{"name": "Navy", "hex": "#001122"}],
        }
        response = await async_client.post(
            "/api/extract-clothing-metadata",
            headers={"X-API-Key": "test-metadata-key"},
            json={
                "item_id": "item-1",
                "image_bytes_base64": async_image,
                "media_type": "image/jpeg",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["brand"] == "Acme"
    assert payload["category"] == "Outerwear"
    assert payload["tags"] == ["cotton", "oversized", "casual"]
    assert payload["colours"] == [{"name": "Navy", "hex": "#001122"}]


@pytest.mark.unit
async def test_post_extract_metadata_returns_400_on_invalid_payload(async_client):
    response = await async_client.post(
        "/api/extract-clothing-metadata",
        headers={"X-API-Key": "test-metadata-key"},
        json={
            "item_id": "item-1",
            "media_type": "image/jpeg",
            "image_bytes_base64": "%%%invalid%%",
        },
    )
    assert response.status_code == 400


@pytest.mark.unit
async def test_post_extract_metadata_forwards_trace_headers_to_infer(async_client):
    async_image = base64.b64encode(b"fake-image").decode("ascii")
    with patch("function_app._infer_clothing_metadata") as mock_infer:
        mock_infer.return_value = {"brand": None, "category": None, "tags": [], "colours": []}
        response = await async_client.post(
            "/api/extract-clothing-metadata",
            headers={
                "X-API-Key": "test-metadata-key",
                "X-Request-Id": "request-123",
                "traceparent": "00-11223344556677889900aabbccddeeff-1234567890abcdef-01",
            },
            json={
                "item_id": "item-1",
                "image_bytes_base64": async_image,
                "media_type": "image/jpeg",
            },
        )

    assert response.status_code == 200
    assert mock_infer.call_count == 1
    _, call_kwargs = mock_infer.call_args
    assert call_kwargs["request_id"] == "request-123"
    assert call_kwargs["traceparent"] == "00-11223344556677889900aabbccddeeff-1234567890abcdef-01"


@pytest.mark.unit
async def test_post_extract_metadata_forwards_x_trace_id_header_to_request_id(async_client):
    async_image = base64.b64encode(b"fake-image").decode("ascii")
    with patch("function_app._infer_clothing_metadata") as mock_infer:
        mock_infer.return_value = {"brand": None, "category": None, "tags": [], "colours": []}
        response = await async_client.post(
            "/api/extract-clothing-metadata",
            headers={"X-API-Key": "test-metadata-key", "X-Trace-Id": "trace-header-1"},
            json={
                "item_id": "item-1",
                "image_bytes_base64": async_image,
                "media_type": "image/jpeg",
            },
        )

    assert response.status_code == 200
    _, call_kwargs = mock_infer.call_args
    assert call_kwargs["request_id"] == "trace-header-1"


@pytest.mark.unit
def test_infer_clothing_metadata_attaches_component_label_to_langfuse_metadata():
    fake_llm_response = MagicMock()
    fake_llm_response.content = json.dumps(
        {"brand": "Acme", "category": "Outerwear", "tags": ["cotton"], "colours": [{"name": "Navy", "hex": "#001122"}]}
    )
    fake_llm = MagicMock()
    fake_llm.invoke = MagicMock(return_value=fake_llm_response)

    with (
        patch.dict(
            os.environ,
            {
                "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com/",
                "AZURE_OPENAI_API_KEY": "test-key",
                "AZURE_OPENAI_DEPLOYMENT": "gpt-4.1-mini",
            },
        ),
        patch("function_app._build_langfuse_callbacks") as mock_build,
        patch("langchain_openai.AzureChatOpenAI", return_value=fake_llm),
    ):
        result = _infer_clothing_metadata(
            b"fake-image",
            "image/jpeg",
            "item-1",
            request_id="request-123",
        )

    assert result["brand"] == "Acme"
    assert result["category"] == "Outerwear"
    assert result["tags"] == ["cotton"]
    assert result["colours"] == [{"name": "Navy", "hex": "#001122"}]
    mock_build.assert_called_once()
    call_args, call_kwargs = mock_build.call_args
    assert len(call_args) == 1
    assert isinstance(call_args[0], str)
    assert len(call_args[0]) == 32
    assert call_kwargs == {
        "user_id": "item-1",
        "metadata": {"component": "clothing-metadata", "trace_label": "clothing-metadata"},
    }


@pytest.mark.unit
async def test_post_extract_metadata_rejects_invalid_api_key(async_client):
    response = await async_client.post(
        "/api/extract-clothing-metadata",
        headers={"X-API-Key": "wrong"},
        json={
            "item_id": "item-1",
            "image_bytes_base64": base64.b64encode(b"fake-image").decode("ascii"),
            "media_type": "image/jpeg",
        },
    )
    assert response.status_code == 401


@pytest.mark.unit
async def test_post_extract_metadata_invalid_model_payload_normalises_to_empty(async_client):
    async_image = base64.b64encode(b"fake-image").decode("ascii")
    with patch("function_app._infer_clothing_metadata") as mock_infer:
        mock_infer.return_value = {
            "brand": 42,
            "category": None,
            "tags": "not-a-list",
            "colours": [{"name": "Navy", "hex": "#001122"}, {"name": "", "hex": "#123456"}, {"name": "X", "hex": "bad"}],
        }
        response = await async_client.post(
            "/api/extract-clothing-metadata",
            headers={"X-API-Key": "test-metadata-key"},
            json={
                "item_id": "item-1",
                "image_bytes_base64": async_image,
                "media_type": "image/jpeg",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["brand"] is None
    assert payload["category"] is None
    assert payload["tags"] == []
    assert payload["colours"] == [{"name": "Navy", "hex": "#001122"}]


@pytest.mark.unit
async def test_post_extract_metadata_azuread_mode_accepts_valid_bearer_token(async_client):
    audience = "metadata-api-access"
    issuer = "https://login.microsoftonline.com/test-issuer/v2.0"
    token = _build_test_jwt(audience=audience, issuer=issuer, alg="RS256")
    discovery_payload = {"jwks_uri": "https://login.microsoftonline.com/common/discovery/v2.0/keys"}
    jwks_key_payload = {"kty": "RSA", "kid": "test-kid", "n": "AQAB", "e": "AQAB"}

    with patch.dict(
        os.environ,
        {
            "METADATA_EXTRACT_AUTH_MODE": "azuread",
            "METADATA_EXTRACT_AZURE_AD_AUDIENCE": audience,
            "METADATA_EXTRACT_AZURE_AD_ISSUER": issuer,
        },
    ), patch(
        "function_app._fetch_oidc_discovery_async", return_value=discovery_payload
    ) as mock_discovery, patch(
        "function_app._fetch_jwks_keys_async", return_value=[jwks_key_payload]
    ) as mock_jwks, patch(
        "function_app.jwt.algorithms.RSAAlgorithm.from_jwk", return_value="public-key"
    ) as mock_from_jwk, patch(
        "function_app.jwt.decode", return_value={"aud": audience, "iss": issuer, "exp": int(time.time()) + 300}
    ) as mock_jwt_decode, patch(
        "function_app._infer_clothing_metadata"
    ) as mock_infer:
        mock_infer.return_value = {"brand": None, "category": None, "tags": [], "colours": []}
        response = await async_client.post(
            "/api/extract-clothing-metadata",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "item_id": "item-1",
                "image_bytes_base64": base64.b64encode(b"fake-image").decode("ascii"),
                "media_type": "image/jpeg",
            },
        )

    assert response.status_code == 200
    mock_discovery.assert_called_once_with(issuer)
    mock_jwks.assert_called_once_with(discovery_payload["jwks_uri"])
    mock_from_jwk.assert_called_once_with(json.dumps(jwks_key_payload))
    mock_jwt_decode.assert_called_once_with(
        token,
        "public-key",
        algorithms=["RS256"],
        audience=audience,
        issuer=issuer,
        options={"require": ["exp"]},
    )
    mock_infer.assert_called_once()


@pytest.mark.unit
async def test_post_extract_metadata_azuread_mode_rejects_none_algorithm(async_client):
    audience = "metadata-api-access"
    issuer = "https://login.microsoftonline.com/test-issuer/v2.0"
    token = _build_test_jwt(audience=audience, issuer=issuer, alg="none")

    with patch.dict(
        os.environ,
        {
            "METADATA_EXTRACT_AUTH_MODE": "azuread",
            "METADATA_EXTRACT_AZURE_AD_AUDIENCE": audience,
            "METADATA_EXTRACT_AZURE_AD_ISSUER": issuer,
        },
    ), patch("function_app._infer_clothing_metadata") as mock_infer:
        response = await async_client.post(
            "/api/extract-clothing-metadata",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "item_id": "item-1",
                "image_bytes_base64": base64.b64encode(b"fake-image").decode("ascii"),
                "media_type": "image/jpeg",
            },
        )

    assert response.status_code == 401
    mock_infer.assert_not_called()


@pytest.mark.unit
async def test_post_extract_metadata_azuread_mode_rejects_missing_bearer(async_client):
    with patch.dict(os.environ, {"METADATA_EXTRACT_AUTH_MODE": "azuread"}):
        response = await async_client.post(
            "/api/extract-clothing-metadata",
            headers={"X-API-Key": "irrelevant"},
            json={
                "item_id": "item-1",
                "image_bytes_base64": base64.b64encode(b"fake-image").decode("ascii"),
                "media_type": "image/jpeg",
            },
        )
    assert response.status_code == 401


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
async def test_post_digest_run_forwards_x_trace_id(async_client):
    with patch("agents.digest_agent.run_digest_for_user", return_value={"id": "digest-001", "suggestions": []}) as mock_run:
        response = await async_client.post("/api/digest/run", headers={"X-Trace-Id": "digest-trace-header"})

    assert response.status_code == 200
    call_args, _ = mock_run.call_args
    assert len(call_args) == 3
    assert call_args[1] is True
    assert call_args[2] == "digest-trace-header"


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
        "function_app._maybe_enqueue_taste_job",
        new=AsyncMock(return_value=True),
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
async def test_maybe_enqueue_taste_job_enqueues_new_job_and_creates_state():
    import function_app

    function_app._TASTE_JOB_IN_FLIGHT.clear()
    function_app._TASTE_JOB_COMPLETED.clear()

    with patch("function_app._load_taste_job_doc", AsyncMock(return_value=None)), patch(
        "function_app._upsert_taste_job_doc", AsyncMock()
    ) as upsert_job, patch("function_app._send_taste_job_message", AsyncMock()) as send_message:
        created = await function_app._maybe_enqueue_taste_job(
            user_id="user-001",
            item_id="item-001",
            image_url="https://cdn.example.com/item.png",
            gallery_image_index=0,
            signal="up",
        )

    assert created is True
    assert upsert_job.called
    assert send_message.called


@pytest.mark.unit
async def test_maybe_enqueue_taste_job_deduplicates_completed_job_states():
    import function_app

    function_app._TASTE_JOB_IN_FLIGHT.clear()
    function_app._TASTE_JOB_COMPLETED.clear()

    existing = {"id": "job-abc", "jobId": "job-abc", "status": "completed"}
    with patch("function_app._load_taste_job_doc", AsyncMock(return_value=existing)), patch(
        "function_app._upsert_taste_job_doc"
    ) as upsert_job, patch("function_app._send_taste_job_message") as send_message:
        queued = await function_app._maybe_enqueue_taste_job(
            user_id="user-001",
            item_id="item-001",
            image_url="https://cdn.example.com/item.png",
            gallery_image_index=0,
            signal="up",
        )

    assert queued is False
    assert not upsert_job.called
    assert not send_message.called


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
async def test_process_taste_profile_job_marks_celestial_completion():
    import function_app

    document = {"jobId": "job-1", "status": "queued"}
    with patch("function_app._parse_taste_job", return_value={"job_id": "job-1", "user_id": "u-1", "item_id": "item-1", "image_url": "https://cdn.example.com/1.png"}), patch(
        "function_app._load_taste_job_doc",
        AsyncMock(return_value=document),
    ), patch(
        "function_app._set_taste_job_status",
        AsyncMock(),
    ) as set_status, patch(
        "function_app._run_taste_profile_job",
        AsyncMock(return_value=None),
    ) as run_job, patch(
        "function_app._mark_taste_job_completed"
    ) as mark_completed:
        await function_app._process_taste_profile_job("payload")

    assert run_job.called
    set_status.assert_any_await(ANY, "in_flight")
    set_status.assert_any_await(ANY, "completed", lastCompletedAt=ANY)
    mark_completed.assert_called_once()


@pytest.mark.unit
async def test_process_taste_profile_job_marks_dead_letter_on_error():
    import function_app

    with patch("function_app._parse_taste_job", return_value={"job_id": "job-2", "user_id": "u-2", "item_id": "item-2", "image_url": "https://cdn.example.com/2.png"}), patch(
        "function_app._load_taste_job_doc",
        AsyncMock(return_value={"jobId": "job-2", "status": "queued"}),
    ), patch(
        "function_app._set_taste_job_status",
        AsyncMock(),
    ) as set_status, patch(
        "function_app._run_taste_profile_job",
        AsyncMock(side_effect=RuntimeError("failure")),
    ):
        with pytest.raises(RuntimeError):
            await function_app._process_taste_profile_job("payload")

    set_status.assert_any_await(ANY, "in_flight")
    set_status.assert_any_await(ANY, "failed", error=ANY)


@pytest.mark.unit
async def test_process_taste_profile_job_dlq_persists_dead_letter():
    import function_app

    dead_letter_container = MagicMock()
    dead_letter_container.upsert_item = AsyncMock()
    with patch("function_app._parse_taste_job", return_value={"job_id": "job-3", "payload": {"x": 1}}), patch(
        "agents.db.get_taste_job_dead_letters_container",
        return_value=dead_letter_container,
    ), patch("function_app._set_taste_job_status", AsyncMock()):
        await function_app._process_taste_profile_job_dead_letter("payload")

    dead_letter_container.upsert_item.assert_awaited_once()


@pytest.mark.unit
async def test_process_taste_profile_job_dlq_payload_parse_error_uses_unknown_job_and_raw_payload():
    import function_app

    dead_letter_container = MagicMock()
    dead_letter_container.upsert_item = AsyncMock()

    with patch("function_app._parse_taste_job", side_effect=ValueError("invalid")) as parse_mock, patch(
        "function_app._set_taste_job_status",
        AsyncMock(),
    ) as set_status, patch(
        "agents.db.get_taste_job_dead_letters_container",
        return_value=dead_letter_container,
    ):
        await function_app._process_taste_profile_job_dead_letter("legacy-bad-payload")

    parse_mock.assert_called_once_with("legacy-bad-payload")
    dead_letter_payload = dead_letter_container.upsert_item.await_args.args[0]
    assert dead_letter_payload["jobId"].startswith("unknown-")
    assert dead_letter_payload["payload"] == "legacy-bad-payload"
    assert dead_letter_payload["sourceQueue"] == function_app._TASTE_JOB_DEAD_LETTER_QUEUE_NAME
    set_status.assert_any_await(ANY, "dead_lettered", error="Poison queue message")


@pytest.mark.unit
async def test_taste_job_state_transitions_to_dead_lettered_after_failures():
    import function_app

    function_app._TASTE_JOB_IN_FLIGHT.clear()
    function_app._TASTE_JOB_COMPLETED.clear()

    state_transitions: list[str] = []

    def _capture_state(_job_id: str, status: str, **kwargs: object) -> None:
        state_transitions.append(status)

    dead_letter_container = MagicMock()
    dead_letter_container.upsert_item = AsyncMock()

    job = {"job_id": "job-transition", "user_id": "u-3", "item_id": "item-3", "image_url": "https://cdn.example.com/3.png"}
    with patch("function_app._parse_taste_job", return_value=job), patch(
        "function_app._load_taste_job_doc",
        AsyncMock(return_value={"jobId": "job-transition", "status": "queued"}),
    ), patch(
        "function_app._set_taste_job_status",
        AsyncMock(side_effect=_capture_state),
    ) as set_status, patch(
        "function_app._run_taste_profile_job",
        AsyncMock(side_effect=RuntimeError("transient failure")),
    ), patch(
        "agents.db.get_taste_job_dead_letters_container",
        return_value=dead_letter_container,
    ):
        with pytest.raises(RuntimeError):
            await function_app._process_taste_profile_job("payload")

        await function_app._process_taste_profile_job_dead_letter({"job_id": "job-transition", "payload": {"kind": "poison"}})

    assert state_transitions == ["in_flight", "failed", "dead_lettered"]
    dead_letter_container.upsert_item.assert_awaited_once()
    set_status.assert_any_await("job-transition", "in_flight")
    set_status.assert_any_await("job-transition", "failed", error=ANY)
    set_status.assert_any_await("job-transition", "dead_lettered", error=ANY)
