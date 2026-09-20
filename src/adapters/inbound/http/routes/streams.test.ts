import { describe, expect, it } from "vitest";
import { buildApp } from "../../../../infrastructure/server.js";
import {
  StreamMockError,
  StreamNotFoundError,
  type StreamMockEngine,
} from "../../../../application/ports/stream-mock.js";
import type {
  ControlLiveInput,
  CreateStreamInput,
  LiveMock,
  MockStream,
  MockWorkspace,
  ProxyRequest,
  ProxyRequestFilters,
  WorkspaceRequests,
} from "../../../../domain/streams.js";
import type {
  CreatePlaybackSessionInput,
  CreatedPlaybackSession,
  Finding,
  PlaybackSession,
  PlaybackSessionFilters,
  PlaybackTimeline,
  SessionListItem,
} from "../../../../domain/playback.js";

const SAMPLE_SESSION: PlaybackSession = {
  id: "sess-1",
  workspace_slug: "ws-abc",
  stream_id: "od-1",
  cmcd_session_id: "cmcd-1",
  cmcd_version: 1,
  initial_preset: "clean",
  observer_connected: true,
  started_at_ms: 1,
  last_seen_at_ms: 2,
  created_at_ms: 1,
};

const SAMPLE_SUMMARY = {
  observed_duration_ms: 1000,
  request_count: 1,
  bytes: 2048,
  error_count: 0,
  urgent_request_count: 0,
  starvation_count: 0,
  deadline_miss_count: 0,
  intervention_count: 0,
  event_count: 0,
  rebuffer_count: 0,
  rebuffer_duration_ms: 0,
  dropped_frames: 0,
};

const baseConfig = {
  host: "127.0.0.1",
  port: 0,
  lensUrl: "http://lens:8000",
  mockUrl: "http://mock:8080",
  mockPublicUrl: "http://127.0.0.1:8081",
  serviceToken: "test-token",
};

function sampleStream(overrides: Partial<MockStream> = {}): MockStream {
  return {
    id: "clone-1",
    label: "Demo",
    original_url: "https://example.com/master.m3u8",
    proxy_path: "/s/clone-1/master.m3u8",
    playback_url: "http://127.0.0.1:8081/s/clone-1/master.m3u8",
    active_preset: "clean",
    format: "hls",
    protection_mode: "clear",
    track_selection: "highest",
    capture_progress: 100,
    video_track_count: 1,
    audio_track_count: 1,
    subtitle_track_count: 0,
    source_live: false,
    mode: "clone",
    capture_status: "ready",
    requested_duration_seconds: 60,
    created_at: "2026-09-19T00:00:00Z",
    updated_at: "2026-09-19T00:00:00Z",
    presets: [{ key: "clean", label: "Clean", description: "Pass-through." }],
    ...overrides,
  };
}

class StubEngine implements StreamMockEngine {
  public owners: string[] = [];
  public created: Array<{ ownerId: string; input: CreateStreamInput }> = [];
  public deleted: string[] = [];
  public live: LiveMock = {
    status: "stopped",
    window_segments: 3,
    loop: true,
    playback_path: "/s/clone-1/live.m3u8",
    playback_url: "http://127.0.0.1:8081/s/clone-1/live.m3u8",
    sequence: 0,
  };

  constructor(private readonly streams: MockStream[] = [sampleStream()]) {}

  async listStreams(ownerId: string): Promise<MockStream[]> {
    this.owners.push(ownerId);
    return this.streams;
  }

  async getStream(ownerId: string, streamId: string): Promise<MockStream> {
    const stream = this.streams.find((item) => item.id === streamId);
    if (!stream) throw new StreamNotFoundError(streamId);
    return stream;
  }

  async createStream(ownerId: string, input: CreateStreamInput): Promise<MockStream> {
    this.created.push({ ownerId, input });
    return sampleStream({ id: "clone-new", label: input.label ?? "" });
  }

  async deleteStream(_ownerId: string, streamId: string): Promise<void> {
    this.deleted.push(streamId);
  }

  async setPreset(_ownerId: string, streamId: string, preset: string): Promise<MockStream> {
    return sampleStream({ id: streamId, active_preset: preset });
  }

  async getLive(): Promise<LiveMock> {
    return this.live;
  }

  async controlLive(_ownerId: string, _streamId: string, input: ControlLiveInput): Promise<LiveMock> {
    this.live = { ...this.live, status: input.action === "stop" ? "stopped" : "playing" };
    return this.live;
  }

  async getWorkspace(): Promise<MockWorkspace> {
    return {
      slug: "ws-abc",
      playback_url: "http://127.0.0.1:8081/ws/ws-abc/p.m3u8",
      stored_bytes: 1024,
      quota_bytes: 5_368_709_120,
      clone_ttl_hours: 0,
    };
  }

  async createProxyPlayback(
    _ownerId: string,
    input: { url: string; preset?: string; format?: "hls" | "dash" },
  ): Promise<{ playback_url: string; slug: string; preset: string; format: "hls" | "dash" }> {
    const preset = input.preset ?? "clean";
    const format = input.format ?? "hls";
    const params = new URLSearchParams({ url: input.url });
    if (preset !== "clean") params.set("preset", preset);
    return {
      playback_url: `http://127.0.0.1:8081/ws/ws-abc/p.${format === "dash" ? "mpd" : "m3u8"}?${params.toString()}`,
      slug: "ws-abc",
      preset,
      format,
    };
  }

  public requestFilters: ProxyRequestFilters[] = [];
  public cleared: ProxyRequestFilters[] = [];

  async listWorkspaceRequests(_ownerId: string, filters: ProxyRequestFilters): Promise<WorkspaceRequests> {
    this.requestFilters.push(filters);
    return {
      requests: [
        {
          id: 1,
          workspace_slug: "ws-abc",
          stream_id: "od-1",
          kind: "segment",
          target_url: "https://example.com/seg0.ts",
          status: 200,
          duration_ms: 42,
          bytes: 2048,
          client_ip: "127.0.0.1",
          active_preset: "clean",
          range_result: "not_requested",
          started_at_ms: 1,
          completed_at_ms: 43,
          hit_count: 1,
          first_seen_at: "2026-09-19T00:00:00Z",
          last_seen_at: "2026-09-19T00:00:00Z",
        },
      ],
      range_summary: { requested: 0, satisfied: 0, issues: 0 },
    };
  }

  async clearWorkspaceRequests(_ownerId: string, filters: ProxyRequestFilters): Promise<void> {
    this.cleared.push(filters);
  }

  public sessionInputs: CreatePlaybackSessionInput[] = [];

  async createPlaybackSession(
    _ownerId: string,
    input: CreatePlaybackSessionInput,
  ): Promise<CreatedPlaybackSession> {
    this.sessionInputs.push(input);
    return {
      session: SAMPLE_SESSION,
      cmcd_session_id: "cmcd-1",
      content_id: "sm-1",
      playback_url: "http://127.0.0.1:8081/ws/ws-abc/p.m3u8",
      ingest_url: "http://127.0.0.1:8081/i/tok/events",
      ingest_expires_at_ms: 1,
      protection_mode: "clear",
    };
  }

  async listPlaybackSessions(
    _ownerId: string,
    _filters: PlaybackSessionFilters,
  ): Promise<SessionListItem[]> {
    return [{ session: SAMPLE_SESSION, summary: SAMPLE_SUMMARY }];
  }

  async getPlaybackTimeline(
    _ownerId: string,
    _sessionId: string,
  ): Promise<{ timeline: PlaybackTimeline; findings: Finding[] }> {
    return {
      timeline: { session: SAMPLE_SESSION, summary: SAMPLE_SUMMARY, entries: [] },
      findings: [],
    };
  }
}

describe("stream routes (dev-mode auth)", () => {
  it("lists streams for the authenticated owner", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({ method: "GET", url: "/v1/streams" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ streams: [{ id: "clone-1", active_preset: "clean" }] });
    expect(engine.owners).toEqual(["dev-user"]);
    await app.close();
  });

  it("creates a clone forwarding the decoded input", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({
      method: "POST",
      url: "/v1/streams",
      payload: {
        url: "https://example.com/master.m3u8",
        label: "Meu clone",
        duration_seconds: 120,
        format: "hls",
        protection_mode: "clearkey",
        track_selection: "all",
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ stream: { id: "clone-new", label: "Meu clone" } });
    expect(engine.created).toEqual([
      {
        ownerId: "dev-user",
        input: {
          url: "https://example.com/master.m3u8",
          label: "Meu clone",
          durationSeconds: 120,
          format: "hls",
          protectionMode: "clearkey",
          trackSelection: "all",
        },
      },
    ]);
    await app.close();
  });

  it("rejects a body without url", async () => {
    const app = buildApp(baseConfig, { streamMock: new StubEngine() });
    const response = await app.inject({ method: "POST", url: "/v1/streams", payload: {} });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("maps a missing stream to 404", async () => {
    const app = buildApp(baseConfig, { streamMock: new StubEngine() });
    const response = await app.inject({ method: "GET", url: "/v1/streams/missing" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("propagates engine errors", async () => {
    const engine = new StubEngine();
    engine.listStreams = async () => {
      throw new StreamMockError(503, "mock respondeu 503");
    };
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({ method: "GET", url: "/v1/streams" });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("deletes a clone", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({ method: "DELETE", url: "/v1/streams/clone-1" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(engine.deleted).toEqual(["clone-1"]);
    await app.close();
  });

  it("sets a preset", async () => {
    const app = buildApp(baseConfig, { streamMock: new StubEngine() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/streams/clone-1/preset",
      payload: { preset: "subway_3g" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ stream: { active_preset: "subway_3g" } });
    await app.close();
  });

  it("controls the live mock", async () => {
    const app = buildApp(baseConfig, { streamMock: new StubEngine() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/streams/clone-1/live",
      payload: { action: "start", window_segments: 4 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ live: { status: "playing", window_segments: 3 } });
    await app.close();
  });

  it("returns workspace info", async () => {
    const app = buildApp(baseConfig, { streamMock: new StubEngine() });
    const response = await app.inject({ method: "GET", url: "/v1/workspace" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ slug: "ws-abc", stored_bytes: 1024 });
    await app.close();
  });

  it("builds an on-demand proxy playback URL without creating a stream", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({
      method: "POST",
      url: "/v1/streams/proxy",
      payload: { url: "https://example.com/live.m3u8", preset: "subway_3g" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      slug: "ws-abc",
      preset: "subway_3g",
      format: "hls",
      playback_url:
        "http://127.0.0.1:8081/ws/ws-abc/p.m3u8?url=https%3A%2F%2Fexample.com%2Flive.m3u8&preset=subway_3g",
    });
    expect(engine.created).toEqual([]);
    await app.close();
  });

  it("rejects a proxy request without url", async () => {
    const app = buildApp(baseConfig, { streamMock: new StubEngine() });
    const response = await app.inject({ method: "POST", url: "/v1/streams/proxy", payload: {} });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("returns the workspace request board filtered by mode", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({ method: "GET", url: "/v1/workspace/requests?mode=proxy" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      requests: [{ target_url: "https://example.com/seg0.ts", status: 200 }],
      range_summary: { requested: 0 },
    });
    expect(engine.requestFilters).toEqual([{ mode: "proxy" }]);
    await app.close();
  });

  it("maps stream/source/preset query params to engine filters", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({
      method: "GET",
      url: "/v1/workspace/requests?mode=clone&stream=clone-1&preset=subway_3g",
    });
    expect(response.statusCode).toBe(200);
    expect(engine.requestFilters).toEqual([
      { mode: "clone", streamId: "clone-1", preset: "subway_3g" },
    ]);
    await app.close();
  });

  it("requires a stream or source to clear activity", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({ method: "DELETE", url: "/v1/workspace/requests?mode=proxy" });
    expect(response.statusCode).toBe(400);
    expect(engine.cleared).toEqual([]);
    await app.close();
  });

  it("clears activity for a specific stream", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/workspace/requests?mode=clone&stream=clone-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(engine.cleared).toEqual([{ mode: "clone", streamId: "clone-1" }]);
    await app.close();
  });

  it("creates a playback session with the browser origin as allowed origin", async () => {
    const engine = new StubEngine();
    const app = buildApp(baseConfig, { streamMock: engine });
    const response = await app.inject({
      method: "POST",
      url: "/v1/playback/sessions",
      headers: { origin: "http://127.0.0.1:8080" },
      payload: { source: "https://example.com/live.m3u8", preset: "subway_3g" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      playback_url: "http://127.0.0.1:8081/ws/ws-abc/p.m3u8",
      ingest_url: "http://127.0.0.1:8081/i/tok/events",
    });
    expect(engine.sessionInputs).toEqual([
      {
        source: "https://example.com/live.m3u8",
        preset: "subway_3g",
        allowedOrigin: "http://127.0.0.1:8080",
      },
    ]);
    await app.close();
  });

  it("rejects a playback session without source or stream", async () => {
    const app = buildApp(baseConfig, { streamMock: new StubEngine() });
    const response = await app.inject({ method: "POST", url: "/v1/playback/sessions", payload: {} });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("lists playback sessions and returns a timeline", async () => {
    const app = buildApp(baseConfig, { streamMock: new StubEngine() });
    const list = await app.inject({ method: "GET", url: "/v1/playback/sessions?source=https%3A%2F%2Fexample.com%2Flive.m3u8" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ sessions: [{ session: { id: "sess-1" } }] });

    const timeline = await app.inject({ method: "GET", url: "/v1/playback/sessions/sess-1/timeline" });
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json()).toMatchObject({
      timeline: { session: { id: "sess-1" }, entries: [] },
      findings: [],
    });
    await app.close();
  });
});
