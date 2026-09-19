"""Fetcher de manifestos de fixtures locais (única fonte aceita na v0.1).

URLs têm a forma ``fixture://<fixture-name>/<caminho-relativo>`` (ex.:
``fixture://hls-ts/master.m3u8``) e são resolvidas dentro do diretório
de fixtures — path traversal e userinfo são rejeitados.
O fetcher HTTP seguro (SSRF, redirects, limites) chega na Fase 2.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

from stream_lens.application.ports.manifest_fetcher import FetchedManifest
from stream_lens.application.use_cases.create_inspection import InspectionError

FIXTURE_SCHEME = "fixture"
_MAX_BYTES = 1_000_000


class LocalFixtureFetcher:
    """Lê manifestos de fixtures locais — sem rede, sem segredos."""

    def __init__(self, fixtures_root: Path) -> None:
        self._root = fixtures_root.resolve()

    async def fetch(self, url: str) -> FetchedManifest:
        parts = urlsplit(url)
        if parts.scheme != FIXTURE_SCHEME:
            raise InspectionError(
                "fetching_manifest",
                "apenas URLs fixture:// são suportadas nesta versão; "
                "captura remota chega com as proteções de URL na Fase 2",
            )
        if parts.query or parts.fragment or parts.username or parts.password:
            raise InspectionError("fetching_manifest", "URL de fixture malformada")

        fixture_name = parts.netloc
        rel = Path(parts.path.strip("/"))
        if not fixture_name or not rel.parts or rel.is_absolute() or ".." in rel.parts:
            raise InspectionError("fetching_manifest", "URL de fixture malformada")

        candidate = (self._root / fixture_name / rel).resolve()
        if self._root not in candidate.parents:
            raise InspectionError("fetching_manifest", "caminho de fixture inválido")
        if not candidate.is_file():
            raise InspectionError("fetching_manifest", f"fixture não encontrada: {url}")
        if candidate.stat().st_size > _MAX_BYTES:
            raise InspectionError("fetching_manifest", "fixture excede o limite de bytes")

        return FetchedManifest(
            url=url,
            text=candidate.read_text(encoding="utf-8"),
            content_type=_guess_content_type(candidate),
        )


def _guess_content_type(path: Path) -> str:
    if path.suffix == ".mpd":
        return "application/dash+xml"
    if path.suffix == ".m3u8":
        return "application/vnd.apple.mpegurl"
    return "application/octet-stream"
