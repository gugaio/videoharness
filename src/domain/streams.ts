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

export type ControlLiveInput = {
  action: "start" | "pause" | "resume" | "restart" | "stop";
  windowSegments?: number;
  loop?: boolean;
};

export type ProxyPlaybackInput = {
  url: string;
  preset?: string;
  format?: StreamFormat;
};

export type ProxyPlayback = {
  playback_url: string;
  slug: string;
  preset: string;
  format: StreamFormat;
};

export type CMCDIssue = { code: string; key?: string };

export type RequestCMCD = {
  // Presente na atividade do workspace; ausente na projeção do timeline.
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
