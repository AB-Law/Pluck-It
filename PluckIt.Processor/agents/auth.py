"""
Google ID token validation for the Python Processor HTTP endpoints.

In production the Angular client attaches `Authorization: Bearer <Google ID token>`
to every request. This module verifies that token against Google's public JWKS and
returns the user's Google `sub` (stable user ID).

In local development (`AZURE_FUNCTIONS_ENVIRONMENT=Development`), if the env var
`LOCAL_DEV_USER_ID` is set, token validation is skipped and that value is returned.
This mirrors the behaviour of GoogleTokenValidator.cs in the .NET API.
"""

import asyncio
import logging
import os
import base64
import json
import hashlib
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)

_IS_DEV = os.getenv("AZURE_FUNCTIONS_ENVIRONMENT", "").lower() == "development"
_LOCAL_USER_ID = os.getenv("LOCAL_DEV_USER_ID", "dev-user-001")
_GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
_GOOGLE_ALLOWED_CLIENT_IDS = os.getenv("GOOGLE_ALLOWED_CLIENT_IDS", "")


def _parse_allowed_google_client_ids(raw: str) -> list[str]:
    """Parse comma/semicolon separated Google client IDs into a deduplicated list."""
    if not raw.strip():
        return []

    raw_values = raw.replace(";", ",").split(",")
    seen: set[str] = set()
    client_ids: list[str] = []

    for value in raw_values:
        client_id = value.strip()
        if not client_id or client_id in seen:
            continue
        client_ids.append(client_id)
        seen.add(client_id)

    return client_ids


_ALLOWED_GOOGLE_CLIENT_IDS: list[str] = _parse_allowed_google_client_ids(_GOOGLE_ALLOWED_CLIENT_IDS)
if _GOOGLE_CLIENT_ID and _GOOGLE_CLIENT_ID not in _ALLOWED_GOOGLE_CLIENT_IDS:
    _ALLOWED_GOOGLE_CLIENT_IDS.insert(0, _GOOGLE_CLIENT_ID)

if not _ALLOWED_GOOGLE_CLIENT_IDS:
    logger.warning("Google ID token verification has no configured client ids.")


def _verify_google_token(token: str) -> str:
    """
    Verify a Google ID token and return the `sub` (userId).
    Uses google-auth which validates signature, expiry, and audience.
    """
    token_audience = _read_token_audience(token)
    token_prefix = _token_prefix(token)
    logger.warning(
        "Google token validation start: aud=%s prefix=%s", token_audience or "unknown", token_prefix
    )
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests

    if not _ALLOWED_GOOGLE_CLIENT_IDS:
        logger.error("Google ID token verification cannot proceed without configured client ids.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google OAuth client ids are not configured.",
        )

    request = google_requests.Request()
    last_error: Optional[Exception] = None
    for client_id in _ALLOWED_GOOGLE_CLIENT_IDS:
        try:
            idinfo = id_token.verify_oauth2_token(
                token,
                request,
                client_id,
            )
            return idinfo["sub"]
        except Exception as exc:  # pragma: no cover - external auth failure path
            logger.warning(
                "Token validation failed for client id %s and aud=%s prefix=%s: %s",
                client_id,
                token_audience or "unknown",
                token_prefix,
                exc,
            )
            last_error = exc

    logger.warning("Token validation failed for all configured client ids: %s", last_error)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired Google ID token.",
    ) from last_error


async def get_user_id(request: Request) -> str:
    """
    FastAPI dependency: extracts and validates the Bearer token, returns userId.

    Usage:
        @fastapi_app.post("/api/chat")
        async def chat(user_id: str = Depends(get_user_id)):
            ...
    """
    if _IS_DEV:
        return _LOCAL_USER_ID

    auth_header: Optional[str] = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        logger.warning(
            "Auth header missing for %s %s",
            request.method,
            request.url.path,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )

    token = auth_header.removeprefix("Bearer ").strip()
    token_audience = _read_token_audience(token)
    token_prefix = _token_prefix(token)
    logger.warning(
        "Auth dependency validating request path=%s method=%s aud=%s prefix=%s",
        request.url.path,
        request.method,
        token_audience or "unknown",
        token_prefix,
    )
    user_id = await _get_user_id_from_session_token(token)
    if user_id:
        return user_id

    return await asyncio.to_thread(_verify_google_token, token)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _get_user_id_from_session_token(token: str) -> Optional[str]:
    token_hash = _hash_token(token)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    try:
        from agents.db import get_refresh_tokens_container
        container = get_refresh_tokens_container()
    except Exception as exc:  # pragma: no cover - depends on local/runner packages
        logger.warning("Session token lookup unavailable: %s", exc)
        return None
    query = (
        "SELECT c.userId, c.accessTokenExpiresAt "
        "FROM c "
        "WHERE c.accessTokenHash = @tokenHash "
        "AND (NOT IS_DEFINED(c.revoked) OR c.revoked = false) "
        "AND c.accessTokenExpiresAt >= @now"
    )
    parameters = [
        {"name": "@tokenHash", "value": token_hash},
        {"name": "@now", "value": now},
    ]

    try:
        async for row in container.query_items(
            query=query,
            parameters=parameters,
        ):
            user_id = row.get("userId")
            if isinstance(user_id, str) and user_id.strip():
                return user_id.strip()
    except Exception as exc:  # pragma: no cover - depends on Cosmos availability
        logger.warning("Session token lookup failed: %s", exc)
        return None

    return None


def _token_prefix(token: str, max_len: int = 20) -> str:
    return token[:max_len] if len(token) <= max_len else f"{token[:max_len]}..."


def _read_token_audience(token: str) -> Optional[str]:
    """
    Extract aud from JWT payload without verifying the token.
    Useful for diagnostics only.
    """
    parts = token.split(".")
    if len(parts) < 2 or not parts[1]:
        return None

    try:
        padded = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
        payload_bytes = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(payload_bytes.decode("utf-8"))
        aud = payload.get("aud")
        if isinstance(aud, str):
            return aud
        if isinstance(aud, list):
            return ",".join([str(x) for x in aud if x])
    except Exception:
        return None

    return None
