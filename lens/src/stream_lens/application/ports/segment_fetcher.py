"""Port: obter bytes de um segmento (com byte range opcional)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from stream_lens.domain.value_objects.segments import DeliveryObservation


@dataclass(frozen=True, slots=True)
class FetchedBytes:
    url: str
    data: bytes
    status: int | None = None  # None para fontes locais (fixture)
    content_type: str | None = None
    delivery: DeliveryObservation | None = None


class SegmentFetcher(Protocol):
    """Busca bytes de um segmento de forma limitada e segura.

    Implementações devem aplicar os mesmos controles do fetcher de
    manifestos (SSRF, redirects revalidados, cap de bytes por resposta).
    `byte_range` é (offset, length) para Range: bytes=o-l.
    """

    async def fetch(
        self,
        url: str,
        byte_range: tuple[int, int] | None = None,
        max_bytes: int | None = None,
    ) -> FetchedBytes: ...
