import { afterEach, describe, expect, it } from "vitest";
import { HealthResponseSchema } from "../contracts/health.js";
import { StartInvestigationResponseSchema } from "../contracts/investigation.js";
import { buildApiServer } from "./server.js";
import { formatInvestigationSseEvent } from "./routes/investigations.js";

const startInvestigation = async () => ({
  created: true,
  investigation: {
    id: "c56a4180-65aa-42ec-a945-5fd21dec0538",
    sourceUrl: "https://example.test/live/master.m3u8",
    state: "queued" as const,
    createdAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z",
  },
});

const investigationQueries = {
  getInvestigation: async (id: string) => id === "c56a4180-65aa-42ec-a945-5fd21dec0538"
    ? {
        id,
        sourceUrl: "https://example.test/live/master.m3u8",
        state: "queued" as const,
        createdAt: "2026-07-21T12:00:00.000Z",
        updatedAt: "2026-07-21T12:00:00.000Z",
      }
    : null,
  listEventsAfter: async () => [],
};

describe("GET /v1/health", () => {
  const servers: Array<ReturnType<typeof buildApiServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("reports a healthy database", async () => {
    const server = buildApiServer({
      database: { check: async () => undefined },
      startInvestigation,
      investigationQueries,
      version: "test",
    });
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/v1/health" });
    const body = HealthResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.database.status).toBe("up");
  });

  it("returns service unavailable when PostgreSQL is down", async () => {
    const server = buildApiServer({
      database: { check: async () => Promise.reject(new Error("offline")) },
      startInvestigation,
      investigationQueries,
    });
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/v1/health" });
    const body = HealthResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.database.status).toBe("down");
  });
});

describe("POST /v1/investigations", () => {
  it("accepts a valid request", async () => {
    const server = buildApiServer({
      database: { check: async () => undefined },
      startInvestigation,
      investigationQueries,
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/investigations",
      headers: { "idempotency-key": "request-1" },
      payload: {
        url: "https://example.test/live/master.m3u8",
        problemDescription: "Playback freezes.",
      },
    });
    const body = StartInvestigationResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(202);
    expect(body.investigation.state).toBe("queued");
    expect(body.replayed).toBe(false);
    await server.close();
  });

  it("rejects missing idempotency", async () => {
    const server = buildApiServer({
      database: { check: async () => undefined },
      startInvestigation,
      investigationQueries,
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/investigations",
      payload: { url: "https://example.test/live/master.m3u8" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_IDEMPOTENCY_KEY" } });
    await server.close();
  });
});

describe("investigation queries", () => {
  it("returns one persisted investigation", async () => {
    const server = buildApiServer({
      database: { check: async () => undefined },
      startInvestigation,
      investigationQueries,
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/investigations/c56a4180-65aa-42ec-a945-5fd21dec0538",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ investigation: { state: "queued" } });
    await server.close();
  });

  it("returns not found for an unknown investigation", async () => {
    const server = buildApiServer({
      database: { check: async () => undefined },
      startInvestigation,
      investigationQueries,
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/investigations/7d9d633e-3118-42e9-a4bb-2d917bbe3290",
    });

    expect(response.statusCode).toBe(404);
    await server.close();
  });

  it("formats replayable SSE events", () => {
    expect(formatInvestigationSseEvent({
      id: "42",
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      type: "investigation.state_changed",
      actor: "system",
      message: "Investigation created and queued.",
      payload: { state: "queued" },
      createdAt: "2026-07-21T12:00:00.000Z",
    })).toContain("id: 42\nevent: investigation.event\ndata:");
  });
});
