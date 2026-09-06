"""Testes da Fase 5: parsers de container (fMP4 e MPEG-TS) — offline e determinísticos."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from stream_lens.adapters.outbound.containers.container_analyzer import (
    SniffingContainerAnalyzer,
)
from stream_lens.adapters.outbound.containers.fmp4_parser import parse_fmp4
from stream_lens.adapters.outbound.containers.mpegts_parser import parse_mpegts
from stream_lens.domain.value_objects.containers import SegmentContainer

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
analyzer = SniffingContainerAnalyzer()


def _box(box_type: str, payload: bytes) -> bytes:
    return (len(payload) + 8).to_bytes(4, "big") + box_type.encode("latin-1") + payload


class TestSniffing:
    def test_detecta_mpeg_ts(self):
        data = (FIXTURES / "hls-ts/video/seg-0.ts").read_bytes()
        assert analyzer.analyze(data, False).kind == "mpeg-ts"

    def test_detecta_fmp4(self):
        data = (FIXTURES / "hls-fmp4/video/v360_seg0.m4s").read_bytes()
        assert analyzer.analyze(data, False).kind == "mp4"
        init = (FIXTURES / "hls-fmp4/video/init_v360.mp4").read_bytes()
        assert analyzer.analyze(init, True).kind == "mp4"

    def test_desconhecido(self):
        result = analyzer.analyze(b"\x00" * 512, False)
        assert result.kind == "unknown"
        assert result.error


class TestFmp4:
    def test_init_arvore_e_timescales(self):
        data = (FIXTURES / "hls-fmp4/video/init_v360.mp4").read_bytes()
        result = parse_fmp4(data, is_init=True)
        info = result.fmp4
        assert info is not None and info.is_init
        types = [b.type for b in info.boxes]
        assert types == ["ftyp", "moov"]
        assert info.brands == ("isom",)
        assert info.timescales.get("movie") == 1000
        assert 1 in info.track_ids  # tkhd
        assert info.truncated is False
        # árvore navega até o trex
        moov = info.boxes[1]
        assert {c.type for c in moov.children} >= {"mvhd", "trak", "mvex"}
        mvex = next(c for c in moov.children if c.type == "mvex")
        assert mvex.children[0].type == "trex"
        assert mvex.children[0].fields["track_id"] == 1
        assert mvex.children[0].fields["default_sample_duration"] == 4000
        assert mvex.offset > moov.offset
        assert mvex.children[0].offset > mvex.offset

    def test_media_fragment_moof_campos(self):
        data = (FIXTURES / "hls-fmp4/video/v360_seg0.m4s").read_bytes()
        result = parse_fmp4(data, is_init=False)
        info = result.fmp4
        assert info is not None
        assert [b.type for b in info.boxes] == ["styp", "moof", "mdat"]
        assert info.sequence_number == 1
        assert info.base_media_decode_time == 0
        assert info.sample_counts == {1: 1}
        moof = info.boxes[1]
        traf = next(c for c in moof.children if c.type == "traf")
        tfhd = next(c for c in traf.children if c.type == "tfhd")
        assert tfhd.fields["track_id"] == 1
        tfdt = next(c for c in traf.children if c.type == "tfdt")
        assert tfdt.fields["base_media_decode_time"] == 0
        trun = next(c for c in traf.children if c.type == "trun")
        assert trun.fields["sample_count"] == 1
        assert trun.fields["data_offset"] > 0

    def test_tfhd_flags_seguem_isobmff(self):
        # full box: default duration, size e flags; nenhum offset/índice opcional.
        payload = (
            b"\x00\x00\x00\x1ctfhd"
            + b"\x00\x00\x00\x38"
            + b"\x00\x00\x00\x01"
            + b"\x00\x00\x0f\xa0"
            + b"\x00\x01\x86\xa0"
            + b"\x10\x10\x00\x00"
        )
        info = parse_fmp4(payload, is_init=False).fmp4
        assert info is not None
        tfhd = info.boxes[0]
        assert tfhd.fields == {
            "track_id": 1,
            "flags": 0x38,
            "default_sample_duration": 4000,
            "default_sample_size": 100000,
            "default_sample_flags": 0x10100000,
        }

    def test_tfdt_acumula_por_segmento(self):
        data = (FIXTURES / "hls-fmp4/video/v360_seg2.m4s").read_bytes()
        info = parse_fmp4(data, is_init=False).fmp4
        assert info is not None
        assert info.sequence_number == 3
        assert info.base_media_decode_time == 8000

    def test_box_truncado_marcado(self):
        data = (FIXTURES / "hls-fmp4/video/v360_seg0.m4s").read_bytes()
        cut = data[: len(data) - 10]  # corta o fim do mdat
        info = parse_fmp4(cut, is_init=False).fmp4
        assert info is not None and info.truncated

    def test_extrai_sinal_e_metadados_hdr_estaticos_do_stsd(self):
        colr = _box("colr", b"nclx" + (9).to_bytes(2, "big") + (16).to_bytes(2, "big")
                    + (9).to_bytes(2, "big") + b"\x80")
        mdcv = _box(
            "mdcv",
            struct.pack(
                ">HHHHHHHHII", 34000, 16000, 13250, 34500, 7500, 3000,
                15635, 16450, 10_000_000, 50,
            ),
        )
        clli = _box("clli", struct.pack(">HH", 1000, 400))
        sample_entry = _box("hvc1", b"\x00" * 78 + colr + mdcv + clli)
        stsd = _box("stsd", b"\x00" * 4 + (1).to_bytes(4, "big") + sample_entry)

        info = parse_fmp4(stsd, is_init=True).fmp4

        assert info is not None and info.hdr is not None
        assert info.hdr.color_primaries == "BT.2020"
        assert info.hdr.transfer_characteristics == "PQ (ST 2084)"
        assert info.hdr.static_metadata["content_light_level"] == {
            "max_cll_cd_m2": 1000,
            "max_fall_cd_m2": 400,
        }
        assert info.hdr.static_metadata["mastering_display"]["max_luminance_cd_m2"] == 1000

    def test_detecta_assinatura_hdr10_mais_em_sei_hevc_capturado(self):
        # Prefix SEI (NAL type 39) com registered user data ITU-T T.35 HDR10+.
        sei = bytes([0x4E, 0x01, 0x04, 0x06]) + b"\xB5\x00\x3C\x00\x01\x04" + b"\x80"
        fragment = _box("mdat", len(sei).to_bytes(4, "big") + sei)

        info = parse_fmp4(fragment, is_init=False).fmp4

        assert info is not None and info.hdr is not None
        assert info.hdr.dynamic_metadata == ("HDR10+",)

    def test_reconhece_hlg_sem_confundir_ausencia_de_metadados_com_sdr(self):
        colr = _box(
            "colr",
            b"nclx" + (9).to_bytes(2, "big") + (18).to_bytes(2, "big")
            + (9).to_bytes(2, "big") + b"\x00",
        )
        sample_entry = _box("hvc1", b"\x00" * 78 + colr)
        stsd = _box("stsd", b"\x00" * 4 + (1).to_bytes(4, "big") + sample_entry)

        hlg = parse_fmp4(stsd, is_init=True).fmp4
        sem_sinal = parse_fmp4(_box("ftyp", b"isom\x00\x00\x00\x00"), is_init=True).fmp4

        assert hlg is not None and hlg.hdr is not None
        assert hlg.hdr.transfer_characteristics == "HLG"
        assert sem_sinal is not None and sem_sinal.hdr is None


class TestMpegTs:
    def test_pat_pmt_programas(self):
        data = (FIXTURES / "hls-ts/video/seg-0.ts").read_bytes()
        result = parse_mpegts(data)
        info = result.ts
        assert info is not None
        assert info.programs == {"1": 0x1000}
        pids = {p.pid: p for p in info.pids}
        assert 0x1000 in pids  # PMT presente
        assert 0x100 in pids  # elementary
        video = pids[0x100]
        assert video.stream_type == 0x1B
        assert "h264" in (video.stream_kind or "")
        assert info.sync_errors == 0

    def test_pes_pts_e_pcr(self):
        data = (FIXTURES / "hls-ts/video/seg-0.ts").read_bytes()
        info = parse_mpegts(data).ts
        assert info is not None
        video = next(p for p in info.pids if p.pid == 0x100)
        assert video.pes_count == 2
        assert video.first_pts == 0
        assert video.last_pts == 3600
        assert video.pcr_count >= 1
        assert video.last_pcr == 0  # pcr_base do seg-0

    def test_packet_count(self):
        data = (FIXTURES / "hls-ts/video/seg-1.ts").read_bytes()
        info = parse_mpegts(data).ts
        assert info is not None
        assert info.packet_count == len(data) // 188
        assert len(data) % 188 == 0

    def test_continuity_error_detectada(self):
        data = bytearray((FIXTURES / "hls-ts/video/seg-0.ts").read_bytes())
        # pular um pacote do PID 0x100 (posição 3) sem ajustar CC: insere null no lugar
        null = bytes([0x47, 0x1F, 0xFF, 0x10]) + b"\xff" * 184
        pkt3 = 3 * 188
        data[pkt3 : pkt3 + 188] = null
        info = parse_mpegts(bytes(data)).ts
        assert info is not None
        video = next(p for p in info.pids if p.pid == 0x100)
        assert video.continuity_errors >= 1


class TestIntegracaoSnapshot:
    def test_snapshot_inclui_containers_das_tres_combinacoes(self, tmp_path):
        import asyncio

        from stream_lens.adapters.outbound.containers.serialization import (
            analysis_from_dict,
            analysis_to_dict,
        )
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
        from stream_lens.adapters.outbound.segments.capture_service import SegmentCaptureService
        from stream_lens.application.use_cases.create_inspection import CreateInspection
        from stream_lens.application.use_cases.run_inspection import RunInspection
        from tests.conftest import FrozenClock, SequentialIdGenerator
        from tests.test_capture import _NullHttp
        from tests.test_create_inspection import RecordingQueue

        clock = FrozenClock()
        repo = FilesystemInspectionRepository(tmp_path, clock=clock)
        create = CreateInspection(
            repository=repo, jobs=RecordingQueue(), ids=SequentialIdGenerator(),
            clock=clock, ttl_seconds=600,
        )
        service = SegmentCaptureService(
            manifest_fetcher=DispatchingManifestFetcher(
                LocalFixtureFetcher(FIXTURES), _NullHttp()
            ),
            segment_fetcher=DispatchingSegmentFetcher(
                fixture_fetcher=LocalFixtureSegmentFetcher(FIXTURES),
                http_fetcher=_NullHttp(),
            ),
            clock=clock,
        )
        runner = RunInspection(
            fetcher=DispatchingManifestFetcher(LocalFixtureFetcher(FIXTURES), _NullHttp()),
            inspector=_InspectorStub(),
            repository=repo,
            capture_service=service,
            workspace=tmp_path,
            container_analyzer=analyzer,
        )

        for url in (
            "fixture://hls-ts/master.m3u8",
            "fixture://hls-fmp4/master.m3u8",
            "fixture://dash-mpd/stream.mpd",
        ):
            insp0 = create.execute(url)
            result = asyncio.run(runner.execute(insp0.inspection_id, url))
            assert result.status.value == "completed", url
            snap = repo.get_snapshot(insp0.inspection_id)
            assert snap is not None and snap.containers, url
            kinds = {c.analysis.kind for c in snap.containers}
            assert kinds == {"mp4"} if "hls-ts" not in url else kinds == {"mpeg-ts"}
            # round-trip
            payload = snapshot_to_dict(snap)
            for c in payload["containers"]:
                again = analysis_from_dict(c["analysis"])
                assert analysis_to_dict(again) == c["analysis"]

    def test_container_round_trip_preserva_probe(self):
        from stream_lens.adapters.outbound.containers.serialization import (
            container_from_dict,
            container_to_dict,
        )

        original = SegmentContainer(
            rep_id="v360", group_kind="video", index=1, is_init=False,
            file="segments/0001.m4s", byte_size=12,
            analysis=analyzer.analyze(b"invalido", False),
            probe={"provenance": "derived (ffprobe)", "streams": []},
        )
        assert container_from_dict(container_to_dict(original)) == original

    def test_container_de_segmento_falhado_nao_existe(self):
        seg = SegmentContainer(
            rep_id="x", group_kind="video", index=1, is_init=False,
            file="segments/0001_x.ts", byte_size=0,
            analysis=analyzer.analyze(b"", False),
        )
        assert seg.analysis.kind == "unknown"


class _InspectorStub:
    """Reaproveita o inspector real via fixture files."""

    def inspect(self, content: str):
        from stream_lens.adapters.outbound.manifests.manifest_inspector import (
            DeclarativeManifestInspector,
        )

        return DeclarativeManifestInspector().inspect(content)


class TestFfprobe:
    def test_resumo_preserva_cor_e_side_data_hdr_reconhecido(self):
        from stream_lens.adapters.outbound.containers.ffprobe_probe import _summarize

        probe = _summarize({
            "streams": [{
                "index": 0, "codec_type": "video", "color_primaries": "bt2020",
                "color_transfer": "smpte2084", "bits_per_raw_sample": "10",
                "side_data_list": [
                    {"side_data_type": "Mastering display metadata"},
                    {"side_data_type": "Content light level metadata"},
                ],
            }],
        })

        stream = probe["streams"][0]
        assert stream["color_primaries"] == "bt2020"
        assert stream["color_transfer"] == "smpte2084"
        assert stream["bits_per_raw_sample"] == "10"
        assert stream["hdr_side_data"] == [
            "Mastering display metadata",
            "Content light level metadata",
        ]

    def test_probe_de_fixture_fmp4(self):
        from stream_lens.adapters.outbound.containers.ffprobe_probe import FFprobeMediaProbe

        probe = FFprobeMediaProbe()
        if not probe.available:
            pytest.skip("ffprobe não instalado neste ambiente")
        data = probe.probe_file(str(FIXTURES / "hls-fmp4/video/init_v360.mp4"))
        assert data is not None
        assert data["provenance"].startswith("derived")
        assert data["format_name"].startswith("mov")
        # fragmento sintético sem sample entry real: ffprobe recusa (None, not_collected)
        assert probe.probe_file(str(FIXTURES / "hls-fmp4/video/v360_seg0.m4s")) is None

    def test_probe_binario_ausente_retorna_none(self, monkeypatch):
        import stream_lens.adapters.outbound.containers.ffprobe_probe as mod

        probe = mod.FFprobeMediaProbe(binary="ffprobe-que-nao-existe")
        assert probe.available is False
        assert probe.probe_file("/whatever") is None
