import type { RequestCMCD } from "./streams.js";

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

export type FindingSeverity = "info" | "warning" | "error";
export type FindingConfidence = "low" | "medium" | "high";

export type Finding = {
  rule_id: string;
  rule_version: number;
  severity: FindingSeverity;
  confidence: FindingConfidence;
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

export type SessionListItem = {
  session: PlaybackSession;
  summary: SessionSummary;
};

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
  streamId?: string;
  preset?: string;
  format?: "hls" | "dash";
  live?: boolean;
  contentId?: string;
  durationSeconds?: number;
  allowedOrigin?: string;
};

export type PlaybackSessionFilters = {
  streamId?: string;
  source?: string;
  preset?: string;
};
