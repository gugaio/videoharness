"""Testes do serviço de redaction (domínio puro)."""

from stream_lens.domain.services.redaction import redact_url


class TestRedactUrl:
    def test_remove_query_fragment_e_userinfo(self):
        url = "https://cdn.example.com/live/master.m3u8?token=SECRET&exp=1#frag"
        assert redact_url(url) == "https://cdn.example.com/live/master.m3u8"

    def test_userinfo_e_removido(self):
        assert redact_url("http://user:pass@host/path") == "http://host/path"

    def test_mantem_porta(self):
        assert redact_url("http://host:8080/path?x=1") == "http://host:8080/path"

    def test_fixture_url_mantida(self):
        # URLs de fixture não carregam segredos; seguem redacted por consistência
        assert redact_url("fixture://hls-ts/master.m3u8") == "fixture://hls-ts/master.m3u8"
