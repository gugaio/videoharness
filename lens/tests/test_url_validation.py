"""Testes da validação sintática de URLs (domínio puro)."""

import pytest

from stream_lens.domain.services.url_validation import (
    InvalidManifestUrl,
    validate_manifest_url,
)


class TestValidateManifestUrl:
    def test_aceita_fixture_http_e_https_com_query(self):
        validate_manifest_url("fixture://hls-ts/master.m3u8")
        validate_manifest_url("https://cdn.example.com/live/master.m3u8?token=abc")
        validate_manifest_url("http://example.com/manifest.mpd")

    def test_rejeita_esquemas_exoticos(self):
        for url in ("file:///etc/passwd", "ftp://x/y", "gopher://x", "javascript:alert(1)"):
            with pytest.raises(InvalidManifestUrl):
                validate_manifest_url(url)

    def test_rejeita_userinfo(self):
        with pytest.raises(InvalidManifestUrl, match="userinfo"):
            validate_manifest_url("http://user:pass@example.com/m.m3u8")

    def test_rejeita_fragmento(self):
        with pytest.raises(InvalidManifestUrl, match="fragmento"):
            validate_manifest_url("https://example.com/m.m3u8#frag")

    def test_rejeita_http_sem_host(self):
        with pytest.raises(InvalidManifestUrl, match="host"):
            validate_manifest_url("http:///manifest.m3u8")

    def test_rejeita_fixture_malformada(self):
        for url in ("fixture://", "fixture://hls-ts", "fixture:///master.m3u8"):
            with pytest.raises(InvalidManifestUrl):
                validate_manifest_url(url)
