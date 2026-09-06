"""Adapter HTTP (FastAPI). Sem lógica de negócio: traduz HTTP <-> casos de uso."""

from __future__ import annotations

import asyncio
import contextlib

from fastapi import FastAPI, HTTPException
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
from stream_lens.bootstrap import Container
from stream_lens.domain.entities.inspection import InspectionStatus


def create_app(container: Container) -> FastAPI:
    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        # jobs em andamento pertencem ao processo anterior: marcar como failed
        container.repository.fail_active(
            "job_lost", "processo reiniciado; inspeção não concluída"
        )
        purge_task = _start_purge_task(container)
        try:
            yield
        finally:
            purge_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await purge_task

    app = FastAPI(
        title="Stream Lens",
        version="0.5.0",
        description=(
            "Inspeção top-down de streams HLS/DASH. Inspeções são assíncronas: "
            "crie com POST e acompanhe por polling em status_url. v0.5: "
            "snapshot schema 1.3: modelo unificado, captura limitada, containers e HDR."
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

    return app


def _start_purge_task(container: Container) -> asyncio.Task[None]:
    """Limpeza periódica de inspeções expiradas (TTL)."""

    async def purge_loop() -> None:
        while True:
            await asyncio.sleep(container.purge_interval_seconds)
            with contextlib.suppress(OSError):
                container.repository.purge_expired()

    return asyncio.ensure_future(purge_loop())
