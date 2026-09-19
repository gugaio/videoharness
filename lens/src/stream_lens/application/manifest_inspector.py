"""Inspetor de manifestos: detecta HLS/DASH e delega ao parser dedicado."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from stream_lens.application.ports.manifest_inspector import (
    ManifestInspector as ManifestInspectorPort,
)
from stream_lens.application.use_cases.create_inspection import InspectionError
from stream_lens.domain.value_objects.media import UnifiedManifest
from stream_lens.parsers.dash import parse_dash
from stream_lens.parsers.hls import parse_hls


class UnsupportedManifestError(InspectionError):
    def __init__(self, message: str) -> None:
        super().__init__("parsing_manifest", message)


class DeclarativeManifestInspector(ManifestInspectorPort):
    """Seleciona o parser pelo conteúdo e normaliza erros para a inspeção."""

    def inspect(self, content: str) -> UnifiedManifest:
        stripped = content.strip()
        if stripped.startswith("#EXTM3U"):
            return parse_hls(stripped)
        if _is_dash_mpd(stripped):
            try:
                return parse_dash(stripped)
            except ValueError as exc:
                raise UnsupportedManifestError(f"MPD inválido: {exc}") from exc
        raise UnsupportedManifestError(
            "conteúdo não reconhecido como HLS (m3u8) nem DASH (MPD)"
        )


def _is_dash_mpd(content: str) -> bool:
    """Reconhece o elemento-raiz MPD, sem depender de `<MPD` literal.

    CDNs podem entregar declaração XML, BOM ou prefixo de namespace (`dash:MPD`).
    A extensão da URL não é uma fonte confiável em URLs assinadas.
    """
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return False
    return root.tag.rsplit("}", 1)[-1] == "MPD"
