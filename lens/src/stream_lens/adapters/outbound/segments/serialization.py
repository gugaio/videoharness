"""Serialização dos blocos de captura/timeline do snapshot (schema 1.1)."""

from __future__ import annotations

from stream_lens.domain.services.redaction import redact_url
from stream_lens.domain.value_objects.segments import (
    AbrAlignment,
    AbrSegmentAlignment,
    BitstreamConfigurationChange,
    BitstreamSegmentObservation,
    CapturedSegment,
    CaptureReport,
    DeliveryObservation,
    DeliveryReport,
    EffectiveStreamConfiguration,
    LivePlaylistObservation,
    RepresentationBitrate,
    RepresentationBitstream,
    RepresentationTimeline,
    SegmentBitrate,
    TimelineEntry,
)


def delivery_to_dict(observation: DeliveryObservation | None) -> dict | None:
    if observation is None:
        return None
    return {
        "http_status": observation.http_status,
        "ttfb_ms": observation.ttfb_ms,
        "download_duration_ms": observation.download_duration_ms,
        "effective_throughput_bps": observation.effective_throughput_bps,
        "redirect_count": observation.redirect_count,
        "cache_control": list(observation.cache_control),
        "cache_max_age_seconds": observation.cache_max_age_seconds,
        "cache_age_seconds": observation.cache_age_seconds,
        "cache_etag_present": observation.cache_etag_present,
        "provenance": observation.provenance,
    }


def delivery_from_dict(data: dict | None) -> DeliveryObservation | None:
    if data is None:
        return None
    return DeliveryObservation(
        http_status=data.get("http_status"),
        ttfb_ms=data.get("ttfb_ms"),
        download_duration_ms=data.get("download_duration_ms"),
        effective_throughput_bps=data.get("effective_throughput_bps"),
        redirect_count=data.get("redirect_count"),
        cache_control=tuple(data.get("cache_control", [])),
        cache_max_age_seconds=data.get("cache_max_age_seconds"),
        cache_age_seconds=data.get("cache_age_seconds"),
        cache_etag_present=data.get("cache_etag_present"),
        provenance=data.get("provenance", "observed (HTTP client)"),
    )


def delivery_report_to_dict(report: DeliveryReport) -> dict:
    return {
        "manifest_requests": [
            {"url": redact_url(url), "delivery": delivery_to_dict(delivery)}
            for url, delivery in report.manifest_requests
        ],
        "live_playlists": [
            {
                "rep_id": item.rep_id,
                "playlist_url": redact_url(item.playlist_url),
                "observed_at": _iso(item.observed_at),
                "media_sequence": item.media_sequence,
                "last_segment_sequence": item.last_segment_sequence,
                "target_duration_seconds": item.target_duration_seconds,
                "playlist_window_duration_seconds": item.playlist_window_duration_seconds,
                "live_edge_program_date_time": _iso(item.live_edge_program_date_time),
                "live_edge_distance_seconds": item.live_edge_distance_seconds,
                "delivery": delivery_to_dict(item.delivery),
                "advancement": item.advancement,
                "live_edge_advance_segments": item.live_edge_advance_segments,
                "window_shift_segments": item.window_shift_segments,
                "provenance": item.provenance,
            }
            for item in report.live_playlists
        ],
        "live_note": report.live_note,
    }


def delivery_report_from_dict(data: dict) -> DeliveryReport:
    return DeliveryReport(
        manifest_requests=tuple(
            (item["url"], delivery_from_dict(item.get("delivery")))
            for item in data.get("manifest_requests", [])
        ),
        live_playlists=tuple(
            LivePlaylistObservation(
                rep_id=item.get("rep_id"),
                playlist_url=item["playlist_url"],
                observed_at=_parse_dt(item["observed_at"]),
                media_sequence=item.get("media_sequence"),
                last_segment_sequence=item.get("last_segment_sequence"),
                target_duration_seconds=item.get("target_duration_seconds"),
                playlist_window_duration_seconds=item.get("playlist_window_duration_seconds"),
                live_edge_program_date_time=_parse_dt(item.get("live_edge_program_date_time")),
                live_edge_distance_seconds=item.get("live_edge_distance_seconds"),
                delivery=delivery_from_dict(item.get("delivery")),
                advancement=item.get("advancement", "not measured (single playlist observation)"),
                live_edge_advance_segments=item.get("live_edge_advance_segments"),
                window_shift_segments=item.get("window_shift_segments"),
                provenance=item.get("provenance", "declared (HLS playlist)"),
            )
            for item in data.get("live_playlists", [])
        ),
        live_note=data.get("live_note"),
    )


def abr_alignment_to_dict(alignment: AbrAlignment) -> dict:
    return {
        "group_kind": alignment.group_kind,
        "reference_rep_id": alignment.reference_rep_id,
        "rep_id": alignment.rep_id,
        "segments": [
            {
                "index": segment.index,
                "candidate_index": segment.candidate_index,
                "segment_sequence": segment.segment_sequence,
                "declared_start_delta_seconds": segment.declared_start_delta_seconds,
                "declared_duration_delta_seconds": segment.declared_duration_delta_seconds,
                "keyframe_pts_delta_seconds": segment.keyframe_pts_delta_seconds,
            }
            for segment in alignment.segments
        ],
        "comparison_basis": alignment.comparison_basis,
        "unmatched_reference_segments": alignment.unmatched_reference_segments,
        "unmatched_candidate_segments": alignment.unmatched_candidate_segments,
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
                candidate_index=segment.get("candidate_index"),
                segment_sequence=segment.get("segment_sequence"),
                declared_start_delta_seconds=segment.get("declared_start_delta_seconds"),
                declared_duration_delta_seconds=segment.get("declared_duration_delta_seconds"),
                keyframe_pts_delta_seconds=segment.get("keyframe_pts_delta_seconds"),
            )
            for segment in data.get("segments", [])
        ),
        comparison_basis=data.get(
            "comparison_basis", "capture-window index (sequence unavailable)"
        ),
        unmatched_reference_segments=data.get("unmatched_reference_segments", 0),
        unmatched_candidate_segments=data.get("unmatched_candidate_segments", 0),
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


def representation_bitstream_to_dict(observation: RepresentationBitstream) -> dict:
    return {
        "group_kind": observation.group_kind,
        "rep_id": observation.rep_id,
        "observed_segments": [
            {
                "index": segment.index,
                "segment_sequence": segment.segment_sequence,
                "streams": [
                    {
                        "stream_index": stream.stream_index,
                        "kind": stream.kind,
                        "codec_name": stream.codec_name,
                        "profile": stream.profile,
                        "level": stream.level,
                        "pixel_format": stream.pixel_format,
                        "width": stream.width,
                        "height": stream.height,
                        "frame_rate": stream.frame_rate,
                        "sample_rate": stream.sample_rate,
                        "channels": stream.channels,
                        "channel_layout": stream.channel_layout,
                        "start_time_seconds": stream.start_time_seconds,
                    }
                    for stream in segment.streams
                ],
                "video_start_pts": segment.video_start_pts,
                "video_start_seconds": segment.video_start_seconds,
                "audio_start_pts": segment.audio_start_pts,
                "audio_start_seconds": segment.audio_start_seconds,
                "av_start_delta_seconds": segment.av_start_delta_seconds,
                "av_start_provenance": segment.av_start_provenance,
            }
            for segment in observation.observed_segments
        ],
        "configuration_changes": [
            {
                "from_index": change.from_index,
                "to_index": change.to_index,
                "changed_fields": list(change.changed_fields),
            }
            for change in observation.configuration_changes
        ],
        "provenance": observation.provenance,
    }


def representation_bitstream_from_dict(data: dict) -> RepresentationBitstream:
    return RepresentationBitstream(
        group_kind=data["group_kind"],
        rep_id=data["rep_id"],
        observed_segments=tuple(
            BitstreamSegmentObservation(
                index=segment["index"],
                segment_sequence=segment.get("segment_sequence"),
                streams=tuple(
                    EffectiveStreamConfiguration(
                        stream_index=stream.get("stream_index"),
                        kind=stream["kind"],
                        codec_name=stream.get("codec_name"),
                        profile=stream.get("profile"),
                        level=stream.get("level"),
                        pixel_format=stream.get("pixel_format"),
                        width=stream.get("width"),
                        height=stream.get("height"),
                        frame_rate=stream.get("frame_rate"),
                        sample_rate=stream.get("sample_rate"),
                        channels=stream.get("channels"),
                        channel_layout=stream.get("channel_layout"),
                        start_time_seconds=stream.get("start_time_seconds"),
                    )
                    for stream in segment.get("streams", [])
                ),
                video_start_pts=segment.get("video_start_pts"),
                video_start_seconds=segment.get("video_start_seconds"),
                audio_start_pts=segment.get("audio_start_pts"),
                audio_start_seconds=segment.get("audio_start_seconds"),
                av_start_delta_seconds=segment.get("av_start_delta_seconds"),
                av_start_provenance=segment.get("av_start_provenance", "not available"),
            )
            for segment in data.get("observed_segments", [])
        ),
        configuration_changes=tuple(
            BitstreamConfigurationChange(
                from_index=change["from_index"],
                to_index=change["to_index"],
                changed_fields=tuple(change.get("changed_fields", [])),
            )
            for change in data.get("configuration_changes", [])
        ),
        provenance=data.get("provenance", "derived (ffprobe stream configuration)"),
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
        "segment_sequence": seg.segment_sequence,
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
        "delivery": delivery_to_dict(seg.delivery),
    }


def captured_from_dict(data: dict) -> CapturedSegment:
    br = data.get("byte_range")
    return CapturedSegment(
        rep_id=data["rep_id"],
        group_kind=data["group_kind"],
        uri=data["uri"],
        index=data["index"],
        is_init=data["is_init"],
        segment_sequence=data.get("segment_sequence"),
        declared_duration_seconds=data.get("declared_duration_seconds"),
        byte_range=(br["offset"], br["length"]) if br else None,
        byte_size=data.get("byte_size"),
        sha256=data.get("sha256"),
        http_status=data.get("http_status"),
        fetched_at=_parse_dt(data.get("fetched_at")),
        file=data.get("file"),
        error=data.get("error"),
        delivery=delivery_from_dict(data.get("delivery")),
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
                "segment_sequence": e.segment_sequence,
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
                segment_sequence=e.get("segment_sequence"),
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
