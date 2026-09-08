import { describe, expect, it } from "vitest";
import { buildApp } from "../server.js";
import { LensClient } from "../lens-client.js";
import type { LensFetch } from "../lens-client.js";

const baseConfig = {
  host: "127.0.0.1",
  port: 0,
  lensUrl: "http://lens:8000",
  mockUrl: "http://mock:8080",
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
  return buildApp(baseConfig, { lensClient: lens });
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

  it("propagates lens 404 on detail", async () => {
    const app = appWithLens({ status: 404, body: { detail: "inspeção não encontrada" } });
    const response = await app.inject({ method: "GET", url: "/v1/inspections/missing" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("passes the snapshot through", async () => {
    const app = appWithLens({ status: 200, body: { schema_version: "1.13", source: {} } });
    const response = await app.inject({ method: "GET", url: "/v1/inspections/insp-1/snapshot" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schema_version: "1.13" });
    await app.close();
  });

  it("returns 502 when lens is unreachable", async () => {
    const lens = new LensClient("http://lens:8000", async () => {
      throw new Error("boom");
    });
    const app = buildApp(baseConfig, { lensClient: lens });
    const response = await app.inject({ method: "GET", url: "/v1/inspections/insp-1" });
    expect(response.statusCode).toBe(502);
    await app.close();
  });
});

describe("auth", () => {
  it("rejects requests without a bearer token when clerk is configured", async () => {
    const lens = new LensClient("http://lens:8000", lensStub({ status: 200, body: {} }));
    const app = buildApp(
      { ...baseConfig, clerkSecretKey: "sk_test_invalid" },
      { lensClient: lens },
    );
    const response = await app.inject({ method: "GET", url: "/v1/inspections/insp-1" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects an invalid bearer token when clerk is configured", async () => {
    const lens = new LensClient("http://lens:8000", lensStub({ status: 200, body: {} }));
    const app = buildApp(
      { ...baseConfig, clerkSecretKey: "sk_test_invalid" },
      { lensClient: lens },
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
