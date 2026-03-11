"""
Google ID token validation for the Python Processor HTTP endpoints.

In production the Angular client attaches `Authorization: Bearer <Google ID token>`
to every request. This module verifies that token against Google's public JWKS and
returns the user's Google `sub` (stable user ID).

In local development (`AZURE_FUNCTIONS_ENVIRONMENT=Development`), if the env var
`LOCAL_DEV_USER_ID` is set, token validation is skipped and that value is returned.
This mirrors the behaviour of GoogleTokenValidator.cs in the .NET API.
"""

import os
import logging
import asyncio
from typing import Optional

from fastapi import Request, HTTPException, status

logger = logging.getLogger(__name__)

_IS_DEV = os.getenv("AZURE_FUNCTIONS_ENVIRONMENT", "").lower() == "development"
_LOCAL_USER_ID = os.getenv("LOCAL_DEV_USER_ID", "dev-user-001")
_GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")


def _verify_google_token(token: str) -> str:
    """
    Verify a Google ID token and return the `sub` (userId).
    Uses google-auth which validates signature, expiry, and audience.
    """
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests

    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            _GOOGLE_CLIENT_ID,
        )
        return idinfo["sub"]
    except Exception as exc:
        logger.warning("Token validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Google ID token.",
        ) from exc


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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )

    token = auth_header.removeprefix("Bearer ").strip()
    return await asyncio.to_thread(_verify_google_token, token)
