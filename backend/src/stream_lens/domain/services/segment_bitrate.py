"""Bitrate por segmento, calculado somente a partir da janela capturada."""

from __future__ import annotations

from stream_lens.domain.value_objects.containers import SegmentContainer
from stream_lens.domain.value_objects.media import UnifiedManifest
from stream_lens.domain.value_objects.segments import (
    CapturedSegment,
    RepresentationBitrate,
    SegmentBitrate,
)


def measure_segment_bitrate(
    media: UnifiedManifest,
    segments: tuple[CapturedSegment, ...],
    containers: tuple[SegmentContainer, ...],
) -> tuple[RepresentationBitrate, ...]:
    """Calcula taxa e distribuição de unidades sem inferir complexidade de codec.

    O arquivo do segmento pode conter mais de uma track. Só adotamos duração do
    container quando todas as durações de track observáveis concordam dentro de
    50 ms; caso contrário, a duração declarada é o fallback explícito.
    """

    declared = {
        representation.id: representation.bandwidth_bps
        for group in media.track_groups
        for representation in group.representations
    }
    by_container = {
        (item.rep_id, item.group_kind, item.index): item for item in containers if not item.is_init
    }
    grouped: dict[tuple[str, str], list[SegmentBitrate]] = {}
    for segment in segments:
        if segment.is_init or not segment.ok or segment.byte_size is None:
            continue
        container = by_container.get((segment.rep_id, segment.group_kind, segment.index))
        duration, provenance = _duration(container, segment.declared_duration_seconds)
        if duration is None or duration <= 0:
            continue
        bitrate = round(segment.byte_size * 8 / duration)
        unit_count, average, largest, unit_provenance = _unit_sizes(container)
        declared_bitrate = declared.get(segment.rep_id)
        grouped.setdefault((segment.group_kind, segment.rep_id), []).append(
            SegmentBitrate(
                index=segment.index,
                byte_size=segment.byte_size,
                duration_seconds=duration,
                duration_provenance=provenance,
                bitrate_bps=bitrate,
                bitrate_ratio_to_declared=(
                    round(bitrate / declared_bitrate, 4) if declared_bitrate else None
                ),
                unit_count=unit_count,
                average_unit_bytes=average,
                largest_unit_bytes=largest,
                unit_provenance=unit_provenance,
            )
        )

    result: list[RepresentationBitrate] = []
    for (group_kind, rep_id), observed in grouped.items():
        observed.sort(key=lambda item: item.index)
        total_bytes = sum(item.byte_size for item in observed)
        total_duration = sum(item.duration_seconds for item in observed)
        rates = [item.bitrate_bps for item in observed]
        result.append(
            RepresentationBitrate(
                group_kind=group_kind,
                rep_id=rep_id,
                declared_bandwidth_bps=declared.get(rep_id),
                segments=tuple(observed),
                average_bitrate_bps=round(total_bytes * 8 / total_duration),
                peak_bitrate_bps=max(rates),
                lowest_bitrate_bps=min(rates),
            )
        )
    return tuple(result)


def _duration(
    container: SegmentContainer | None, declared: float | None
) -> tuple[float | None, str]:
    tracks = container.analysis.timing.tracks if container and container.analysis.timing else ()
    durations = [
        track.observed_duration_seconds for track in tracks if track.observed_duration_seconds
    ]
    if durations and max(durations) - min(durations) <= 0.05:
        return round(sum(durations) / len(durations), 6), "deterministic (container timestamps)"
    if declared is not None:
        return declared, "declared (manifest duration)"
    return None, "not available"


def _unit_sizes(
    container: SegmentContainer | None,
) -> tuple[int, int | None, int | None, str | None]:
    if container is None:
        return 0, None, None, None
    frame_sizes = [
        size
        for frame in (container.probe or {}).get("frames", [])
        if isinstance((size := frame.get("byte_size")), int) and size >= 0
    ]
    if frame_sizes:
        return (
            len(frame_sizes),
            round(sum(frame_sizes) / len(frame_sizes)),
            max(frame_sizes),
            "derived (ffprobe frame packet sizes)",
        )
    sample_sizes = [
        sample.byte_size for sample in container.analysis.samples if sample.byte_size is not None
    ]
    if sample_sizes:
        return (
            len(sample_sizes),
            round(sum(sample_sizes) / len(sample_sizes)),
            max(sample_sizes),
            "deterministic (container samples/PES)",
        )
    return 0, None, None, None
