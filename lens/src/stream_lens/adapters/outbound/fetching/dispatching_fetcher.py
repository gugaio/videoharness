"""Dispatcher de fetchers por esquema: fixture:// -> local, http(s) -> safe."""

from __future__ import annotations

from stream_lens.adapters.outbound.fetching.local_fixture_fetcher import (
    FIXTURE_SCHEME,
    LocalFixtureFetcher,
)
from stream_lens.adapters.outbound.fetching.safe_http_fetcher import SafeHttpFetcher
from stream_lens.application.ports.manifest_fetcher import FetchedManifest


class DispatchingManifestFetcher:
    """Roteia pelo esquema da URL; http/https passam pelo safe fetcher (SSRF)."""

    def __init__(self, fixture_fetcher: LocalFixtureFetcher, http_fetcher: SafeHttpFetcher) -> None:
        self._fixture = fixture_fetcher
        self._http = http_fetcher

    async def fetch(self, url: str) -> FetchedManifest:
        if url.startswith(f"{FIXTURE_SCHEME}:"):
            return await self._fixture.fetch(url)
        return await self._http.fetch(url)
