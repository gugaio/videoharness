from stream_lens.domain.services.segment_bitrate import measure_segment_bitrate
from stream_lens.domain.value_objects.containers import (
    ContainerAnalysis,
    ContainerSample,
    ContainerTiming,
    SegmentContainer,
    TimingTrack,
)
from stream_lens.domain.value_objects.media import (
    MediaKind,
    Representation,
    TrackGroup,
    UnifiedManifest,
)
from stream_lens.domain.value_objects.segments import CapturedSegment


def _media() -> UnifiedManifest:
    return UnifiedManifest(
        protocol="HLS",
        kind="hls_media_playlist",
        is_live=False,
        track_groups=(
            TrackGroup(
                kind=MediaKind.VIDEO,
                representations=(Representation(id="v1", bandwidth_bps=1_000_000),),
            ),
        ),
    )


def _segment(duration: float | None = 2.0) -> CapturedSegment:
    return CapturedSegment(
        rep_id="v1",
        group_kind="video",
        uri="fixture://v1/1.m4s",
        index=1,
        is_init=False,
        declared_duration_seconds=duration,
        byte_size=250_000,
    )


def test_calcula_bitrate_com_duracao_observada_e_payloads():
    container = SegmentContainer(
        rep_id="v1",
        group_kind="video",
        index=1,
        is_init=False,
        file="segment.m4s",
        byte_size=250_000,
        analysis=ContainerAnalysis(
            kind="mp4",
            timing=ContainerTiming(
                tracks=(TimingTrack(track_id=1, observed_duration_seconds=2.0),)
            ),
            samples=(
                ContainerSample(index=0, unit_type="sample", byte_size=100),
                ContainerSample(index=1, unit_type="sample", byte_size=300),
            ),
        ),
    )

    result = measure_segment_bitrate(_media(), (_segment(),), (container,))

    assert result[0].average_bitrate_bps == 1_000_000
    assert result[0].peak_bitrate_bps == 1_000_000
    assert result[0].segments[0].duration_provenance == "deterministic (container timestamps)"
    assert result[0].segments[0].average_unit_bytes == 200
    assert result[0].segments[0].largest_unit_bytes == 300


def test_faz_fallback_para_duracao_declarada_sem_forcar_tempo_do_container():
    container = SegmentContainer(
        rep_id="v1",
        group_kind="video",
        index=1,
        is_init=False,
        file="segment.ts",
        byte_size=250_000,
        analysis=ContainerAnalysis(
            kind="mpeg-ts",
            timing=ContainerTiming(
                tracks=(
                    TimingTrack(pid=256, observed_duration_seconds=1.0),
                    TimingTrack(pid=257, observed_duration_seconds=1.2),
                )
            ),
        ),
    )

    result = measure_segment_bitrate(_media(), (_segment(),), (container,))

    assert result[0].segments[0].duration_provenance == "declared (manifest duration)"
    assert result[0].segments[0].bitrate_bps == 1_000_000
