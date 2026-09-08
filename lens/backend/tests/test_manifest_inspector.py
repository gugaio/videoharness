"""Testes do inspetor declarativo: modelo unificado + paridade HLS/DASH."""

import hashlib

import pytest

from stream_lens.adapters.outbound.manifests.manifest_inspector import (
    DeclarativeManifestInspector,
    UnsupportedManifestError,
)
from stream_lens.adapters.outbound.manifests.serialization import (
    media_from_dict,
    media_to_dict,
)
from stream_lens.domain.value_objects.manifest_summary import summary_from_unified
from stream_lens.domain.value_objects.media import MediaKind
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol

inspector = DeclarativeManifestInspector()

MASTER = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="pt",LANGUAGE="pt",URI="audio/pt.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud",FRAME-RATE=30.000
video/360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud"
video/720p.m3u8
"""

MEDIA_VOD = """#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
seg-0.ts
#EXTINF:4.000,
seg-1.ts
#EXT-X-ENDLIST
"""

MEDIA_LIVE = MEDIA_VOD.replace("#EXT-X-ENDLIST\n", "")

MPD_STATIC = (
    '<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT12S">'
    "<Period><AdaptationSet><Representation/></AdaptationSet>"
    "<AdaptationSet><Representation/></AdaptationSet></Period></MPD>"
)

MPD_DYNAMIC = '<MPD type="dynamic"><Period></Period></MPD>'

# paridade: mesmo conteúdo declarado nos dois protocolos
MPD_PARITY = """<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT12S">
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="v360" bandwidth="800000" width="640" height="360"
        codecs="avc1.64001e" frameRate="30"/>
      <Representation id="v720" bandwidth="2000000" width="1280" height="720" codecs="avc1.64001f"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" lang="pt">
      <Representation id="apt" bandwidth="128000" codecs="mp4a.40.2" audioSamplingRate="48000"/>
    </AdaptationSet>
  </Period>
</MPD>
"""


class TestSummaryDerivation:
    def test_hls_master(self):
        summary = summary_from_unified(inspector.inspect(MASTER))
        assert summary.protocol is Protocol.HLS
        assert summary.kind is ManifestKind.HLS_MASTER_PLAYLIST
        assert summary.is_live is False
        assert summary.variant_count == 2
        assert summary.rendition_count == 1
        assert summary.segment_count is None  # não coletado neste kind

    def test_hls_media_vod(self):
        summary = summary_from_unified(inspector.inspect(MEDIA_VOD))
        assert summary.kind is ManifestKind.HLS_MEDIA_PLAYLIST
        assert summary.is_live is False
        assert summary.segment_count == 2

    def test_hls_media_live_sem_endlist(self):
        assert inspector.inspect(MEDIA_LIVE).is_live is True

    def test_dash_estatico(self):
        media = inspector.inspect(MPD_STATIC)
        summary = summary_from_unified(media)
        assert summary.protocol is Protocol.DASH
        assert summary.kind is ManifestKind.DASH_MPD
        assert summary.is_live is False
        # representations mínimas continuam sendo declarações contáveis
        assert summary.variant_count == 2

    def test_dash_dinamico(self):
        assert inspector.inspect(MPD_DYNAMIC).is_live is True

    def test_dash_com_bom_e_prefixo_de_namespace(self):
        mpd = (
            "\ufeff<dash:MPD xmlns:dash=\"urn:mpeg:dash:schema:mpd:2011\">"
            "<dash:Period/></dash:MPD>"
        )
        assert inspector.inspect(mpd).protocol == Protocol.DASH.value

    def test_conteudo_desconhecido(self):
        with pytest.raises(UnsupportedManifestError):
            inspector.inspect("<html><body>not a manifest</body></html>")

    def test_mpd_malformado(self):
        with pytest.raises(UnsupportedManifestError):
            inspector.inspect("<wrapper><MPD/></wrapper>")


class TestUnifiedModelHls:
    def test_master_grupos_e_representacoes(self):
        media = inspector.inspect(MASTER)
        groups = {g.kind: g for g in media.track_groups}
        assert set(groups) == {MediaKind.AUDIO, MediaKind.VIDEO}
        video = groups[MediaKind.VIDEO]
        reps = video.representations
        assert [r.bandwidth_bps for r in reps] == [800_000, 2_000_000]
        assert reps[0].codecs == "avc1.64001e,mp4a.40.2"
        assert (reps[0].resolution.width, reps[0].resolution.height) == (640, 360)
        assert reps[0].frame_rate == 30.0
        audio = groups[MediaKind.AUDIO]
        assert audio.name == "aud"
        assert audio.representations[0].language == "pt"
        assert audio.representations[0].uri == "audio/pt.m3u8"

    def test_media_playlist_segmentos_declarados(self):
        media = inspector.inspect(MEDIA_VOD)
        rep = media.track_groups[0].representations[0]
        assert rep.segment_count_declared == 2
        assert [s.uri for s in rep.segments] == ["seg-0.ts", "seg-1.ts"]
        assert all(s.duration_seconds == 4.0 for s in rep.segments)
        assert rep.init_segment is None  # TS puro: sem EXT-X-MAP
        assert media.protocol_specific["hls"]["container"] == "mpeg-ts"

    def test_capabilities_hls(self):
        caps = inspector.inspect(MEDIA_VOD).capabilities
        assert caps["segment_download"].status.value == "not_collected"
        assert caps["segment_download"].reason  # motivo explícito


class TestUnifiedModelDash:
    def test_mpd_grupos_e_representacoes(self):
        media = inspector.inspect(MPD_PARITY)
        groups = {g.kind: g for g in media.track_groups}
        assert set(groups) == {MediaKind.VIDEO, MediaKind.AUDIO}
        video = groups[MediaKind.VIDEO]
        assert [r.id for r in video.representations] == ["v360", "v720"]
        v360 = video.representations[0]
        assert v360.codecs == "avc1.64001e"
        assert v360.bandwidth_bps == 800_000
        assert (v360.resolution.width, v360.resolution.height) == (640, 360)
        assert v360.frame_rate == 30.0
        audio = groups[MediaKind.AUDIO]
        assert audio.language == "pt"
        assert audio.representations[0].audio_sampling_rate == 48000

    def test_segment_template_herdado_do_adaptation_set(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
          <Period>
            <AdaptationSet contentType="video">
              <SegmentTemplate timescale="1000" duration="4000"
                initialization="init_$RepresentationID$.mp4"
                media="$RepresentationID$/$Number$.m4s" startNumber="1"/>
              <Representation id="v1" bandwidth="100000" codecs="avc1.64001e"/>
            </AdaptationSet>
          </Period>
        </MPD>"""
        rep = inspector.inspect(mpd).track_groups[0].representations[0]
        assert rep.init_segment is not None
        assert rep.init_segment.uri == "init_v1.mp4"
        assert rep.init_segment.timescale == 1000
        assert len(rep.segments) == 1  # template declarado, não enumerado
        seg = rep.segments[0]
        assert seg.template == "v1/$Number$.m4s"
        assert seg.template_duration == 4000

    def test_segment_timeline_resolve_time_e_expande_repeticoes(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
          <Period duration="PT13S">
            <AdaptationSet contentType="video">
              <SegmentTemplate timescale="1000" startNumber="5"
                initialization="init-$RepresentationID$.mp4"
                media="$RepresentationID$-$Time$-$Number$.m4s">
                <SegmentTimeline>
                  <S t="900" d="4000" r="1"/>
                  <S d="5000"/>
                </SegmentTimeline>
              </SegmentTemplate>
              <Representation id="v1" bandwidth="100000"/>
            </AdaptationSet>
          </Period>
        </MPD>"""
        rep = inspector.inspect(mpd).track_groups[0].representations[0]
        assert [segment.uri for segment in rep.segments] == [
            "v1-900-5.m4s",
            "v1-4900-6.m4s",
            "v1-8900-7.m4s",
        ]
        assert [segment.start_number for segment in rep.segments] == [5, 6, 7]
        assert [segment.template_duration for segment in rep.segments] == [
            4000,
            4000,
            5000,
        ]
        assert rep.segment_count_declared == 3
        assert rep.total_duration_seconds == 13.0

    def test_segment_timeline_r_negativo_usa_proximo_t_ou_fim_do_period(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
          <Period duration="PT20S">
            <AdaptationSet contentType="video">
              <SegmentTemplate timescale="1" presentationTimeOffset="4"
                media="$Time$.m4s">
                <SegmentTimeline>
                  <S t="4" d="4" r="-1"/>
                  <S t="16" d="2" r="-1"/>
                </SegmentTimeline>
              </SegmentTemplate>
              <Representation id="v1"/>
            </AdaptationSet>
          </Period>
        </MPD>"""
        media = inspector.inspect(mpd)
        rep = media.track_groups[0].representations[0]
        assert [segment.uri for segment in rep.segments] == [
            "4.m4s",
            "8.m4s",
            "12.m4s",
            "16.m4s",
            "18.m4s",
            "20.m4s",
            "22.m4s",
        ]
        assert rep.segment_count_declared == 7
        assert not media.warnings

    def test_base_url_da_representacao_vira_segmento_unico(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"
          mediaPresentationDuration="PT12S">
          <BaseURL>assets/</BaseURL>
          <Period><AdaptationSet contentType="text">
            <Representation id="caption" bandwidth="1000">
              <BaseURL>caption.vtt</BaseURL>
            </Representation>
          </AdaptationSet></Period>
        </MPD>"""
        rep = inspector.inspect(mpd).track_groups[0].representations[0]
        assert rep.uri == "assets/caption.vtt"
        assert rep.segment_count_declared == 1
        assert rep.total_duration_seconds == 12.0

    def test_content_protection_mapeada(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
          xmlns:cenc="urn:mpeg:cenc:2013" type="static">
          <Period id="p0">
          <ContentProtection schemeIdUri="urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b"/>
          <AdaptationSet id="video" contentType="video">
            <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"
              value="cenc" cenc:default_KID="{11111111-2222-3333-4444-555555555555}"/>
            <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed">
              <cenc:pssh>cHNzaC1kYXRh</cenc:pssh>
            </ContentProtection>
            <Representation id="v1" bandwidth="100000">
              <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/>
            </Representation>
          </AdaptationSet></Period>
        </MPD>"""
        media = inspector.inspect(mpd)
        assert [d.system for d in media.drm_systems] == [
            "common-pssh",
            "mp4-protection",
            "widevine",
            "playready",
        ]
        assert [item.scope for item in media.dash_drm] == [
            "period",
            "adaptation_set",
            "adaptation_set",
            "representation",
        ]
        assert media.dash_drm[1].default_kids == (
            "11111111-2222-3333-4444-555555555555",
        )
        assert media.dash_drm[0].period_id == "p0"
        assert media.dash_drm[1].adaptation_set_id == "video"
        assert media.dash_drm[3].representation_id == "v1"

        pssh = media.dash_drm[2].pssh[0]
        assert pssh.encoded_length == 12
        assert pssh.decoded_size == 9
        assert pssh.sha256 == hashlib.sha256(b"pssh-data").hexdigest()
        assert pssh.status == "valid"

        payload = media_to_dict(media)
        assert "cHNzaC1kYXRh" not in str(payload)
        assert media_from_dict(payload) == media

    @pytest.mark.parametrize(
        ("scheme", "expected"),
        [
            ("urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2", "fairplay"),
            ("urn:uuid:f239e769-efa3-4850-9c16-a903c6932efb", "adobe-primetime"),
        ],
    )
    def test_uuid_drm_mapeado_sem_confundir_sistemas(self, scheme, expected):
        mpd = f"""<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
          <Period><AdaptationSet contentType="video">
            <ContentProtection schemeIdUri="{scheme}"/>
            <Representation id="v1" bandwidth="100000"/>
          </AdaptationSet></Period>
        </MPD>"""
        assert inspector.inspect(mpd).dash_drm[0].system == expected

    def test_content_protection_pssh_invalido_nao_quebra_parser(self):
        mpd = """<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
          xmlns:cenc="urn:mpeg:cenc:2013" type="static">
          <Period><AdaptationSet contentType="video">
            <ContentProtection schemeIdUri="https://drm.example/system?token=secret">
              <cenc:pssh>not!base64</cenc:pssh>
            </ContentProtection>
            <Representation id="v1" bandwidth="100000"/>
          </AdaptationSet></Period>
        </MPD>"""
        media = inspector.inspect(mpd)
        declaration = media.dash_drm[0]
        assert declaration.scheme_id_uri == "https://drm.example/system"
        assert declaration.pssh[0].status == "invalid_base64"
        assert declaration.pssh[0].decoded_size is None
        assert declaration.pssh[0].sha256 is None

    def test_capabilities_dash(self):
        caps = inspector.inspect(MPD_PARITY).capabilities
        assert caps["segment_timeline"].status.value == "not_applicable"


class TestParidadeHlsDash:
    """Mesmo conteúdo declarado nos dois protocolos deve produzir o mesmo
    modelo unificado (groups/kinds/bandwidth/resolução), diferindo apenas
    em protocol_specific e capabilities."""

    def test_pares_de_grupo_e_ladder_equivalentes(self):
        hls = inspector.inspect(MASTER)
        dash = inspector.inspect(MPD_PARITY)

        def ladder(media):
            for g in media.track_groups:
                if g.kind is MediaKind.VIDEO:
                    return sorted(
                        (r.resolution.width, r.resolution.height, r.bandwidth_bps)
                        for r in g.representations
                    )
            return None

        assert ladder(hls) == ladder(dash)
        audio_hls = next(g for g in hls.track_groups if g.kind is MediaKind.AUDIO)
        audio_dash = next(g for g in dash.track_groups if g.kind is MediaKind.AUDIO)
        assert audio_hls.representations[0].language == audio_dash.language

        # protocol_specific nunca é forjado como equivalente
        assert set(hls.protocol_specific) == {"hls"}
        assert set(dash.protocol_specific) == {"dash"}
