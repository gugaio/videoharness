"""Matriz ABR de alinhamento, limitada à evidência efetivamente observada."""

from __future__ import annotations

from stream_lens.domain.value_objects.containers import SegmentContainer
from stream_lens.domain.value_objects.segments import (
    AbrAlignment,
    AbrSegmentAlignment,
    RepresentationTimeline,
    TimelineEntry,
)


def measure_abr_alignment(
    timelines: tuple[RepresentationTimeline, ...],
    containers: tuple[SegmentContainer, ...],
) -> tuple[AbrAlignment, ...]:
    """Compara rendições do mesmo grupo contra a primeira referência observada.

    A primeira timeline do grupo define a referência de forma estável, preservando
    a ordem declarada pelo manifesto/captura. Não compara áudio com vídeo nem
    supõe que índices diferentes representem o mesmo instante.
    """

    by_group: dict[str, list[RepresentationTimeline]] = {}
    for timeline in timelines:
        by_group.setdefault(timeline.group_kind, []).append(timeline)

    result: list[AbrAlignment] = []
    for group_kind, group in by_group.items():
        if len(group) < 2:
            continue
        reference = group[0]
        reference_entries = _media_entries(reference)
        for candidate in group[1:]:
            candidate_entries = _media_entries(candidate)
            common_indexes = sorted(reference_entries.keys() & candidate_entries.keys())
            samples: list[AbrSegmentAlignment] = []
            for index in common_indexes:
                ref_entry = reference_entries[index]
                candidate_entry = candidate_entries[index]
                samples.append(
                    AbrSegmentAlignment(
                        index=index,
                        declared_start_delta_seconds=_delta(
                            ref_entry.start_seconds, candidate_entry.start_seconds
                        ),
                        declared_duration_delta_seconds=_delta(
                            ref_entry.duration_seconds, candidate_entry.duration_seconds
                        ),
                        keyframe_pts_delta_seconds=_delta(
                            _first_keyframe_pts(containers, reference.rep_id, index),
                            _first_keyframe_pts(containers, candidate.rep_id, index),
                        ),
                    )
                )
            declared = [
                sample for sample in samples
                if sample.declared_start_delta_seconds is not None
                and sample.declared_duration_delta_seconds is not None
            ]
            keyframes = [
                sample for sample in samples if sample.keyframe_pts_delta_seconds is not None
            ]
            result.append(
                AbrAlignment(
                    group_kind=group_kind,
                    reference_rep_id=reference.rep_id,
                    rep_id=candidate.rep_id,
                    segments=tuple(samples),
                    comparable_declared_segments=len(declared),
                    comparable_keyframes=len(keyframes),
                    max_abs_declared_start_delta_seconds=_max_abs(
                        sample.declared_start_delta_seconds for sample in declared
                    ),
                    max_abs_declared_duration_delta_seconds=_max_abs(
                        sample.declared_duration_delta_seconds for sample in declared
                    ),
                    max_abs_keyframe_pts_delta_seconds=_max_abs(
                        sample.keyframe_pts_delta_seconds for sample in keyframes
                    ),
                )
            )
    return tuple(result)


def _media_entries(timeline: RepresentationTimeline) -> dict[int, TimelineEntry]:
    return {entry.index: entry for entry in timeline.entries if entry.status != "init"}


def _delta(reference: float | None, candidate: float | None) -> float | None:
    if reference is None or candidate is None:
        return None
    return round(candidate - reference, 6)


def _max_abs(values) -> float | None:
    observed = [abs(value) for value in values if value is not None]
    return round(max(observed), 6) if observed else None


def _first_keyframe_pts(
    containers: tuple[SegmentContainer, ...], rep_id: str, index: int
) -> float | None:
    container = next(
        (
            item for item in containers
            if item.rep_id == rep_id and item.index == index and not item.is_init
        ),
        None,
    )
    if container is None or not container.probe:
        return None
    for frame in container.probe.get("frames", []):
        if frame.get("key_frame") is not True:
            continue
        try:
            return round(float(frame["pts_time"]), 6)
        except (KeyError, TypeError, ValueError):
            continue
    return None
