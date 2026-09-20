import { describe, expect, it } from "vitest";
import { buildApp } from "./server.js";

const config = {
  host: "127.0.0.1",
  port: 0,
  lensUrl: "http://lens:8000",
  mockUrl: "http://mock:8080",
  mockPublicUrl: "http://127.0.0.1:8081",
  serviceToken: "test-token",
};

describe("server", () => {
  it("reports health", async () => {
    const app = buildApp(config);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("exposes configured service URLs", async () => {
    const app = buildApp(config);
    const response = await app.inject({ method: "GET", url: "/v1/services" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      lens: { url: "http://lens:8000" },
      mock: { url: "http://mock:8080" },
    });
    await app.close();
  });
});
