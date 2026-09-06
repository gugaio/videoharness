"""Serialização do modelo unificado <-> dict (JSON canônico do snapshot)."""

from __future__ import annotations

from stream_lens.domain.services.redaction import redact_url
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


def _safe_uri(uri: str | None) -> str | None:
    if uri is None:
        return None
    if "://" in uri:
        return redact_url(uri)
    return uri


def _segment_to_dict(seg: SegmentDeclaration) -> dict:
    return {
        "uri": _safe_uri(seg.uri),
        "duration_seconds": seg.duration_seconds,
        "template": seg.template,
        "timescale": seg.timescale,
        "template_duration": seg.template_duration,
        "start_number": seg.start_number,
        "discontinuity": seg.discontinuity,
    }


def _segment_from_dict(data: dict) -> SegmentDeclaration:
    return SegmentDeclaration(
        uri=data.get("uri"),
        duration_seconds=data.get("duration_seconds"),
        template=data.get("template"),
        timescale=data.get("timescale"),
        template_duration=data.get("template_duration"),
        start_number=data.get("start_number"),
        discontinuity=bool(data.get("discontinuity", False)),
    )


def _rep_to_dict(rep: Representation) -> dict:
    return {
        "id": rep.id,
        "uri": _safe_uri(rep.uri),
        "codecs": rep.codecs,
        "bandwidth_bps": rep.bandwidth_bps,
        "average_bandwidth_bps": rep.average_bandwidth_bps,
        "resolution": (
            {"width": rep.resolution.width, "height": rep.resolution.height}
            if rep.resolution
            else None
        ),
        "frame_rate": rep.frame_rate,
        "audio_sampling_rate": rep.audio_sampling_rate,
        "language": rep.language,
        "roles": list(rep.roles),
        "init_segment": _segment_to_dict(rep.init_segment) if rep.init_segment else None,
        "segments": [_segment_to_dict(s) for s in rep.segments],
        "segment_count_declared": rep.segment_count_declared,
        "total_duration_seconds": rep.total_duration_seconds,
    }


def _rep_from_dict(data: dict) -> Representation:
    res = data.get("resolution")
    return Representation(
        id=data["id"],
        uri=data.get("uri"),
        codecs=data.get("codecs"),
        bandwidth_bps=data.get("bandwidth_bps"),
        average_bandwidth_bps=data.get("average_bandwidth_bps"),
        resolution=Resolution(width=res["width"], height=res["height"]) if res else None,
        frame_rate=data.get("frame_rate"),
        audio_sampling_rate=data.get("audio_sampling_rate"),
        language=data.get("language"),
        roles=tuple(data.get("roles", [])),
        init_segment=_segment_from_dict(data["init_segment"]) if data.get("init_segment") else None,
        segments=tuple(_segment_from_dict(s) for s in data.get("segments", [])),
        segment_count_declared=data.get("segment_count_declared"),
        total_duration_seconds=data.get("total_duration_seconds"),
    )


def media_to_dict(media: UnifiedManifest) -> dict:
    return {
        "protocol": media.protocol,
        "kind": media.kind,
        "is_live": media.is_live,
        "track_groups": [
            {
                "kind": g.kind.value,
                "name": g.name,
                "language": g.language,
                "representations": [_rep_to_dict(r) for r in g.representations],
            }
            for g in media.track_groups
        ],
        "drm_systems": [
            {"system": d.system, "details": d.details} for d in media.drm_systems
        ],
        "protocol_specific": media.protocol_specific,
        "capabilities": {
            key: {"status": cap.status.value, "reason": cap.reason}
            for key, cap in media.capabilities.items()
        },
        "warnings": list(media.warnings),
    }


def media_from_dict(data: dict) -> UnifiedManifest:
    return UnifiedManifest(
        protocol=data["protocol"],
        kind=data["kind"],
        is_live=data["is_live"],
        track_groups=tuple(
            TrackGroup(
                kind=MediaKind(g["kind"]),
                name=g.get("name"),
                language=g.get("language"),
                representations=tuple(_rep_from_dict(r) for r in g.get("representations", [])),
            )
            for g in data.get("track_groups", [])
        ),
        drm_systems=tuple(
            DrmSystem(system=d["system"], details=d.get("details"))
            for d in data.get("drm_systems", [])
        ),
        protocol_specific=data.get("protocol_specific", {}),
        capabilities={
            key: Capability(
                status=CapabilityStatus(v["status"]),
                reason=v.get("reason"),
            )
            for key, v in data.get("capabilities", {}).items()
        },
        warnings=tuple(data.get("warnings", [])),
    )
