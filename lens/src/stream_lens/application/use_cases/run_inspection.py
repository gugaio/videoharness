"""Caso de uso: executar o ciclo de vida de uma inspeção (usado pelo job e pela CLI).

Estágios persistidos: fetching_manifest -> parsing_manifest ->
resolving_segments -> capturing_segments -> building_snapshot ->
completed | partial | failed. Falha em qualquer estágio é persistida com
stage+mensagem (sem segredos). Falha de **segmento** não derruba a
inspeção: vira `partial` (Fase 4).
"""

from __future__ import annotations

from pathlib import Path

from stream_lens.application.capture_plan import CapturePlan
from stream_lens.application.capture_service import SegmentCaptureService
from stream_lens.application.ports.container_analyzer import ContainerAnalyzer
from stream_lens.application.ports.manifest_fetcher import ManifestFetcher
from stream_lens.application.ports.manifest_inspector import ManifestInspector
from stream_lens.application.ports.media_probe import MediaProbe
from stream_lens.application.ports.repositories import InspectionRepository
from stream_lens.application.use_cases.create_inspection import InspectionError
from stream_lens.domain.entities.inspection import Inspection, InspectionStatus
from stream_lens.domain.services.abr_alignment import measure_abr_alignment
from stream_lens.domain.services.bitstream_observability import (
    measure_bitstream_observability,
)
from stream_lens.domain.services.redaction import redact_url
from stream_lens.domain.services.segment_bitrate import measure_segment_bitrate
from stream_lens.domain.services.timeline_health import apply_timing_health
from stream_lens.domain.value_objects.containers import SegmentContainer
from stream_lens.domain.value_objects.manifest_summary import summary_from_unified
from stream_lens.domain.value_objects.media import (
    Capability,
    CapabilityStatus,
    UnifiedManifest,
)
from stream_lens.domain.value_objects.segments import (
    CaptureReport,
    DeliveryReport,
    SegmentCoverage,
)
from stream_lens.domain.value_objects.snapshot import (
    ANALYZER_VERSION,
    SCHEMA_VERSION,
    Snapshot,
    SourceInfo,
)


def build_snapshot(
    inspection: Inspection,
    url: str,
    media: UnifiedManifest,
    capture: CaptureReport | None = None,
    segments=(),
    timeline=(),
    containers=(),
    abr_alignment=(),
    bitrate_observations=(),
    delivery: DeliveryReport | None = None,
    bitstream_observations=(),
    warnings: list[str] | None = None,
) -> Snapshot:
    """Constrói o snapshot canônico a partir de uma inspeção concluída."""
    if inspection.manifest is None:
        raise ValueError("inspeção sem resumo de manifesto")
    return Snapshot(
        schema_version=SCHEMA_VERSION,
        analyzer_version=ANALYZER_VERSION,
        inspection_id=inspection.inspection_id,
        created_at=inspection.created_at,
        expires_at=inspection.expires_at,
        source=SourceInfo(
            display_url=redact_url(url),
            protocol=inspection.manifest.protocol.value,
            is_live=inspection.manifest.is_live,
        ),
        manifest=inspection.manifest,
        media=media,
        capture=capture,
        segments=tuple(segments),
        timeline=tuple(timeline),
        containers=tuple(containers),
        abr_alignment=tuple(abr_alignment),
        bitrate_observations=tuple(bitrate_observations),
        delivery=delivery,
        bitstream_observations=tuple(bitstream_observations),
        warnings=warnings if warnings is not None else list(inspection.warnings),
    )


def _replace_capabilities(media: UnifiedManifest, caps: dict) -> UnifiedManifest:
    import dataclasses

    return dataclasses.replace(media, capabilities=caps)


class RunInspection:
    """Executa uma inspeção do início ao fim, persistindo cada estágio."""

    def __init__(
        self,
        fetcher: ManifestFetcher,
        inspector: ManifestInspector,
        repository: InspectionRepository,
        capture_service: SegmentCaptureService | None = None,
        workspace: Path | None = None,
        container_analyzer: ContainerAnalyzer | None = None,
        media_probe: MediaProbe | None = None,
    ) -> None:
        self._fetcher = fetcher
        self._inspector = inspector
        self._repository = repository
        self._capture = capture_service
        self._workspace = workspace
        self._containers = container_analyzer
        self._probe = media_probe

    async def execute(self, inspection_id: str, url: str) -> Inspection:
        inspection = self._repository.get(inspection_id)
        if inspection is None:
            raise InspectionError("job", f"inspeção {inspection_id} não encontrada")

        inspection.start_stage(InspectionStatus.FETCHING_MANIFEST)
        self._repository.save(inspection)
        try:
            fetched = await self._fetcher.fetch(url)
        except InspectionError as exc:
            inspection.fail(exc.stage, exc.message)
            self._repository.save(inspection)
            return inspection
        except Exception as exc:
            inspection.fail("fetching_manifest", f"{type(exc).__name__}: {exc}")
            self._repository.save(inspection)
            return inspection

        inspection.start_stage(InspectionStatus.PARSING_MANIFEST)
        self._repository.save(inspection)
        media: UnifiedManifest | None = None
        try:
            media = self._inspector.inspect(fetched.text)
            summary = summary_from_unified(media)
        except InspectionError as exc:
            inspection.fail(exc.stage, exc.message)
            self._repository.save(inspection)
            return inspection
        except Exception as exc:
            inspection.fail("parsing_manifest", f"{type(exc).__name__}: {exc}")
            self._repository.save(inspection)
            return inspection

        plan = CapturePlan()
        captured = []
        timelines: list = []
        if self._capture is not None and self._workspace is not None:
            inspection.start_stage(InspectionStatus.RESOLVING_SEGMENTS)
            self._repository.save(inspection)
            try:
                plan = await self._capture.plan(media, fetched.url, root_fetched=fetched)
                self._capture.identify(plan, inspection_id)
            except Exception as exc:
                inspection.warnings.append(
                    f"resolução de segmentos falhou: {type(exc).__name__}: {exc}"[:200]
                )
                plan = CapturePlan()

            inspection.start_stage(InspectionStatus.CAPTURING_SEGMENTS)
            inspection.record_capture_progress(len(plan.planned), 0, 0)
            self._repository.save(inspection)

            def _progress(done: int, ok: int, failed: int) -> None:
                inspection.record_capture_progress(len(plan.planned), ok, failed)
                self._repository.save(inspection)

            try:
                captured = await self._capture.capture(
                    inspection_id,
                    plan,
                    self._workspace,
                    progress=_progress,
                    reserve_minimum=True,
                )
            except Exception as exc:  # captura inteira falhou: parcial, não fatal
                inspection.warnings.append(
                    f"captura de segmentos falhou: {type(exc).__name__}: {exc}"[:200]
                )
                captured = []
            await self._capture.observe_live_advancement(plan)
            timelines = self._capture.timeline(plan, captured)

        containers: list[SegmentContainer] = []
        if self._containers is not None and self._workspace is not None:
            inspection.start_stage(InspectionStatus.INSPECTING_CONTAINERS)
            self._repository.save(inspection)
            init_files = {
                (cap.rep_id, cap.group_kind): cap.file
                for cap in captured
                if cap.ok and cap.is_init and cap.file
            }
            init_cache: dict[tuple[str, str], bytes] = {}
            for cap in captured:
                if not cap.ok or not cap.file:
                    continue
                path = self._workspace / inspection_id / cap.file
                key = (cap.rep_id, cap.group_kind)
                init_file = init_files.get(key)
                probe: dict | None = None
                try:
                    data = path.read_bytes()
                    init_data = None
                    if not cap.is_init and init_file:
                        if key not in init_cache:
                            try:
                                init_cache[key] = (
                                    self._workspace / inspection_id / init_file
                                ).read_bytes()
                            except OSError:
                                init_cache[key] = b""
                        init_data = init_cache[key] or None
                    analysis = self._containers.analyze(data, cap.is_init, init_data)
                except Exception as exc:  # container individual não derruba nada
                    from stream_lens.domain.value_objects.containers import (
                        ContainerAnalysis as _CA,
                    )

                    analysis = _CA(kind="unknown", error=f"{type(exc).__name__}: {exc}"[:200])
                    data = b""
                if self._probe is not None:
                    try:
                        probe_init_path = None
                        if not cap.is_init and init_file and analysis.kind == "mp4":
                            probe_init_path = str(
                                self._workspace / inspection_id / init_file
                            )
                        probe = self._probe.probe_file(
                            str(path),
                            init_path=probe_init_path,
                            include_frames=not cap.is_init,
                        )
                    except Exception:
                        # A coleta derivada é opcional; não afeta a análise determinística.
                        probe = None
                containers.append(
                    SegmentContainer(
                        rep_id=cap.rep_id,
                        group_kind=cap.group_kind,
                        index=cap.index,
                        is_init=cap.is_init,
                        file=cap.file,
                        byte_size=cap.byte_size or len(data),
                        analysis=analysis,
                        probe=probe,
                    )
                )

        # a captura aconteceu: capabilities estáticas do parser ficam desatualizadas
        if self._capture is not None and media.capabilities:
            caps = dict(media.capabilities)
            if "segment_download" in caps:
                caps["segment_download"] = Capability(
                    CapabilityStatus.SUPPORTED, "janela limitada capturada nesta inspeção"
                )
            if "media_playlist_follow" in caps and any(
                p.group_kind != "unknown" for p in plan.planned
            ):
                caps["media_playlist_follow"] = Capability(CapabilityStatus.SUPPORTED)
            media = _replace_capabilities(media, caps)

        inspection.start_stage(InspectionStatus.BUILDING_SNAPSHOT)
        self._repository.save(inspection)

        failed = sum(1 for c in captured if not c.ok)
        partial = bool(plan.warnings) or failed > 0
        inspection.complete(summary, partial=partial)
        for warning in plan.warnings:
            if warning not in inspection.warnings:
                inspection.warnings.append(warning)
        inspection.record_capture_progress(
            len(plan.planned), sum(1 for c in captured if c.ok), failed
        )

        report = None
        capture_service = self._capture
        if capture_service is not None:
            limits = capture_service.limits
            report = CaptureReport(
                window_seconds=limits.window_seconds,
                max_total_bytes=capture_service.effective_budget_bytes(
                    plan, reserve_minimum=True
                ),
                max_segment_bytes=limits.max_segment_bytes,
                max_playlists_followed=limits.max_playlists_followed,
                planned=len(plan.planned),
                captured=sum(1 for c in captured if c.ok),
                failed=failed,
                total_bytes=sum(c.byte_size or 0 for c in captured if c.ok),
                coverage=tuple(
                    SegmentCoverage(
                        segment_ref=item.segment_ref or "",
                        rep_id=item.rep_id,
                        group_kind=item.group_kind,
                        index=item.index,
                        segment_sequence=item.segment_sequence,
                        start_seconds=item.timeline_start_seconds,
                        duration_seconds=item.declared_duration_seconds,
                        status=(
                            "captured"
                            if any(
                                cap.segment_ref == item.segment_ref and cap.ok
                                for cap in captured
                            )
                            else "failed"
                            if any(
                                cap.segment_ref == item.segment_ref and not cap.ok
                                for cap in captured
                            )
                            else "available"
                        ),
                        is_init=item.is_init,
                    )
                    for item in plan.coverage
                    if item.segment_ref
                ),
            )
        timed_containers = apply_timing_health(tuple(containers), tuple(captured))
        abr_alignment = measure_abr_alignment(
            tuple(timelines), timed_containers, protocol=media.protocol
        )
        bitrate_observations = measure_segment_bitrate(
            media, tuple(captured), timed_containers
        )
        segment_sequences = {
            (item.rep_id, item.group_kind, item.index): item.segment_sequence
            for item in captured
            if not item.is_init
        }
        bitstream_observations = measure_bitstream_observability(
            timed_containers, segment_sequences
        )
        delivery = DeliveryReport(
            manifest_requests=tuple(plan.manifest_requests),
            live_playlists=tuple(plan.live_playlists),
            live_note=(
                "not collected (no live HLS media playlist observed)"
                if media.is_live and not plan.live_playlists
                else None
            ),
        )
        snapshot = build_snapshot(
            inspection,
            url,
            media,
            capture=report,
            segments=captured,
            timeline=timelines,
            containers=timed_containers,
            abr_alignment=abr_alignment,
            bitrate_observations=bitrate_observations,
            delivery=delivery,
            bitstream_observations=bitstream_observations,
        )
        self._repository.save(inspection, snapshot)
        return inspection
