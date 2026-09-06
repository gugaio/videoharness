"""Adapter ffprobe: metadados derivados de arquivos de mídia capturados.

Segurança: subprocess SEM shell, com lista de argumentos fixa — o único
dado variável é o caminho do arquivo (sob nosso workspace). Sem uso de
entrada do usuário na linha de comando. Timeout curto.
"""

from __future__ import annotations

import json
import shutil
import subprocess

_ARGS = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
]


class FFprobeMediaProbe:
    """Implementa o port MediaProbe usando o binário ffprobe (se existir)."""

    def __init__(self, binary: str = "ffprobe", timeout_seconds: float = 10.0) -> None:
        self._binary = shutil.which(binary)
        self._timeout = timeout_seconds

    @property
    def available(self) -> bool:
        return self._binary is not None

    def probe_file(self, path: str) -> dict | None:
        if self._binary is None:
            return None
        try:
            result = subprocess.run(
                [self._binary, *_ARGS, path],
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
        return _summarize(data)


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
