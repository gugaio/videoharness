"""Serialização dos blocos de captura/timeline do snapshot (schema 1.1)."""

from __future__ import annotations

from stream_lens.domain.services.redaction import redact_url
from stream_lens.domain.value_objects.segments import (
    CapturedSegment,
    CaptureReport,
    RepresentationTimeline,
    TimelineEntry,
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
