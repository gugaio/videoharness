"""Medições temporais determinísticas para diagnóstico guiado por evidências.

Esta etapa não decide se um stream "está ruim". Ela torna explícito o intervalo
que os bytes permitem observar e a diferença de fronteira entre segmentos da
mesma representação. A ausência de dado continua sendo ausência de evidência.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from stream_lens.domain.value_objects.containers import (
    ContainerSample,
    ContainerTiming,
    SegmentContainer,
    TimingTrack,
)
from stream_lens.domain.value_objects.segments import CapturedSegment


@dataclass(frozen=True, slots=True)
class _PreviousTiming:
    timescale: int
    end_dts: int | None
    start_dts: int | None
    start_pts: int | None
    declared_duration_seconds: float | None


def apply_timing_health(
    containers: tuple[SegmentContainer, ...],
    captured: tuple[CapturedSegment, ...],
) -> tuple[SegmentContainer, ...]:
    """Anexa medições de tempo e continuidade aos containers de mídia.

    Só compara DTS quando fim anterior e início atual são conhecidos e usam a
    mesma escala. Init e segmentos falhos ficam intocados.
    """

    declared = {
        (item.rep_id, item.group_kind, item.index): item.declared_duration_seconds
        for item in captured
        if item.ok and not item.is_init
    }
    previous: dict[tuple[str, str, str], _PreviousTiming] = {}
    updated: dict[tuple[str, str, int, bool], SegmentContainer] = {}

    for container in sorted(
        containers, key=lambda item: (item.rep_id, item.group_kind, item.index)
    ):
        if container.is_init or not container.analysis.samples:
            updated[_key(container)] = container
            continue
        declared_duration = declared.get(
            (container.rep_id, container.group_kind, container.index)
        )
        tracks = _tracks_for(
            container.analysis.samples, container, previous, declared_duration
        )
        timing = ContainerTiming(
            declared_duration_seconds=declared_duration,
            tracks=tuple(tracks),
        )
        updated[_key(container)] = replace(
            container, analysis=replace(container.analysis, timing=timing)
        )
    return tuple(updated[_key(container)] for container in containers)


def _key(container: SegmentContainer) -> tuple[str, str, int, bool]:
    return (container.rep_id, container.group_kind, container.index, container.is_init)


def _tracks_for(
    samples: tuple[ContainerSample, ...],
    container: SegmentContainer,
    previous: dict[tuple[str, str, str], _PreviousTiming],
    declared_duration_seconds: float | None,
) -> list[TimingTrack]:
    groups: dict[tuple[str, int | None], list[ContainerSample]] = {}
    for sample in samples:
        kind = "track" if sample.track_id is not None else "pid"
        identifier = sample.track_id if kind == "track" else sample.pid
        groups.setdefault((kind, identifier), []).append(sample)

    tracks: list[TimingTrack] = []
    for (kind, identifier), group in groups.items():
        first = group[0]
        last = group[-1]
        timescale = first.timescale
        start_dts = first.dts
        end_dts = (
            last.dts + last.duration
            if last.dts is not None and last.duration is not None
            else None
        )
        start_pts = first.pts
        end_pts = (
            last.pts + last.duration
            if last.pts is not None and last.duration is not None
            else None
        )
        observed = _seconds(start_dts, end_dts, timescale)
        key = (container.rep_id, container.group_kind, f"{kind}:{identifier}")
        prior = previous.get(key)
        boundary = None
        basis = None
        wraps = kind == "pid"
        if prior and timescale is not None and prior.timescale == timescale:
            if prior.end_dts is not None and start_dts is not None:
                boundary = _timestamp_delta_seconds(
                    prior.end_dts, start_dts, timescale, wraps
                )
                basis = "DTS current start - previous observed end"
            elif prior.declared_duration_seconds is not None:
                if prior.start_dts is not None and start_dts is not None:
                    elapsed = _timestamp_delta_seconds(
                        prior.start_dts, start_dts, timescale, wraps
                    )
                    boundary = round(elapsed - prior.declared_duration_seconds, 6)
                    basis = "DTS start-to-start - previous declared duration"
                elif prior.start_pts is not None and start_pts is not None:
                    elapsed = _timestamp_delta_seconds(
                        prior.start_pts, start_pts, timescale, wraps
                    )
                    boundary = round(elapsed - prior.declared_duration_seconds, 6)
                    basis = "PTS start-to-start - previous declared duration"
        if timescale is not None and timescale > 0:
            previous[key] = _PreviousTiming(
                timescale=timescale,
                end_dts=end_dts,
                start_dts=start_dts,
                start_pts=start_pts,
                declared_duration_seconds=declared_duration_seconds,
            )
        tracks.append(
            TimingTrack(
                track_id=identifier if kind == "track" else None,
                pid=identifier if kind == "pid" else None,
                timescale=timescale,
                start_dts=start_dts,
                end_dts=end_dts,
                start_pts=start_pts,
                end_pts=end_pts,
                observed_duration_seconds=observed,
                boundary_delta_seconds=boundary,
                boundary_basis=basis,
            )
        )
    return tracks


def _seconds(start: int | None, end: int | None, timescale: int | None) -> float | None:
    if start is None or end is None or timescale is None or timescale <= 0:
        return None
    return round((end - start) / timescale, 6)


def _timestamp_delta_seconds(start: int, end: int, timescale: int, wraps: bool) -> float:
    delta = end - start
    if wraps and delta < -(1 << 32):
        delta += 1 << 33
    return round(delta / timescale, 6)
