import { z } from "zod";
import type {
  ControlLiveInput,
  CreateStreamInput,
  LiveMock,
  MockStream,
  MockWorkspace,
  ProxyPlayback,
  ProxyPlaybackInput,
  ProxyRequest,
  ProxyRequestFilters,
  WorkspaceRequests,
} from "../../../domain/streams.js";
import type {
  CreatePlaybackSessionInput,
  CreatedPlaybackSession,
  Finding,
  PlaybackSession,
  PlaybackSessionFilters,
  PlaybackTimeline,
  SessionListItem,
} from "../../../domain/playback.js";
import {
  StreamMockError,
  StreamNotFoundError,
  type StreamMockEngine,
} from "../../../application/ports/stream-mock.js";

const PresetSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
});

const StreamSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    original_url: z.string(),
    proxy_path: z.string(),
    active_preset: z.string(),
    format: z.enum(["hls", "dash"]),
    protection_mode: z.enum(["clear", "clearkey"]),
    track_selection: z.enum(["highest", "all"]),
    capture_progress: z.number(),
    video_track_count: z.number(),
    audio_track_count: z.number(),
    subtitle_track_count: z.number(),
    source_live: z.boolean(),
    mode: z.enum(["clone", "proxy"]),
    capture_status: z.enum(["queued", "capturing", "ready", "failed"]),
    requested_duration_seconds: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
    presets: z.array(PresetSchema),
    license_path: z.string().optional(),
    expires_at: z.string().optional(),
    owner_id: z.string().nullable().optional(),
    duration_seconds: z.number().optional(),
    total_bytes: z.number().optional(),
    resource_count: z.number().optional(),
    error_code: z.string().optional(),
    error_message: z.string().optional(),
  })
  .passthrough();

const LiveSchema = z.object({
  status: z.enum(["stopped", "playing", "paused", "ended"]),
  window_segments: z.number(),
  loop: z.boolean(),
  playback_path: z.string(),
  sequence: z.number(),
});

const WorkspaceSchema = z.object({
  slug: z.string(),
  playback_url: z.string(),
  stored_bytes: z.number(),
  quota_bytes: z.number(),
  clone_ttl_hours: z.number(),
});

const CMCDIssueSchema = z.object({ code: z.string(), key: z.string().optional() });

const CMCDSchema = z
  .object({
    // O timeline projeta CMCD sem version (telemetry.RequestCMCD); a atividade
    // do workspace sempre serializa version (models.RequestCMCD).
    version: z.number().optional(),
    valid: z.boolean(),
    validation_errors: z.array(z.union([z.string(), CMCDIssueSchema])).optional(),
    session_id: z.string().optional(),
    sid: z.string().optional(),
    cid: z.string().optional(),
    ot: z.string().optional(),
    sf: z.string().optional(),
    st: z.string().optional(),
    br_kbps: z.number().optional(),
    tb_kbps: z.number().optional(),
    mtp_kbps: z.number().optional(),
    rtp_kbps: z.number().optional(),
    bl_ms: z.number().optional(),
    dl_ms: z.number().optional(),
    object_duration_ms: z.number().optional(),
    playback_rate: z.number().optional(),
    startup: z.boolean().optional(),
    buffer_starvation: z.boolean().optional(),
    raw_value: z.string().optional(),
    canonical_value: z.string().optional(),
    custom: z.record(z.unknown()).optional(),
  })
  .passthrough();

const ProxyRequestSchema = z
  .object({
    id: z.number(),
    workspace_slug: z.string(),
    stream_id: z.string(),
    kind: z.enum(["master", "variant", "segment", "asset", "license"]),
    target_url: z.string(),
    status: z.number(),
    duration_ms: z.number(),
    bytes: z.number(),
    client_ip: z.string(),
    active_preset: z.string(),
    range_result: z.enum(["not_requested", "satisfied", "ignored", "missing_content_range", "failed"]),
    started_at_ms: z.number(),
    completed_at_ms: z.number(),
    hit_count: z.number(),
    first_seen_at: z.string(),
    last_seen_at: z.string(),
    client_range: z.string().optional(),
    forwarded_range: z.string().optional(),
    upstream_status: z.number().optional(),
    content_range: z.string().optional(),
    content_length: z.number().optional(),
    diagnostic: z.string().optional(),
    intervention: z.string().optional(),
    added_latency_ms: z.number().optional(),
    injected_status: z.number().optional(),
    dns_ms: z.number().optional(),
    connect_ms: z.number().optional(),
    tls_ms: z.number().optional(),
    ttfb_ms: z.number().optional(),
    relay_ms: z.number().optional(),
    origin_body_ms: z.number().optional(),
    local_serve_ms: z.number().optional(),
    connection_reused: z.boolean().optional(),
    transport_error: z.string().optional(),
    cmcd: CMCDSchema.optional(),
  })
  .passthrough();

const WorkspaceRequestsSchema = z.object({
  requests: z.array(ProxyRequestSchema),
  range_summary: z
    .object({ requested: z.number(), satisfied: z.number(), issues: z.number() })
    .optional(),
});

const PlaybackSessionSchema = z
  .object({
    id: z.string(),
    workspace_slug: z.string(),
    stream_id: z.string(),
    cmcd_session_id: z.string(),
    cmcd_version: z.number(),
    initial_preset: z.string(),
    observer_connected: z.boolean(),
    started_at_ms: z.number(),
    last_seen_at_ms: z.number(),
    created_at_ms: z.number(),
    content_id: z.string().optional(),
    player_name: z.string().optional(),
    player_version: z.string().optional(),
    user_agent: z.string().optional(),
    ended_at_ms: z.number().optional(),
  })
  .passthrough();

const SessionSummarySchema = z
  .object({
    observed_duration_ms: z.number(),
    request_count: z.number(),
    bytes: z.number(),
    error_count: z.number(),
    urgent_request_count: z.number(),
    starvation_count: z.number(),
    deadline_miss_count: z.number(),
    intervention_count: z.number(),
    event_count: z.number(),
    rebuffer_count: z.number(),
    rebuffer_duration_ms: z.number(),
    dropped_frames: z.number(),
    minimum_bitrate_kbps: z.number().optional(),
    maximum_bitrate_kbps: z.number().optional(),
    average_bitrate_kbps: z.number().optional(),
    startup_time_ms: z.number().optional(),
    startup_method: z.string().optional(),
  })
  .passthrough();

const PlaybackEventSchema = z
  .object({
    id: z.string(),
    sequence_number: z.number(),
    event_type: z.string(),
    wall_time_ms: z.number(),
    monotonic_ms: z.number(),
    media_time_ms: z.number().optional(),
    buffer_ahead_ms: z.number().optional(),
    bitrate_kbps: z.number().optional(),
    throughput_kbps: z.number().optional(),
    payload_json: z.string().optional(),
  })
  .passthrough();

const RequestPointSchema = z
  .object({
    request_id: z.number(),
    started_at_ms: z.number(),
    completed_at_ms: z.number(),
    duration_ms: z.number(),
    status: z.number(),
    bytes: z.number(),
    kind: z.string(),
    target_url: z.string(),
    active_preset: z.string(),
    intervention: z.string().optional(),
    added_latency_ms: z.number().optional(),
    injected_status: z.number().optional(),
    upstream_status: z.number().optional(),
    transport_error: z.string().optional(),
    dns_ms: z.number().optional(),
    connect_ms: z.number().optional(),
    tls_ms: z.number().optional(),
    ttfb_ms: z.number().optional(),
    relay_ms: z.number().optional(),
    origin_body_ms: z.number().optional(),
    local_serve_ms: z.number().optional(),
    connection_reused: z.boolean().optional(),
    effective_delivery_kbps: z.number().optional(),
    deadline_miss_ms: z.number().optional(),
    buffer_risk_ms: z.number().optional(),
    bitrate_throughput_ratio: z.number().optional(),
    cmcd: CMCDSchema.optional(),
  })
  .passthrough();

const TimelineEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request"), at_ms: z.number(), request: RequestPointSchema }),
  z.object({ kind: z.literal("event"), at_ms: z.number(), event: PlaybackEventSchema }),
]);

const PlaybackTimelineSchema = z.object({
  session: PlaybackSessionSchema,
  summary: SessionSummarySchema,
  entries: z.array(TimelineEntrySchema),
});

const FindingSchema = z
  .object({
    rule_id: z.string(),
    rule_version: z.number(),
    severity: z.enum(["info", "warning", "error"]),
    confidence: z.enum(["low", "medium", "high"]),
    message: z.string(),
    occurrences: z.number().optional(),
    evidence: z.array(z.object({ kind: z.enum(["request", "event"]), id: z.string() })).nullish(),
    measurements: z
      .array(z.object({ name: z.string(), value: z.number(), unit: z.string() }))
      .nullish(),
  })
  .passthrough();

const CreatedPlaybackSessionSchema = z.object({
  session: PlaybackSessionSchema,
  cmcd_session_id: z.string(),
  content_id: z.string(),
  playback_url: z.string(),
  ingest_url: z.string(),
  ingest_expires_at_ms: z.number(),
  protection_mode: z.enum(["clear", "clearkey"]),
  license_url: z.string().optional(),
});

const SessionListItemSchema = z.object({
  session: PlaybackSessionSchema,
  summary: SessionSummarySchema,
});

export type MockFetch = (url: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Adapter HTTP do Stream Mock em modo interno: injeta o service token e o
 * owner verificado pelo Clerk (X-Owner-Id) em toda chamada. O mock não é
 * exposto ao browser; só paths de playback viram capability URLs públicas.
 */
export class MockClient implements StreamMockEngine {
  constructor(
    private readonly baseUrl: string,
    private readonly publicBaseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: MockFetch = fetch,
  ) {}

  async listStreams(ownerId: string): Promise<MockStream[]> {
    const body = await this.request(ownerId, "/api/streams", { method: "GET" }, z.object({ streams: z.array(StreamSchema) }));
    return body.streams.map((stream) => this.toStream(stream));
  }

  async getStream(ownerId: string, streamId: string): Promise<MockStream> {
    try {
      const body = await this.request(
        ownerId,
        `/api/streams/${encodeURIComponent(streamId)}`,
        { method: "GET" },
        z.object({ stream: StreamSchema }),
      );
      const stream = this.toStream(body.stream);
      // O mock não escopa o GET por dono; o orquestrador esconde streams de
      // outro owner (e anônimos) atrás de 404.
      if (stream.owner_id != null && stream.owner_id !== ownerId) {
        throw new StreamNotFoundError(streamId);
      }
      return stream;
    } catch (error) {
      throw this.asNotFound(error, streamId);
    }
  }

  async createStream(ownerId: string, input: CreateStreamInput): Promise<MockStream> {
    const payload: Record<string, unknown> = { url: input.url };
    if (input.label !== undefined) payload.label = input.label;
    if (input.durationSeconds !== undefined) payload.duration_seconds = input.durationSeconds;
    if (input.mode !== undefined) payload.mode = input.mode;
    if (input.format !== undefined) payload.format = input.format;
    if (input.protectionMode !== undefined) payload.protection_mode = input.protectionMode;
    if (input.trackSelection !== undefined) payload.track_selection = input.trackSelection;

    const body = await this.request(
      ownerId,
      "/api/streams",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      z.object({ stream: StreamSchema }),
    );
    return this.toStream(body.stream);
  }

  async deleteStream(ownerId: string, streamId: string): Promise<void> {
    try {
      await this.requestNoContent(ownerId, `/api/streams/${encodeURIComponent(streamId)}`, {
        method: "DELETE",
      });
    } catch (error) {
      throw this.asNotFound(error, streamId);
    }
  }

  async setPreset(ownerId: string, streamId: string, preset: string): Promise<MockStream> {
    try {
      const body = await this.request(
        ownerId,
        `/api/streams/${encodeURIComponent(streamId)}/preset`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ preset }),
        },
        z.object({ stream: StreamSchema }),
      );
      return this.toStream(body.stream);
    } catch (error) {
      throw this.asNotFound(error, streamId);
    }
  }

  async getLive(ownerId: string, streamId: string): Promise<LiveMock> {
    try {
      const body = await this.request(
        ownerId,
        `/api/streams/${encodeURIComponent(streamId)}/live`,
        { method: "GET" },
        z.object({ live: LiveSchema }),
      );
      return this.toLive(body.live);
    } catch (error) {
      throw this.asNotFound(error, streamId);
    }
  }

  async controlLive(ownerId: string, streamId: string, input: ControlLiveInput): Promise<LiveMock> {
    const payload: Record<string, unknown> = { action: input.action };
    if (input.windowSegments !== undefined) payload.window_segments = input.windowSegments;
    if (input.loop !== undefined) payload.loop = input.loop;
    try {
      const body = await this.request(
        ownerId,
        `/api/streams/${encodeURIComponent(streamId)}/live`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        z.object({ live: LiveSchema }),
      );
      return this.toLive(body.live);
    } catch (error) {
      throw this.asNotFound(error, streamId);
    }
  }

  async getWorkspace(ownerId: string): Promise<MockWorkspace> {
    const body = await this.request(ownerId, "/api/workspace", { method: "GET" }, WorkspaceSchema);
    return {
      slug: body.slug,
      playback_url: this.absolute(body.playback_url),
      stored_bytes: body.stored_bytes,
      quota_bytes: body.quota_bytes,
      clone_ttl_hours: body.clone_ttl_hours,
    };
  }

  async createProxyPlayback(ownerId: string, input: ProxyPlaybackInput): Promise<ProxyPlayback> {
    const workspace = await this.getWorkspace(ownerId);
    const format = input.format ?? this.formatFromUrl(input.url);
    const preset = input.preset ?? "clean";
    const params = new URLSearchParams({ url: input.url });
    if (preset !== "clean") params.set("preset", preset);
    const extension = format === "dash" ? "mpd" : "m3u8";
    const playbackUrl = this.absolute(`/ws/${encodeURIComponent(workspace.slug)}/p.${extension}?${params.toString()}`);
    return { playback_url: playbackUrl, slug: workspace.slug, preset, format };
  }

  async listWorkspaceRequests(
    ownerId: string,
    filters: ProxyRequestFilters,
  ): Promise<WorkspaceRequests> {
    const body = await this.request(
      ownerId,
      `/api/workspace/requests?${this.requestQuery(filters)}`,
      { method: "GET" },
      WorkspaceRequestsSchema,
    );
    return {
      // Os campos foram validados pelo Zod; o cast reconcilia os opcionais do
      // schema com o modelo do domínio sob exactOptionalPropertyTypes.
      requests: body.requests as ProxyRequest[],
      ...(body.range_summary !== undefined ? { range_summary: body.range_summary } : {}),
    };
  }

  async clearWorkspaceRequests(ownerId: string, filters: ProxyRequestFilters): Promise<void> {
    await this.requestNoContent(
      ownerId,
      `/api/workspace/requests?${this.requestQuery(filters)}`,
      { method: "DELETE" },
    );
  }

  private requestQuery(filters: ProxyRequestFilters): string {
    const params = new URLSearchParams({ mode: filters.mode });
    if (filters.streamId) params.set("stream", filters.streamId);
    if (filters.source) params.set("source", filters.source);
    if (filters.preset) params.set("preset", filters.preset);
    return params.toString();
  }

  async createPlaybackSession(
    ownerId: string,
    input: CreatePlaybackSessionInput,
  ): Promise<CreatedPlaybackSession> {
    const payload: Record<string, unknown> = {};
    if (input.source !== undefined) payload.source = input.source;
    if (input.streamId !== undefined) payload.stream_id = input.streamId;
    if (input.preset !== undefined) payload.preset = input.preset;
    if (input.format !== undefined) payload.format = input.format;
    if (input.live !== undefined) payload.live = input.live;
    if (input.contentId !== undefined) payload.content_id = input.contentId;
    if (input.durationSeconds !== undefined) payload.duration_seconds = input.durationSeconds;
    if (input.allowedOrigin !== undefined) payload.allowed_origin = input.allowedOrigin;

    const body = await this.request(
      ownerId,
      "/api/playback/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      CreatedPlaybackSessionSchema,
    );
    return {
      session: body.session as PlaybackSession,
      cmcd_session_id: body.cmcd_session_id,
      content_id: body.content_id,
      playback_url: this.absolute(body.playback_url),
      ingest_url: this.absolute(body.ingest_url),
      ingest_expires_at_ms: body.ingest_expires_at_ms,
      protection_mode: body.protection_mode,
      ...(body.license_url !== undefined ? { license_url: this.absolute(body.license_url) } : {}),
    };
  }

  async listPlaybackSessions(
    ownerId: string,
    filters: PlaybackSessionFilters,
  ): Promise<SessionListItem[]> {
    const body = await this.request(
      ownerId,
      `/api/playback/sessions?${this.playbackQuery(filters)}`,
      { method: "GET" },
      z.object({ sessions: z.array(SessionListItemSchema) }),
    );
    return body.sessions as SessionListItem[];
  }

  async getPlaybackTimeline(
    ownerId: string,
    sessionId: string,
  ): Promise<{ timeline: PlaybackTimeline; findings: Finding[] }> {
    const body = await this.request(
      ownerId,
      `/api/playback/sessions/${encodeURIComponent(sessionId)}/timeline`,
      { method: "GET" },
      z.object({ timeline: PlaybackTimelineSchema, findings: z.array(FindingSchema).nullish() }),
    );
    return {
      timeline: body.timeline as PlaybackTimeline,
      findings: (body.findings ?? []).map((finding) => this.toFinding(finding)),
    };
  }

  // Fatias nil do Go serializam como null; o domínio espera ausência, não null.
  private toFinding(finding: z.infer<typeof FindingSchema>): Finding {
    return {
      rule_id: finding.rule_id,
      rule_version: finding.rule_version,
      severity: finding.severity,
      confidence: finding.confidence,
      message: finding.message,
      ...(finding.occurrences !== undefined ? { occurrences: finding.occurrences } : {}),
      ...(finding.evidence != null ? { evidence: finding.evidence } : {}),
      ...(finding.measurements != null ? { measurements: finding.measurements } : {}),
    };
  }

  private playbackQuery(filters: PlaybackSessionFilters): string {
    const params = new URLSearchParams();
    if (filters.streamId) params.set("stream", filters.streamId);
    if (filters.source) params.set("source", filters.source);
    if (filters.preset) params.set("preset", filters.preset);
    return params.toString();
  }

  private formatFromUrl(raw: string): "hls" | "dash" {
    try {
      return new URL(raw).pathname.toLowerCase().endsWith(".mpd") ? "dash" : "hls";
    } catch {
      return raw.toLowerCase().split("?")[0]?.endsWith(".mpd") ? "dash" : "hls";
    }
  }

  private toStream(stream: z.infer<typeof StreamSchema>): MockStream {
    return {
      id: stream.id,
      label: stream.label,
      original_url: stream.original_url,
      proxy_path: stream.proxy_path,
      playback_url: this.absolute(stream.proxy_path),
      active_preset: stream.active_preset,
      format: stream.format,
      protection_mode: stream.protection_mode,
      track_selection: stream.track_selection,
      capture_progress: stream.capture_progress,
      video_track_count: stream.video_track_count,
      audio_track_count: stream.audio_track_count,
      subtitle_track_count: stream.subtitle_track_count,
      source_live: stream.source_live,
      mode: stream.mode,
      capture_status: stream.capture_status,
      requested_duration_seconds: stream.requested_duration_seconds,
      created_at: stream.created_at,
      updated_at: stream.updated_at,
      presets: stream.presets,
      ...(stream.license_path !== undefined
        ? { license_path: stream.license_path, license_url: this.absolute(stream.license_path) }
        : {}),
      ...(stream.expires_at !== undefined ? { expires_at: stream.expires_at } : {}),
      ...(stream.owner_id !== undefined ? { owner_id: stream.owner_id } : {}),
      ...(stream.duration_seconds !== undefined ? { duration_seconds: stream.duration_seconds } : {}),
      ...(stream.total_bytes !== undefined ? { total_bytes: stream.total_bytes } : {}),
      ...(stream.resource_count !== undefined ? { resource_count: stream.resource_count } : {}),
      ...(stream.error_code !== undefined ? { error_code: stream.error_code } : {}),
      ...(stream.error_message !== undefined ? { error_message: stream.error_message } : {}),
    };
  }

  private toLive(live: z.infer<typeof LiveSchema>): LiveMock {
    return {
      status: live.status,
      window_segments: live.window_segments,
      loop: live.loop,
      playback_path: live.playback_path,
      playback_url: this.absolute(live.playback_path),
      sequence: live.sequence,
    };
  }

  private absolute(path: string): string {
    try {
      return new URL(path, this.publicBaseUrl).toString();
    } catch {
      return path;
    }
  }

  private async request<T>(
    ownerId: string,
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.fetchJson(ownerId, path, init);
    const body: unknown = await response.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new StreamMockError(
        502,
        `resposta inválida do mock: ${parsed.error.issues
          .map((i) => [i.path.join("."), i.message].filter(Boolean).join(": "))
          .join("; ")}`,
      );
    }
    return parsed.data;
  }

  private async requestNoContent(ownerId: string, path: string, init: RequestInit): Promise<void> {
    await this.fetchJson(ownerId, path, init);
  }

  private async fetchJson(ownerId: string, path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          "x-service-token": this.serviceToken,
          "x-owner-id": ownerId,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StreamMockError(502, `mock inacessível: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new StreamMockError(response.status, `mock respondeu ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response;
  }

  private asNotFound(error: unknown, streamId: string): unknown {
    if (error instanceof StreamMockError && error.status === 404) {
      return new StreamNotFoundError(streamId);
    }
    return error;
  }
}
