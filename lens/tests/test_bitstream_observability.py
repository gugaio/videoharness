"""Contrato da configuração efetiva derivada e do delta A/V por container."""

from dataclasses import replace
from datetime import UTC, datetime

from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    _snapshot_from_dict,
    snapshot_to_dict,
)
from stream_lens.domain.services.bitstream_observability import (
    measure_bitstream_observability,
)
from stream_lens.domain.value_objects.containers import ContainerAnalysis, SegmentContainer
from stream_lens.domain.value_objects.manifest_summary import ManifestSummary
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol
from stream_lens.domain.value_objects.snapshot import Snapshot, SourceInfo


def _container(index: int, *, profile: str = "High", start_audio: str = "0.048"):
    return SegmentContainer(
        rep_id="v1",
        group_kind="video",
        index=index,
        is_init=False,
        file=f"segments/{index}.m4s",
        byte_size=100,
        analysis=ContainerAnalysis(kind="mp4"),
        probe={
            "provenance": "derived (ffprobe)",
            "av_timing": {
                "video": {"pts": 90_000, "pts_time": "0.000"},
                "audio": {"pts": 2_304, "pts_time": start_audio},
                "provenance": "derived (ffprobe presentation timestamps)",
            },
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "h264",
                    "profile": profile,
                    "level": 41,
                    "pix_fmt": "yuv420p",
                    "width": 1280,
                    "height": 720,
                    "r_frame_rate": "30000/1001",
                    "start_time": "1.000",
                },
                {
                    "index": 1,
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "profile": "LC",
                    "sample_rate": "48000",
                    "channels": 2,
                    "channel_layout": "stereo",
                    "start_time": start_audio,
                },
            ],
        },
    )


def test_resume_configuracao_efetiva_mudancas_e_delta_av():
    observed = measure_bitstream_observability(
        (_container(8), _container(9, profile="Main", start_audio="-0.021")),
        {("v1", "video", 8): 190, ("v1", "video", 9): 191},
    )

    assert len(observed) == 1
    item = observed[0]
    assert item.observed_segments[0].segment_sequence == 190
    assert item.observed_segments[0].av_start_delta_seconds == 0.048
    assert item.observed_segments[0].video_start_pts == 90_000
    assert item.observed_segments[0].audio_start_pts == 2_304
    assert item.observed_segments[0].video_start_seconds == 0.0
    assert item.observed_segments[0].audio_start_seconds == 0.048
    assert item.observed_segments[0].av_start_provenance.endswith("presentation timestamps)")
    assert item.observed_segments[1].av_start_delta_seconds == -0.021
    assert item.observed_segments[0].streams[0].codec_name == "aac"
    assert item.configuration_changes[0].from_index == 8
    assert item.configuration_changes[0].to_index == 9
    assert item.configuration_changes[0].changed_fields == ("profile",)


def test_ausencia_de_audio_ou_probe_nao_inventa_delta_ou_mudanca():
    video_only = _container(1)
    assert video_only.probe is not None
    video_only = replace(video_only, probe={"streams": [video_only.probe["streams"][0]]})
    no_probe = SegmentContainer(
        rep_id="v1", group_kind="video", index=2, is_init=False,
        file="segments/2.m4s", byte_size=100, analysis=ContainerAnalysis(kind="mp4"),
    )

    observed = measure_bitstream_observability((video_only, no_probe), {})

    assert len(observed) == 1
    assert len(observed[0].observed_segments) == 1
    assert observed[0].observed_segments[0].av_start_delta_seconds is None
    assert observed[0].observed_segments[0].av_start_provenance == "not available"
    assert observed[0].configuration_changes == ()


def test_bitstream_roundtrip_no_snapshot_preserva_proveniencia():
    observations = measure_bitstream_observability((_container(1),), {("v1", "video", 1): 7})
    snapshot = Snapshot(
        schema_version="1.12",
        analyzer_version="1.4.0",
        inspection_id="bitstream-test",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        expires_at=datetime(2026, 1, 1, 1, tzinfo=UTC),
        source=SourceInfo("fixture://test", "HLS", False),
        manifest=ManifestSummary(Protocol.HLS, ManifestKind.HLS_MEDIA_PLAYLIST, False),
        bitstream_observations=observations,
    )

    payload = snapshot_to_dict(snapshot)

    assert payload["bitstream_observations"][0]["provenance"].startswith("derived")
    assert _snapshot_from_dict(payload).bitstream_observations == observations
