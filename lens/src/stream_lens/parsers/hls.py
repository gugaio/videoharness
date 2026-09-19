"""Parser HLS -> modelo unificado, sobre a lib `m3u8` (ADR-0002)."""

from __future__ import annotations

import m3u8

from stream_lens.domain.value_objects.media import (
    Capability,
    CapabilityStatus,
    DrmSystem,
    MediaKind,
    Representation,
    Resolution,
    SegmentDeclaration,
    TrackGroup,
    UnifiedManifest,
)
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol

_HLS_MEDIA_KIND = {
    "AUDIO": MediaKind.AUDIO,
    "SUBTITLES": MediaKind.SUBTITLE,
    "CLOSED-CAPTIONS": MediaKind.CLOSED_CAPTIONS,
}


def parse_hls(content: str) -> UnifiedManifest:
    playlist = m3u8.loads(content)
    if playlist.is_variant:
        return _parse_master(playlist)
    return _parse_media(playlist)


def _parse_master(playlist: m3u8.M3U8) -> UnifiedManifest:
    groups: list[TrackGroup] = []
    warnings: list[str] = []

    audio_like: dict[str, list[Representation]] = {}
    for media in playlist.media:
        roles = [r for r in ("default" if media.default else None,
                             "autoselect" if media.autoselect else None) if r]
        rep = Representation(
            id=media.name or media.group_id or "rendition",
            uri=media.uri,
            language=media.language,
            roles=tuple(roles),
        )
        if media.uri is None:
            warnings.append(
                f"rendição {media.type} '{media.name}' sem URI (embutida no container)"
            )
        audio_like.setdefault(f"{media.type}:{media.group_id}", []).append(rep)

    for key, reps in audio_like.items():
        media_type, group_id = key.split(":", 1)
        groups.append(
            TrackGroup(
                kind=_HLS_MEDIA_KIND.get(media_type, MediaKind.UNKNOWN),
                name=group_id,
                representations=tuple(reps),
            )
        )

    variant_reps = []
    for variant in playlist.playlists:
        stream = variant.stream_info
        resolution = None
        res = getattr(stream, "resolution", None)
        if res:
            resolution = Resolution(width=res[0], height=res[1])
        variant_reps.append(
            Representation(
                id=variant.uri or "",
                uri=variant.uri,
                codecs=stream.codecs,
                bandwidth_bps=stream.bandwidth,
                average_bandwidth_bps=getattr(stream, "average_bandwidth", None),
                resolution=resolution,
                frame_rate=_frame_rate(getattr(stream, "frame_rate", None)),
            )
        )
    if variant_reps:
        groups.append(
            TrackGroup(kind=MediaKind.VIDEO, name="variants", representations=tuple(variant_reps))
        )

    drm = []
    for session_key in playlist.session_keys or []:
        if session_key is None:
            continue
        keyformat = getattr(session_key, "keyformat", None)
        system = "identity" if keyformat is None else keyformat
        drm.append(DrmSystem(system=system, details=f"METHOD={session_key.method}"))

    return UnifiedManifest(
        protocol=Protocol.HLS.value,
        kind=ManifestKind.HLS_MASTER_PLAYLIST.value,
        is_live=False,
        track_groups=tuple(groups),
        drm_systems=tuple(drm),
        protocol_specific={
            "hls": {
                "version": playlist.version,
                "independent_segments": bool(playlist.is_independent_segments),
                "live_determination": "requires_media_playlist",
            }
        },
        capabilities={
            "segment_download": Capability(CapabilityStatus.NOT_COLLECTED,
                                           "Fase 3 inspeciona apenas declarações"),
            "media_playlist_follow": Capability(CapabilityStatus.NOT_COLLECTED,
                                                "rendições não foram baixadas nesta fase"),
        },
        warnings=tuple(warnings),
    )


def _parse_media(playlist: m3u8.M3U8) -> UnifiedManifest:
    segments = tuple(
        SegmentDeclaration(
            uri=s.uri,
            duration_seconds=s.duration,
            discontinuity=bool(getattr(s, "discontinuity", False)),
        )
        for s in playlist.segments
        if s.uri
    )
    init_segment = None
    segment_maps = playlist.segment_map or []
    for seg_map in segment_maps:
        if seg_map.uri:
            init_segment = SegmentDeclaration(uri=seg_map.uri)
            break
    total_duration = sum(s.duration for s in playlist.segments if s.duration)

    rep = Representation(
        id="media-playlist",
        codecs=None,
        init_segment=init_segment,
        segments=segments,
        segment_count_declared=len(segments),
        total_duration_seconds=total_duration or None,
    )

    return UnifiedManifest(
        protocol=Protocol.HLS.value,
        kind=ManifestKind.HLS_MEDIA_PLAYLIST.value,
        is_live=not playlist.is_endlist,
        track_groups=(TrackGroup(kind=MediaKind.UNKNOWN, representations=(rep,)),),
        protocol_specific={
            "hls": {
                "version": playlist.version,
                "target_duration": playlist.target_duration,
                "media_sequence": playlist.media_sequence,
                "playlist_type": playlist.playlist_type,
                "container": "mp4" if init_segment else "mpeg-ts",
            }
        },
        capabilities={
            "segment_download": Capability(CapabilityStatus.NOT_COLLECTED,
                                           "Fase 3 inspeciona apenas declarações"),
        },
    )


def _frame_rate(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
