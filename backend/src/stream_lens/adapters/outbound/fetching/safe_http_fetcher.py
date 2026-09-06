"""Safe HTTP fetcher de manifestos: SSRF, redirects, limites e timeouts.

Regras (SECURITY.md):
- somente http/https, sem userinfo;
- DNS resolvido e todos os endereços validados contra faixas bloqueadas
  (loopback, private, link-local, multicast, reserved, unspecified);
- redirects seguidos manualmente com limite e **revalidação completa do
  destino** (esquema + host + IP) a cada hop;
- timeouts de conexão e leitura; limite de bytes por resposta;
- sem proxies do ambiente (trust_env=False) e sem cookies/headers arbitrários.

`allow_loopback=True` existe APENAS para testes locais e desenvolvimento
(nunca em deploy público; o compose de produção não o define).
"""

from __future__ import annotations

import asyncio
import ipaddress
from urllib.parse import urljoin, urlsplit

import httpx

from stream_lens.application.ports.manifest_fetcher import FetchedManifest
from stream_lens.application.use_cases.create_inspection import InspectionError

_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
DEFAULT_MAX_BYTES = 2_000_000
DEFAULT_MAX_REDIRECTS = 5
DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_READ_TIMEOUT = 15.0


class NetworkPolicy:
    """Decide se um endereço IP pode ser contatado (fronteira de SSRF)."""

    def __init__(self, allow_loopback: bool = False) -> None:
        self._allow_loopback = allow_loopback

    def is_ip_allowed(self, ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
        if ip.is_loopback:
            return self._allow_loopback
        return not (
            ip.is_private
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        )

    async def check_host(self, host: str) -> None:
        """Resolve o host e exige que TODOS os endereços sejam permitidos."""
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(host, None)
        except (OSError, asyncio.CancelledError) as exc:
            raise InspectionError("fetching_manifest", f"falha ao resolver host: {host}") from exc
        for info in infos:
            address = info[4][0]
            try:
                parsed = ipaddress.ip_address(address)
            except ValueError as exc:
                raise InspectionError("fetching_manifest", f"endereço inválido: {address}") from exc
            if not self.is_ip_allowed(parsed):
                raise InspectionError(
                    "fetching_manifest",
                    "host aponta para endereço de rede não permitido",
                )


class SafeHttpFetcher:
    """Implementação do port ManifestFetcher para URLs http/https."""

    def __init__(
        self,
        policy: NetworkPolicy | None = None,
        max_bytes: int = DEFAULT_MAX_BYTES,
        max_redirects: int = DEFAULT_MAX_REDIRECTS,
        connect_timeout: float = DEFAULT_CONNECT_TIMEOUT,
        read_timeout: float = DEFAULT_READ_TIMEOUT,
    ) -> None:
        self._policy = policy or NetworkPolicy()
        self._max_bytes = max_bytes
        self._max_redirects = max_redirects
        self._timeout = httpx.Timeout(
            connect=connect_timeout, read=read_timeout, write=5.0, pool=5.0
        )
        self._client = httpx.AsyncClient(
            follow_redirects=False,
            trust_env=False,
            timeout=self._timeout,
            headers={"User-Agent": "stream-lens/0.1"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def fetch(self, url: str) -> FetchedManifest:
        current = _validate_remote_url(url)
        for _hop in range(self._max_redirects + 1):
            parts = urlsplit(current)
            await self._policy.check_host(parts.hostname or "")

            response = await self._request(current)
            if response.status_code in _REDIRECT_STATUSES:
                location = response.headers.get("location")
                await response.aclose()
                if not location:
                    raise InspectionError("fetching_manifest", "redirect sem Location")
                current = _validate_remote_url(urljoin(current, location))
                continue

            content_type = response.headers.get("content-type")
            if response.status_code >= 400:
                await response.aclose()
                raise InspectionError(
                    "fetching_manifest", f"HTTP {response.status_code} ao obter manifesto"
                )
            body = await self._read_capped(response)
            try:
                text = body.decode("utf-8", errors="replace")
            except UnicodeDecodeError as exc:  # praticamente inalcançável com replace
                raise InspectionError("fetching_manifest", "resposta não é texto") from exc
            return FetchedManifest(url=current, text=text, content_type=content_type)

        raise InspectionError(
            "fetching_manifest", f"excedeu o limite de {self._max_redirects} redirects"
        )

    async def _request(self, url: str) -> httpx.Response:
        try:
            return await self._client.send(self._client.build_request("GET", url), stream=True)
        except httpx.TimeoutException as exc:
            raise InspectionError("fetching_manifest", "timeout ao obter manifesto") from exc
        except httpx.HTTPError as exc:
            raise InspectionError(
                "fetching_manifest", f"falha de rede: {type(exc).__name__}"
            ) from exc

    async def _read_capped(self, response: httpx.Response) -> bytes:
        chunks: list[bytes] = []
        total = 0
        try:
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > self._max_bytes:
                    raise InspectionError(
                        "fetching_manifest",
                        f"manifesto excede o limite de {self._max_bytes} bytes",
                    )
                chunks.append(chunk)
        finally:
            await response.aclose()
        return b"".join(chunks)


def _validate_remote_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise InspectionError("fetching_manifest", "somente http e https são aceitos")
    if parts.username or parts.password:
        raise InspectionError("fetching_manifest", "userinfo não é aceito na URL")
    if not parts.hostname:
        raise InspectionError("fetching_manifest", "URL sem host")
    return url
