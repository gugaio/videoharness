"""Testes de integração da API FastAPI (httpx ASGI, sem internet externa).

O POST é assíncrono: a resposta é 202/queued e o job roda como task asyncio
no mesmo loop do teste; fazemos polling até estado terminal.
"""

import asyncio
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from stream_lens.adapters.inbound.http.app import create_app
from stream_lens.bootstrap import build_container
from tests.conftest import FrozenClock, SequentialIdGenerator

TERMINAL = {"completed", "partial", "failed"}


@pytest.fixture
def app(tmp_path, fixtures_root, frozen_clock):
    container = build_container(
        workspace=tmp_path / "workspace",
        fixtures_root=fixtures_root,
        clock=frozen_clock,
        ids=SequentialIdGenerator(),
        ttl_seconds=600,
        allow_loopback=True,
    )
    return create_app(container)


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _wait_terminal(client: AsyncClient, inspection_id: str, timeout: float = 5.0) -> dict:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        response = await client.get(f"/api/v1/inspections/{inspection_id}")
        assert response.status_code == 200
        body = response.json()
        if body["status"] in TERMINAL:
            return body
        await asyncio.sleep(0.01)
    raise AssertionError("inspeção não chegou a estado terminal a tempo")


class TestHealth:
    async def test_health(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    async def test_ready(self, client):
        response = await client.get("/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}

    async def test_openapi_disponivel(self, client):
        response = await client.get("/openapi.json")
        assert response.status_code == 200
        spec = response.json()
        assert "/api/v1/inspections" in spec["paths"]
        assert spec["info"]["title"] == "Stream Lens"


class TestCreateInspectionAsync:
    async def test_fluxo_hls_202_polling_snapshot(self, client):
        created = await client.post(
            "/api/v1/inspections", json={"url": "fixture://hls-ts/master.m3u8"}
        )
        assert created.status_code == 202
        body = created.json()
        assert body["status"] == "queued"
        assert body["status_url"] == f"/api/v1/inspections/{body['inspection_id']}"
        assert body["view_url"] == f"/inspect/{body['inspection_id']}"
        assert body["expires_at"]

        detail = await _wait_terminal(client, body["inspection_id"])
        assert detail["status"] == "completed"
        assert detail["protocol"] == "HLS"
        assert detail["manifest"]["variant_count"] == 2

        snapshot = await client.get(detail["snapshot_url"])
        assert snapshot.status_code == 200
        snap = snapshot.json()
        assert snap["schema_version"] == "1.14"
        assert snap["source"]["display_url"] == "fixture://hls-ts/master.m3u8"

    async def test_cobertura_e_captura_seletiva_preservam_o_baseline(self, client):
        created = await client.post(
            "/api/v1/inspections", json={"url": "fixture://hls-ts/master.m3u8"}
        )
        inspection_id = created.json()["inspection_id"]
        await _wait_terminal(client, inspection_id)
        baseline_before = (await client.get(f"/api/v1/inspections/{inspection_id}/snapshot")).json()

        coverage = await client.post(
            f"/api/v1/inspections/{inspection_id}/coverage",
            json={"source_url": "fixture://hls-ts/master.m3u8"},
        )
        assert coverage.status_code == 200
        candidates = [item for item in coverage.json()["coverage"] if not item["is_init"]]
        assert candidates
        selected = candidates[-1]
        assert selected["segment_ref"].startswith("seg_")

        capture_id = str(uuid4())
        submitted = await client.post(
            f"/api/v1/inspections/{inspection_id}/captures/{capture_id}",
            json={
                "source_url": "fixture://hls-ts/master.m3u8",
                "segment_refs": [selected["segment_ref"]],
                "max_bytes": 100_000,
                "max_segments": 4,
            },
        )
        assert submitted.status_code == 202

        for _ in range(100):
            status = await client.get(
                f"/api/v1/inspections/{inspection_id}/captures/{capture_id}"
            )
            if status.json()["status"] in {"completed", "partial", "failed"}:
                break
            await asyncio.sleep(0.01)
        assert status.json()["status"] == "completed"
        assert status.json()["bytes_received"] > 0

        evidence = await client.get(
            f"/api/v1/inspections/{inspection_id}/captures/{capture_id}/evidence"
        )
        assert evidence.status_code == 200
        assert len(evidence.json()["segments"]) == 1
        assert evidence.json()["segments"][0]["segment_ref"] == selected["segment_ref"]
        baseline_after = (await client.get(f"/api/v1/inspections/{inspection_id}/snapshot")).json()
        assert baseline_after == baseline_before

    async def test_fluxo_dash(self, client):
        created = await client.post(
            "/api/v1/inspections", json={"url": "fixture://dash-mpd/stream.mpd"}
        )
        detail = await _wait_terminal(client, created.json()["inspection_id"])
        assert detail["protocol"] == "DASH"

    async def test_url_invalida_400(self, client):
        for url in ("ftp://x/y", "http://user:pass@h/m.m3u8", "https://h/#f"):
            response = await client.post("/api/v1/inspections", json={"url": url})
            assert response.status_code == 400, url

    async def test_url_vazia_422(self, client):
        response = await client.post("/api/v1/inspections", json={"url": ""})
        assert response.status_code == 422


class TestGetInspection:
    async def test_inspecao_inexistente_404(self, client):
        response = await client.get("/api/v1/inspections/00000000-0000-0000-0000-00000000dead")
        assert response.status_code == 404

    async def test_inspecao_expirada_410(self, client, frozen_clock: FrozenClock):
        created = await client.post(
            "/api/v1/inspections", json={"url": "fixture://hls-ts/master.m3u8"}
        )
        await _wait_terminal(client, created.json()["inspection_id"])
        frozen_clock.advance(601)
        inspection_id = created.json()["inspection_id"]
        assert (await client.get(f"/api/v1/inspections/{inspection_id}")).status_code == 410
        assert (
            await client.get(f"/api/v1/inspections/{inspection_id}/snapshot")
        ).status_code == 410

    async def test_snapshot_antes_do_fim_404_informativo(self, client):
        # job síncrono rápido: usamos uma inspeção failed (sem snapshot)
        created = await client.post(
            "/api/v1/inspections", json={"url": "fixture://hls-ts/nao-existe.m3u8"}
        )
        detail = await _wait_terminal(client, created.json()["inspection_id"])
        assert detail["status"] == "failed"
        assert detail["error_stage"] == "fetching_manifest"
        assert detail["error_message"]
        response = await client.get(detail["snapshot_url"])
        assert response.status_code == 404
