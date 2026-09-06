"""Repositório temporário de inspeções sobre filesystem local (ADR-0003).

Layout por inspeção (workspace configurável):

    <workspace>/<inspection_id>/
    ├── status.json     # estado do ciclo de vida (escrita atômica)
    └── snapshot.json   # snapshot canônico (escrita atômica)

Sem banco de dados; limpeza por TTL via purge_expired().
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from stream_lens.adapters.outbound.containers.serialization import (
    container_from_dict,
    container_to_dict,
)
from stream_lens.adapters.outbound.manifests.serialization import media_from_dict, media_to_dict
from stream_lens.adapters.outbound.segments.serialization import (
    capture_report_from_dict,
    capture_report_to_dict,
    captured_from_dict,
    captured_to_dict,
    timeline_from_dict,
    timeline_to_dict,
)
from stream_lens.domain.entities.inspection import ACTIVE_STATUSES, Inspection, InspectionStatus
from stream_lens.domain.value_objects.manifest_summary import ManifestSummary
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol
from stream_lens.domain.value_objects.snapshot import Snapshot, SourceInfo


class FilesystemInspectionRepository:
    """Persistência temporária com escrita atômica (tmp + rename)."""

    def __init__(self, root: Path, clock=None) -> None:
        self._root = root
        self._clock = clock or _SystemClock()

    def save(self, inspection: Inspection, snapshot: Snapshot | None = None) -> None:
        directory = self._root / inspection.inspection_id
        directory.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(directory / "status.json", _status_to_dict(inspection))
        if snapshot is not None:
            _atomic_write_json(directory / "snapshot.json", snapshot_to_dict(snapshot))

    def get(self, inspection_id: str) -> Inspection | None:
        path = self._root / inspection_id / "status.json"
        if not path.is_file():
            return None
        data = _read_json(path)
        inspection = _status_from_dict(data)
        if inspection.status is not InspectionStatus.EXPIRED and inspection.is_expired(
            self._clock.now()
        ):
            inspection.status = InspectionStatus.EXPIRED
        return inspection

    def get_snapshot(self, inspection_id: str) -> Snapshot | None:
        path = self._root / inspection_id / "snapshot.json"
        if not path.is_file():
            return None
        return _snapshot_from_dict(_read_json(path))

    def purge_expired(self, now: datetime | None = None) -> int:
        now = now or self._clock.now()
        removed = 0
        if not self._root.is_dir():
            return 0
        for entry in sorted(self._root.iterdir()):
            status_path = entry / "status.json"
            if not status_path.is_file():
                continue
            inspection = _status_from_dict(_read_json(status_path))
            if inspection.is_expired(now):
                _remove_tree(entry)
                removed += 1
        return removed

    def fail_active(self, stage: str, message: str) -> int:
        """Sweep de startup: jobs ativos órfãos (processo reiniciado) viram failed."""
        marked = 0
        if not self._root.is_dir():
            return 0
        for entry in sorted(self._root.iterdir()):
            status_path = entry / "status.json"
            if not status_path.is_file():
                continue
            inspection = _status_from_dict(_read_json(status_path))
            if inspection.status in ACTIVE_STATUSES:
                inspection.fail(stage, message)
                self.save(inspection)
                marked += 1
        return marked


class _SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


# -- serialização (aqui, não no domínio) -------------------------------------


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _parse_dt(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp_name)
        raise


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _status_to_dict(inspection: Inspection) -> dict:
    return {
        "inspection_id": inspection.inspection_id,
        "status": inspection.status.value,
        "created_at": _iso(inspection.created_at),
        "expires_at": _iso(inspection.expires_at),
        "protocol": inspection.protocol.value if inspection.protocol else None,
        "manifest": _manifest_to_dict(inspection.manifest) if inspection.manifest else None,
        "error_stage": inspection.error_stage,
        "error_message": inspection.error_message,
        "segments_planned": inspection.segments_planned,
        "segments_captured": inspection.segments_captured,
        "segments_failed": inspection.segments_failed,
    }


def _status_from_dict(data: dict) -> Inspection:
    manifest = _manifest_from_dict(data["manifest"]) if data.get("manifest") else None
    return Inspection(
        inspection_id=data["inspection_id"],
        status=InspectionStatus(data["status"]),
        created_at=_parse_dt(data["created_at"]),
        expires_at=_parse_dt(data["expires_at"]),
        protocol=Protocol(data["protocol"]) if data.get("protocol") else None,
        manifest=manifest,
        error_stage=data.get("error_stage"),
        error_message=data.get("error_message"),
        segments_planned=data.get("segments_planned"),
        segments_captured=data.get("segments_captured"),
        segments_failed=data.get("segments_failed"),
    )


def _manifest_to_dict(summary: ManifestSummary) -> dict:
    return {
        "protocol": summary.protocol.value,
        "kind": summary.kind.value,
        "is_live": summary.is_live,
        "variant_count": summary.variant_count,
        "segment_count": summary.segment_count,
        "rendition_count": summary.rendition_count,
    }


def _manifest_from_dict(data: dict) -> ManifestSummary:
    return ManifestSummary(
        protocol=Protocol(data["protocol"]),
        kind=ManifestKind(data["kind"]),
        is_live=data["is_live"],
        variant_count=data.get("variant_count"),
        segment_count=data.get("segment_count"),
        rendition_count=data.get("rendition_count"),
    )


def snapshot_to_dict(snapshot: Snapshot) -> dict:
    return {
        "schema_version": snapshot.schema_version,
        "analyzer_version": snapshot.analyzer_version,
        "inspection_id": snapshot.inspection_id,
        "created_at": _iso(snapshot.created_at),
        "expires_at": _iso(snapshot.expires_at),
        "source": {
            "display_url": snapshot.source.display_url,
            "protocol": snapshot.source.protocol,
            "is_live": snapshot.source.is_live,
        },
        "manifest": _manifest_to_dict(snapshot.manifest),
        "media": media_to_dict(snapshot.media) if snapshot.media is not None else None,
        "capture": (
            capture_report_to_dict(snapshot.capture) if snapshot.capture is not None else None
        ),
        "segments": [captured_to_dict(s) for s in snapshot.segments],
        "timeline": [timeline_to_dict(t) for t in snapshot.timeline],
        "containers": [container_to_dict(c) for c in snapshot.containers],
        "warnings": list(snapshot.warnings),
    }


def _snapshot_from_dict(data: dict) -> Snapshot:
    source = data["source"]
    return Snapshot(
        schema_version=data["schema_version"],
        analyzer_version=data["analyzer_version"],
        inspection_id=data["inspection_id"],
        created_at=_parse_dt(data["created_at"]),
        expires_at=_parse_dt(data["expires_at"]),
        source=SourceInfo(
            display_url=source["display_url"],
            protocol=source["protocol"],
            is_live=source["is_live"],
        ),
        manifest=_manifest_from_dict(data["manifest"]),
        media=media_from_dict(data["media"]) if data.get("media") is not None else None,
        capture=(
            capture_report_from_dict(data["capture"]) if data.get("capture") is not None else None
        ),
        segments=tuple(captured_from_dict(s) for s in data.get("segments", [])),
        timeline=tuple(timeline_from_dict(t) for t in data.get("timeline", [])),
        containers=tuple(container_from_dict(c) for c in data.get("containers", [])),
        warnings=list(data.get("warnings", [])),
    )


def _remove_tree(path: Path) -> None:
    import shutil

    shutil.rmtree(path, ignore_errors=True)
