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


def test_sem_fim_observavel_compara_inicios_com_duracao_declarada():
    result = apply_timing_health(
        (_container(1, 0, duration=None), _container(2, 90_000)),
        (_captured(1), _captured(2)),
    )

    timing = result[1].analysis.timing
    assert timing is not None
    assert timing.tracks[0].boundary_delta_seconds == 0.0
    assert timing.tracks[0].boundary_basis == (
        "DTS start-to-start - previous declared duration"
    )


def test_mpeg_ts_pts_only_compara_inicios_sem_inventar_dts():
    def ts_container(index: int, pts: int) -> SegmentContainer:
        return SegmentContainer(
            rep_id="v1", group_kind="video", index=index, is_init=False,
            file=f"segments/{index}.ts", byte_size=1,
            analysis=ContainerAnalysis(
                kind="mpeg-ts",
                samples=(ContainerSample(
                    index=0, unit_type="pes", pid=0x101, pts=pts,
                    dts=None, duration=None, timescale=90_000,
                ),),
            ),
        )

    result = apply_timing_health(
        (ts_container(1, 1_000_000), ts_container(2, 1_288_000)),
        (_captured(1), CapturedSegment(
            rep_id="v1", group_kind="video", uri="fixture://segment-2.ts",
            index=2, is_init=False, declared_duration_seconds=1.0,
            byte_size=1, file="segments/2.ts",
        )),
    )

    timing = result[1].analysis.timing
    assert timing is not None
    assert timing.tracks[0].start_dts is None
    assert timing.tracks[0].boundary_delta_seconds == 2.2
    assert timing.tracks[0].boundary_basis == (
        "PTS start-to-start - previous declared duration"
    )
