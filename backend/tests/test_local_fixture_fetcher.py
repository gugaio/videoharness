"""Testes do fetcher de fixtures locais."""

import pytest

from stream_lens.adapters.outbound.fetching.local_fixture_fetcher import (
    LocalFixtureFetcher,
)
from stream_lens.application.use_cases.create_inspection import InspectionError


@pytest.fixture
def fetcher(fixtures_root):
    return LocalFixtureFetcher(fixtures_root)


class TestLocalFixtureFetcher:
    async def test_busca_master_hls(self, fetcher):
        fetched = await fetcher.fetch("fixture://hls-ts/master.m3u8")
        assert fetched.text.startswith("#EXTM3U")
        assert fetched.content_type == "application/vnd.apple.mpegurl"

    async def test_busca_mpd(self, fetcher):
        fetched = await fetcher.fetch("fixture://dash-mpd/stream.mpd")
        assert "<MPD" in fetched.text
        assert fetched.content_type == "application/dash+xml"

    async def test_rejeita_esquema_remoto(self, fetcher):
        with pytest.raises(InspectionError, match="fixture://"):
            await fetcher.fetch("https://example.com/master.m3u8")

    async def test_rejeita_file_scheme(self, fetcher):
        with pytest.raises(InspectionError):
            await fetcher.fetch("file:///etc/passwd")

    async def test_rejeita_path_traversal(self, fetcher):
        with pytest.raises(InspectionError):
            await fetcher.fetch("fixture://hls-ts/../../etc/passwd")

    async def test_fixture_inexistente(self, fetcher):
        with pytest.raises(InspectionError, match="não encontrada"):
            await fetcher.fetch("fixture://hls-ts/nope.m3u8")

    async def test_rejeita_query_string(self, fetcher):
        with pytest.raises(InspectionError, match="malformada"):
            await fetcher.fetch("fixture://hls-ts/master.m3u8?token=x")
