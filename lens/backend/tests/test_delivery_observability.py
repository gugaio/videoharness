"""Contrato da evidência de entrega HTTP e de uma leitura de playlist live."""

import asyncio
from datetime import UTC, datetime

from stream_lens.adapters.outbound.fetching.dispatching_segment_fetcher import (
    LocalFixtureSegmentFetcher,
)
from stream_lens.adapters.outbound.fetching.local_fixture_fetcher import LocalFixtureFetcher
from stream_lens.adapters.outbound.fetching.safe_http_segment_fetcher import SegmentHttpError
from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    _snapshot_from_dict,
    snapshot_to_dict,
)
from stream_lens.adapters.outbound.manifests.manifest_inspector import DeclarativeManifestInspector
from stream_lens.adapters.outbound.segments.capture_service import (
    CapturePlan,
    SegmentCaptureService,
)
from stream_lens.application.ports.manifest_fetcher import FetchedManifest
from stream_lens.domain.value_objects.manifest_summary import ManifestSummary
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol
from stream_lens.domain.value_objects.segments import (
    CapturedSegment,
    DeliveryObservation,
    DeliveryReport,
    PlannedSegment,
)
from stream_lens.domain.value_objects.snapshot import Snapshot, SourceInfo
from tests.conftest import FIXTURES_ROOT, FrozenClock


def test_hls_live_expoe_borda_somente_com_program_date_time():
    clock = FrozenClock(datetime(2026, 1, 1, 0, 0, 20, tzinfo=UTC))
    service = SegmentCaptureService(
        LocalFixtureFetcher(FIXTURES_ROOT), LocalFixtureSegmentFetcher(FIXTURES_ROOT), clock
    )
    text = """#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:12
#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:08Z
#EXTINF:4.0,
one.ts
#EXTINF:4.0,
two.ts
"""
    media = DeclarativeManifestInspector().inspect(text)
    fetched = FetchedManifest(
        url="https://cdn.example/live.m3u8?token=secret",
        text=text,
        delivery=DeliveryObservation(http_status=200, ttfb_ms=12, download_duration_ms=20),
    )

    plan = asyncio.run(service.plan(media, fetched.url, root_fetched=fetched))

    assert len(plan.live_playlists) == 1
    observation = plan.live_playlists[0]
    assert observation.media_sequence == 12
    assert observation.last_segment_sequence == 13
    assert observation.playlist_window_duration_seconds == 8.0
    assert observation.live_edge_program_date_time == datetime(
        2026, 1, 1, 0, 0, 16, tzinfo=UTC
    )
    assert observation.live_edge_distance_seconds == 4.0
    assert observation.advancement == "not measured (single playlist observation)"


def test_hls_live_mede_avanco_com_segunda_leitura_da_mesma_playlist():
    first = """#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:12
#EXTINF:4,
one.ts
"""
    second = first.replace("MEDIA-SEQUENCE:12", "MEDIA-SEQUENCE:14")

    class SequentialFetcher:
        calls = 0

        async def fetch(self, url):
            self.calls += 1
            return FetchedManifest(url=url, text=second)

    fetcher = SequentialFetcher()
    service = SegmentCaptureService(
        fetcher, LocalFixtureSegmentFetcher(FIXTURES_ROOT), FrozenClock()
    )
    media = DeclarativeManifestInspector().inspect(first)
    root = FetchedManifest(url="https://cdn.example/live.m3u8", text=first)
    plan = asyncio.run(service.plan(media, root.url, root_fetched=root))

    asyncio.run(service.observe_live_advancement(plan))

    assert len(plan.live_playlists) == 2
    assert plan.live_playlists[0].advancement == "not measured (single playlist observation)"
    assert plan.live_playlists[1].media_sequence == 14
    assert plan.live_playlists[1].advancement == "live edge advanced by 2 segments"
    assert plan.live_playlists[1].live_edge_advance_segments == 2
    assert plan.live_playlists[1].window_shift_segments == 2


def test_hls_live_separa_deslocamento_da_janela_do_avanco_da_borda():
    first = """#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:12
#EXTINF:4,
one.ts
#EXTINF:4,
two.ts
"""
    second = first.replace("MEDIA-SEQUENCE:12", "MEDIA-SEQUENCE:13").replace(
        "one.ts\n", ""
    )

    class Fetcher:
        async def fetch(self, url):
            return FetchedManifest(url=url, text=second)

    service = SegmentCaptureService(
        Fetcher(), LocalFixtureSegmentFetcher(FIXTURES_ROOT), FrozenClock()
    )
    root = FetchedManifest(url="https://cdn.example/live.m3u8", text=first)
    plan = asyncio.run(
        service.plan(
            DeclarativeManifestInspector().inspect(first), root.url, root_fetched=root
        )
    )

    asyncio.run(service.observe_live_advancement(plan))

    second_read = plan.live_playlists[1]
    assert second_read.advancement == "live edge unchanged between observations"
    assert second_read.live_edge_advance_segments == 0
    assert second_read.window_shift_segments == 1


def test_delivery_roundtrip_redige_urls_e_mantem_ausencia_de_evidencia():
    segment = CapturedSegment(
        rep_id="v1", group_kind="video", uri="https://cdn.example/s1.m4s?sig=secret",
        index=1, is_init=False, byte_size=100, http_status=200,
        delivery=DeliveryObservation(http_status=200, ttfb_ms=7, download_duration_ms=10),
    )
    snapshot = Snapshot(
        schema_version="1.10", analyzer_version="1.2.0", inspection_id="delivery-test",
        created_at=datetime(2026, 1, 1, tzinfo=UTC), expires_at=datetime(2026, 1, 1, 1, tzinfo=UTC),
        source=SourceInfo("https://cdn.example/master.m3u8", "HLS", False),
        manifest=ManifestSummary(Protocol.HLS, ManifestKind.HLS_MEDIA_PLAYLIST, False),
        segments=(segment,),
        delivery=DeliveryReport(
            manifest_requests=(("https://cdn.example/master.m3u8?sig=secret", None),)
        ),
    )

    payload = snapshot_to_dict(snapshot)

    assert "secret" not in str(payload)
    assert payload["segments"][0]["delivery"]["ttfb_ms"] == 7
    assert payload["delivery"]["manifest_requests"][0]["delivery"] is None
    restored = _snapshot_from_dict(payload)
    assert restored.segments[0].uri == "https://cdn.example/s1.m4s"
    assert restored.delivery is not None
    assert restored.delivery.manifest_requests[0][0] == "https://cdn.example/master.m3u8"
    assert restored.segments[0].delivery == segment.delivery


def test_captura_persiste_status_http_de_segmento_que_falhou(tmp_path):
    class FailingFetcher:
        async def fetch(self, _url, _byte_range=None):
            raise SegmentHttpError(
                "HTTP 503 ao obter segmento",
                DeliveryObservation(http_status=503, download_duration_ms=21),
            )

    service = SegmentCaptureService(
        LocalFixtureFetcher(FIXTURES_ROOT), FailingFetcher(), FrozenClock()
    )
    plan = CapturePlan(
        planned=[PlannedSegment("v1", "video", "https://cdn.example/s1.m4s", 1)]
    )

    captured = asyncio.run(service.capture("delivery-failure", plan, tmp_path))

    assert captured[0].ok is False
    assert captured[0].http_status == 503
    assert captured[0].delivery is not None
    assert captured[0].delivery.http_status == 503
