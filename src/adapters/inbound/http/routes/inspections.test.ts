import { describe, expect, it } from "vitest";
import { buildApp } from "../../../../infrastructure/server.js";
import { LensClient } from "../../../outbound/lens/lens-client.js";
import type { LensFetch } from "../../../outbound/lens/lens-client.js";
import { InspectionHistoryStore } from "../../../outbound/sqlite/inspection-history-store.js";

const baseConfig = {
  host: "127.0.0.1",
  port: 0,
  lensUrl: "http://lens:8000",
  mockUrl: "http://mock:8080",
  mockPublicUrl: "http://127.0.0.1:8081",
  serviceToken: "test-token",
};

function lensStub(response: { status: number; body: unknown }): LensFetch {
  return async () =>
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
}

function appWithLens(lensResponse: { status: number; body: unknown }) {
  const lens = new LensClient("http://lens:8000", lensStub(lensResponse));
  return buildApp(baseConfig, { inspectionEngine: lens });
}

function historyWithInspection(): InspectionHistoryStore {
  const history = new InspectionHistoryStore(":memory:");
  history.create("dev-user", "https://example.com/master.m3u8", {
    inspection_id: "insp-1",
    status: "queued",
    status_url: "/api/v1/inspections/insp-1",
    view_url: "/inspect/insp-1",
    expires_at: "2026-09-08T00:00:00Z",
  });
  return history;
}

describe("inspection routes (dev-mode auth)", () => {
  it("creates an inspection through the lens", async () => {
    const app = appWithLens({
      status: 202,
      body: {
        inspection_id: "insp-1",
        status: "queued",
        status_url: "/api/v1/inspections/insp-1",
        view_url: "/inspect/insp-1",
        expires_at: "2026-09-08T00:00:00Z",
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/inspections",
      payload: { url: "https://example.com/master.m3u8" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ inspection_id: "insp-1", status: "queued" });
    const list = await app.inject({ method: "GET", url: "/v1/inspections" });
    expect(list.json()).toMatchObject({
      inspections: [{ inspection_id: "insp-1", source_url: "https://example.com/master.m3u8" }],
    });
    await app.close();
  });

  it("rejects a body without url", async () => {
    const app = appWithLens({ status: 202, body: {} });
    const response = await app.inject({
      method: "POST",
      url: "/v1/inspections",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("redacts query credentials in persisted history", async () => {
    const app = appWithLens({
      status: 202,
      body: {
        inspection_id: "insp-1",
        status: "queued",
        status_url: "/api/v1/inspections/insp-1",
        view_url: "/inspect/insp-1",
        expires_at: "2026-09-08T00:00:00Z",
      },
    });
    await app.inject({
      method: "POST",
      url: "/v1/inspections",
      payload: { url: "https://example.com/master.m3u8?token=secret" },
    });
    const response = await app.inject({ method: "GET", url: "/v1/inspections" });
    expect(response.json()).toMatchObject({
      inspections: [{ source_url: "https://example.com/master.m3u8?token=REDACTED" }],
    });
    await app.close();
  });

  it("deletes an inspection from the owner history", async () => {
    const history = historyWithInspection();
    const app = buildApp(baseConfig, { inspectionRepository: history });
    const response = await app.inject({ method: "DELETE", url: "/v1/inspections/insp-1" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(history.has("dev-user", "insp-1")).toBe(false);
    const list = await app.inject({ method: "GET", url: "/v1/inspections" });
    expect(list.json()).toMatchObject({ inspections: [] });
    await app.close();
  });

  it("returns 404 when deleting an inspection the owner does not have", async () => {
    const history = historyWithInspection();
    const app = buildApp(baseConfig, { inspectionRepository: history });
    const response = await app.inject({ method: "DELETE", url: "/v1/inspections/missing" });
    expect(response.statusCode).toBe(404);
    expect(history.has("dev-user", "insp-1")).toBe(true);
    await app.close();
  });

  it("propagates lens 404 on detail", async () => {
    const history = historyWithInspection();
    const app = buildApp(baseConfig, {
      inspectionEngine: new LensClient("http://lens:8000", lensStub({ status: 404, body: { detail: "inspeção não encontrada" } })),
      inspectionRepository: history,
    });
    const response = await app.inject({ method: "GET", url: "/v1/inspections/insp-1" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("passes the snapshot through", async () => {
    const history = historyWithInspection();
    const app = buildApp(baseConfig, {
      inspectionEngine: new LensClient("http://lens:8000", lensStub({ status: 200, body: { schema_version: "1.13", source: {} } })),
      inspectionRepository: history,
    });
    const response = await app.inject({ method: "GET", url: "/v1/inspections/insp-1/snapshot" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schema_version: "1.13" });
    expect(history.getSnapshot("dev-user", "insp-1")).toMatchObject({ schema_version: "1.13" });
    await app.close();
  });

  it("returns 502 when lens is unreachable", async () => {
    const lens = new LensClient("http://lens:8000", async () => {
      throw new Error("boom");
    });
    const app = buildApp(baseConfig, { inspectionEngine: lens, inspectionRepository: historyWithInspection() });
    const response = await app.inject({ method: "GET", url: "/v1/inspections/insp-1" });
    expect(response.statusCode).toBe(502);
    await app.close();
  });

  it("serves an archived terminal detail when the Lens record has expired", async () => {
    const history = historyWithInspection();
    history.updateDetail("dev-user", {
      inspection_id: "insp-1",
      status: "completed",
      created_at: "2026-09-08T00:00:00Z",
      expires_at: "2026-09-08T01:00:00Z",
    });
    const lens = new LensClient("http://lens:8000", async () => {
      throw new Error("expired");
    });
    const app = buildApp(baseConfig, { inspectionEngine: lens, inspectionRepository: history });
    const response = await app.inject({ method: "GET", url: "/v1/inspections/insp-1" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "completed" });
    await app.close();
  });
});

describe("auth", () => {
  it("rejects requests without a bearer token when clerk is configured", async () => {
    const lens = new LensClient("http://lens:8000", lensStub({ status: 200, body: {} }));
    const app = buildApp(
      { ...baseConfig, clerkSecretKey: "sk_test_invalid" },
      { inspectionEngine: lens },
    );
    const response = await app.inject({ method: "GET", url: "/v1/inspections/insp-1" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects an invalid bearer token when clerk is configured", async () => {
    const lens = new LensClient("http://lens:8000", lensStub({ status: 200, body: {} }));
    const app = buildApp(
      { ...baseConfig, clerkSecretKey: "sk_test_invalid" },
      { inspectionEngine: lens },
    );
    const response = await app.inject({
      method: "GET",
      url: "/v1/inspections/insp-1",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("keeps health open even with clerk configured", async () => {
    const app = buildApp({ ...baseConfig, clerkSecretKey: "sk_test_invalid" });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
