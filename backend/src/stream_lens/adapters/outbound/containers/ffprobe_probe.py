"""Adapter ffprobe: metadados derivados de arquivos de mídia capturados.

Segurança: subprocess SEM shell, com lista de argumentos fixa — o único
dado variável é o caminho do arquivo (sob nosso workspace). Sem uso de
entrada do usuário na linha de comando. Timeout curto.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from itertools import pairwise
from pathlib import Path

_METADATA_ARGS = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
]
_MAX_FRAMES = 1_000
_MAX_COMBINED_BYTES = 40 * 1024 * 1024
_FRAME_ARGS = [
    "-v", "error",
    "-print_format", "json",
    "-select_streams", "v:0",
    "-read_intervals", f"%+#{_MAX_FRAMES + 1}",
    "-show_frames",
    "-show_entries",
    (
        "frame=stream_index,pict_type,key_frame,pkt_size,pts,pts_time,"
        "best_effort_timestamp,best_effort_timestamp_time,pkt_dts,pkt_dts_time,"
        "pkt_duration,pkt_duration_time,duration,duration_time"
    ),
]


class FFprobeMediaProbe:
    """Implementa o port MediaProbe usando o binário ffprobe (se existir)."""

    def __init__(self, binary: str = "ffprobe", timeout_seconds: float = 10.0) -> None:
        self._binary = shutil.which(binary)
        self._timeout = timeout_seconds

    @property
    def available(self) -> bool:
        return self._binary is not None

    def probe_file(
        self,
        path: str,
        init_path: str | None = None,
        include_frames: bool = False,
    ) -> dict | None:
        if self._binary is None:
            return None
        source = path
        input_bytes = None
        if init_path is not None:
            try:
                init_file = Path(init_path)
                media_file = Path(path)
                if (
                    init_file.stat().st_size + media_file.stat().st_size
                    > _MAX_COMBINED_BYTES
                ):
                    return None
                input_bytes = init_file.read_bytes() + media_file.read_bytes()
            except OSError:
                return None
            if len(input_bytes) > _MAX_COMBINED_BYTES:
                return None
            source = "pipe:0"

        data = self._run_json(_METADATA_ARGS, source, input_bytes)
        if data is None:
            return None
        summary = _summarize(data)
        summary["frames"] = []
        summary["frames_truncated"] = False
        summary["gop"] = None
        if include_frames and any(
            stream.get("codec_type") == "video" for stream in summary["streams"]
        ):
            frame_data = self._run_json(_FRAME_ARGS, source, input_bytes)
            if frame_data is not None:
                frames, truncated = _summarize_frames(frame_data)
                summary["frames"] = frames
                summary["frames_truncated"] = truncated
                if frames:
                    summary["gop"] = _summarize_gop(frames, truncated)
        return summary

    def _run_json(
        self, args: list[str], source: str, input_bytes: bytes | None
    ) -> dict | None:
        assert self._binary is not None
        try:
            result = subprocess.run(
                [self._binary, *args, source],
                input=input_bytes,
                capture_output=True,
                timeout=self._timeout,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return None
        if result.returncode != 0:
            return None
        try:
            data = json.loads(result.stdout.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            return None
        return data


def _summarize(data: dict) -> dict:
    streams = []
    for s in data.get("streams", []):
        streams.append(
            {
                "index": s.get("index"),
                "codec_name": s.get("codec_name"),
                "codec_type": s.get("codec_type"),
                "profile": s.get("profile"),
                "width": s.get("width"),
                "height": s.get("height"),
                "r_frame_rate": s.get("r_frame_rate"),
                "sample_rate": s.get("sample_rate"),
                "channels": s.get("channels"),
                "color_range": s.get("color_range"),
                "color_space": s.get("color_space"),
                "color_transfer": s.get("color_transfer"),
                "color_primaries": s.get("color_primaries"),
                "bits_per_raw_sample": s.get("bits_per_raw_sample"),
                "hdr_side_data": [
                    side.get("side_data_type")
                    for side in s.get("side_data_list", [])
                    if side.get("side_data_type") in {
                        "Mastering display metadata",
                        "Content light level metadata",
                        "HDR Dynamic Metadata SMPTE2094-40 (HDR10+)",
                    }
                ],
                "nb_frames": s.get("nb_frames"),
                "duration": s.get("duration"),
                "extradata_size": s.get("extradata_size"),
            }
        )
    fmt = data.get("format", {})
    return {
        "provenance": "derived (ffprobe)",
        "format_name": fmt.get("format_name"),
        "duration": fmt.get("duration"),
        "size": fmt.get("size"),
        "bit_rate": fmt.get("bit_rate"),
        "streams": streams,
    }


def _as_int(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _as_float(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _summarize_frames(data: dict) -> tuple[list[dict], bool]:
    raw_frames = data.get("frames", [])
    frames = []
    for index, frame in enumerate(raw_frames[:_MAX_FRAMES]):
        pict_type = frame.get("pict_type")
        key_frame = _as_int(frame.get("key_frame"))
        pts = frame.get("pts")
        if pts is None:
            pts = frame.get("best_effort_timestamp")
        duration = frame.get("pkt_duration")
        if duration is None:
            duration = frame.get("duration")
        duration_time = frame.get("pkt_duration_time")
        if duration_time is None:
            duration_time = frame.get("duration_time")
        frames.append(
            {
                "index": index,
                "stream_index": _as_int(frame.get("stream_index")),
                "pict_type": pict_type if pict_type in {"I", "P", "B"} else None,
                "key_frame": bool(key_frame) if key_frame is not None else None,
                "byte_size": _as_int(frame.get("pkt_size")),
                "pts": _as_int(pts),
                "pts_time": frame.get("pts_time")
                or frame.get("best_effort_timestamp_time"),
                "dts": _as_int(frame.get("pkt_dts")),
                "dts_time": frame.get("pkt_dts_time"),
                "duration": _as_int(duration),
                "duration_time": duration_time,
            }
        )
    return frames, len(raw_frames) > _MAX_FRAMES


def _summarize_gop(frames: list[dict], truncated: bool) -> dict:
    key_positions = [
        position
        for position, frame in enumerate(frames)
        if frame.get("key_frame") is True
    ]
    intervals = []
    for start, end in pairwise(key_positions):
        start_seconds = _as_float(frames[start].get("pts_time"))
        end_seconds = _as_float(frames[end].get("pts_time"))
        duration_seconds = None
        if (
            start_seconds is not None
            and end_seconds is not None
            and end_seconds >= start_seconds
        ):
            duration_seconds = round(end_seconds - start_seconds, 6)
        intervals.append(
            {
                "start_frame_index": frames[start]["index"],
                "next_key_frame_index": frames[end]["index"],
                "frame_count": end - start,
                "duration_seconds": duration_seconds,
            }
        )

    first_key_frame_index = (
        frames[key_positions[0]]["index"] if key_positions else None
    )
    trailing_gop = None
    if key_positions:
        trailing_start = key_positions[-1]
        start_seconds = _as_float(frames[trailing_start].get("pts_time"))
        last_seconds = _as_float(frames[-1].get("pts_time"))
        last_duration = _as_float(frames[-1].get("duration_time"))
        observed_duration = None
        if start_seconds is not None and last_seconds is not None:
            observed_duration = last_seconds - start_seconds
            if last_duration is not None:
                observed_duration += last_duration
            observed_duration = (
                None
                if observed_duration <= 0
                else round(observed_duration, 6)
            )
        trailing_gop = {
            "start_frame_index": frames[trailing_start]["index"],
            "observed_frame_count": len(frames) - trailing_start,
            "observed_duration_seconds": observed_duration,
        }
    first_key_state = frames[0].get("key_frame")
    return {
        "starts_with_key_frame": (
            first_key_state if isinstance(first_key_state, bool) else None
        ),
        "first_key_frame_index": first_key_frame_index,
        "key_frame_count": len(key_positions),
        "i_frame_count": sum(frame.get("pict_type") == "I" for frame in frames),
        "p_frame_count": sum(frame.get("pict_type") == "P" for frame in frames),
        "b_frame_count": sum(frame.get("pict_type") == "B" for frame in frames),
        "unknown_frame_count": sum(
            frame.get("pict_type") not in {"I", "P", "B"} for frame in frames
        ),
        "intervals": intervals,
        "trailing_gop": trailing_gop,
        "truncated": truncated,
    }
