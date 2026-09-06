"""Testes do safe HTTP fetcher: política de rede, redirects, limites.

A fronteira de SSRF é a NetworkPolicy (testada puramente contra faixas de
IP). O fluxo HTTP (redirects, byte cap, erros) é testado contra um servidor
HTTP local com allow_loopback=True — flag exclusiva de dev/testes.
"""

import ipaddress
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from stream_lens.adapters.outbound.fetching.safe_http_fetcher import (
    NetworkPolicy,
    SafeHttpFetcher,
)
from stream_lens.application.use_cases.create_inspection import InspectionError


class TestNetworkPolicy:
    def setup_method(self):
        self.policy = NetworkPolicy(allow_loopback=False)

    def test_bloqueia_faixas_perigosas(self):
        for raw in (
            "127.0.0.1",  # loopback
            "10.0.0.1",  # private
            "192.168.1.1",
            "172.16.0.1",
            "169.254.169.254",  # link-local / metadata
            "0.0.0.0",  # unspecified
            "224.0.0.1",  # multicast
            "240.0.0.1",  # reserved
            "::1",  # loopback v6
            "fe80::1",  # link-local v6
            "fc00::1",  # private v6
        ):
            assert not self.policy.is_ip_allowed(ipaddress.ip_address(raw)), raw

    def test_permite_ip_publico(self):
        for raw in ("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"):
            assert self.policy.is_ip_allowed(ipaddress.ip_address(raw)), raw

    def test_allow_loopback_e_para_dev_testes(self):
        policy = NetworkPolicy(allow_loopback=True)
        assert policy.is_ip_allowed(ipaddress.ip_address("127.0.0.1"))
        # mesmo com loopback liberado, private continua bloqueado
        assert not policy.is_ip_allowed(ipaddress.ip_address("10.0.0.1"))

    async def test_check_host_bloqueia_localhost_por_dns(self):
        with pytest.raises(InspectionError, match="não permitido"):
            await self.policy.check_host("localhost")

    async def test_check_host_falha_dns(self):
        with pytest.raises(InspectionError, match="resolver"):
            await self.policy.check_host("stream-lens-invalid.invalid")


def _make_server(handler) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f"http://{host}:{port}"


class _ManifestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/master.m3u8":
            body = b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nv360.m3u8\n"
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.apple.mpegurl")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/master.m3u8")
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif self.path == "/redirect-loop":
            self.send_response(302)
            self.send_header("Location", "/redirect-loop")
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif self.path == "/redirect-metadata":
            # redirect para IP de metadata: deve ser barrado na revalidação
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif self.path == "/huge":
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.apple.mpegurl")
            self.end_headers()
            chunk = b"#EXTINF:4.0,\n" * 1024  # ~10KB por escrito, repetido abaixo
            for _ in range(500):  # ~5MB no total
                self.wfile.write(chunk)
        elif self.path == "/notfound":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif self.path == "/notamanifest":
            body = b"<html>nope</html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def log_message(self, *args) -> None:  # silencia o servidor de teste
        return


@pytest.fixture
def local_server():
    server, base = _make_server(_ManifestHandler)
    yield base
    server.shutdown()


@pytest.fixture
def fetcher():
    return SafeHttpFetcher(policy=NetworkPolicy(allow_loopback=True))


class TestSafeHttpFetcher:
    async def test_busca_manifesto(self, fetcher, local_server):
        fetched = await fetcher.fetch(f"{local_server}/master.m3u8")
        assert fetched.text.startswith("#EXTM3U")
        assert fetched.content_type == "application/vnd.apple.mpegurl"

    async def test_segue_redirect_com_revalidacao(self, fetcher, local_server):
        fetched = await fetcher.fetch(f"{local_server}/redirect")
        assert fetched.text.startswith("#EXTM3U")
        assert fetched.url.endswith("/master.m3u8")

    async def test_redirect_para_metadata_endpoint_bloqueado(self, fetcher, local_server):
        with pytest.raises(InspectionError, match="não permitido"):
            await fetcher.fetch(f"{local_server}/redirect-metadata")

    async def test_limite_de_redirects(self, fetcher, local_server):
        with pytest.raises(InspectionError, match="redirects"):
            await fetcher.fetch(f"{local_server}/redirect-loop")

    async def test_limite_de_bytes(self, fetcher, local_server):
        small = SafeHttpFetcher(policy=NetworkPolicy(allow_loopback=True), max_bytes=100_000)
        with pytest.raises(InspectionError, match="limite de"):
            await small.fetch(f"{local_server}/huge")

    async def test_erro_http_4xx(self, fetcher, local_server):
        with pytest.raises(InspectionError, match="HTTP 404"):
            await fetcher.fetch(f"{local_server}/notfound")

    async def test_url_invalida_sem_rede(self, fetcher):
        for url in ("file:///etc/passwd", "http://user:pass@h/x", "https:///nohost"):
            with pytest.raises(InspectionError):
                await fetcher.fetch(url)

    async def test_politica_real_bloqueia_loopback(self):
        strict = SafeHttpFetcher(policy=NetworkPolicy(allow_loopback=False))
        with pytest.raises(InspectionError, match="não permitido"):
            await strict.fetch("http://127.0.0.1:9/manifest.m3u8")
