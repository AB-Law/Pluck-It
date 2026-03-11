"""
Unit tests for the image utils helper functions.
"""

import importlib
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agents.scrapers.image_utils import compute_phash, hamming_distance


def _with_imagehash(fake_module: object) -> dict[str, object]:
    return {"imagehash": fake_module}


def test_compute_phash_returns_hash_when_image_is_valid() -> None:
    fake_imagehash = SimpleNamespace(phash=lambda _image: "deadbeef")

    fake_response = httpx.Response(
        status_code=200,
        content=b"fake-image-bytes",
        request=httpx.Request("GET", "https://example.com/image.png"),
    )
    fake_image = MagicMock()
    fake_image.convert.return_value = fake_image

    with patch.dict(sys.modules, _with_imagehash(fake_imagehash)):
        with patch("agents.scrapers.image_utils.httpx.get", return_value=fake_response):
            with patch("agents.scrapers.image_utils.Image.open", return_value=fake_image):
                result = compute_phash("https://example.com/image.png")

    assert result == "deadbeef"
    fake_image.thumbnail.assert_called_once()


def test_compute_phash_returns_none_on_http_status_error() -> None:
    fake_request = httpx.Request("GET", "https://example.com/image.png")
    fake_response = httpx.Response(status_code=500, request=fake_request, content=b"nope")

    with patch("agents.scrapers.image_utils.httpx.get", return_value=fake_response):
        result = compute_phash("https://example.com/image.png")

    assert result is None


def test_compute_phash_returns_none_on_request_error() -> None:
    with patch("agents.scrapers.image_utils.httpx.get", side_effect=httpx.RequestError("offline", request=None)):
        result = compute_phash("https://example.com/image.png")

    assert result is None


def test_hamming_distance_uses_imagehash_library_when_available() -> None:
    fake_imagehash = SimpleNamespace(hex_to_hash=lambda value: int(value, 16))

    with patch.dict(sys.modules, _with_imagehash(fake_imagehash)):
        result = hamming_distance("0f", "03")

    assert result == 12


def test_hamming_distance_uses_fallback_when_imagehash_fails() -> None:
    def _raise_value_error(_value: str) -> int:
        raise ValueError("bad")

    fake_imagehash = SimpleNamespace(hex_to_hash=_raise_value_error)

    with patch.dict(sys.modules, _with_imagehash(fake_imagehash)):
        # Strings are intentionally non-hexadecimal to force the fallback path.
        result = hamming_distance("zz", "zz")

    assert result == 999


def test_hamming_distance_returns_large_for_mismatch_lengths() -> None:
    result = hamming_distance("abcd", "abc")
    assert result == 999

