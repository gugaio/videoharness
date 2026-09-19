"""Testes do parser puro de playlist de mídia HLS usado pela captura."""

from __future__ import annotations

from stream_lens.parsers.hls_playlist import parse_hls_media_playlist


def test_media_sequence_e_segmentos_declarados():
    playlist = parse_hls_media_playlist(
        "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:372661281\n"
        "#EXTINF:4.800,\na.ts\n#EXTINF:4.800,\nb.ts\n"
    )

    assert playlist.is_endlist is False
    assert playlist.media_sequence == 372661281
    assert playlist.target_duration == 5
    assert [segment.uri for segment in playlist.segments] == ["a.ts", "b.ts"]
    assert all(segment.duration_seconds == 4.8 for segment in playlist.segments)
    assert playlist.init_segment is None


def test_byterange_explicito_e_relativo_acumula_offset():
    playlist = parse_hls_media_playlist(
        "#EXTM3U\n#EXT-X-TARGETDURATION:5\n"
        "#EXTINF:4.0,\n#EXT-X-BYTERANGE:1000@0\nseg.ts\n"
        "#EXTINF:4.0,\n#EXT-X-BYTERANGE:1000\nseg.ts\n"
        "#EXT-X-ENDLIST\n"
    )

    assert playlist.is_endlist is True
    assert [segment.byte_range for segment in playlist.segments] == [
        (0, 1000),
        (1000, 1000),
    ]


def test_init_segment_com_byterange():
    playlist = parse_hls_media_playlist(
        "#EXTM3U\n#EXT-X-TARGETDURATION:5\n"
        '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"\n'
        "#EXTINF:4.0,\nseg.ts\n"
    )

    assert playlist.init_segment is not None
    assert playlist.init_segment.uri == "init.mp4"
    assert playlist.init_segment.byte_range == (0, 720)


def test_discontinuity_marcada_no_segmento():
    playlist = parse_hls_media_playlist(
        "#EXTM3U\n#EXT-X-TARGETDURATION:5\n"
        "#EXTINF:4.0,\nseg-0.ts\n"
        "#EXT-X-DISCONTINUITY\n#EXTINF:4.0,\nseg-1.ts\n"
    )

    assert [segment.discontinuity for segment in playlist.segments] == [False, True]
