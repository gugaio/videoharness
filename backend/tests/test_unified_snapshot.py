"""Testes de contrato do snapshot unificado (schema 1.0) e golden snapshots.

Golden = snapshot completo serializado para as três formas da Fase 3:
HLS TS, HLS fMP4 e DASH fMP4. Qualquer mudança de contrato consciente
deve atualizar o golden junto (é o objetivo: travar o contrato).
"""

import json
from pathlib import Path

from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    snapshot_to_dict,
)
from stream_lens.adapters.outbound.manifests.manifest_inspector import (
    DeclarativeManifestInspector,
)
from stream_lens.adapters.outbound.manifests.serialization import (
    media_from_dict,
    media_to_dict,
)
from tests.conftest import SequentialIdGenerator

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
inspector = DeclarativeManifestInspector()

#golden minimal Snapshot construction requires many fields; instead goldens
# cobrem apenas a parte nova do contrato: o bloco `media`.


def _media_block(rel_path: str) -> dict:
    media = inspector.inspect((FIXTURES / rel_path).read_text())
    return media_to_dict(media)


def test_golden_hls_ts_master():
    golden = json.loads((Path(__file__).parent / "golden" / "hls_ts_master.media.json").read_text())
    assert _media_block("hls-ts/master.m3u8") == golden


def test_golden_hls_fmp4_media_playlist():
    golden = json.loads(
        (Path(__file__).parent / "golden" / "hls_fmp4_media.media.json").read_text()
    )
    assert _media_block("hls-fmp4/video/360p.m3u8") == golden


def test_golden_dash_fmp4():
    golden = json.loads((Path(__file__).parent / "golden" / "dash_fmp4.media.json").read_text())
    assert _media_block("dash-mpd/stream.mpd") == golden


def test_roundtrip_serializacao_media():
    for rel in ("hls-ts/master.m3u8", "hls-fmp4/video/360p.m3u8", "dash-mpd/stream.mpd"):
        media = inspector.inspect((FIXTURES / rel).read_text())
        assert media_from_dict(media_to_dict(media)) == media


def test_snapshot_schema_e_campos_top_level(tmp_path):
    """O snapshot serializado expõe schema 1.0 com bloco `media` populado."""
    import asyncio

    from stream_lens.adapters.outbound.fetching.local_fixture_fetcher import (
        LocalFixtureFetcher,
    )
    from stream_lens.adapters.outbound.filesystem.inspection_repository import (
        FilesystemInspectionRepository,
    )
    from stream_lens.application.use_cases.create_inspection import CreateInspection
    from stream_lens.application.use_cases.run_inspection import RunInspection
    from tests.conftest import FIXTURES_ROOT, FrozenClock
    from tests.test_create_inspection import RecordingQueue

    clock = FrozenClock()
    repo = FilesystemInspectionRepository(tmp_path, clock=clock)
    create = CreateInspection(
        repository=repo,
        jobs=RecordingQueue(),
        ids=SequentialIdGenerator(),
        clock=clock,
        ttl_seconds=600,
    )
    inspection = create.execute("fixture://hls-fmp4/master.m3u8")
    use_case = RunInspection(
        fetcher=LocalFixtureFetcher(FIXTURES_ROOT),
        inspector=DeclarativeManifestInspector(),
        repository=repo,
    )
    result = asyncio.run(
        use_case.execute(inspection.inspection_id, "fixture://hls-fmp4/master.m3u8")
    )
    assert result.status.value == "completed"
    payload = snapshot_to_dict(repo.get_snapshot(inspection.inspection_id))
    assert payload["schema_version"] == "1.13"
    assert payload["media"]["protocol"] == "HLS"
    assert payload["media"]["capabilities"]["segment_download"]["status"] == "not_collected"
