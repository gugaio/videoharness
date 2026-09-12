from stream_lens.domain.services.abr_alignment import measure_abr_alignment
from stream_lens.domain.value_objects.containers import ContainerAnalysis, SegmentContainer
from stream_lens.domain.value_objects.segments import RepresentationTimeline, TimelineEntry


def _timeline(
    rep_id: str,
    start: float,
    duration: float,
    *,
    index: int = 1,
    sequence: int | None = None,
) -> RepresentationTimeline:
    return RepresentationTimeline(
        rep_id=rep_id,
        group_kind="video",
        entries=(
            TimelineEntry(index=-1, start_seconds=None, duration_seconds=None, status="init"),
            TimelineEntry(
                index=index,
                start_seconds=start,
                duration_seconds=duration,
                status="captured",
                segment_sequence=sequence,
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


def test_pareia_janelas_live_pela_media_sequence_e_nao_pelo_indice_local():
    reference = RepresentationTimeline(
        rep_id="360p",
        group_kind="video",
        entries=(
            TimelineEntry(10, 0.0, 4.8, "captured", segment_sequence=281),
            TimelineEntry(11, 4.8, 4.8, "captured", segment_sequence=282),
        ),
    )
    candidate = RepresentationTimeline(
        rep_id="720p",
        group_kind="video",
        entries=(
            TimelineEntry(3, 0.0, 4.8, "captured", segment_sequence=282),
            TimelineEntry(4, 4.8, 4.8, "captured", segment_sequence=283),
        ),
    )
    containers = (
        SegmentContainer(
            rep_id="360p", group_kind="video", index=11, is_init=False,
            file="segments/360p-11.m4s", byte_size=10,
            analysis=ContainerAnalysis(kind="mp4"),
            probe={"frames": [{"key_frame": True, "pts_time": "104.800000"}]},
        ),
        SegmentContainer(
            rep_id="720p", group_kind="video", index=3, is_init=False,
            file="segments/720p-3.m4s", byte_size=10,
            analysis=ContainerAnalysis(kind="mp4"),
            probe={"frames": [{"key_frame": True, "pts_time": "104.800000"}]},
        ),
    )

    matrix = measure_abr_alignment((reference, candidate), containers, protocol="DASH")[0]

    assert matrix.comparison_basis == "canonical segment sequence"
    assert matrix.comparable_declared_segments == 1
    assert matrix.comparable_keyframes == 1
    assert matrix.unmatched_reference_segments == 1
    assert matrix.unmatched_candidate_segments == 1
    assert matrix.max_abs_keyframe_pts_delta_seconds == 0.0
    assert matrix.segments[0].index == 11
    assert matrix.segments[0].candidate_index == 3
    assert matrix.segments[0].segment_sequence == 282


def test_hls_sequence_sozinha_nao_prova_identidade_entre_rendicoes():
    alignment = measure_abr_alignment(
        (_timeline("360p", 0, 4, sequence=12), _timeline("720p", 0, 4, sequence=12)),
        (),
        protocol="HLS",
    )[0]
    assert alignment.segments == ()
    assert alignment.comparable_declared_segments == 0
    assert alignment.comparable_keyframes == 0
    assert alignment.comparison_basis == "not comparable (HLS cross-rendition identity unavailable)"
