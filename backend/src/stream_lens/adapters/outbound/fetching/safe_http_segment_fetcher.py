"""Safe HTTP fetcher de BYTES de segmentos: mesmas regras do fetcher de manifestos.

Diferenciais: header Range opcional (byte range) e o cap de bytes é por
segmento (não por manifesto). Falhas aqui são por segmento: quem chama
decide se viram `partial`, não `failed` da inspeção.
"""

from __future__ import annotations

import httpx

from stream_lens.adapters.outbound.fetching.safe_http_fetcher import (
    _REDIRECT_STATUSES,
    NetworkPolicy,
    _validate_remote_url,
)
from stream_lens.application.ports.segment_fetcher import FetchedBytes
from stream_lens.application.use_cases.create_inspection import InspectionError

DEFAULT_MAX_SEGMENT_BYTES = 20_000_000


class SafeHttpSegmentFetcher:
    """Implementa o port SegmentFetcher para http/https."""

    def __init__(
        self,
        policy: NetworkPolicy | None = None,
        max_segment_bytes: int = DEFAULT_MAX_SEGMENT_BYTES,
        max_redirects: int = 5,
        connect_timeout: float = 5.0,
        read_timeout: float = 15.0,
    ) -> None:
        self._policy = policy or NetworkPolicy()
        self._max_bytes = max_segment_bytes
        self._max_redirects = max_redirects
        self._client = httpx.AsyncClient(
            follow_redirects=False,
            trust_env=False,
            timeout=httpx.Timeout(
                connect=connect_timeout, read=read_timeout, write=5.0, pool=5.0
            ),
            headers={"User-Agent": "stream-lens/0.1"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def fetch(self, url: str, byte_range: tuple[int, int] | None = None) -> FetchedBytes:
        headers: dict[str, str] = {}
        if byte_range is not None:
            offset, length = byte_range
            headers["Range"] = f"bytes={offset}-{offset + length - 1}"

        current = _validate_remote_url(url)
        for _hop in range(self._max_redirects + 1):
            parts = httpx.URL(current)
            await self._policy.check_host(parts.host)
            try:
                request = self._client.build_request("GET", current, headers=headers)
                response = await self._client.send(request, stream=True)
            except httpx.TimeoutException as exc:
                raise InspectionError("capturing_segments", "timeout ao obter segmento") from exc
            except httpx.HTTPError as exc:
                raise InspectionError(
                    "capturing_segments", f"falha de rede: {type(exc).__name__}"
                ) from exc

            if response.status_code in _REDIRECT_STATUSES:
                # redirects de segmento normalmente carregam query com token:
                # revalidamos destino, mas não propagamos headers de Range
                location = response.headers.get("location")
                await response.aclose()
                if not location:
                    raise InspectionError("capturing_segments", "redirect sem Location")
                from urllib.parse import urljoin

                current = _validate_remote_url(urljoin(current, location))
                continue

            if response.status_code >= 400:
                await response.aclose()
                raise InspectionError(
                    "capturing_segments", f"HTTP {response.status_code} ao obter segmento"
                )

            body = b""
            total = 0
            chunks: list[bytes] = []
            try:
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > self._max_bytes:
                        raise InspectionError(
                            "capturing_segments",
                            f"segmento excede o limite de {self._max_bytes} bytes",
                        )
                    chunks.append(chunk)
            finally:
                await response.aclose()
            body = b"".join(chunks)
            return FetchedBytes(
                url=current,
                data=body,
                status=response.status_code,
                content_type=response.headers.get("content-type"),
            )

        raise InspectionError(
            "capturing_segments", f"excedeu o limite de {self._max_redirects} redirects"
        )
