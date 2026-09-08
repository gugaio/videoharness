"""Analyzer de containers: sniffing do formato + delegação ao parser.

Sniffing determinístico pelos bytes capturados:
- MPEG-TS: byte de sync 0x47 em 0 e em 188 (e em 376 quando existir);
- fMP4: primeiro box com tipo em {ftyp, styp, moov, moof, sidx, skip, free}.
"""

from __future__ import annotations

from stream_lens.adapters.outbound.containers.fmp4_parser import parse_fmp4
from stream_lens.adapters.outbound.containers.mpegts_parser import parse_mpegts
from stream_lens.domain.value_objects.containers import ContainerAnalysis

_FMP4_TOP_BOXES = {b"ftyp", b"styp", b"moov", b"moof", b"sidx", b"skip", b"free", b"emsg"}


class SniffingContainerAnalyzer:
    """Implementa o port ContainerAnalyzer."""

    def analyze(
        self, data: bytes, is_init: bool, init_data: bytes | None = None
    ) -> ContainerAnalysis:
        if not data:
            return ContainerAnalysis(kind="unknown", error="sem bytes")
        if _looks_like_mpegts(data):
            return parse_mpegts(data)
        if _looks_like_fmp4(data):
            init_info = None
            if not is_init and init_data and _looks_like_fmp4(init_data):
                init_info = parse_fmp4(init_data, is_init=True).fmp4
            return parse_fmp4(data, is_init, init_info=init_info)
        return ContainerAnalysis(
            kind="unknown", error="formato não reconhecido (nem TS nem fMP4)"
        )


def _looks_like_mpegts(data: bytes) -> bool:
    if len(data) < 2 * 188:
        return data[0] == 0x47 and data[188] == 0x47
    return data[0] == 0x47 and data[188] == 0x47 and data[376] == 0x47


def _looks_like_fmp4(data: bytes) -> bool:
    if len(data) < 8:
        return False
    return data[4:8] in _FMP4_TOP_BOXES
