"""Composition root: único lugar onde adapters são instanciados e injetados.

Não há framework de DI (ADR-0001); a composição é explícita e simples.
Configuração por variáveis de ambiente:
  STREAM_LENS_WORKSPACE      — diretório de inspeções (default .runtime/inspections)
  STREAM_LENS_FIXTURES       — diretório raiz das fixtures (default fixtures/)
  STREAM_LENS_TTL_SECONDS    — TTL das inspeções (default 3600)
  STREAM_LENS_ALLOW_LOOPBACK — "1" permite loopback no fetcher (só para dev/testes)
  STREAM_LENS_MAX_CONCURRENCY — jobs simultâneos (default 4)
  STREAM_LENS_PURGE_INTERVAL_SECONDS — intervalo da limpeza por TTL (default 60)
  STREAM_LENS_WINDOW_SECONDS     — janela de captura (default 10; teto 60)
  STREAM_LENS_MAX_TOTAL_BYTES    — orçamento total de captura (default 500000000)
  STREAM_LENS_MAX_SEGMENT_BYTES  — cap por segmento, default 20000000
  STREAM_LENS_MAX_PLAYLISTS      — rendições HLS seguidas a partir do master (default 8)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from stream_lens.adapters.outbound.containers.container_analyzer import (
    SniffingContainerAnalyzer,
)
from stream_lens.adapters.outbound.containers.ffprobe_probe import FFprobeMediaProbe
from stream_lens.adapters.outbound.fetching.dispatching_fetcher import (
    DispatchingManifestFetcher,
)
from stream_lens.adapters.outbound.fetching.dispatching_segment_fetcher import (
    DispatchingSegmentFetcher,
    LocalFixtureSegmentFetcher,
)
from stream_lens.adapters.outbound.fetching.local_fixture_fetcher import (
    LocalFixtureFetcher,
)
from stream_lens.adapters.outbound.fetching.safe_http_fetcher import (
    NetworkPolicy,
    SafeHttpFetcher,
)
from stream_lens.adapters.outbound.fetching.safe_http_segment_fetcher import (
    SafeHttpSegmentFetcher,
)
from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    FilesystemInspectionRepository,
)
from stream_lens.adapters.outbound.jobs.in_process_job_queue import InProcessJobQueue
from stream_lens.adapters.outbound.manifests.manifest_inspector import (
    DeclarativeManifestInspector,
)
from stream_lens.adapters.outbound.providers import SystemClock, UuidIdGenerator
from stream_lens.adapters.outbound.segments.capture_service import SegmentCaptureService
from stream_lens.application.ports.manifest_fetcher import ManifestFetcher
from stream_lens.application.ports.manifest_inspector import ManifestInspector
from stream_lens.application.ports.providers import Clock, IdGenerator
from stream_lens.application.ports.repositories import InspectionRepository
from stream_lens.application.use_cases.create_inspection import CreateInspection
from stream_lens.application.use_cases.run_inspection import RunInspection
from stream_lens.domain.value_objects.segments import MAX_WINDOW_SECONDS, CaptureLimits


def _optional_ffprobe() -> FFprobeMediaProbe | None:
    probe = FFprobeMediaProbe()
    return probe if probe.available else None


_REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True, slots=True)
class Container:
    create_inspection: CreateInspection
    run_inspection: RunInspection
    repository: InspectionRepository
    workspace: Path
    purge_interval_seconds: int


def build_container(
    workspace: Path | None = None,
    fixtures_root: Path | None = None,
    ttl_seconds: int | None = None,
    clock: Clock | None = None,
    ids: IdGenerator | None = None,
    allow_loopback: bool | None = None,
    max_concurrency: int | None = None,
    purge_interval_seconds: int | None = None,
) -> Container:
    def env_flag(name: str) -> bool | None:
        value = os.environ.get(name)
        if value is None:
            return None
        return value.strip().lower() in ("1", "true", "yes")

    workspace = workspace or Path(
        os.environ.get("STREAM_LENS_WORKSPACE", _REPO_ROOT / ".runtime" / "inspections")
    )
    fixtures_root = fixtures_root or Path(
        os.environ.get("STREAM_LENS_FIXTURES", _REPO_ROOT / "fixtures")
    )
    ttl = ttl_seconds if ttl_seconds is not None else int(
        os.environ.get("STREAM_LENS_TTL_SECONDS", "3600")
    )
    if allow_loopback is None:
        allow_loopback = bool(env_flag("STREAM_LENS_ALLOW_LOOPBACK"))
    concurrency = max_concurrency or int(
        os.environ.get("STREAM_LENS_MAX_CONCURRENCY", "4")
    )
    purge_interval = purge_interval_seconds or int(
        os.environ.get("STREAM_LENS_PURGE_INTERVAL_SECONDS", "60")
    )
    clock = clock or SystemClock()
    ids = ids or UuidIdGenerator()

    fixture_fetcher = LocalFixtureFetcher(fixtures_root)
    http_fetcher = SafeHttpFetcher(policy=NetworkPolicy(allow_loopback=allow_loopback))
    fetcher: ManifestFetcher = DispatchingManifestFetcher(fixture_fetcher, http_fetcher)
    inspector: ManifestInspector = DeclarativeManifestInspector()
    repository = FilesystemInspectionRepository(workspace, clock=clock)

    window = min(
        float(os.environ.get("STREAM_LENS_WINDOW_SECONDS", "10")),
        MAX_WINDOW_SECONDS,
    )
    limits = CaptureLimits(
        window_seconds=window,
        max_total_bytes=int(os.environ.get("STREAM_LENS_MAX_TOTAL_BYTES", "500000000")),
        max_segment_bytes=int(os.environ.get("STREAM_LENS_MAX_SEGMENT_BYTES", "20000000")),
        max_playlists_followed=int(os.environ.get("STREAM_LENS_MAX_PLAYLISTS", "8")),
    )
    segment_fetcher = DispatchingSegmentFetcher(
        fixture_fetcher=LocalFixtureSegmentFetcher(
            fixtures_root, max_segment_bytes=limits.max_segment_bytes
        ),
        http_fetcher=SafeHttpSegmentFetcher(
            policy=NetworkPolicy(allow_loopback=allow_loopback),
            max_segment_bytes=limits.max_segment_bytes,
        ),
    )
    capture_service = SegmentCaptureService(
        manifest_fetcher=fetcher,
        segment_fetcher=segment_fetcher,
        clock=clock,
        limits=limits,
    )
    runner = RunInspection(
        fetcher=fetcher,
        inspector=inspector,
        repository=repository,
        capture_service=capture_service,
        workspace=workspace,
        container_analyzer=SniffingContainerAnalyzer(),
        media_probe=_optional_ffprobe(),
    )
    queue = InProcessJobQueue(runner, max_concurrency=concurrency)
    create = CreateInspection(
        repository=repository,
        jobs=queue,
        ids=ids,
        clock=clock,
        ttl_seconds=ttl,
    )

    return Container(
        create_inspection=create,
        run_inspection=runner,
        repository=repository,
        workspace=workspace,
        purge_interval_seconds=purge_interval,
    )
