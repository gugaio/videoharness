"""Redaction de URLs: segredos nunca chegam a snapshot, logs ou UI."""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit


def redact_url(url: str) -> str:
    """Remove query string, fragment e userinfo de uma URL.

    Exemplo: https://host/path?token=abc#frag -> https://host/path
    Esquemas sem authority (ex.: fixture://) são retornados sem query/fragment.
    """
    parts = urlsplit(url)
    # userinfo não deve existir em fonte válida; removemos por defesa
    host = parts.hostname or ""
    netloc = host if not parts.port else f"{host}:{parts.port}"
    if not netloc:
        netloc = ""
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))
