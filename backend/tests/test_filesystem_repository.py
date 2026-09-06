"""Testes do repositório filesystem: atomicidade, round-trip e expiração."""

from datetime import timedelta

from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    FilesystemInspectionRepository,
)
from stream_lens.domain.entities.inspection import Inspection, InspectionStatus
from stream_lens.domain.value_objects.manifest_summary import ManifestSummary
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol
from stream_lens.domain.value_objects.snapshot import Snapshot, SourceInfo
from tests.conftest import FrozenClock


def _make_inspection(clock: FrozenClock, status=InspectionStatus.QUEUED) -> Inspection:
    return Inspection(
        inspection_id="test-id-1",
        status=status,
        created_at=clock.now(),
        expires_at=clock.now() + timedelta(seconds=600),
    )


def _make_snapshot(inspection: Inspection) -> Snapshot:
    return Snapshot(
        schema_version="0.1",
        analyzer_version="0.1.0",
        inspection_id=inspection.inspection_id,
        created_at=inspection.created_at,
        expires_at=inspection.expires_at,
        source=SourceInfo(
            display_url="fixture://hls-ts/master.m3u8",
            protocol="HLS",
            is_live=False,
        ),
        manifest=ManifestSummary(
            protocol=Protocol.HLS,
            kind=ManifestKind.HLS_MASTER_PLAYLIST,
            is_live=False,
            variant_count=2,
        ),
    )


class TestFilesystemRepository:
    def test_round_trip_status_e_snapshot(self, tmp_path, frozen_clock):
        repo = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
        inspection = _make_inspection(frozen_clock, InspectionStatus.COMPLETED)
        inspection.complete(
            ManifestSummary(Protocol.HLS, ManifestKind.HLS_MASTER_PLAYLIST, False, variant_count=2)
        )
        snapshot = _make_snapshot(inspection)

        repo.save(inspection, snapshot)

        loaded = repo.get("test-id-1")
        assert loaded is not None
        assert loaded.status is InspectionStatus.COMPLETED
        assert loaded.protocol is Protocol.HLS
        assert loaded.manifest is not None and loaded.manifest.variant_count == 2

        loaded_snapshot = repo.get_snapshot("test-id-1")
        assert loaded_snapshot is not None
        assert loaded_snapshot.source.display_url == "fixture://hls-ts/master.m3u8"
        assert loaded_snapshot.manifest.kind is ManifestKind.HLS_MASTER_PLAYLIST

    def test_inexistente_retorna_none(self, tmp_path, frozen_clock):
        repo = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
        assert repo.get("nada") is None
        assert repo.get_snapshot("nada") is None

    def test_expirado_reportado_na_leitura(self, tmp_path, frozen_clock):
        repo = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
        inspection = _make_inspection(frozen_clock)
        repo.save(inspection)
        frozen_clock.advance(601)
        loaded = repo.get("test-id-1")
        assert loaded is not None
        assert loaded.status is InspectionStatus.EXPIRED

    def test_purge_expired_remove_apenas_expiradas(self, tmp_path, frozen_clock):
        repo = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
        nova = _make_inspection(frozen_clock)
        nova.inspection_id = "nova"
        velha = _make_inspection(frozen_clock)
        velha.inspection_id = "velha"
        velha.expires_at = frozen_clock.now() - timedelta(seconds=1)
        repo.save(nova)
        repo.save(velha)

        removed = repo.purge_expired()

        assert removed == 1
        assert repo.get("velha") is None
        assert repo.get("nova") is not None

    def test_escrita_atomica_nao_deixa_tmp(self, tmp_path, frozen_clock):
        repo = FilesystemInspectionRepository(tmp_path, clock=frozen_clock)
        repo.save(_make_inspection(frozen_clock))
        leftovers = list((tmp_path / "test-id-1").glob("*.tmp"))
        assert leftovers == []
        assert (tmp_path / "test-id-1" / "status.json").is_file()
