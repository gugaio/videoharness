"""Value objects de protocolo e manifesto."""

from __future__ import annotations

from enum import StrEnum


class Protocol(StrEnum):
    """Protocolo de streaming detectado no manifesto."""

    HLS = "HLS"
    DASH = "DASH"
    UNKNOWN = "UNKNOWN"


class ManifestKind(StrEnum):
    """Tipo de manifesto inspecionado (terminologia comum, sem forjar equivalências)."""

    HLS_MASTER_PLAYLIST = "hls_master_playlist"
    HLS_MEDIA_PLAYLIST = "hls_media_playlist"
    DASH_MPD = "dash_mpd"
    UNKNOWN = "unknown"
