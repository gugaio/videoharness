"""Modelo de captura limitada e timeline de segmentos (Fase 4).

Tudo aqui é declarativo: o que foi planejado, o que foi capturado (com
hash/tamanho/status) e como os segmentos se distribuem no tempo por
representação. Bytes ficam em arquivos isolados por inspeção (adapter),
referenciados por `file`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

MAX_WINDOW_SECONDS = 60.0  # teto absoluto da janela, independente de config


@dataclass(frozen=True, slots=True)
class CaptureLimits:
    """Limites conservadores da janela de captura (fonte: env/bootstrap)."""

    window_seconds: float = 10.0  # default conservador
    max_window_seconds: float = 60.0  # teto absoluto
    max_total_bytes: int = 500_000_000
    max_segment_bytes: int = 20_000_000
    max_playlists_followed: int = 8  # rendições HLS seguidas a partir do master


@dataclass(frozen=True, slots=True)
class PlannedSegment:
    """Segmento selecionado para captura dentro da janela."""

    rep_id: str
    group_kind: str
    uri: str  # absoluta (resolvida contra a base do manifesto)
    index: int  # ordem declarada na representação
    start_number: int | None = None  # DASH $Number$
    declared_duration_seconds: float | None = None
    byte_range: tuple[int, int] | None = None  # (offset, length)
    is_init: bool = False


@dataclass(frozen=True, slots=True)
class CapturedSegment:
    """Resultado da captura de um segmento planejado."""

    rep_id: str
    group_kind: str
    uri: str  # serializada redacted
    index: int
    is_init: bool
    declared_duration_seconds: float | None = None
    byte_range: tuple[int, int] | None = None
    byte_size: int | None = None
    sha256: str | None = None
    http_status: int | None = None
    fetched_at: datetime | None = None
    file: str | None = None  # nome relativo dentro de segments/ da inspeção
    error: str | None = None  # sem segredos; falha de segmento ≠ inspeção falha

    @property
    def ok(self) -> bool:
        return self.error is None and self.byte_size is not None


@dataclass(frozen=True, slots=True)
class TimelineEntry:
    """Posição normalizada de um segmento na timeline da representação."""

    index: int
    start_seconds: float | None  # None = duração declarada desconhecida
    duration_seconds: float | None
    status: str  # captured | failed | planned | init
    discontinuity: bool = False  # EXT-X-DISCONTINUITY / quebra declarada


@dataclass(frozen=True, slots=True)
class RepresentationTimeline:
    """Timeline de uma representação dentro da janela inspecionada."""

    rep_id: str
    group_kind: str
    entries: tuple[TimelineEntry, ...] = field(default_factory=tuple)

    @property
    def captured_count(self) -> int:
        return sum(1 for e in self.entries if e.status == "captured")


@dataclass(frozen=True, slots=True)
class CaptureReport:
    """Resumo da janela de captura aplicada nesta inspeção."""

    window_seconds: float
    max_total_bytes: int
    max_segment_bytes: int
    max_playlists_followed: int
    planned: int
    captured: int
    failed: int
    total_bytes: int
