"""Port: obter o conteúdo de um manifesto."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from stream_lens.domain.value_objects.segments import DeliveryObservation


@dataclass(frozen=True, slots=True)
class FetchedManifest:
    """Resultado bruto de um fetch: bytes/texto e metadados mínimos."""

    url: str
    text: str
    content_type: str | None = None
    delivery: DeliveryObservation | None = None


class ManifestFetcher(Protocol):
    """Busca o manifesto. Implementações devem validar e limitar o acesso."""

    async def fetch(self, url: str) -> FetchedManifest: ...
