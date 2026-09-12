"""Testes da Fase 5: parsers de container (fMP4 e MPEG-TS) — offline e determinísticos."""

from __future__ import annotations

import struct
import subprocess
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
        assert info.track_ids == (1,)
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

    def test_materializa_samples_com_tamanho_dts_pts_e_sync(self):
        init_data = (FIXTURES / "hls-fmp4/video/init_v360.mp4").read_bytes()
        init_info = parse_fmp4(init_data, is_init=True).fmp4
        assert init_info is not None
        tfhd = _box("tfhd", b"\x00\x00\x00\x00" + (1).to_bytes(4, "big"))
        tfdt = _box("tfdt", b"\x01\x00\x00\x00" + (90_000).to_bytes(8, "big"))
        flags = 0x000F00  # duration, size, flags e composition time offset
        trun = _box(
            "trun",
            b"\x01" + flags.to_bytes(3, "big") + (2).to_bytes(4, "big")
            + struct.pack(">IIIi", 3_000, 1_800, 0, 6_000)
            + struct.pack(">IIIi", 3_000, 420, 0x00010000, -3_000),
        )
        fragment = _box("moof", _box("traf", tfhd + tfdt + trun)) + _box(
            "mdat", b"x" * 2_220
        )

        result = parse_fmp4(fragment, is_init=False, init_info=init_info)

        assert result.samples_truncated is False
        assert len(result.samples) == 2
        first, second = result.samples
        assert (first.byte_size, first.dts, first.pts, first.duration) == (
            1_800, 90_000, 96_000, 3_000,
        )
        assert first.timescale == 1_000
        assert first.is_sync is True
        assert (second.byte_size, second.dts, second.pts) == (420, 93_000, 90_000)
        assert second.composition_offset == -3_000
        assert second.is_sync is False

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
    def test_stream_type_15_e_metadata_pes_nao_audio(self):
        from stream_lens.adapters.outbound.containers.mpegts_parser import _STREAM_KINDS

        assert _STREAM_KINDS[0x0F] == "audio (aac)"
        assert _STREAM_KINDS[0x15] == "metadata (pes)"

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

    def test_materializa_unidades_pes_com_tamanho_e_pts(self):
        data = (FIXTURES / "hls-ts/video/seg-0.ts").read_bytes()
        result = parse_mpegts(data)

        assert result.samples_truncated is False
        assert [(sample.pid, sample.pts) for sample in result.samples] == [
            (0x100, 0),
            (0x100, 3600),
        ]
        assert all(sample.unit_type == "pes" for sample in result.samples)
        assert all(sample.byte_size == 102 for sample in result.samples)
        assert result.samples[0].duration == 3600
        assert result.samples[0].timescale == 90_000

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
        probe_calls: list[tuple[str, str | None, bool]] = []

        class RecordingProbe:
            def probe_file(
                self,
                path: str,
                init_path: str | None = None,
                include_frames: bool = False,
            ):
                probe_calls.append((path, init_path, include_frames))
                return None

        runner = RunInspection(
            fetcher=DispatchingManifestFetcher(LocalFixtureFetcher(FIXTURES), _NullHttp()),
            inspector=_InspectorStub(),
            repository=repo,
            capture_service=service,
            workspace=tmp_path,
            container_analyzer=analyzer,
            media_probe=RecordingProbe(),
        )

        for url in (
            "fixture://hls-ts/master.m3u8",
            "fixture://hls-fmp4/master.m3u8",
            "fixture://dash-mpd/stream.mpd",
        ):
            first_call = len(probe_calls)
            insp0 = create.execute(url)
            result = asyncio.run(runner.execute(insp0.inspection_id, url))
            assert result.status.value == "completed", url
            snap = repo.get_snapshot(insp0.inspection_id)
            assert snap is not None and snap.containers, url
            kinds = {c.analysis.kind for c in snap.containers}
            assert kinds == {"mp4"} if "hls-ts" not in url else kinds == {"mpeg-ts"}
            timed_units = [
                sample
                for container in snap.containers
                if not container.is_init
                for sample in container.analysis.samples
            ]
            assert timed_units, url
            assert all(sample.timescale for sample in timed_units), url
            media_containers = [container for container in snap.containers if not container.is_init]
            assert all(container.analysis.timing is not None for container in media_containers)
            current_calls = probe_calls[first_call:]
            assert any(include_frames for _, _, include_frames in current_calls)
            if "hls-ts" in url:
                assert all(init_path is None for _, init_path, _ in current_calls)
            else:
                assert any(
                    include_frames and init_path is not None
                    for _, init_path, include_frames in current_calls
                )
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
    def test_av_timing_usa_menor_pts_de_apresentacao_por_stream(self):
        from stream_lens.adapters.outbound.containers.ffprobe_probe import (
            _summarize_av_timing,
        )

        timing = _summarize_av_timing(
            {
                "frames": [
                    {
                        "media_type": "video",
                        "pts": 9_000,
                        "pts_time": "0.100000",
                        "best_effort_timestamp": 0,
                        "best_effort_timestamp_time": "0.000000",
                    },
                    {
                        "media_type": "audio",
                        "pts": 2_304,
                        "pts_time": "0.048000",
                    },
                    {
                        "media_type": "video",
                        "pts": 3_000,
                        "pts_time": "0.033333",
                    },
                ]
            }
        )

        assert timing == {
            "video": {"pts": 0, "pts_time": "0.000000"},
            "audio": {"pts": 2_304, "pts_time": "0.048000"},
            "provenance": "derived (ffprobe presentation timestamps)",
        }

    def test_gop_parcial_nao_inventa_intervalo(self):
        from stream_lens.adapters.outbound.containers.ffprobe_probe import _summarize_gop

        gop = _summarize_gop(
            [
                {"index": 0, "pict_type": "B", "key_frame": False, "pts_time": "0"},
                {"index": 1, "pict_type": "P", "key_frame": False, "pts_time": "0.04"},
                {"index": 2, "pict_type": "I", "key_frame": True, "pts_time": "0.08"},
            ],
            truncated=False,
        )

        assert gop["starts_with_key_frame"] is False
        assert gop["first_key_frame_index"] == 2
        assert gop["key_frame_count"] == 1
        assert gop["intervals"] == []
        assert gop["trailing_gop"] == {
            "start_frame_index": 2,
            "observed_frame_count": 1,
            "observed_duration_seconds": None,
        }

    def test_limita_lista_de_frames(self):
        from stream_lens.adapters.outbound.containers.ffprobe_probe import (
            _MAX_FRAMES,
            _summarize_frames,
        )

        frames, truncated = _summarize_frames(
            {"frames": [{"pict_type": "P"}] * (_MAX_FRAMES + 1)}
        )

        assert len(frames) == _MAX_FRAMES
        assert truncated is True

    def test_recusa_entrada_combinada_acima_do_limite(self, monkeypatch, tmp_path):
        import stream_lens.adapters.outbound.containers.ffprobe_probe as mod

        init = tmp_path / "init.mp4"
        fragment = tmp_path / "segment.m4s"
        init.write_bytes(b"init")
        fragment.write_bytes(b"fragment")
        monkeypatch.setattr(mod.shutil, "which", lambda _binary: "/fake/ffprobe")
        monkeypatch.setattr(mod, "_MAX_COMBINED_BYTES", 5)

        probe = mod.FFprobeMediaProbe()

        assert probe.probe_file(str(fragment), init_path=str(init)) is None

    def test_probe_frames_combina_init_e_fragmento(self, monkeypatch, tmp_path):
        import json

        import stream_lens.adapters.outbound.containers.ffprobe_probe as mod

        init = tmp_path / "init.mp4"
        fragment = tmp_path / "segment.m4s"
        init.write_bytes(b"init")
        fragment.write_bytes(b"fragment")
        calls = []
        responses = [
            {
                "format": {"format_name": "mov,mp4"},
                "streams": [{"index": 0, "codec_type": "video"}],
            },
            {
                "frames": [
                    {
                        "stream_index": 0,
                        "pict_type": "I",
                        "key_frame": 1,
                        "pkt_size": "1800",
                        "pts": 0,
                        "pts_time": "0.000000",
                        "pkt_dts": 0,
                        "pkt_dts_time": "0.000000",
                    },
                    {
                        "stream_index": 0,
                        "pict_type": "B",
                        "key_frame": "0",
                        "pkt_size": "420",
                        "best_effort_timestamp": 3000,
                        "best_effort_timestamp_time": "0.033333",
                    },
                    {
                        "stream_index": 0,
                        "pict_type": "P",
                        "key_frame": 0,
                        "pkt_size": "700",
                        "pts": 6000,
                        "pts_time": "0.066667",
                    },
                    {
                        "stream_index": 0,
                        "pict_type": "I",
                        "key_frame": 1,
                        "pkt_size": "1700",
                        "pts": 9000,
                        "pts_time": "0.100000",
                    },
                ],
            },
        ]

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            payload = responses[len(calls) - 1]
            return subprocess.CompletedProcess(
                args=args,
                returncode=0,
                stdout=json.dumps(payload).encode(),
                stderr=b"",
            )

        monkeypatch.setattr(mod.shutil, "which", lambda _binary: "/fake/ffprobe")
        monkeypatch.setattr(mod.subprocess, "run", fake_run)

        probe = mod.FFprobeMediaProbe()
        result = probe.probe_file(
            str(fragment), init_path=str(init), include_frames=True
        )

        assert result is not None
        assert [frame["pict_type"] for frame in result["frames"]] == [
            "I",
            "B",
            "P",
            "I",
        ]
        assert [frame["key_frame"] for frame in result["frames"]] == [
            True,
            False,
            False,
            True,
        ]
        assert result["frames"][0]["pts"] == 0
        assert result["frames"][1]["pts"] == 3000
        assert result["frames_truncated"] is False
        assert result["gop"] == {
            "starts_with_key_frame": True,
            "first_key_frame_index": 0,
            "key_frame_count": 2,
            "i_frame_count": 2,
            "p_frame_count": 1,
            "b_frame_count": 1,
            "unknown_frame_count": 0,
            "intervals": [
                {
                    "start_frame_index": 0,
                    "next_key_frame_index": 3,
                    "frame_count": 3,
                    "duration_seconds": 0.1,
                }
            ],
            "trailing_gop": {
                "start_frame_index": 3,
                "observed_frame_count": 1,
                "observed_duration_seconds": None,
            },
            "truncated": False,
        }
        assert len(calls) == 2
        assert all(call[0][-1] == "pipe:0" for call in calls)
        assert all(call[1]["input"] == b"initfragment" for call in calls)
        assert "-show_frames" in calls[1][0]

    def test_resumo_preserva_cor_e_side_data_hdr_reconhecido(self):
        from stream_lens.adapters.outbound.containers.ffprobe_probe import _summarize

        probe = _summarize({
            "streams": [{
                "index": 0, "codec_type": "video", "color_primaries": "bt2020",
                "color_transfer": "smpte2084", "bits_per_raw_sample": "10",
                "level": 153, "pix_fmt": "yuv420p10le", "start_time": "1.5",
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
        assert stream["level"] == 153
        assert stream["pix_fmt"] == "yuv420p10le"
        assert stream["start_time"] == "1.5"
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
