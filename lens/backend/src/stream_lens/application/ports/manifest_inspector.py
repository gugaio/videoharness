"""Port: inspeção declarativa de manifestos (modelo unificado)."""

from __future__ import annotations

from typing import Protocol

from stream_lens.domain.value_objects.media import UnifiedManifest


class ManifestInspector(Protocol):
    """Parse puro de conteúdo (sem I/O) -> modelo unificado do domínio."""

    def inspect(self, content: str) -> UnifiedManifest: ...
