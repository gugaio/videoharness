import type { ManifestSummary, Snapshot } from "./snapshot";

export type { CaptureReport, ManifestSummary, Snapshot } from "./snapshot";

export type InspectionDetail = {
  inspection_id: string;
  status: string;
  created_at: string;
  expires_at: string;
  protocol?: string | null;
  manifest?: ManifestSummary | null;
  error_stage?: string | null;
  error_message?: string | null;
  segments_planned?: number | null;
  segments_captured?: number | null;
  segments_failed?: number | null;
  snapshot_url?: string | null;
};

export type InspectionCreated = {
  inspection_id: string;
  status: string;
  status_url: string;
  view_url: string;
  expires_at: string;
};

export type InspectionHistoryItem = {
  inspection_id: string;
  source_url: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  snapshot_available: boolean;
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

/** Registrado pelo AuthTokenBridge (modo Clerk); dev-mode não registra. */
export function setTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, body?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createInspection(url: string): Promise<InspectionCreated> {
  return request<InspectionCreated>("/api/v1/inspections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function listInspections(): Promise<{ inspections: InspectionHistoryItem[] }> {
  return request<{ inspections: InspectionHistoryItem[] }>("/api/v1/inspections");
}

export function getInspection(inspectionId: string): Promise<InspectionDetail> {
  return request<InspectionDetail>(`/api/v1/inspections/${encodeURIComponent(inspectionId)}`);
}

export function deleteInspection(inspectionId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/inspections/${encodeURIComponent(inspectionId)}`, {
    method: "DELETE",
  });
}

export function getSnapshot(inspectionId: string): Promise<Snapshot> {
  return request<Snapshot>(`/api/v1/inspections/${encodeURIComponent(inspectionId)}/snapshot`);
}

export type StreamFormat = "hls" | "dash";
export type ProtectionMode = "clear" | "clearkey";
export type TrackSelection = "highest" | "all";
export type CaptureStatus = "queued" | "capturing" | "ready" | "failed";
export type StreamMode = "clone" | "proxy";

export type MockPreset = {
  key: string;
  label: string;
  description: string;
};

export type MockStream = {
  id: string;
  label: string;
  original_url: string;
  proxy_path: string;
  playback_url: string;
  active_preset: string;
  format: StreamFormat;
  protection_mode: ProtectionMode;
  track_selection: TrackSelection;
  capture_progress: number;
  video_track_count: number;
  audio_track_count: number;
  subtitle_track_count: number;
  source_live: boolean;
  mode: StreamMode;
  capture_status: CaptureStatus;
  requested_duration_seconds: number;
  created_at: string;
  updated_at: string;
  presets: MockPreset[];
  license_path?: string;
  license_url?: string;
  expires_at?: string;
  owner_id?: string | null;
  duration_seconds?: number;
  total_bytes?: number;
  resource_count?: number;
  error_code?: string;
  error_message?: string;
};

export type LiveMockStatus = "stopped" | "playing" | "paused" | "ended";

export type LiveMock = {
  status: LiveMockStatus;
  window_segments: number;
  loop: boolean;
  playback_path: string;
  playback_url: string;
  sequence: number;
};

export type MockWorkspace = {
  slug: string;
  playback_url: string;
  stored_bytes: number;
  quota_bytes: number;
  clone_ttl_hours: number;
};

export type CreateStreamInput = {
  url: string;
  label?: string;
  durationSeconds?: number;
  mode?: StreamMode;
  format?: StreamFormat;
  protectionMode?: ProtectionMode;
  trackSelection?: TrackSelection;
};

export type LiveAction = "start" | "pause" | "resume" | "restart" | "stop";

function createStreamBody(input: CreateStreamInput): Record<string, unknown> {
  const body: Record<string, unknown> = { url: input.url };
  if (input.label !== undefined) body.label = input.label;
  if (input.durationSeconds !== undefined) body.duration_seconds = input.durationSeconds;
  if (input.mode !== undefined) body.mode = input.mode;
  if (input.format !== undefined) body.format = input.format;
  if (input.protectionMode !== undefined) body.protection_mode = input.protectionMode;
  if (input.trackSelection !== undefined) body.track_selection = input.trackSelection;
  return body;
}

export function listStreams(): Promise<{ streams: MockStream[] }> {
  return request<{ streams: MockStream[] }>("/api/v1/streams");
}

export function getStream(streamId: string): Promise<{ stream: MockStream }> {
  return request<{ stream: MockStream }>(`/api/v1/streams/${encodeURIComponent(streamId)}`);
}

export function createStream(input: CreateStreamInput): Promise<{ stream: MockStream }> {
  return request<{ stream: MockStream }>("/api/v1/streams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createStreamBody(input)),
  });
}

export function deleteStream(streamId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/streams/${encodeURIComponent(streamId)}`, {
    method: "DELETE",
  });
}

export function setStreamPreset(streamId: string, preset: string): Promise<{ stream: MockStream }> {
  return request<{ stream: MockStream }>(`/api/v1/streams/${encodeURIComponent(streamId)}/preset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preset }),
  });
}

export function getLive(streamId: string): Promise<{ live: LiveMock }> {
  return request<{ live: LiveMock }>(`/api/v1/streams/${encodeURIComponent(streamId)}/live`);
}

export function controlLive(streamId: string, action: LiveAction): Promise<{ live: LiveMock }> {
  return request<{ live: LiveMock }>(`/api/v1/streams/${encodeURIComponent(streamId)}/live`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export function getWorkspace(): Promise<MockWorkspace> {
  return request<MockWorkspace>("/api/v1/workspace");
}

export type ProxyPlayback = {
  playback_url: string;
  slug: string;
  preset: string;
  format: StreamFormat;
};

export type ProxyPlaybackInput = {
  url: string;
  preset?: string;
  format?: StreamFormat;
};

export function createProxyPlayback(input: ProxyPlaybackInput): Promise<ProxyPlayback> {
  return request<ProxyPlayback>("/api/v1/streams/proxy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type CMCDIssue = { code: string; key?: string };

export type RequestCMCD = {
  version?: number;
  valid: boolean;
  validation_errors?: Array<CMCDIssue | string>;
  session_id?: string;
  sid?: string;
  cid?: string;
  ot?: string;
  sf?: string;
  st?: string;
  br_kbps?: number;
  tb_kbps?: number;
  mtp_kbps?: number;
  rtp_kbps?: number;
  bl_ms?: number;
  dl_ms?: number;
  object_duration_ms?: number;
  playback_rate?: number;
  startup?: boolean;
  buffer_starvation?: boolean;
  raw_value?: string;
  canonical_value?: string;
  custom?: Record<string, unknown>;
};

export type ProxyRequest = {
  id: number;
  workspace_slug: string;
  stream_id: string;
  kind: "master" | "variant" | "segment" | "asset" | "license";
  target_url: string;
  status: number;
  duration_ms: number;
  bytes: number;
  client_ip: string;
  active_preset: string;
  range_result: "not_requested" | "satisfied" | "ignored" | "missing_content_range" | "failed";
  started_at_ms: number;
  completed_at_ms: number;
  hit_count: number;
  first_seen_at: string;
  last_seen_at: string;
  client_range?: string;
  forwarded_range?: string;
  upstream_status?: number;
  content_range?: string;
  content_length?: number;
  diagnostic?: string;
  intervention?: string;
  added_latency_ms?: number;
  injected_status?: number;
  dns_ms?: number;
  connect_ms?: number;
  tls_ms?: number;
  ttfb_ms?: number;
  relay_ms?: number;
  origin_body_ms?: number;
  local_serve_ms?: number;
  connection_reused?: boolean;
  transport_error?: string;
  cmcd?: RequestCMCD;
};

export type RangeSummary = { requested: number; satisfied: number; issues: number };

export type ProxyRequestFilters = {
  mode: "proxy" | "clone";
  streamId?: string;
  source?: string;
  preset?: string;
};

export type WorkspaceRequests = {
  requests: ProxyRequest[];
  range_summary?: RangeSummary;
};

function requestQuery(filters: ProxyRequestFilters): string {
  const params = new URLSearchParams({ mode: filters.mode });
  if (filters.streamId) params.set("stream", filters.streamId);
  if (filters.source) params.set("source", filters.source);
  if (filters.preset) params.set("preset", filters.preset);
  return params.toString();
}

export function listWorkspaceRequests(filters: ProxyRequestFilters): Promise<WorkspaceRequests> {
  return request<WorkspaceRequests>(`/api/v1/workspace/requests?${requestQuery(filters)}`);
}

export function clearWorkspaceRequests(filters: ProxyRequestFilters): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/workspace/requests?${requestQuery(filters)}`, {
    method: "DELETE",
  });
}

export type PlaybackSession = {
  id: string;
  workspace_slug: string;
  stream_id: string;
  cmcd_session_id: string;
  cmcd_version: number;
  initial_preset: string;
  observer_connected: boolean;
  started_at_ms: number;
  last_seen_at_ms: number;
  created_at_ms: number;
  content_id?: string;
  player_name?: string;
  player_version?: string;
  user_agent?: string;
  ended_at_ms?: number;
};

export type SessionSummary = {
  observed_duration_ms: number;
  request_count: number;
  bytes: number;
  error_count: number;
  urgent_request_count: number;
  starvation_count: number;
  deadline_miss_count: number;
  intervention_count: number;
  event_count: number;
  rebuffer_count: number;
  rebuffer_duration_ms: number;
  dropped_frames: number;
  minimum_bitrate_kbps?: number;
  maximum_bitrate_kbps?: number;
  average_bitrate_kbps?: number;
  startup_time_ms?: number;
  startup_method?: string;
};

export type PlaybackEvent = {
  id: string;
  sequence_number: number;
  event_type: string;
  wall_time_ms: number;
  monotonic_ms: number;
  media_time_ms?: number;
  buffer_ahead_ms?: number;
  bitrate_kbps?: number;
  throughput_kbps?: number;
  payload_json?: string;
};

export type RequestPoint = {
  request_id: number;
  started_at_ms: number;
  completed_at_ms: number;
  duration_ms: number;
  status: number;
  bytes: number;
  kind: string;
  target_url: string;
  active_preset: string;
  intervention?: string;
  added_latency_ms?: number;
  injected_status?: number;
  upstream_status?: number;
  transport_error?: string;
  dns_ms?: number;
  connect_ms?: number;
  tls_ms?: number;
  ttfb_ms?: number;
  relay_ms?: number;
  origin_body_ms?: number;
  local_serve_ms?: number;
  connection_reused?: boolean;
  effective_delivery_kbps?: number;
  deadline_miss_ms?: number;
  buffer_risk_ms?: number;
  bitrate_throughput_ratio?: number;
  cmcd?: RequestCMCD;
};

export type TimelineEntry =
  | { kind: "request"; at_ms: number; request: RequestPoint }
  | { kind: "event"; at_ms: number; event: PlaybackEvent };

export type Finding = {
  rule_id: string;
  rule_version: number;
  severity: "info" | "warning" | "error";
  confidence: "low" | "medium" | "high";
  message: string;
  occurrences?: number;
  evidence?: Array<{ kind: "request" | "event"; id: string }>;
  measurements?: Array<{ name: string; value: number; unit: string }>;
};

export type PlaybackTimeline = {
  session: PlaybackSession;
  summary: SessionSummary;
  entries: TimelineEntry[];
};

export type SessionListItem = { session: PlaybackSession; summary: SessionSummary };

export type CreatedPlaybackSession = {
  session: PlaybackSession;
  cmcd_session_id: string;
  content_id: string;
  playback_url: string;
  ingest_url: string;
  ingest_expires_at_ms: number;
  protection_mode: "clear" | "clearkey";
  license_url?: string;
};

export type CreatePlaybackSessionInput = {
  source?: string;
  stream_id?: string;
  preset?: string;
  format?: StreamFormat;
  live?: boolean;
  content_id?: string;
  duration_seconds?: number;
};

export type PlaybackSessionFilters = {
  streamId?: string;
  source?: string;
  preset?: string;
};

export function createPlaybackSession(
  input: CreatePlaybackSessionInput,
): Promise<CreatedPlaybackSession> {
  return request<CreatedPlaybackSession>("/api/v1/playback/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function listPlaybackSessions(
  filters: PlaybackSessionFilters,
): Promise<{ sessions: SessionListItem[] }> {
  const params = new URLSearchParams();
  if (filters.streamId) params.set("stream", filters.streamId);
  if (filters.source) params.set("source", filters.source);
  if (filters.preset) params.set("preset", filters.preset);
  const query = params.toString();
  return request<{ sessions: SessionListItem[] }>(
    `/api/v1/playback/sessions${query ? `?${query}` : ""}`,
  );
}

export function getPlaybackTimeline(
  sessionId: string,
): Promise<{ timeline: PlaybackTimeline; findings: Finding[] }> {
  return request<{ timeline: PlaybackTimeline; findings: Finding[] }>(
    `/api/v1/playback/sessions/${encodeURIComponent(sessionId)}/timeline`,
  );
}
