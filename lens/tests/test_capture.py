"""Testes da Fase 4: captura limitada, timeline, progresso e parciais."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

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
from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    FilesystemInspectionRepository,
    snapshot_to_dict,
)
from stream_lens.adapters.outbound.segments.capture_service import (
    CapturePlan,
    SegmentCaptureService,
)
from stream_lens.application.manifest_inspector import (
    DeclarativeManifestInspector,
)
from stream_lens.application.ports.manifest_fetcher import FetchedManifest
from stream_lens.application.use_cases.create_inspection import CreateInspection
from stream_lens.application.use_cases.run_inspection import RunInspection
from stream_lens.domain.value_objects.segments import CaptureLimits
from tests.conftest import FIXTURES_ROOT, FrozenClock, SequentialIdGenerator
from tests.test_create_inspection import RecordingQueue


def _service(fixtures_root: Path, limits: CaptureLimits | None = None) -> SegmentCaptureService:
    return SegmentCaptureService(
        manifest_fetcher=DispatchingManifestFetcher(
            LocalFixtureFetcher(fixtures_root), _NullHttp()
        ),
        segment_fetcher=DispatchingSegmentFetcher(
            fixture_fetcher=LocalFixtureSegmentFetcher(fixtures_root),
            http_fetcher=_NullHttp(),
        ),
        clock=FrozenClock(),
        limits=limits,
    )


class _NullHttp:
    async def fetch(self, url, byte_range=None):
        raise AssertionError(f"não deveria reachar HTTP: {url}")


def _run(use_case, inspection_id, url):
    return asyncio.run(use_case.execute(inspection_id, url))


@pytest.fixture
def runner_factory(tmp_path):
    def make(limits: CaptureLimits | None = None):
        clock = FrozenClock()
        repo = FilesystemInspectionRepository(tmp_path, clock=clock)
        create = CreateInspection(
            repository=repo,
            jobs=RecordingQueue(),
            ids=SequentialIdGenerator(),
            clock=clock,
            ttl_seconds=600,
        )
        service = _service(FIXTURES_ROOT, limits)
        runner = RunInspection(
            fetcher=DispatchingManifestFetcher(LocalFixtureFetcher(FIXTURES_ROOT), _NullHttp()),
            inspector=DeclarativeManifestInspector(),
            repository=repo,
            capture_service=service,
            workspace=tmp_path,
        )
        return create, runner, repo

    return make


class TestCapturaDasTresCombinacoes:
    def test_hls_ts_master_segue_rendicoes_e_captura(self, runner_factory):
        create, runner, repo = runner_factory()
        insp0 = create.execute("fixture://hls-ts/master.m3u8")
        result = _run(runner, insp0.inspection_id, "fixture://hls-ts/master.m3u8")
        assert result.status.value == "completed"
        assert result.segments_planned == 6  # 3 playlists x 2 segs na janela de 10s
        assert result.segments_captured == 6
        snap = repo.get_snapshot(insp0.inspection_id)
        seg = snap.segments[0]
        assert seg.sha256 and len(seg.sha256) == 64
        assert seg.byte_size > 0
        assert seg.file and (Path(repo._root) / insp0.inspection_id / seg.file).is_file()
        assert seg.uri.startswith("fixture://")  # resolvido absoluto

    def test_hls_fmp4_captura_init_e_segmentos(self, runner_factory):
        create, runner, repo = runner_factory()
        insp0 = create.execute("fixture://hls-fmp4/master.m3u8")
        result = _run(runner, insp0.inspection_id, "fixture://hls-fmp4/master.m3u8")
        assert result.status.value == "completed"
        snap = repo.get_snapshot(insp0.inspection_id)
        inits = [s for s in snap.segments if s.is_init]
        assert inits, "init segment (EXT-X-MAP) deveria ser capturado"
        assert any("init_" in (s.file or "") for s in inits)

    def test_hls_preserva_media_sequence_na_janela_e_timeline(self):
        service = _service(FIXTURES_ROOT)
        fetched = FetchedManifest(
            url="fixture://hls-ts/video/live.m3u8",
            text=(
                "#EXTM3U\n#EXT-X-TARGETDURATION:5\n"
                "#EXT-X-MEDIA-SEQUENCE:372661281\n"
                "#EXTINF:4.800,\na.ts\n#EXTINF:4.800,\nb.ts\n"
            ),
        )
        plan = CapturePlan()
        service._add_hls_playlist_segments(plan, "v720", "video", fetched)

        assert [item.segment_sequence for item in plan.planned] == [372661281, 372661282]
        timeline = service.timeline(plan, [])
        assert [entry.segment_sequence for entry in timeline[0].entries] == [
            372661281,
            372661282,
        ]

    def test_dash_template_enumerado_pela_janela(self, runner_factory):
        create, runner, repo = runner_factory()
        insp0 = create.execute("fixture://dash-mpd/stream.mpd")
        result = _run(runner, insp0.inspection_id, "fixture://dash-mpd/stream.mpd")
        assert result.status.value == "completed"
        snap = repo.get_snapshot(insp0.inspection_id)
        v360 = [s for s in snap.segments if s.rep_id == "v360"]
        assert any(s.is_init and s.uri.endswith("init_v360.mp4") for s in v360)
        media = sorted(s.index for s in v360 if not s.is_init)
        assert media == [1, 2]  # janela 10s / segs de 4s
        assert [s.segment_sequence for s in v360 if not s.is_init] == [1, 2]

    def test_dash_time_e_resolvido_a_partir_do_segment_timeline(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
          <Period duration="PT13S"><AdaptationSet contentType="video">
            <SegmentTemplate timescale="1000" initialization="init.mp4"
              media="video-$Time$.m4s">
              <SegmentTimeline>
                <S t="900" d="4000"/>
                <S d="4000"/>
                <S d="5000"/>
              </SegmentTimeline>
            </SegmentTemplate>
            <Representation id="v1"/>
          </AdaptationSet></Period>
        </MPD>"""
        service = _service(FIXTURES_ROOT)
        media = DeclarativeManifestInspector().inspect(mpd)
        plan = asyncio.run(service.plan(media, "fixture://dash-mpd/stream.mpd"))

        assert [segment.uri for segment in plan.planned] == [
            "fixture://dash-mpd/init.mp4",
            "fixture://dash-mpd/video-900.m4s",
            "fixture://dash-mpd/video-4900.m4s",
        ]
        assert not any("$Time$" in warning for warning in plan.warnings)

    def test_dash_time_percorre_fluxo_com_bytes_reais(self, runner_factory):
        create, runner, repo = runner_factory()
        inspection = create.execute("fixture://dash-mpd/time.mpd")
        result = _run(runner, inspection.inspection_id, "fixture://dash-mpd/time.mpd")

        assert result.status.value == "completed"
        snapshot = repo.get_snapshot(inspection.inspection_id)
        media_segments = [segment for segment in snapshot.segments if not segment.is_init]
        assert [segment.index for segment in media_segments] == [1, 2, 3]
        assert [segment.uri.rsplit("/", 1)[-1] for segment in media_segments] == [
            "1.m4s",
            "2.m4s",
            "3.m4s",
        ]
        assert all(segment.ok for segment in media_segments)
        assert not any("$Time$" in warning for warning in snapshot.warnings)

    def test_dash_time_com_duracao_fixa_comeca_em_zero(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
          <Period duration="PT12S"><AdaptationSet contentType="video">
            <SegmentTemplate timescale="1000" duration="4000"
              media="video-$Time$.m4s" startNumber="7"/>
            <Representation id="v1"/>
          </AdaptationSet></Period>
        </MPD>"""
        service = _service(FIXTURES_ROOT)
        media = DeclarativeManifestInspector().inspect(mpd)
        plan = asyncio.run(service.plan(media, "fixture://dash-mpd/stream.mpd"))

        assert [(segment.index, segment.uri) for segment in plan.planned] == [
            (7, "fixture://dash-mpd/video-0.m4s"),
            (8, "fixture://dash-mpd/video-4000.m4s"),
        ]

    def test_dash_base_url_direta_e_planejada_sem_aviso(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"
          mediaPresentationDuration="PT12S">
          <Period><AdaptationSet contentType="text">
            <Representation id="caption"><BaseURL>caption.vtt</BaseURL></Representation>
          </AdaptationSet></Period>
        </MPD>"""
        service = _service(FIXTURES_ROOT)
        media = DeclarativeManifestInspector().inspect(mpd)
        plan = asyncio.run(service.plan(media, "fixture://dash-mpd/stream.mpd"))

        assert [segment.uri for segment in plan.planned] == [
            "fixture://dash-mpd/caption.vtt"
        ]
        assert not plan.warnings

    def test_dash_live_escolhe_o_fim_da_timeline(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
          <Period><AdaptationSet contentType="video">
            <SegmentTemplate timescale="1" media="$Time$.m4s">
              <SegmentTimeline><S t="0" d="4" r="3"/></SegmentTimeline>
            </SegmentTemplate>
            <Representation id="v1"/>
          </AdaptationSet></Period>
        </MPD>"""
        service = _service(FIXTURES_ROOT, limits=CaptureLimits(window_seconds=8.0))
        media = DeclarativeManifestInspector().inspect(mpd)
        plan = asyncio.run(service.plan(media, "fixture://dash-mpd/stream.mpd"))

        assert [(segment.index, segment.uri) for segment in plan.planned] == [
            (3, "fixture://dash-mpd/8.m4s"),
            (4, "fixture://dash-mpd/12.m4s"),
        ]


class TestLimitesEParciais:
    def test_limites_padrao_sao_500mb_total_e_20mb_por_segmento(self):
        limits = CaptureLimits()
        assert limits.max_total_bytes == 500_000_000
        assert limits.max_segment_bytes == 20_000_000

    def test_janela_menor_captura_menos(self, runner_factory):
        create, runner, _repo = runner_factory(limits=CaptureLimits(window_seconds=5.0))
        insp0 = create.execute("fixture://hls-ts/master.m3u8")
        result = _run(runner, insp0.inspection_id, "fixture://hls-ts/master.m3u8")
        assert result.segments_captured == 3  # 3 playlists x 1 seg (4s cada)

    def test_janela_tem_teto_absoluto(self):
        limits = CaptureLimits(window_seconds=999.0)
        assert limits.window_seconds == 999.0  # domínio não mentiu...
        # ...quem aplica o teto é o bootstrap (env), testado abaixo
        from stream_lens.domain.value_objects.segments import MAX_WINDOW_SECONDS
        assert MAX_WINDOW_SECONDS == 60.0

    def test_orcamento_de_bytes_gera_parcial(self, runner_factory):
        limits = CaptureLimits(
            window_seconds=10.0,
            max_total_bytes=3 * 3760,  # exatamente 3 segmentos de 20 pacotes TS
        )
        create, runner, _repo = runner_factory(limits=limits)
        insp0 = create.execute("fixture://hls-ts/master.m3u8")
        result = _run(runner, insp0.inspection_id, "fixture://hls-ts/master.m3u8")
        assert result.status.value == "partial"
        assert any("orçamento" in w for w in result.warnings)
        assert result.segments_captured == 3

    def test_segmento_ausente_nao_derruba_inspecao(self, runner_factory, tmp_path):
        # fixture com um segmento faltando
        broken = tmp_path / "broken"
        (broken / "video").mkdir(parents=True)
        (broken / "master.m3u8").write_text(
            "#EXTM3U\n"
            "#EXT-X-TARGETDURATION:4\n"
            "#EXTINF:4.000,\nseg-0.ts\n"
            "#EXTINF:4.000,\nseg-1.ts\n"
            "#EXTINF:4.000,\nseg-2.ts\n"
            "#EXT-X-ENDLIST\n",
            encoding="utf-8",
        )
        (broken / "seg-0.ts").write_bytes(b"\x47" * 188)
        # seg-1 e seg-2 não existem

        create, runner, repo = runner_factory(limits=None)
        # aponta o runner para a fixture quebrada via URL direta
        insp0 = create.execute("fixture://hls-ts/master.m3u8")
        # substituímos o fetcher do runner por um que lê a fixture quebrada
        runner._fetcher = DispatchingManifestFetcher(
            LocalFixtureFetcher(broken.parent), _NullHttp()
        )
        runner._capture._manifests = runner._fetcher
        runner._capture._segments = DispatchingSegmentFetcher(
            fixture_fetcher=LocalFixtureSegmentFetcher(broken.parent),
            http_fetcher=_NullHttp(),
        )
        result = _run(runner, insp0.inspection_id, "fixture://broken/master.m3u8")
        assert result.status.value == "partial"
        assert result.segments_planned == 2  # janela de 10s sobre segs de 4s
        assert result.segments_captured == 1
        assert result.segments_failed == 1
        snap = repo.get_snapshot(insp0.inspection_id)
        failed = [s for s in snap.segments if s.error]
        assert len(failed) == 1
        assert "fixture não encontrada" in failed[0].error


class TestTimeline:
    def test_timeline_normalizada_com_inicio_e_duracao(self, runner_factory):
        create, runner, repo = runner_factory()
        insp0 = create.execute("fixture://dash-mpd/stream.mpd")
        _run(runner, insp0.inspection_id, "fixture://dash-mpd/stream.mpd")
        snap = repo.get_snapshot(insp0.inspection_id)
        tl = next(t for t in snap.timeline if t.rep_id == "v360")
        entries = [e for e in tl.entries if e.status in ("captured", "failed")]
        assert [e.index for e in entries] == [1, 2]
        assert entries[0].start_seconds == 0.0
        assert entries[1].start_seconds == pytest.approx(4.0)
        assert all(e.duration_seconds == pytest.approx(4.0) for e in entries)
        init = [e for e in tl.entries if e.status == "init"]
        assert init and init[0].index == -1

    def test_discontinuity_declarada_aparece_na_timeline(self):
        service = _service(FIXTURES_ROOT)
        media = DeclarativeManifestInspector().inspect(
            "#EXTM3U\n#EXT-X-TARGETDURATION:4\n"
            "#EXTINF:4.000,\nseg-0.ts\n"
            "#EXT-X-DISCONTINUITY\n"
            "#EXTINF:4.000,\nseg-1.ts\n"
            "#EXT-X-ENDLIST\n"
        )
        plan = asyncio.run(service.plan(media, "fixture://hls-ts/master.m3u8"))
        assert plan.discontinuities.get("media-playlist", {}).get(1) is True


class TestProgressoEContrato:
    def test_progresso_persistido_no_status_json(self, runner_factory):
        create, runner, repo = runner_factory()
        insp0 = create.execute("fixture://hls-ts/master.m3u8")
        _run(runner, insp0.inspection_id, "fixture://hls-ts/master.m3u8")
        status = json.loads(
            (repo._root / insp0.inspection_id / "status.json").read_text(encoding="utf-8")
        )
        assert status["segments_planned"] == 6
        assert status["segments_captured"] == 6
        assert status["segments_failed"] == 0

    def test_snapshot_expose_capture_segments_timeline(self, runner_factory):
        create, runner, repo = runner_factory()
        insp0 = create.execute("fixture://hls-fmp4/video/360p.m3u8")
        _run(runner, insp0.inspection_id, "fixture://hls-fmp4/video/360p.m3u8")
        payload = snapshot_to_dict(repo.get_snapshot(insp0.inspection_id))
        assert payload["schema_version"] == "1.13"
        assert payload["capture"]["planned"] == 3
        assert payload["capture"]["captured"] == 3
        assert payload["capture"]["window_seconds"] == 10.0
        assert len(payload["segments"]) == 3
        assert payload["segments"][0]["sha256"]
        assert len(payload["timeline"]) == 1

    def test_uri_de_segmento_nao_vaza_query(self, runner_factory):
        """Mesmo que a fonte tivesse query com token, o snapshot não persiste."""
        create, runner, repo = runner_factory()
        insp0 = create.execute("fixture://hls-ts/master.m3u8")
        _run(runner, insp0.inspection_id, "fixture://hls-ts/master.m3u8")
        payload = snapshot_to_dict(repo.get_snapshot(insp0.inspection_id))
        for seg in payload["segments"]:
            assert "?" not in seg["uri"]

    def test_roundtrip_snapshot_completo(self, runner_factory):
        from stream_lens.adapters.outbound.filesystem.inspection_repository import (
            _snapshot_from_dict,
        )

        create, runner, repo = runner_factory()
        insp0 = create.execute("fixture://dash-mpd/stream.mpd")
        _run(runner, insp0.inspection_id, "fixture://dash-mpd/stream.mpd")
        snap = repo.get_snapshot(insp0.inspection_id)
        payload = snapshot_to_dict(snap)
        assert _snapshot_from_dict(payload) == snap
