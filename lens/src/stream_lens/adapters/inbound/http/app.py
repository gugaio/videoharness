"""Adapter HTTP (FastAPI). Sem lógica de negócio: traduz HTTP <-> casos de uso."""

from __future__ import annotations

import asyncio
import contextlib
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from fastapi.responses import JSONResponse

from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    snapshot_to_dict,
)
from stream_lens.application.dto.inspection import (
    CreateInspectionRequest,
    InspectionDetail,
    InspectionResponse,
    ManifestSummaryDTO,
)
from stream_lens.application.use_cases.create_inspection import InspectionError
from stream_lens.application.capture_plan import CaptureSelection
from stream_lens.application.supplemental_capture import CaptureConflict
from stream_lens.bootstrap import Container
from stream_lens.domain.entities.inspection import InspectionStatus


class CaptureCoverageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_url: str = Field(min_length=1, max_length=4096)


class SupplementalCaptureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_url: str = Field(min_length=1, max_length=4096)
    segment_refs: list[str] = Field(default_factory=list, max_length=16)
    representation_ids: list[str] = Field(default_factory=list, max_length=8)
    start_seconds: float | None = Field(default=None, ge=0, le=86_400)
    duration_seconds: float | None = Field(default=None, gt=0, le=60)
    max_bytes: int = Field(default=25_000_000, ge=1024, le=100_000_000)
    max_segments: int = Field(default=16, ge=1, le=16)

    @model_validator(mode="after")
    def validate_selection(self):
        has_refs = bool(self.segment_refs)
        has_window = self.start_seconds is not None or self.duration_seconds is not None
        if has_refs == has_window:
            raise ValueError("use segment_refs ou start_seconds + duration_seconds")
        if has_window and (self.start_seconds is None or self.duration_seconds is None):
            raise ValueError("a janela exige start_seconds e duration_seconds")
        if has_window and not self.representation_ids:
            raise ValueError("a janela exige ao menos uma representation_id")
        if len(set(self.segment_refs)) != len(self.segment_refs):
            raise ValueError("segment_refs duplicados")
        return self


def create_app(container: Container) -> FastAPI:
    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        # jobs em andamento pertencem ao processo anterior: marcar como failed
        container.repository.fail_active(
            "job_lost", "processo reiniciado; inspeção não concluída"
        )
        container.supplemental_captures.recover_orphans()
        purge_task = _start_purge_task(container)
        try:
            yield
        finally:
            purge_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await purge_task

    app = FastAPI(
        title="Stream Lens",
        version="1.6.0",
        description=(
            "Inspeção top-down de streams HLS/DASH. Inspeções são assíncronas: "
            "crie com POST e acompanhe por polling em status_url. v1.0: "
            "snapshot schema 1.14: cobertura estável de segmentos, DRM declarado no DASH, entrega HTTP/live, bitrate "
            "calculado por segmento, "
            "matriz ABR por sequência, configuração efetiva de bitstream/A-V, saúde "
            "temporal, frames derivados, samples/PES e HDR."
        ),
        lifespan=lifespan,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    async def ready() -> dict[str, str]:
        try:
            container.workspace.mkdir(parents=True, exist_ok=True)
            probe = container.workspace / ".ready-probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
        except OSError as exc:
            raise HTTPException(status_code=503, detail="workspace indisponível") from exc
        return {"status": "ready"}

    @app.post(
        "/api/v1/inspections",
        status_code=202,
        responses={400: {"description": "URL inválida ou não suportada"}},
    )
    async def create_inspection(
        request: CreateInspectionRequest,
    ) -> InspectionResponse:
        try:
            inspection = container.create_inspection.execute(request.url)
        except InspectionError as exc:
            raise HTTPException(status_code=400, detail=f"{exc.stage}: {exc.message}") from exc
        return InspectionResponse(
            inspection_id=inspection.inspection_id,
            status=inspection.status.value,
            status_url=f"/api/v1/inspections/{inspection.inspection_id}",
            view_url=f"/inspect/{inspection.inspection_id}",
            expires_at=inspection.expires_at,
        )

    @app.get("/api/v1/inspections/{inspection_id}")
    async def get_inspection(inspection_id: str) -> InspectionDetail:
        inspection = container.repository.get(inspection_id)
        if inspection is None:
            raise HTTPException(status_code=404, detail="inspeção não encontrada")
        if inspection.status is InspectionStatus.EXPIRED:
            raise HTTPException(status_code=410, detail="inspeção expirada")
        return InspectionDetail(
            inspection_id=inspection.inspection_id,
            status=inspection.status.value,
            created_at=inspection.created_at,
            expires_at=inspection.expires_at,
            protocol=inspection.protocol.value if inspection.protocol else None,
            manifest=ManifestSummaryDTO.from_domain(inspection.manifest)
            if inspection.manifest
            else None,
            error_stage=inspection.error_stage,
            error_message=inspection.error_message,
            segments_planned=inspection.segments_planned,
            segments_captured=inspection.segments_captured,
            segments_failed=inspection.segments_failed,
            snapshot_url=f"/api/v1/inspections/{inspection.inspection_id}/snapshot",
        )

    @app.get("/api/v1/inspections/{inspection_id}/snapshot")
    async def get_snapshot(inspection_id: str) -> JSONResponse:
        inspection = container.repository.get(inspection_id)
        if inspection is None:
            raise HTTPException(status_code=404, detail="inspeção não encontrada")
        if inspection.status is InspectionStatus.EXPIRED:
            raise HTTPException(status_code=410, detail="inspeção expirada")
        snapshot = container.repository.get_snapshot(inspection_id)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="snapshot ainda não disponível")
        return JSONResponse(content=snapshot_to_dict(snapshot))

    @app.post("/api/v1/inspections/{inspection_id}/coverage")
    async def get_capture_coverage(
        inspection_id: str, request: CaptureCoverageRequest
    ) -> dict:
        try:
            return await container.supplemental_captures.coverage_async(
                inspection_id, request.source_url
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="inspeção não encontrada") from exc
        except TimeoutError as exc:
            raise HTTPException(status_code=410, detail="inspeção expirada") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except InspectionError as exc:
            raise HTTPException(status_code=400, detail=f"{exc.stage}: {exc.message}") from exc

    @app.post("/api/v1/inspections/{inspection_id}/captures/{capture_id}", status_code=202)
    async def create_supplemental_capture(
        inspection_id: str, capture_id: UUID, request: SupplementalCaptureRequest
    ) -> dict:
        selection = CaptureSelection(
            segment_refs=tuple(request.segment_refs),
            representation_ids=tuple(request.representation_ids),
            start_seconds=request.start_seconds,
            duration_seconds=request.duration_seconds,
        )
        try:
            return await container.supplemental_captures.create(
                inspection_id,
                str(capture_id),
                request.source_url,
                selection,
                request.max_bytes,
                request.max_segments,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="inspeção não encontrada") from exc
        except TimeoutError as exc:
            raise HTTPException(status_code=410, detail="inspeção expirada") from exc
        except CaptureConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/v1/inspections/{inspection_id}/captures/{capture_id}")
    async def get_supplemental_capture(inspection_id: str, capture_id: UUID) -> dict:
        try:
            record = container.supplemental_captures.get(inspection_id, str(capture_id))
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="inspeção não encontrada") from exc
        except TimeoutError as exc:
            raise HTTPException(status_code=410, detail="inspeção expirada") from exc
        if record is None:
            raise HTTPException(status_code=404, detail="captura não encontrada")
        return {key: value for key, value in record.items() if key != "evidence"}

    @app.get("/api/v1/inspections/{inspection_id}/captures/{capture_id}/evidence")
    async def get_supplemental_capture_evidence(
        inspection_id: str, capture_id: UUID
    ) -> dict:
        try:
            record = container.supplemental_captures.get(inspection_id, str(capture_id))
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="inspeção não encontrada") from exc
        except TimeoutError as exc:
            raise HTTPException(status_code=410, detail="inspeção expirada") from exc
        if record is None:
            raise HTTPException(status_code=404, detail="captura não encontrada")
        if record.get("status") not in {"completed", "partial"}:
            raise HTTPException(status_code=409, detail="evidência ainda não disponível")
        return record.get("evidence", {})

    return app


def _start_purge_task(container: Container) -> asyncio.Task[None]:
    """Limpeza periódica de inspeções expiradas (TTL)."""

    async def purge_loop() -> None:
        while True:
            await asyncio.sleep(container.purge_interval_seconds)
            with contextlib.suppress(OSError):
                container.repository.purge_expired()

    return asyncio.ensure_future(purge_loop())
