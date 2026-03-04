import hmac


def parse_bearer_token(auth_header: str | None) -> str | None:
    if not auth_header:
        return None
    parts = auth_header.strip().split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts[0], parts[1].strip()
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def is_valid_bearer(auth_header: str | None, expected_token: str | None) -> bool:
    token = parse_bearer_token(auth_header)
    if not token or not expected_token:
        return False
    return hmac.compare_digest(token, expected_token)
