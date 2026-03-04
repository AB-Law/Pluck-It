import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from auth import is_valid_bearer, parse_bearer_token


def test_parse_bearer_token_ok():
    assert parse_bearer_token("Bearer abc123") == "abc123"


def test_parse_bearer_token_invalid():
    assert parse_bearer_token("Basic abc123") is None
    assert parse_bearer_token(None) is None


def test_is_valid_bearer():
    assert is_valid_bearer("Bearer secret", "secret") is True
    assert is_valid_bearer("Bearer wrong", "secret") is False
