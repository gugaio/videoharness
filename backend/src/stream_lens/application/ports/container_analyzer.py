"""Port: analisar a estrutura de um container capturado (bytes puros)."""

from __future__ import annotations

from typing import Protocol

from stream_lens.domain.value_objects.containers import ContainerAnalysis


class ContainerAnalyzer(Protocol):
    """Parse estrutural determinístico (sem I/O, sem diagnóstico)."""

    def analyze(
        self, data: bytes, is_init: bool, init_data: bytes | None = None
    ) -> ContainerAnalysis: ...
