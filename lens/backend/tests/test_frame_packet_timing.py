"""Packet DTS must be read, never inferred from presentation time or payload size."""

import copy
import json
import shutil
import subprocess

import pytest

from stream_lens.adapters.outbound.containers.ffprobe_probe import (
    FFprobeMediaProbe,
    _summarize_frames,
)


def evidence():
    # Decode order I P B; output order I B P. Equal sizes are intentional.
    packets = [
        dict(type="packet", stream_index=0, pos=100, pts=400, dts=0, dts_time="0.000000", size=500),
        dict(
            type="packet", stream_index=0, pos=600, pts=1200, dts=400, dts_time="0.033333", size=500
        ),
        dict(
            type="packet", stream_index=0, pos=1100, pts=800, dts=800, dts_time="0.066667", size=500
        ),
    ]
    frames = [
        dict(
            type="frame",
            stream_index=0,
            pkt_pos=p["pos"],
            pts=p["pts"],
            pkt_size=500,
            pkt_dts=p["pts"],
            pkt_dts_time="wrong",
            pict_type=kind,
        )
        for p, kind in ((packets[0], "I"), (packets[2], "B"), (packets[1], "P"))
    ]
    return packets, frames


def test_packet_timestamps_survive_reordering_and_identical_sizes():
    packets, frames = evidence()
    result, _ = _summarize_frames({"packets_and_frames": packets + frames})
    assert [f["dts"] for f in result] == [0, 800, 400]
    assert [f["dts_time"] for f in result] == ["0.000000", "0.066667", "0.033333"]
    assert [f["packet_position"] for f in result] == [100, 1100, 600]
    assert all(f["dts_provenance"] == "derived (ffprobe packet)" for f in result)


@pytest.mark.parametrize(
    "case",
    [
        "no_packets",
        "no_position",
        "negative_position",
        "stream",
        "pts",
        "size",
        "duplicate_packet",
        "duplicate_frame",
        "no_dts",
        "best_effort_only",
    ],
)
def test_missing_or_ambiguous_evidence_never_falls_back(case):
    packets, frames = evidence()
    if case == "no_packets":
        packets = []
    if case == "no_position":
        frames[0].pop("pkt_pos")
    if case == "negative_position":
        frames[0]["pkt_pos"] = -1
    if case == "stream":
        frames[0]["stream_index"] = 1
    if case == "pts":
        frames[0]["pts"] = 123
    if case == "size":
        frames[0]["pkt_size"] = 123
    if case == "duplicate_packet":
        packets.append(copy.copy(packets[0]))
    if case == "duplicate_frame":
        frames.append(copy.copy(frames[0]))
    if case == "no_dts":
        packets[0].pop("dts")
    if case == "best_effort_only":
        frames[0]["best_effort_timestamp"] = frames[0].pop("pts")
    result, _ = _summarize_frames({"packets_and_frames": packets + frames})
    assert result[0]["dts"] is None
    assert result[0]["dts_time"] is None
    assert result[0]["dts_provenance"] is None


def test_negative_dts_is_preserved():
    packets, frames = evidence()
    packets[0].update(dts=-400, dts_time="-0.033333")
    result, _ = _summarize_frames({"packets_and_frames": packets + frames})
    assert result[0]["dts"] == -400
    assert result[0]["dts_time"] == "-0.033333"


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required for B-frame fixture")
@pytest.mark.parametrize("suffix", ["mp4", "ts", "fmp4"])
def test_real_b_frames_match_demuxed_packets(tmp_path, suffix):
    path = tmp_path / f"reordered.{'mp4' if suffix == 'fmp4' else suffix}"
    flags = ["-movflags", "frag_keyframe+empty_moov+default_base_moof"] if suffix == "fmp4" else []
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=64x64:rate=30",
            "-frames:v",
            "15",
            "-c:v",
            "libx264",
            "-bf",
            "2",
            "-g",
            "15",
            "-x264-params",
            "b-adapt=0",
            *flags,
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    init = None
    source = path
    if suffix == "fmp4":
        data = path.read_bytes()
        offset = 0
        while data[offset + 4 : offset + 8] != b"moof":
            size = int.from_bytes(data[offset : offset + 4], "big")
            assert size >= 8
            offset += size
        init = tmp_path / "init.mp4"
        source = tmp_path / "segment.m4s"
        init.write_bytes(data[:offset])
        source.write_bytes(data[offset:])
    actual = FFprobeMediaProbe().probe_file(
        str(source), init_path=str(init) if init else None, include_frames=True
    )
    assert actual is not None
    packets = json.loads(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_packets",
                "-select_streams",
                "v:0",
                "-of",
                "json",
                str(path),
            ]
        )
    )["packets"]
    assert any(f["pict_type"] == "B" for f in actual["frames"])
    assert len(actual["frames"]) == 15
    for frame in actual["frames"]:
        packet = next(p for p in packets if int(p["pos"]) == frame["packet_position"])
        assert frame["dts"] == int(packet["dts"])
        assert frame["dts_time"] == packet["dts_time"]
        assert frame["pts"] == int(packet["pts"])
    assert any(f["dts"] != f["pts"] for f in actual["frames"])
