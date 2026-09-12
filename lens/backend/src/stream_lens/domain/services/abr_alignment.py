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
    protocol: str | None = None,
) -> tuple[AbrAlignment, ...]:
    """Compara rendições do mesmo grupo contra a primeira referência observada.

    A primeira timeline do grupo define a referência de forma estável, preservando
    a ordem declarada pelo manifesto/captura. Quando as duas timelines preservam
    uma sequência canônica, os pares DASH são formados por ela. No HLS,
    ``EXT-X-MEDIA-SEQUENCE`` é local a cada Media Playlist e não prova identidade
    entre rendições; portanto nenhum par cross-rendition é fabricado. O índice
    local só é fallback em protocolos sem sequência canônica disponível.
    """

    by_group: dict[str, list[RepresentationTimeline]] = {}
    for timeline in timelines:
        by_group.setdefault(timeline.group_kind, []).append(timeline)

    result: list[AbrAlignment] = []
    for group_kind, group in by_group.items():
        if len(group) < 2:
            continue
        reference = group[0]
        for candidate in group[1:]:
            pairs: tuple[tuple[TimelineEntry, TimelineEntry, int | None], ...]
            if (protocol or "").upper() == "HLS":
                pairs = ()
                comparison_basis = "not comparable (HLS cross-rendition identity unavailable)"
                unmatched_reference = len(_media_entries(reference))
                unmatched_candidate = len(_media_entries(candidate))
            else:
                pairs, comparison_basis, unmatched_reference, unmatched_candidate = _pairs(
                    reference, candidate
                )
            samples: list[AbrSegmentAlignment] = []
            for ref_entry, candidate_entry, sequence in pairs:
                samples.append(
                    AbrSegmentAlignment(
                        index=ref_entry.index,
                        candidate_index=candidate_entry.index,
                        segment_sequence=sequence,
                        # Um par com a mesma sequence descreve a mesma fronteira
                        # declarada; start_seconds é relativo a cada janela e não
                        # deve criar um falso delta quando elas estão deslocadas.
                        declared_start_delta_seconds=(
                            0.0
                            if sequence is not None
                            else _delta(ref_entry.start_seconds, candidate_entry.start_seconds)
                        ),
                        declared_duration_delta_seconds=_delta(
                            ref_entry.duration_seconds, candidate_entry.duration_seconds
                        ),
                        keyframe_pts_delta_seconds=_delta(
                            _first_keyframe_pts(containers, reference.rep_id, ref_entry.index),
                            _first_keyframe_pts(
                                containers, candidate.rep_id, candidate_entry.index
                            ),
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
                    comparison_basis=comparison_basis,
                    unmatched_reference_segments=unmatched_reference,
                    unmatched_candidate_segments=unmatched_candidate,
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


def _media_entries(timeline: RepresentationTimeline) -> tuple[TimelineEntry, ...]:
    return tuple(entry for entry in timeline.entries if entry.status != "init")


def _pairs(
    reference: RepresentationTimeline, candidate: RepresentationTimeline
) -> tuple[
    tuple[tuple[TimelineEntry, TimelineEntry, int | None], ...], str, int, int
]:
    """Encontra pares sem confundir a posição local com a identidade do conteúdo."""
    reference_entries = _media_entries(reference)
    candidate_entries = _media_entries(candidate)
    reference_sequences = {
        entry.segment_sequence: entry
        for entry in reference_entries
        if entry.segment_sequence is not None
    }
    candidate_sequences = {
        entry.segment_sequence: entry
        for entry in candidate_entries
        if entry.segment_sequence is not None
    }
    if reference_sequences and candidate_sequences:
        common_sequences = sorted(reference_sequences.keys() & candidate_sequences.keys())
        return (
            tuple(
                (
                    reference_sequences[sequence],
                    candidate_sequences[sequence],
                    sequence,
                )
                for sequence in common_sequences
            ),
            "canonical segment sequence",
            len(reference_entries) - len(common_sequences),
            len(candidate_entries) - len(common_sequences),
        )

    reference_indexes = {entry.index: entry for entry in reference_entries}
    candidate_indexes = {entry.index: entry for entry in candidate_entries}
    common_indexes = sorted(reference_indexes.keys() & candidate_indexes.keys())
    return (
        tuple(
            (reference_indexes[index], candidate_indexes[index], None)
            for index in common_indexes
        ),
        "capture-window index (sequence unavailable)",
        len(reference_entries) - len(common_indexes),
        len(candidate_entries) - len(common_indexes),
    )


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
