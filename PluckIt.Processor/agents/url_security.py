from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit


def _is_public_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def _resolve_public_addresses(hostname: str) -> None:
    try:
        infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"Host lookup failed: {hostname}") from exc

    if not infos:
        raise ValueError(f"Host lookup returned no addresses: {hostname}")

    for info in infos:
        ip = info[4][0]
        if not _is_public_ip(ip):
            raise ValueError(f"Host resolves to a non-public address: {hostname}")


def validate_public_https_url(raw_url: str) -> str:
    """
    Validate that a URL is HTTPS and resolves to publicly routable IP addresses.
    Returns a normalized URL string (fragment removed).
    """
    if not raw_url:
        raise ValueError("URL is empty.")

    parsed = urlsplit(raw_url.strip())
    if parsed.scheme.lower() != "https":
        raise ValueError("Only HTTPS URLs are allowed.")
    if not parsed.hostname:
        raise ValueError("URL hostname is missing.")
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded credentials are not allowed.")

    host = parsed.hostname.strip().lower()
    if host in {"localhost"} or host.endswith(".local"):
        raise ValueError("Local hostnames are not allowed.")

    try:
        _is_public_ip(host)
        is_ip_literal = True
    except ValueError:
        is_ip_literal = False

    if is_ip_literal:
        if not _is_public_ip(host):
            raise ValueError("Non-public IP addresses are not allowed.")
    else:
        _resolve_public_addresses(host)

    normalized = urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc,
            parsed.path or "/",
            parsed.query,
            "",
        )
    )
    return normalized
