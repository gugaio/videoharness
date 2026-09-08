"""Medições determinísticas de continuidade temporal entre segmentos."""

from stream_lens.domain.services.timeline_health import apply_timing_health
from stream_lens.domain.value_objects.containers import (
    ContainerAnalysis,
    ContainerSample,
    SegmentContainer,
)
from stream_lens.domain.value_objects.segments import CapturedSegment


def _container(index: int, dts: int, duration: int | None = 90_000) -> SegmentContainer:
    return SegmentContainer(
        rep_id="v1",
        group_kind="video",
        index=index,
        is_init=False,
        file=f"segments/{index}.m4s",
        byte_size=1,
        analysis=ContainerAnalysis(
            kind="mp4",
            samples=(
                ContainerSample(
                    index=0,
                    unit_type="sample",
                    track_id=1,
                    dts=dts,
                    pts=dts,
                    duration=duration,
                    timescale=90_000,
                ),
            ),
        ),
    )


def _captured(index: int) -> CapturedSegment:
    return CapturedSegment(
        rep_id="v1",
        group_kind="video",
        uri=f"fixture://segment-{index}.m4s",
        index=index,
        is_init=False,
        declared_duration_seconds=1.0,
        byte_size=1,
        file=f"segments/{index}.m4s",
    )


def test_mede_gap_na_fronteira_e_preserva_duracao_declarada():
    result = apply_timing_health(
        (_container(1, 0), _container(2, 90_500)),
        (_captured(1), _captured(2)),
    )

    first = result[0].analysis.timing
    second = result[1].analysis.timing
    assert first is not None and second is not None
    assert first.tracks[0].observed_duration_seconds == 1.0
    assert second.declared_duration_seconds == 1.0
    assert second.tracks[0].boundary_delta_seconds == 0.005556


def test_nao_inventa_continuidade_sem_fim_observavel():
    result = apply_timing_health(
        (_container(1, 0, duration=None), _container(2, 90_000)),
        (_captured(1), _captured(2)),
    )

    timing = result[1].analysis.timing
    assert timing is not None
    assert timing.tracks[0].boundary_delta_seconds is None
