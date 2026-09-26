"""Persistência filesystem dos bytes de segmentos capturados."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from stream_lens.application.ports.segment_fetcher import FetchedBytes
from stream_lens.domain.value_objects.segments import CapturedSegment, PlannedSegment


class FilesystemSegmentStore:
    def store(
        self,
        inspection_id: str,
        position: int,
        planned: PlannedSegment,
        fetched: FetchedBytes,
        workspace: Path,
        fetched_at,
    ) -> CapturedSegment:
        segments_dir = workspace / inspection_id / "segments"
        segments_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(fetched.data).hexdigest()
        name = f"{position:04d}_{_safe_name(planned.uri, planned.is_init)}"
        target = segments_dir / name
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(fetched.data)
        tmp.replace(target)
        return CapturedSegment(
            rep_id=planned.rep_id,
            group_kind=planned.group_kind,
            uri=planned.uri,
            index=planned.index,
            is_init=planned.is_init,
            segment_sequence=planned.segment_sequence,
            declared_duration_seconds=planned.declared_duration_seconds,
            byte_range=planned.byte_range,
            byte_size=len(fetched.data),
            sha256=digest,
            http_status=fetched.status,
            fetched_at=fetched_at,
            file=f"segments/{name}",
            delivery=fetched.delivery,
            segment_ref=planned.segment_ref,
            bytes_received=len(fetched.data),
        )


def _safe_name(uri: str, is_init: bool) -> str:
    tail = uri.rstrip("/").split("?")[0].rsplit("/", 1)[-1] or (
        "init" if is_init else "segment"
    )
    return re.sub(r"[^A-Za-z0-9._-]", "_", tail)[:120]
