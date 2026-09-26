"""Coleta adicional seletiva, separada e atribuída à inspeção de baseline."""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from pathlib import Path

from stream_lens.adapters.outbound.filesystem.container_serialization import (
    container_to_dict,
)
from stream_lens.adapters.outbound.segments.serialization import (
    captured_to_dict,
    timeline_to_dict,
)
from stream_lens.application.capture_plan import CaptureSelection
from stream_lens.application.capture_service import SegmentCaptureService
from stream_lens.application.ports.manifest_fetcher import ManifestFetcher
from stream_lens.application.ports.manifest_inspector import ManifestInspector
from stream_lens.application.ports.repositories import InspectionRepository
from stream_lens.application.ports.supplemental_captures import (
    SupplementalCaptureRepository,
)
from stream_lens.application.use_cases.create_inspection import InspectionError
from stream_lens.domain.entities.inspection import InspectionStatus
from stream_lens.domain.services.url_validation import InvalidManifestUrl, validate_manifest_url
from stream_lens.domain.services.redaction import redact_url


class CaptureConflict(Exception):
    pass


class SupplementalCaptureService:
    def __init__(
        self,
        inspections: InspectionRepository,
        captures: SupplementalCaptureRepository,
        fetcher: ManifestFetcher,
        inspector: ManifestInspector,
        capture_service: SegmentCaptureService,
        workspace: Path,
        container_analyzer,
        *,
        max_concurrency: int = 2,
        max_segments: int = 16,
    ) -> None:
        self._inspections = inspections
        self._captures = captures
        self._fetcher = fetcher
        self._inspector = inspector
        self._capture = capture_service
        self._workspace = workspace
        self._containers = container_analyzer
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._max_segments = max_segments
        self._tasks: set[asyncio.Task] = set()

    async def coverage_async(self, inspection_id: str, source_url: str) -> dict:
        self._require_source(inspection_id, source_url)
        return await self._coverage(inspection_id, source_url)

    async def _coverage(self, inspection_id: str, source_url: str) -> dict:
        try:
            fetched = await self._fetcher.fetch(source_url)
            media = self._inspector.inspect(fetched.text)
            plan = await self._capture.plan(media, fetched.url, root_fetched=fetched)
            self._capture.identify(plan, inspection_id)
        except InspectionError:
            raise
        except Exception as exc:
            raise InspectionError("coverage", f"não foi possível resolver cobertura: {type(exc).__name__}") from exc
        limit = 2_000
        items = plan.coverage
        return {
            "inspection_id": inspection_id,
            "observed_at": datetime.now(UTC).isoformat(),
            "protocol": media.protocol.value,
            "is_live": media.is_live,
            "coverage": [
                {
                    "segment_ref": item.segment_ref,
                    "rep_id": item.rep_id,
                    "group_kind": item.group_kind,
                    "index": item.index,
                    "segment_sequence": item.segment_sequence,
                    "start_seconds": item.timeline_start_seconds,
                    "duration_seconds": item.declared_duration_seconds,
                    "is_init": item.is_init,
                    "status": "available",
                }
                for item in items[:limit]
            ],
            "total": len(items),
            "truncated": len(items) > limit,
            "warnings": plan.warnings,
        }

    async def create(
        self,
        inspection_id: str,
        capture_id: str,
        source_url: str,
        selection: CaptureSelection,
        max_bytes: int,
        max_segments: int = 16,
    ) -> dict:
        self._require_source(inspection_id, source_url)
        if not 1_024 <= max_bytes <= self._capture.limits.max_total_bytes:
            raise ValueError("max_bytes fora dos limites da engine")
        if not 1 <= max_segments <= self._max_segments:
            raise ValueError("max_segments fora dos limites da engine")
        fingerprint = _fingerprint(source_url, selection, max_bytes, max_segments)
        existing = self._captures.get(inspection_id, capture_id)
        if existing is not None:
            if existing.get("request_fingerprint") != fingerprint:
                raise CaptureConflict("capture_id já usado com outro pedido")
            return existing

        record = {
            "inspection_id": inspection_id,
            "capture_id": capture_id,
            "status": "queued",
            "created_at": datetime.now(UTC).isoformat(),
            "requested_bytes": max_bytes,
            "bytes_received": 0,
            "consumption_known": False,
            "request_fingerprint": fingerprint,
            "selection": _selection_dict(selection),
            "error": None,
        }
        self._captures.save(inspection_id, capture_id, record)
        task = asyncio.create_task(
            self._run(inspection_id, capture_id, source_url, selection, max_bytes, max_segments)
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return record

    def get(self, inspection_id: str, capture_id: str) -> dict | None:
        self._require_completed(inspection_id)
        return self._captures.get(inspection_id, capture_id)

    def recover_orphans(self) -> int:
        return self._captures.fail_active("job_lost: processo reiniciado")

    def _require_completed(self, inspection_id: str):
        inspection = self._inspections.get(inspection_id)
        if inspection is None:
            raise LookupError("inspeção não encontrada")
        if inspection.is_expired(datetime.now(UTC)):
            raise TimeoutError("inspeção expirada")
        if inspection.status not in {InspectionStatus.COMPLETED, InspectionStatus.PARTIAL}:
            raise ValueError("inspeção ainda não terminou")
        return inspection

    def _require_source(self, inspection_id: str, source_url: str) -> None:
        self._require_completed(inspection_id)
        _validate_url(source_url)
        snapshot = self._inspections.get_snapshot(inspection_id)
        if snapshot is None or redact_url(source_url) != snapshot.source.display_url:
            raise ValueError("source_url não corresponde à origem da inspeção base")

    async def _run(
        self,
        inspection_id: str,
        capture_id: str,
        source_url: str,
        selection: CaptureSelection,
        max_bytes: int,
        max_segments: int,
    ) -> None:
        async with self._semaphore:
            record = self._captures.get(inspection_id, capture_id)
            if record is None:
                return
            record["status"] = "running"
            record["started_at"] = datetime.now(UTC).isoformat()
            self._captures.save(inspection_id, capture_id, record)
            store_id = f"{inspection_id}/captures/{capture_id}"
            capture_started = False
            received = 0
            try:
                fetched = await self._fetcher.fetch(source_url)
                media = self._inspector.inspect(fetched.text)
                plan = await self._capture.plan(media, fetched.url, root_fetched=fetched)
                self._capture.identify(plan, inspection_id)
                self._capture.select(plan, selection)
                media_segments = [item for item in plan.planned if not item.is_init]
                if len(media_segments) > max_segments:
                    plan.warnings.append(
                        f"seleção limitada a {max_segments} segmentos (limite por pedido)"
                    )
                    keep = {item.segment_ref for item in media_segments[:max_segments]}
                    kept_representations = {
                        item.rep_id for item in media_segments[:max_segments]
                    }
                    plan.planned = [
                        item for item in plan.planned
                        if (item.is_init and item.rep_id in kept_representations)
                        or item.segment_ref in keep
                    ]
                capture_started = True
                captured = await self._capture.capture(
                    store_id,
                    plan,
                    self._workspace,
                    max_total_bytes=max_bytes,
                )
                received = sum(item.bytes_received for item in captured)
                record["bytes_received"] = received
                record["consumption_known"] = True
                containers = self._analyze(store_id, captured)
                failed = sum(not item.ok for item in captured)
                record.update(
                    {
                        "status": "partial" if plan.warnings or failed else "completed",
                        "finished_at": datetime.now(UTC).isoformat(),
                        "bytes_received": received,
                        "consumption_known": True,
                        "segments_planned": len(plan.planned),
                        "segments_captured": sum(item.ok for item in captured),
                        "segments_failed": failed,
                        "warnings": plan.warnings,
                        "evidence": {
                            "captured_at": datetime.now(UTC).isoformat(),
                            "source": {
                                "display_url": redact_url(source_url),
                                "protocol": media.protocol.value,
                                "is_live": media.is_live,
                            },
                            "segments": [captured_to_dict(item) for item in captured],
                            "timeline": [
                                timeline_to_dict(item)
                                for item in self._capture.timeline(plan, captured)
                            ],
                            "containers": [container_to_dict(item) for item in containers],
                        },
                    }
                )
            except Exception as exc:
                record.update(
                    {
                        "status": "failed",
                        "finished_at": datetime.now(UTC).isoformat(),
                        "bytes_received": received,
                        "consumption_known": bool(record.get("consumption_known", not capture_started)),
                        "error": f"capture_failed: {type(exc).__name__}",
                    }
                )
            self._captures.save(inspection_id, capture_id, record)

    def _analyze(self, store_id: str, captured: list):
        result = []
        init_files = {
            item.rep_id: item.file
            for item in captured
            if item.ok and item.is_init and item.file
        }
        for item in captured:
            if not item.ok or not item.file:
                continue
            path = self._workspace / store_id / item.file
            init_path = init_files.get(item.rep_id)
            init_data = None
            if init_path and not item.is_init:
                try:
                    init_data = (self._workspace / store_id / init_path).read_bytes()
                except OSError:
                    pass
            analysis = self._containers.analyze(path.read_bytes(), item.is_init, init_data)
            from stream_lens.domain.value_objects.containers import SegmentContainer

            result.append(
                SegmentContainer(
                    rep_id=item.rep_id,
                    group_kind=item.group_kind,
                    index=item.index,
                    is_init=item.is_init,
                    file=item.file,
                    byte_size=item.byte_size or 0,
                    analysis=analysis,
                )
            )
        return result


def _validate_url(value: str) -> None:
    try:
        validate_manifest_url(value)
    except InvalidManifestUrl as exc:
        raise ValueError(str(exc)) from exc


def _selection_dict(selection: CaptureSelection) -> dict:
    return {
        "segment_refs": list(selection.segment_refs),
        "representation_ids": list(selection.representation_ids),
        "start_seconds": selection.start_seconds,
        "duration_seconds": selection.duration_seconds,
    }


def _fingerprint(url: str, selection: CaptureSelection, max_bytes: int, max_segments: int) -> str:
    material = "\0".join(
        (
            hashlib.sha256(url.encode("utf-8")).hexdigest(),
            repr(_selection_dict(selection)),
            str(max_bytes),
            str(max_segments),
        )
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
