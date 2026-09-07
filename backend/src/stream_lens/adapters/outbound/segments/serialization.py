"""Serialização dos blocos de captura/timeline do snapshot (schema 1.1)."""

from __future__ import annotations

from stream_lens.domain.services.redaction import redact_url
from stream_lens.domain.value_objects.segments import (
    AbrAlignment,
    AbrSegmentAlignment,
    CapturedSegment,
    CaptureReport,
    RepresentationBitrate,
    RepresentationTimeline,
    SegmentBitrate,
    TimelineEntry,
)


def abr_alignment_to_dict(alignment: AbrAlignment) -> dict:
    return {
        "group_kind": alignment.group_kind,
        "reference_rep_id": alignment.reference_rep_id,
        "rep_id": alignment.rep_id,
        "segments": [
            {
                "index": segment.index,
                "declared_start_delta_seconds": segment.declared_start_delta_seconds,
                "declared_duration_delta_seconds": segment.declared_duration_delta_seconds,
                "keyframe_pts_delta_seconds": segment.keyframe_pts_delta_seconds,
            }
            for segment in alignment.segments
        ],
        "comparable_declared_segments": alignment.comparable_declared_segments,
        "comparable_keyframes": alignment.comparable_keyframes,
        "max_abs_declared_start_delta_seconds": alignment.max_abs_declared_start_delta_seconds,
        "max_abs_declared_duration_delta_seconds": (
            alignment.max_abs_declared_duration_delta_seconds
        ),
        "max_abs_keyframe_pts_delta_seconds": alignment.max_abs_keyframe_pts_delta_seconds,
        "declared_provenance": alignment.declared_provenance,
        "keyframe_provenance": alignment.keyframe_provenance,
    }


def abr_alignment_from_dict(data: dict) -> AbrAlignment:
    return AbrAlignment(
        group_kind=data["group_kind"],
        reference_rep_id=data["reference_rep_id"],
        rep_id=data["rep_id"],
        segments=tuple(
            AbrSegmentAlignment(
                index=segment["index"],
                declared_start_delta_seconds=segment.get("declared_start_delta_seconds"),
                declared_duration_delta_seconds=segment.get("declared_duration_delta_seconds"),
                keyframe_pts_delta_seconds=segment.get("keyframe_pts_delta_seconds"),
            )
            for segment in data.get("segments", [])
        ),
        comparable_declared_segments=data.get("comparable_declared_segments", 0),
        comparable_keyframes=data.get("comparable_keyframes", 0),
        max_abs_declared_start_delta_seconds=data.get("max_abs_declared_start_delta_seconds"),
        max_abs_declared_duration_delta_seconds=data.get("max_abs_declared_duration_delta_seconds"),
        max_abs_keyframe_pts_delta_seconds=data.get("max_abs_keyframe_pts_delta_seconds"),
        declared_provenance=data.get("declared_provenance", "declared (manifest timeline)"),
        keyframe_provenance=data.get("keyframe_provenance", "derived (ffprobe)"),
    )


def representation_bitrate_to_dict(observation: RepresentationBitrate) -> dict:
    return {
        "group_kind": observation.group_kind,
        "rep_id": observation.rep_id,
        "declared_bandwidth_bps": observation.declared_bandwidth_bps,
        "segments": [
            {
                "index": segment.index,
                "byte_size": segment.byte_size,
                "duration_seconds": segment.duration_seconds,
                "duration_provenance": segment.duration_provenance,
                "bitrate_bps": segment.bitrate_bps,
                "bitrate_ratio_to_declared": segment.bitrate_ratio_to_declared,
                "unit_count": segment.unit_count,
                "average_unit_bytes": segment.average_unit_bytes,
                "largest_unit_bytes": segment.largest_unit_bytes,
                "unit_provenance": segment.unit_provenance,
            }
            for segment in observation.segments
        ],
        "average_bitrate_bps": observation.average_bitrate_bps,
        "peak_bitrate_bps": observation.peak_bitrate_bps,
        "lowest_bitrate_bps": observation.lowest_bitrate_bps,
        "bitrate_provenance": observation.bitrate_provenance,
    }


def representation_bitrate_from_dict(data: dict) -> RepresentationBitrate:
    return RepresentationBitrate(
        group_kind=data["group_kind"],
        rep_id=data["rep_id"],
        declared_bandwidth_bps=data.get("declared_bandwidth_bps"),
        segments=tuple(
            SegmentBitrate(
                index=segment["index"],
                byte_size=segment["byte_size"],
                duration_seconds=segment["duration_seconds"],
                duration_provenance=segment["duration_provenance"],
                bitrate_bps=segment["bitrate_bps"],
                bitrate_ratio_to_declared=segment.get("bitrate_ratio_to_declared"),
                unit_count=segment.get("unit_count", 0),
                average_unit_bytes=segment.get("average_unit_bytes"),
                largest_unit_bytes=segment.get("largest_unit_bytes"),
                unit_provenance=segment.get("unit_provenance"),
            )
            for segment in data.get("segments", [])
        ),
        average_bitrate_bps=data.get("average_bitrate_bps"),
        peak_bitrate_bps=data.get("peak_bitrate_bps"),
        lowest_bitrate_bps=data.get("lowest_bitrate_bps"),
        bitrate_provenance=data.get(
            "bitrate_provenance", "calculated (captured segment bytes / duration)"
        ),
    )


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def captured_to_dict(seg: CapturedSegment) -> dict:
    return {
        "rep_id": seg.rep_id,
        "group_kind": seg.group_kind,
        "uri": redact_url(seg.uri) if "://" in seg.uri else seg.uri,
        "index": seg.index,
        "is_init": seg.is_init,
        "declared_duration_seconds": seg.declared_duration_seconds,
        "byte_range": (
            {"offset": seg.byte_range[0], "length": seg.byte_range[1]}
            if seg.byte_range
            else None
        ),
        "byte_size": seg.byte_size,
        "sha256": seg.sha256,
        "http_status": seg.http_status,
        "fetched_at": _iso(seg.fetched_at),
        "file": seg.file,
        "error": seg.error,
    }


def captured_from_dict(data: dict) -> CapturedSegment:
    br = data.get("byte_range")
    return CapturedSegment(
        rep_id=data["rep_id"],
        group_kind=data["group_kind"],
        uri=data["uri"],
        index=data["index"],
        is_init=data["is_init"],
        declared_duration_seconds=data.get("declared_duration_seconds"),
        byte_range=(br["offset"], br["length"]) if br else None,
        byte_size=data.get("byte_size"),
        sha256=data.get("sha256"),
        http_status=data.get("http_status"),
        fetched_at=_parse_dt(data.get("fetched_at")),
        file=data.get("file"),
        error=data.get("error"),
    )


def capture_report_to_dict(report: CaptureReport) -> dict:
    return {
        "window_seconds": report.window_seconds,
        "max_total_bytes": report.max_total_bytes,
        "max_segment_bytes": report.max_segment_bytes,
        "max_playlists_followed": report.max_playlists_followed,
        "planned": report.planned,
        "captured": report.captured,
        "failed": report.failed,
        "total_bytes": report.total_bytes,
    }


def capture_report_from_dict(data: dict) -> CaptureReport:
    return CaptureReport(
        window_seconds=data["window_seconds"],
        max_total_bytes=data["max_total_bytes"],
        max_segment_bytes=data["max_segment_bytes"],
        max_playlists_followed=data["max_playlists_followed"],
        planned=data["planned"],
        captured=data["captured"],
        failed=data["failed"],
        total_bytes=data["total_bytes"],
    )


def timeline_to_dict(tl: RepresentationTimeline) -> dict:
    return {
        "rep_id": tl.rep_id,
        "group_kind": tl.group_kind,
        "entries": [
            {
                "index": e.index,
                "start_seconds": e.start_seconds,
                "duration_seconds": e.duration_seconds,
                "status": e.status,
                "discontinuity": e.discontinuity,
            }
            for e in tl.entries
        ],
    }


def timeline_from_dict(data: dict) -> RepresentationTimeline:
    return RepresentationTimeline(
        rep_id=data["rep_id"],
        group_kind=data["group_kind"],
        entries=tuple(
            TimelineEntry(
                index=e["index"],
                start_seconds=e.get("start_seconds"),
                duration_seconds=e.get("duration_seconds"),
                status=e["status"],
                discontinuity=e.get("discontinuity", False),
            )
            for e in data.get("entries", [])
        ),
    )


def _parse_dt(value: str | None):
    if value is None:
        return None
    from datetime import datetime

    return datetime.fromisoformat(value)
