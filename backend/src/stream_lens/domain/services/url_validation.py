"""Validação sintática de URLs de manifesto (domínio puro).

A validação de rede (DNS, IPs bloqueados, redirects) acontece no safe
fetcher; aqui garantimos apenas a forma da URL antes de aceitá-la.
"""

from __future__ import annotations

from urllib.parse import urlsplit

ALLOWED_SCHEMES = frozenset({"fixture", "http", "https"})


class InvalidManifestUrl(ValueError):
    """URL de manifesto com forma inaceitável."""


def validate_manifest_url(url: str) -> None:
    """Valida esquema e ausência de userinfo/fragmento/query secreta.

    Query string é tolerada na entrada (CDNs usam tokens) mas nunca é
    persistida — ver redaction. Fragmento e userinfo são rejeitados.
    """
    parts = urlsplit(url)
    if parts.scheme not in ALLOWED_SCHEMES:
        raise InvalidManifestUrl(
            "esquema não suportado; use http, https ou fixture"
        )
    if parts.username or parts.password:
        raise InvalidManifestUrl("userinfo não é aceito na URL")
    if parts.fragment:
        raise InvalidManifestUrl("fragmento não é aceito na URL")
    if parts.scheme in ("http", "https") and not parts.hostname:
        raise InvalidManifestUrl("URL sem host")
    if parts.scheme == "fixture" and (not parts.netloc or not parts.path.strip("/")):
        raise InvalidManifestUrl("URL de fixture deve ser fixture://<nome>/<caminho>")
