import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HealthResponseSchema } from "../contracts/health.js";
import { StartInvestigationResponseSchema } from "../contracts/investigation.js";
import { buildApiServer } from "./server.js";
import { formatInvestigationSseEvent } from "./routes/investigations.js";
import { formatRecordingSseEvent } from "./routes/recordings.js";
import { FilesystemRecordingStore } from "../record/adapters/filesystem-recording-store.js";

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
  getReport: async (id: string) => id === "c56a4180-65aa-42ec-a945-5fd21dec0538"
    ? {
        id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
        investigationId: id,
        schemaVersion: 1,
        content: {
          placeholder: true as const,
          title: "Investigation lifecycle validated",
          summary: "Lifecycle complete.",
          findings: [],
          confidence: { level: "not_assessed" as const, explanation: "Evidence is not available." },
          generatedBy: "phase-1-lifecycle-fixture" as const,
        },
        createdAt: "2026-07-21T12:00:00.000Z",
        updatedAt: "2026-07-21T12:00:00.000Z",
      }
    : null,
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

  it("returns the persisted report", async () => {
    const server = buildApiServer({
      database: { check: async () => undefined },
      startInvestigation,
      investigationQueries,
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/investigations/c56a4180-65aa-42ec-a945-5fd21dec0538/report",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ report: { content: { placeholder: true } } });
    await server.close();
  });

  it("returns an empty AI prompt audit for a report without AI analysis", async () => {
    const server = buildApiServer({
      database: { check: async () => undefined },
      startInvestigation,
      investigationQueries,
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/investigations/c56a4180-65aa-42ec-a945-5fd21dec0538/ai-runs",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ runs: [] });
    await server.close();
  });
});

describe("recording routes", () => {
  it("accepts a bounded HLS recording when the composition enables Record", async () => {
    const recording = {
      id: "c56a4180-65aa-42ec-a945-5fd21dec0538", sourceUrl: "https://example.test/vod/master.m3u8",
      protocol: "hls" as const, state: "queued" as const, requestedDurationSeconds: 120, requestedStartSeconds: 0,
      createdAt: "2026-08-06T12:00:00.000Z", updatedAt: "2026-08-06T12:00:00.000Z",
    };
    const server = buildApiServer({
      database: { check: async () => undefined }, startInvestigation, investigationQueries,
      startRecording: async () => ({ created: true, recording }),
      recordingQueries: { getRecording: async () => recording, listEventsAfter: async () => [] },
    });

    const response = await server.inject({ method: "POST", url: "/v1/recordings", headers: { "idempotency-key": "record-1" }, payload: { url: recording.sourceUrl } });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ recording: { protocol: "hls", state: "queued" }, replayed: false });
    await server.close();
  });

  it("formats recording SSE events with the separate event name", () => {
    expect(formatRecordingSseEvent({
      id: "42", recordingId: "c56a4180-65aa-42ec-a945-5fd21dec0538", type: "recording.created",
      actor: "system", message: "Recording created and queued.", payload: { state: "queued" }, createdAt: "2026-08-06T12:00:00.000Z",
    })).toContain("id: 42\nevent: recording.event\ndata:");
  });

  it("creates a fixed playback URL for a ready recording", async () => {
    const recording = { id: "c56a4180-65aa-42ec-a945-5fd21dec0538", sourceUrl: "https://example.test/vod/master.m3u8", protocol: "hls" as const, state: "ready" as const, requestedDurationSeconds: 120, requestedStartSeconds: 0, createdAt: "2026-08-06T12:00:00.000Z", updatedAt: "2026-08-06T12:00:00.000Z" };
    const server = buildApiServer({
      database: { check: async () => undefined }, startInvestigation, investigationQueries,
      startRecording: async () => ({ created: true, recording }), recordingQueries: { getRecording: async () => recording, listEventsAfter: async () => [] },
      createPlaybackRun: async () => ({ run: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", recordingId: recording.id, state: "created", maxDurationSeconds: 300, profile: { schemaVersion: 1, name: "baseline", stages: [{ afterVideoRequests: 0, bandwidthKbps: 100000, latencyMs: 0 }] }, createdAt: "2026-08-06T12:00:00.000Z", expiresAt: "2026-08-07T12:00:00.000Z" }, manifestPath: "index.m3u8" }),
    });
    const response = await server.inject({ method: "POST", url: `/v1/recordings/${recording.id}/playback-runs`, payload: {} });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ run: { state: "created" } });
    expect(response.json().playbackUrl).toBe(`/streams/recordings/${recording.id}/index.m3u8`);
    await server.close();
  });

  it("returns correlated ABR switches without requiring AVPlay evidence", async () => {
    const recordingId = "c56a4180-65aa-42ec-a945-5fd21dec0538"; const runId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
    const run = { id: runId, recordingId, state: "active" as const, maxDurationSeconds: 300, profile: { schemaVersion: 1 as const, name: "baseline", stages: [{ afterVideoRequests: 0, bandwidthKbps: 100_000, latencyMs: 0 }] }, createdAt: "2026-08-06T12:00:00.000Z", expiresAt: "2026-08-07T12:00:00.000Z" };
    const recording = { id: recordingId, sourceUrl: "https://example.test/vod/index.mpd", protocol: "dash" as const, state: "ready" as const, requestedDurationSeconds: 120, requestedStartSeconds: 0, createdAt: "2026-08-06T12:00:00.000Z", updatedAt: "2026-08-06T12:00:00.000Z" };
    const server = buildApiServer({
      database: { check: async () => undefined }, startInvestigation, investigationQueries,
      startRecording: async () => ({ created: true, recording }), recordingQueries: { getRecording: async () => recording, listEventsAfter: async () => [] },
      playbackRuns: { create: async () => "recording_not_ready", findById: async () => run, findLatestOpen: async () => run, finish: async () => null, recordDelivery: async () => undefined, listDeliveries: async () => [], listDiagnosticResources: async () => [] },
    });

    const response = await server.inject({ method: "GET", url: `/v1/recordings/${recordingId}/playback-runs/${runId}/abr-switches` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ switches: [] });
    await server.close();
  });

  it("serves a published recording through its fixed URL with and without an active run", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-stream-"));
    const store = new FilesystemRecordingStore(directory);
    const recordingId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
    const runId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
    const workspace = await store.prepareWorkspace(recordingId);
    await fs.writeFile(path.join(workspace.path, "index.m3u8"), "#EXTM3U\n");
    await store.publish(workspace);
    const run = { id: runId, recordingId, state: "created" as const, maxDurationSeconds: 300, profile: { schemaVersion: 1 as const, name: "baseline", stages: [{ afterVideoRequests: 0, bandwidthKbps: 100000, latencyMs: 0 }] }, createdAt: "2026-08-06T12:00:00.000Z", expiresAt: "2026-08-07T12:00:00.000Z" };
    const server = buildApiServer({
      database: { check: async () => undefined }, startInvestigation, investigationQueries,
      playbackRuns: { create: async () => "recording_not_ready", findById: async () => run, findLatestOpen: async () => run, finish: async () => null, recordDelivery: async () => undefined, listDeliveries: async () => [] },
      recordingStore: store,
    });

    const active = await server.inject({ method: "GET", url: `/streams/recordings/${recordingId}/index.m3u8` });
    expect(active.statusCode).toBe(200);
    expect(active.body).toBe("#EXTM3U\n");
    expect(active.headers["cache-control"]).toBe("no-store");

    const missing = await server.inject({ method: "GET", url: `/streams/recordings/${recordingId}/missing.m3u8` });
    expect(missing.statusCode).toBe(404);

    const traversal = await server.inject({ method: "GET", url: `/streams/recordings/${recordingId}/../outside` });
    expect(traversal.statusCode).toBe(404);

    const invalidId = await server.inject({ method: "GET", url: "/streams/recordings/not-a-uuid/index.m3u8" });
    expect(invalidId.statusCode).toBe(400);

    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("still serves the fixed URL with the baseline profile when no run is active", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-stream-"));
    const store = new FilesystemRecordingStore(directory);
    const recordingId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
    const workspace = await store.prepareWorkspace(recordingId);
    await fs.writeFile(path.join(workspace.path, "index.m3u8"), "#EXTM3U\n");
    await store.publish(workspace);
    const server = buildApiServer({
      database: { check: async () => undefined }, startInvestigation, investigationQueries,
      playbackRuns: { create: async () => "recording_not_ready", findById: async () => null, findLatestOpen: async () => null, finish: async () => null, recordDelivery: async () => undefined, listDeliveries: async () => [] },
      recordingStore: store,
    });

    const response = await server.inject({ method: "GET", url: `/streams/recordings/${recordingId}/index.m3u8` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("#EXTM3U\n");
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
});
