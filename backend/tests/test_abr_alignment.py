from stream_lens.domain.services.abr_alignment import measure_abr_alignment
from stream_lens.domain.value_objects.containers import ContainerAnalysis, SegmentContainer
from stream_lens.domain.value_objects.segments import RepresentationTimeline, TimelineEntry


def _timeline(rep_id: str, start: float, duration: float) -> RepresentationTimeline:
    return RepresentationTimeline(
        rep_id=rep_id,
        group_kind="video",
        entries=(
            TimelineEntry(index=-1, start_seconds=None, duration_seconds=None, status="init"),
            TimelineEntry(
                index=1,
                start_seconds=start,
                duration_seconds=duration,
                status="captured",
            ),
        ),
    )


def _container(rep_id: str, pts_time: str | None) -> SegmentContainer:
    frames = [] if pts_time is None else [{"key_frame": True, "pts_time": pts_time}]
    return SegmentContainer(
        rep_id=rep_id,
        group_kind="video",
        index=1,
        is_init=False,
        file=f"segments/{rep_id}.m4s",
        byte_size=10,
        analysis=ContainerAnalysis(kind="mp4"),
        probe={"frames": frames},
    )


def test_compara_declaracao_e_keyframe_do_mesmo_indice():
    alignment = measure_abr_alignment(
        (_timeline("360p", 0.0, 2.0), _timeline("720p", 0.02, 2.1)),
        (_container("360p", "10.000000"), _container("720p", "10.033333")),
    )

    assert len(alignment) == 1
    matrix = alignment[0]
    assert matrix.reference_rep_id == "360p"
    assert matrix.rep_id == "720p"
    assert matrix.comparable_declared_segments == 1
    assert matrix.comparable_keyframes == 1
    assert matrix.max_abs_declared_start_delta_seconds == 0.02
    assert matrix.max_abs_declared_duration_delta_seconds == 0.1
    assert matrix.max_abs_keyframe_pts_delta_seconds == 0.033333


def test_nao_inventa_alinhamento_de_keyframe_ausente():
    alignment = measure_abr_alignment(
        (_timeline("360p", 0.0, 2.0), _timeline("720p", 0.0, 2.0)),
        (_container("360p", "10.000000"), _container("720p", None)),
    )

    matrix = alignment[0]
    assert matrix.comparable_declared_segments == 1
    assert matrix.comparable_keyframes == 0
    assert matrix.max_abs_keyframe_pts_delta_seconds is None
    assert matrix.segments[0].keyframe_pts_delta_seconds is None
