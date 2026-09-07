"""Snapshot canônico de uma inspeção (versão inicial do contrato)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from stream_lens.domain.value_objects.containers import SegmentContainer
from stream_lens.domain.value_objects.manifest_summary import ManifestSummary
from stream_lens.domain.value_objects.media import UnifiedManifest
from stream_lens.domain.value_objects.segments import (
    AbrAlignment,
    CapturedSegment,
    CaptureReport,
    DeliveryReport,
    RepresentationBitrate,
    RepresentationBitstream,
    RepresentationTimeline,
)

SCHEMA_VERSION = "1.13"
ANALYZER_VERSION = "1.5.0"


@dataclass(frozen=True, slots=True)
class SourceInfo:
    """Identificação da fonte com URL redacted — nunca a URL crua."""

    display_url: str
    protocol: str
    is_live: bool


@dataclass(frozen=True, slots=True)
class Snapshot:
    """Resultado canônico e versionado de uma inspeção.

    A serialização para JSON fica nos adapters; o domínio permanece puro.
    """

    schema_version: str
    analyzer_version: str
    inspection_id: str
    created_at: datetime
    expires_at: datetime
    source: SourceInfo
    manifest: ManifestSummary
    media: UnifiedManifest | None = None  # modelo unificado + DRM DASH (1.13)
    capture: CaptureReport | None = None  # janela/limites aplicados (schema 1.1)
    segments: tuple[CapturedSegment, ...] = ()  # bytes capturados (schema 1.1)
    timeline: tuple[RepresentationTimeline, ...] = ()  # timeline normalizada (1.1)
    containers: tuple[SegmentContainer, ...] = ()  # estrutura, frames/samples, HDR e timing (1.6)
    abr_alignment: tuple[AbrAlignment, ...] = ()  # manifesto + keyframes observados (1.10)
    bitrate_observations: tuple[RepresentationBitrate, ...] = ()  # bytes/duração e payloads (1.8)
    delivery: DeliveryReport | None = None  # HTTP e playlists live observadas (1.9)
    # configuração efetiva/A-V (1.12)
    bitstream_observations: tuple[RepresentationBitstream, ...] = ()
    warnings: list[str] = field(default_factory=list)
