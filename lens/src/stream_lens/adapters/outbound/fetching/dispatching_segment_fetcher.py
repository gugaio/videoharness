"""Fetcher de bytes de segmentos para fixtures locais + dispatcher por esquema."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

from stream_lens.adapters.outbound.fetching.safe_http_segment_fetcher import (
    SafeHttpSegmentFetcher,
)
from stream_lens.application.ports.segment_fetcher import FetchedBytes
from stream_lens.application.use_cases.create_inspection import InspectionError

FIXTURE_SCHEME = "fixture"


class LocalFixtureSegmentFetcher:
    """Lê bytes de fixture:// — sem rede, com path traversal bloqueado."""

    def __init__(self, fixtures_root: Path, max_segment_bytes: int = 20_000_000) -> None:
        self._root = fixtures_root.resolve()
        self._max_bytes = max_segment_bytes

    async def fetch(
        self,
        url: str,
        byte_range: tuple[int, int] | None = None,
        max_bytes: int | None = None,
    ) -> FetchedBytes:
        parts = urlsplit(url)
        if parts.scheme != FIXTURE_SCHEME:
            raise InspectionError("capturing_segments", "esquema não suportado")
        if parts.query or parts.fragment or parts.username or parts.password:
            raise InspectionError("capturing_segments", "URL de fixture malformada")

        fixture_name = parts.netloc
        rel = Path(parts.path.strip("/"))
        if not fixture_name or not rel.parts or rel.is_absolute() or ".." in rel.parts:
            raise InspectionError("capturing_segments", "URL de fixture malformada")

        candidate = (self._root / fixture_name / rel).resolve()
        if self._root not in candidate.parents:
            raise InspectionError("capturing_segments", "caminho de fixture inválido")
        if not candidate.is_file():
            raise InspectionError("capturing_segments", f"fixture não encontrada: {url}")

        byte_limit = min(self._max_bytes, max_bytes) if max_bytes is not None else self._max_bytes
        if byte_range is not None:
            offset, length = byte_range
            if offset < 0 or length < 0:
                raise InspectionError("capturing_segments", "byte range inválido")
            read_limit = min(length, byte_limit + 1)
            with candidate.open("rb") as handle:
                handle.seek(offset)
                data = handle.read(read_limit)
        else:
            with candidate.open("rb") as handle:
                data = handle.read(byte_limit + 1)
        if len(data) > byte_limit:
            error = InspectionError(
                "capturing_segments", f"segmento excede o limite de {byte_limit} bytes"
            )
            error.bytes_received = byte_limit
            raise error
        return FetchedBytes(url=url, data=data, status=None, content_type=None)


class DispatchingSegmentFetcher:
    """Roteia fixture:// vs http(s):// para bytes de segmentos."""

    def __init__(
        self,
        fixture_fetcher: LocalFixtureSegmentFetcher,
        http_fetcher: SafeHttpSegmentFetcher,
    ) -> None:
        self._fixture = fixture_fetcher
        self._http = http_fetcher

    async def fetch(
        self,
        url: str,
        byte_range: tuple[int, int] | None = None,
        max_bytes: int | None = None,
    ) -> FetchedBytes:
        if url.startswith(f"{FIXTURE_SCHEME}://"):
            return await self._fixture.fetch(url, byte_range, max_bytes)
        return await self._http.fetch(url, byte_range, max_bytes)
