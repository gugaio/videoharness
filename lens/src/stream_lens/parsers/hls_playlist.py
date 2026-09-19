"""Leitura pura de playlist de mídia HLS para a janela de captura (ADR-0008).

Encapsula a lib `m3u8` (como `parsers/hls.py`) e devolve apenas os fatos que a
captura precisa: sequência, segmentos declarados com byte range resolvido e
program-date-time. Sem I/O e sem conhecer application ou adapters.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import m3u8


@dataclass(frozen=True, eq=False, slots=True)
class HlsPlaylistSegment:
    """Segmento declarado em uma playlist de mídia HLS.

    ``eq=False`` mantém comparação por identidade: `_window_segments` usa
    ``in`` sobre a mesma lista, e segmentos idênticos não devem colidir.
    """

    uri: str | None
    duration_seconds: float | None
    discontinuity: bool
    byte_range: tuple[int, int] | None
    program_date_time: datetime | None


@dataclass(frozen=True, slots=True)
class HlsInitSegment:
    uri: str | None
    byte_range: tuple[int, int] | None


@dataclass(frozen=True, slots=True)
class HlsMediaPlaylist:
    is_endlist: bool
    media_sequence: int | None
    target_duration: float | None
    init_segment: HlsInitSegment | None
    segments: tuple[HlsPlaylistSegment, ...]


def parse_hls_media_playlist(content: str) -> HlsMediaPlaylist:
    playlist = m3u8.loads(content)

    init_segment = None
    for entry in playlist.segment_map or []:
        if entry and entry.uri:
            init_segment = HlsInitSegment(
                uri=entry.uri,
                byte_range=_format_byterange(getattr(entry, "byterange", None), 0),
            )
            break

    segments: list[HlsPlaylistSegment] = []
    next_range_offset = 0
    for segment in playlist.segments:
        byte_range = _format_byterange(getattr(segment, "byterange", None), next_range_offset)
        if byte_range is not None:
            next_range_offset = byte_range[0] + byte_range[1]
        segments.append(
            HlsPlaylistSegment(
                uri=segment.uri,
                duration_seconds=segment.duration,
                discontinuity=bool(getattr(segment, "discontinuity", False)),
                byte_range=byte_range,
                program_date_time=_program_date_time(segment),
            )
        )

    return HlsMediaPlaylist(
        is_endlist=bool(playlist.is_endlist),
        media_sequence=getattr(playlist, "media_sequence", None),
        target_duration=getattr(playlist, "target_duration", None),
        init_segment=init_segment,
        segments=tuple(segments),
    )


def _program_date_time(segment) -> datetime | None:
    value = getattr(segment, "current_program_date_time", None) or getattr(
        segment, "program_date_time", None
    )
    return value if isinstance(value, datetime) else None


def _format_byterange(spec: str | None, default_offset: int) -> tuple[int, int] | None:
    """EXT-X-BYTERANGE: 'len[@offset]' -> (offset, length)."""
    if not spec:
        return None
    try:
        if "@" in spec:
            length, _, offset = spec.partition("@")
            return int(offset), int(length)
        return default_offset, int(spec)
    except ValueError:
        return None
