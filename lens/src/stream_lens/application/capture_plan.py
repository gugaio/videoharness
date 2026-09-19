"""Estado do planejamento de uma janela de captura.

O plano é uma decisão da aplicação: descreve quais segmentos devem ser
capturados e os fatos observados durante a resolução de playlists. Não faz
I/O e não conhece HTTP, filesystem ou adapters.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from stream_lens.domain.value_objects.segments import (
    DeliveryObservation,
    LivePlaylistObservation,
    PlannedSegment,
)


@dataclass(slots=True)
class CapturePlan:
    planned: list[PlannedSegment] = field(default_factory=list)
    # rep_id -> {index: discontinuity} para marcar a timeline
    discontinuities: dict[str, dict[int, bool]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    manifest_requests: list[tuple[str, DeliveryObservation | None]] = field(
        default_factory=list
    )
    live_playlists: list[LivePlaylistObservation] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class DashCandidate:
    """Segmento DASH candidato antes de ser convertido em `PlannedSegment`."""

    uri: str
    index: int
    number: int | None
    duration_seconds: float | None
