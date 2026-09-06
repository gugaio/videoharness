"""Modelo unificado de manifestos HLS/DASH (Fase 3).

Top-down: UnifiedManifest -> TrackGroup -> Representation -> segmentos
declarados (referências, não bytes). Tudo aqui é declaração do manifesto;
análise de segmentos reais acontece em fases posteriores.

Convenções:
- Campos None = "não coletado nesta inspeção".
- Capabilities explicitam supported/unsupported com motivo — nunca omitir
  silenciosamente uma limitação.
- URIs são preservadas como declaradas no manifesto (relativas permanecem
  relativas); URIs absolutas passam por redaction na serialização.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class MediaKind(StrEnum):
    VIDEO = "video"
    AUDIO = "audio"
    SUBTITLE = "subtitle"
    CLOSED_CAPTIONS = "closed_captions"
    UNKNOWN = "unknown"


class CapabilityStatus(StrEnum):
    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    NOT_COLLECTED = "not_collected"
    NOT_APPLICABLE = "not_applicable"


@dataclass(frozen=True, slots=True)
class Capability:
    status: CapabilityStatus
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class Resolution:
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class SegmentDeclaration:
    """Segmento (ou template de segmento) declarado no manifesto."""

    uri: str | None  # None quando só existe template calculado (DASH $Number$)
    duration_seconds: float | None = None
    # templates DASH: $Number$/$Time$ + timescale/duração
    template: str | None = None
    timescale: int | None = None
    template_duration: int | None = None
    start_number: int | None = None
    discontinuity: bool = False


@dataclass(frozen=True, slots=True)
class Representation:
    """Uma rendição endereçável dentro de um grupo de mídia."""

    id: str
    uri: str | None = None
    codecs: str | None = None
    bandwidth_bps: int | None = None
    average_bandwidth_bps: int | None = None
    resolution: Resolution | None = None
    frame_rate: float | None = None
    audio_sampling_rate: int | None = None
    language: str | None = None
    roles: tuple[str, ...] = ()
    # segmentos/init declarados (sem baixar bytes)
    init_segment: SegmentDeclaration | None = None
    segments: tuple[SegmentDeclaration, ...] = ()
    segment_count_declared: int | None = None
    total_duration_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class DrmSystem:
    """Sinalização de DRM declarada (apenas o que o manifesto anuncia)."""

    system: str  # ex.: urn uuid Widevine/PlayReady, ou METHOD do HLS
    details: str | None = None


@dataclass(frozen=True, slots=True)
class TrackGroup:
    """Grupo de mídia: rendições alternativas do mesmo conteúdo/kind."""

    kind: MediaKind
    name: str | None = None
    language: str | None = None
    representations: tuple[Representation, ...] = ()


@dataclass(frozen=True, slots=True)
class UnifiedManifest:
    """Visão comum HLS/DASH: grupos, DRM e detalhes por protocolo."""

    protocol: str  # Protocol.value
    kind: str  # ManifestKind.value
    is_live: bool
    track_groups: tuple[TrackGroup, ...] = ()
    drm_systems: tuple[DrmSystem, ...] = ()
    # preservado sem forjar equivalência: {"hls": {...}} ou {"dash": {...}}
    protocol_specific: dict = field(default_factory=dict)
    # o que esta versão do analyzer suporta sobre este manifesto
    capabilities: dict[str, Capability] = field(default_factory=dict)
    warnings: tuple[str, ...] = ()
