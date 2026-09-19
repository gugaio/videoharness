"""Entidade Inspection: uma inspeção temporária de um stream."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from stream_lens.domain.value_objects.manifest_summary import ManifestSummary
from stream_lens.domain.value_objects.protocol import Protocol


class InspectionStatus(StrEnum):
    QUEUED = "queued"
    FETCHING_MANIFEST = "fetching_manifest"
    PARSING_MANIFEST = "parsing_manifest"
    RESOLVING_SEGMENTS = "resolving_segments"
    CAPTURING_SEGMENTS = "capturing_segments"
    INSPECTING_CONTAINERS = "inspecting_containers"
    BUILDING_SNAPSHOT = "building_snapshot"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"
    EXPIRED = "expired"


ACTIVE_STATUSES = frozenset(
    {
        InspectionStatus.QUEUED,
        InspectionStatus.FETCHING_MANIFEST,
        InspectionStatus.PARSING_MANIFEST,
        InspectionStatus.RESOLVING_SEGMENTS,
        InspectionStatus.CAPTURING_SEGMENTS,
        InspectionStatus.INSPECTING_CONTAINERS,
        InspectionStatus.BUILDING_SNAPSHOT,
    }
)

TERMINAL_STATUSES = frozenset(
    {
        InspectionStatus.COMPLETED,
        InspectionStatus.PARTIAL,
        InspectionStatus.FAILED,
    }
)


@dataclass(slots=True)
class Inspection:
    """Estado temporário de uma inspeção (não é a URL; a mesma URL gera inspeções distintas)."""

    inspection_id: str
    status: InspectionStatus
    created_at: datetime
    expires_at: datetime
    protocol: Protocol | None = None
    manifest: ManifestSummary | None = None
    error_stage: str | None = None
    error_message: str | None = None
    warnings: list[str] = field(default_factory=list)
    # progresso da captura (Fase 4); None = estágio ainda não iniciado
    segments_planned: int | None = None
    segments_captured: int | None = None
    segments_failed: int | None = None

    def start_stage(self, status: InspectionStatus) -> None:
        """Entra em um estágio intermediário do ciclo de vida."""
        self.status = status
        self.error_stage = None
        self.error_message = None

    def complete(self, manifest: ManifestSummary, partial: bool = False) -> None:
        self.status = InspectionStatus.PARTIAL if partial else InspectionStatus.COMPLETED
        self.protocol = manifest.protocol
        self.manifest = manifest

    def record_capture_progress(self, planned: int, captured: int, failed: int) -> None:
        self.segments_planned = planned
        self.segments_captured = captured
        self.segments_failed = failed

    def fail(self, stage: str, message: str) -> None:
        self.status = InspectionStatus.FAILED
        self.error_stage = stage
        self.error_message = message

    def is_expired(self, now: datetime) -> bool:
        return now >= self.expires_at
