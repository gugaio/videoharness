"""Port: metadados derivados de mídia (ffprobe) para um arquivo capturado."""

from __future__ import annotations

from typing import Protocol


class MediaProbe(Protocol):
    """Dados derivados (codec/profile/duration) — não são estruturais.

    Diferente do ContainerAnalyzer (determinístico), o probe é derivado de
    uma ferramenta externa e pode estar ausente (capabilidade not_collected).
    """

    def probe_file(self, path: str) -> dict | None: ...
