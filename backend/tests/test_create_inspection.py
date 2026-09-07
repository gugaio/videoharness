"""Testes dos casos de uso CreateInspection (criar+enfileirar) e RunInspection (executar)."""

from datetime import timedelta

from stream_lens.adapters.outbound.fetching.local_fixture_fetcher import (
    LocalFixtureFetcher,
)
from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    FilesystemInspectionRepository,
)
from stream_lens.adapters.outbound.manifests.manifest_inspector import (
    DeclarativeManifestInspector,
)
from stream_lens.adapters.outbound.providers import UuidIdGenerator
from stream_lens.application.use_cases.create_inspection import (
    CreateInspection,
    InspectionError,
)
from stream_lens.application.use_cases.run_inspection import RunInspection
from stream_lens.domain.entities.inspection import Inspection, InspectionStatus
from stream_lens.domain.value_objects.manifest_summary import ManifestSummary
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol
from tests.conftest import FrozenClock, SequentialIdGenerator


class RecordingQueue:
    """JobQueue fake que registra submissões sem executar."""

    def __init__(self) -> None:
        self.submitted: list[tuple[str, str]] = []

    def submit(self, inspection_id: str, url: str) -> None:
        self.submitted.append((inspection_id, url))


def _create(tmp_path, frozen_clock, ids=None, queue=None):
    repository = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
    create = CreateInspection(
        repository=repository,
        jobs=queue or RecordingQueue(),
        ids=ids or SequentialIdGenerator(),
        clock=frozen_clock,
        ttl_seconds=600,
    )
    return create, repository


class TestCreateInspection:
    def test_cria_em_queued_e_submete_job(self, tmp_path, frozen_clock):
        queue = RecordingQueue()
        create, repo = _create(tmp_path, frozen_clock, queue=queue)
        inspection = create.execute("fixture://hls-ts/master.m3u8")

        assert inspection.status is InspectionStatus.QUEUED
        assert queue.submitted == [(inspection.inspection_id, "fixture://hls-ts/master.m3u8")]
        assert repo.get(inspection.inspection_id) is not None

    def test_url_invalida_nao_cria_nada(self, tmp_path, frozen_clock):
        queue = RecordingQueue()
        create, repo = _create(tmp_path, frozen_clock, queue=queue)
        try:
            create.execute("ftp://bad/x")
            raise AssertionError("deveria ter falhado")
        except InspectionError:
            pass
        assert queue.submitted == []
        assert repo.get("00000000-0000-0000-0000-000000000001") is None

    def test_ids_distintos_para_mesma_url(self, tmp_path, frozen_clock):
        create, _repo = _create(tmp_path, frozen_clock, ids=UuidIdGenerator())
        first = create.execute("fixture://hls-ts/master.m3u8")
        second = create.execute("fixture://hls-ts/master.m3u8")
        assert first.inspection_id != second.inspection_id


class TestRunInspection:
    def _build_runner(self, tmp_path, fixtures_root, frozen_clock):
        repository = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
        runner = RunInspection(
            fetcher=LocalFixtureFetcher(fixtures_root),
            inspector=DeclarativeManifestInspector(),
            repository=repository,
        )
        create, _ = _create(tmp_path, frozen_clock)
        return create, runner, repository

    async def test_ciclo_completo_hls(self, tmp_path, fixtures_root, frozen_clock):
        create, runner, repo = self._build_runner(tmp_path, fixtures_root, frozen_clock)
        inspection = create.execute("fixture://hls-ts/master.m3u8")
        result = await runner.execute(inspection.inspection_id, "fixture://hls-ts/master.m3u8")

        assert result.status is InspectionStatus.COMPLETED
        assert result.protocol is Protocol.HLS
        snapshot = repo.get_snapshot(inspection.inspection_id)
        assert snapshot is not None
        assert snapshot.schema_version == "1.8"
        assert snapshot.source.display_url == "fixture://hls-ts/master.m3u8"
        assert snapshot.manifest.variant_count == 2

    async def test_falha_de_fetch_persistida(self, tmp_path, fixtures_root, frozen_clock):
        create, runner, repo = self._build_runner(tmp_path, fixtures_root, frozen_clock)
        inspection = create.execute("fixture://hls-ts/nao-existe.m3u8")
        result = await runner.execute(
            inspection.inspection_id, "fixture://hls-ts/nao-existe.m3u8"
        )
        assert result.status is InspectionStatus.FAILED
        assert result.error_stage == "fetching_manifest"
        assert repo.get_snapshot(inspection.inspection_id) is None

    async def test_conteudo_desconhecido_falha_no_parse(self, tmp_path, frozen_clock):
        fixtures = tmp_path / "fixtures" / "weird"
        fixtures.mkdir(parents=True)
        (fixtures / "x.txt").write_text("<html>not a manifest</html>", encoding="utf-8")
        repository = FilesystemInspectionRepository(tmp_path / "ws", clock=frozen_clock)
        runner = RunInspection(
            fetcher=LocalFixtureFetcher(fixtures.parent),
            inspector=DeclarativeManifestInspector(),
            repository=repository,
        )
        create, _ = _create(tmp_path / "ws", frozen_clock)
        inspection = create.execute("fixture://weird/x.txt")
        result = await runner.execute(inspection.inspection_id, "fixture://weird/x.txt")
        assert result.status is InspectionStatus.FAILED
        assert result.error_stage == "parsing_manifest"


class TestFailActiveSweep:
    def _queued(self, frozen_clock: FrozenClock, inspection_id: str) -> Inspection:
        return Inspection(
            inspection_id=inspection_id,
            status=InspectionStatus.QUEUED,
            created_at=frozen_clock.now(),
            expires_at=frozen_clock.now() + timedelta(seconds=600),
        )

    def test_sweep_marca_jobs_ativos_como_falhos(self, tmp_path, frozen_clock):
        repo = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
        repo.save(self._queued(frozen_clock, "ativa-1"))

        marked = repo.fail_active("job_lost", "processo reiniciado")

        assert marked == 1
        loaded = repo.get("ativa-1")
        assert loaded is not None
        assert loaded.status is InspectionStatus.FAILED
        assert loaded.error_stage == "job_lost"

    def test_sweep_nao_toca_concluidas(self, tmp_path, frozen_clock):
        repo = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
        done = self._queued(frozen_clock, "concluida")
        done.complete(ManifestSummary(Protocol.HLS, ManifestKind.HLS_MASTER_PLAYLIST, False))
        repo.save(done)

        assert repo.fail_active("job_lost", "x") == 0
        loaded = repo.get("concluida")
        assert loaded is not None and loaded.status is InspectionStatus.COMPLETED
