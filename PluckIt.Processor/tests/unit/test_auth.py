"""
Unit tests for agents/auth.py.

Verifies:
- LOCAL_DEV_USER_ID bypass works (no real Google token needed)
- Missing Authorization header raises 401 when no dev bypass is set
"""
import os
from unittest.mock import MagicMock, patch, AsyncMock

import pytest
from fastapi import HTTPException


@pytest.mark.unit
async def test_get_user_id_uses_dev_bypass():
    """When _IS_DEV is True, get_user_id returns _LOCAL_USER_ID without token validation."""
    from agents.auth import get_user_id

    mock_request = MagicMock()
    mock_request.headers = {}  # No Authorization header

    with (
        patch("agents.auth._IS_DEV", True),
        patch("agents.auth._LOCAL_USER_ID", "dev-bypass-user"),
    ):
        result = await get_user_id(mock_request)

    assert result == "dev-bypass-user"


@pytest.mark.unit
async def test_get_user_id_raises_401_without_auth_and_no_dev_bypass():
    """Without a valid token and no dev bypass, should raise 401."""
    from agents.auth import get_user_id
    from fastapi import Request

    mock_request = MagicMock()
    mock_request.headers = {}  # No Authorization header

    with patch.dict(os.environ, {}, clear=False):
        # Temporarily remove the dev bypass
        original = os.environ.pop("LOCAL_DEV_USER_ID", None)
        try:
            with pytest.raises(HTTPException) as exc_info:
                await get_user_id(mock_request)
            assert exc_info.value.status_code == 401
        finally:
            if original is not None:
                os.environ["LOCAL_DEV_USER_ID"] = original


@pytest.mark.unit
async def test_get_user_id_validates_bearer_token():
    """With a valid Bearer token and _IS_DEV=False, calls _verify_google_token."""
    from agents.auth import get_user_id

    mock_request = MagicMock()
    mock_request.headers = {"Authorization": "Bearer fake-google-token"}

    with (
        patch("agents.auth._IS_DEV", False),
        patch("agents.auth._verify_google_token", return_value="google-user-abc123"),
    ):
        result = await get_user_id(mock_request)

    assert result == "google-user-abc123"
