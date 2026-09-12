"""Serialização dos containers inspecionados (bloco `containers`, schema 1.6)."""

from __future__ import annotations

from stream_lens.domain.value_objects.containers import (
    BoxNode,
    ContainerAnalysis,
    ContainerSample,
    ContainerTiming,
    Fmp4Info,
    HdrInfo,
    SegmentContainer,
    TimingTrack,
    TsInfo,
    TsPidStats,
)

_MAX_TREE_CHILDREN = 64  # proteção contra árvores gigantes


def _box_to_dict(node: BoxNode) -> dict:
    return {
        "type": node.type,
        "offset": node.offset,
        "size": node.size,
        "fields": node.fields,
        "children": [_box_to_dict(c) for c in node.children[:_MAX_TREE_CHILDREN]],
    }


def _box_from_dict(data: dict) -> BoxNode:
    return BoxNode(
        type=data["type"],
        offset=data["offset"],
        size=data["size"],
        fields=data.get("fields", {}),
        children=tuple(_box_from_dict(c) for c in data.get("children", [])),
    )


def _sample_to_dict(sample: ContainerSample) -> dict:
    return {
        "index": sample.index,
        "unit_type": sample.unit_type,
        "byte_size": sample.byte_size,
        "track_id": sample.track_id,
        "pid": sample.pid,
        "duration": sample.duration,
        "dts": sample.dts,
        "pts": sample.pts,
        "composition_offset": sample.composition_offset,
        "timescale": sample.timescale,
        "is_sync": sample.is_sync,
    }


def _sample_from_dict(data: dict) -> ContainerSample:
    return ContainerSample(
        index=data["index"],
        unit_type=data["unit_type"],
        byte_size=data.get("byte_size"),
        track_id=data.get("track_id"),
        pid=data.get("pid"),
        duration=data.get("duration"),
        dts=data.get("dts"),
        pts=data.get("pts"),
        composition_offset=data.get("composition_offset"),
        timescale=data.get("timescale"),
        is_sync=data.get("is_sync"),
    )


def _timing_to_dict(timing: ContainerTiming) -> dict:
    return {
        "declared_duration_seconds": timing.declared_duration_seconds,
        "tracks": [
            {
                "track_id": track.track_id,
                "pid": track.pid,
                "timescale": track.timescale,
                "start_dts": track.start_dts,
                "end_dts": track.end_dts,
                "start_pts": track.start_pts,
                "end_pts": track.end_pts,
                "observed_duration_seconds": track.observed_duration_seconds,
                "boundary_delta_seconds": track.boundary_delta_seconds,
                "boundary_basis": track.boundary_basis,
            }
            for track in timing.tracks
        ],
        "provenance": timing.provenance,
    }


def _timing_from_dict(data: dict) -> ContainerTiming:
    return ContainerTiming(
        declared_duration_seconds=data.get("declared_duration_seconds"),
        tracks=tuple(
            TimingTrack(
                track_id=track.get("track_id"),
                pid=track.get("pid"),
                timescale=track.get("timescale"),
                start_dts=track.get("start_dts"),
                end_dts=track.get("end_dts"),
                start_pts=track.get("start_pts"),
                end_pts=track.get("end_pts"),
                observed_duration_seconds=track.get("observed_duration_seconds"),
                boundary_delta_seconds=track.get("boundary_delta_seconds"),
                boundary_basis=track.get("boundary_basis"),
            )
            for track in data.get("tracks", [])
        ),
        provenance=data.get("provenance", "deterministic (container timestamps)"),
    )


def _fmp4_to_dict(info: Fmp4Info) -> dict:
    return {
        "is_init": info.is_init,
        "brands": list(info.brands),
        "boxes": [_box_to_dict(b) for b in info.boxes],
        "track_ids": list(info.track_ids),
        "timescales": info.timescales,
        "sequence_number": info.sequence_number,
        "base_media_decode_time": info.base_media_decode_time,
        "sample_counts": info.sample_counts,
        "hdr": _hdr_to_dict(info.hdr) if info.hdr else None,
        "truncated": info.truncated,
        "provenance": info.provenance,
    }


def _fmp4_from_dict(data: dict) -> Fmp4Info:
    return Fmp4Info(
        is_init=data.get("is_init", False),
        brands=tuple(data.get("brands", [])),
        boxes=tuple(_box_from_dict(b) for b in data.get("boxes", [])),
        track_ids=tuple(data.get("track_ids", [])),
        timescales=data.get("timescales", {}),
        sequence_number=data.get("sequence_number"),
        base_media_decode_time=data.get("base_media_decode_time"),
        sample_counts=data.get("sample_counts", {}),
        hdr=_hdr_from_dict(data["hdr"]) if data.get("hdr") else None,
        truncated=data.get("truncated", False),
        provenance=data.get("provenance", "deterministic"),
    )


def _hdr_to_dict(info: HdrInfo) -> dict:
    return {
        "color_primaries": info.color_primaries,
        "transfer_characteristics": info.transfer_characteristics,
        "matrix_coefficients": info.matrix_coefficients,
        "full_range": info.full_range,
        "static_metadata": info.static_metadata,
        "dynamic_metadata": list(info.dynamic_metadata),
        "provenance": info.provenance,
    }


def _hdr_from_dict(data: dict) -> HdrInfo:
    return HdrInfo(
        color_primaries=data.get("color_primaries"),
        transfer_characteristics=data.get("transfer_characteristics"),
        matrix_coefficients=data.get("matrix_coefficients"),
        full_range=data.get("full_range"),
        static_metadata=data.get("static_metadata", {}),
        dynamic_metadata=tuple(data.get("dynamic_metadata", [])),
        provenance=data.get("provenance", "deterministic (ISOBMFF/HEVC bytes)"),
    )


def _ts_to_dict(info: TsInfo) -> dict:
    return {
        "packet_count": info.packet_count,
        "sync_errors": info.sync_errors,
        "pids": [
            {
                "pid": p.pid,
                "stream_type": p.stream_type,
                "stream_kind": p.stream_kind,
                "packet_count": p.packet_count,
                "continuity_errors": p.continuity_errors,
                "pes_count": p.pes_count,
                "first_pts": p.first_pts,
                "last_pts": p.last_pts,
                "first_dts": p.first_dts,
                "pcr_count": p.pcr_count,
                "last_pcr": p.last_pcr,
            }
            for p in info.pids
        ],
        "programs": info.programs,
        "provenance": info.provenance,
    }


def _ts_from_dict(data: dict) -> TsInfo:
    return TsInfo(
        packet_count=data.get("packet_count", 0),
        sync_errors=data.get("sync_errors", 0),
        pids=tuple(
            TsPidStats(
                pid=p["pid"],
                stream_type=p.get("stream_type"),
                stream_kind=p.get("stream_kind"),
                packet_count=p.get("packet_count", 0),
                continuity_errors=p.get("continuity_errors", 0),
                pes_count=p.get("pes_count", 0),
                first_pts=p.get("first_pts"),
                last_pts=p.get("last_pts"),
                first_dts=p.get("first_dts"),
                pcr_count=p.get("pcr_count", 0),
                last_pcr=p.get("last_pcr"),
            )
            for p in data.get("pids", [])
        ),
        programs=data.get("programs", {}),
        provenance=data.get("provenance", "deterministic"),
    )


def analysis_to_dict(analysis: ContainerAnalysis) -> dict:
    return {
        "kind": analysis.kind,
        "fmp4": _fmp4_to_dict(analysis.fmp4) if analysis.fmp4 else None,
        "ts": _ts_to_dict(analysis.ts) if analysis.ts else None,
        "samples": [_sample_to_dict(sample) for sample in analysis.samples],
        "samples_truncated": analysis.samples_truncated,
        "timing": _timing_to_dict(analysis.timing) if analysis.timing else None,
        "error": analysis.error,
    }


def analysis_from_dict(data: dict) -> ContainerAnalysis:
    return ContainerAnalysis(
        kind=data["kind"],
        fmp4=_fmp4_from_dict(data["fmp4"]) if data.get("fmp4") else None,
        ts=_ts_from_dict(data["ts"]) if data.get("ts") else None,
        samples=tuple(_sample_from_dict(sample) for sample in data.get("samples", [])),
        samples_truncated=data.get("samples_truncated", False),
        timing=_timing_from_dict(data["timing"]) if data.get("timing") else None,
        error=data.get("error"),
    )


def container_to_dict(seg: SegmentContainer) -> dict:
    return {
        "rep_id": seg.rep_id,
        "group_kind": seg.group_kind,
        "index": seg.index,
        "is_init": seg.is_init,
        "file": seg.file,
        "byte_size": seg.byte_size,
        "analysis": analysis_to_dict(seg.analysis),
        "probe": seg.probe,
    }


def container_from_dict(data: dict) -> SegmentContainer:
    return SegmentContainer(
        rep_id=data["rep_id"],
        group_kind=data["group_kind"],
        index=data["index"],
        is_init=data["is_init"],
        file=data["file"],
        byte_size=data.get("byte_size", 0),
        analysis=analysis_from_dict(data["analysis"]),
        probe=data.get("probe"),
    )
