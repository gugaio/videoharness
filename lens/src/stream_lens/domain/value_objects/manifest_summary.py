"""Resumo declarativo mínimo de um manifesto (modelo comum inicial)."""

from __future__ import annotations

from dataclasses import dataclass

from stream_lens.domain.value_objects.media import MediaKind, UnifiedManifest
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol


@dataclass(frozen=True, slots=True)
class ManifestSummary:
    """O que o manifesto declara, sem baixar segmentos.

    Campos None significam "não coletado nesta inspeção"; campos não
    aplicáveis ao kind simplesmente não fazem sentido (ex.: segment_count
    em um master playlist).
    """

    protocol: Protocol
    kind: ManifestKind
    is_live: bool
    variant_count: int | None = None
    segment_count: int | None = None
    rendition_count: int | None = None


def summary_from_unified(media: UnifiedManifest) -> ManifestSummary:
    """Deriva o resumo rápido a partir do modelo unificado (mesma fonte)."""
    kind = ManifestKind(media.kind)
    groups = media.track_groups
    if kind in (ManifestKind.HLS_MASTER_PLAYLIST, ManifestKind.DASH_MPD):
        variant_count = sum(
            len(g.representations)
            for g in groups
            if g.kind in (MediaKind.VIDEO, MediaKind.UNKNOWN)
        )
        rendition_count = sum(
            len(g.representations)
            for g in groups
            if g.kind in (MediaKind.AUDIO, MediaKind.SUBTITLE, MediaKind.CLOSED_CAPTIONS)
        )
        return ManifestSummary(
            protocol=Protocol(media.protocol),
            kind=kind,
            is_live=media.is_live,
            variant_count=variant_count,
            rendition_count=rendition_count,
        )
    segment_count = None
    for group in groups:
        for rep in group.representations:
            if rep.segment_count_declared is not None:
                segment_count = (segment_count or 0) + rep.segment_count_declared
    return ManifestSummary(
        protocol=Protocol(media.protocol),
        kind=kind,
        is_live=media.is_live,
        segment_count=segment_count,
    )
