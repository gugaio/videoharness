export interface Preset {
  key: string;
  label: string;
  description: string;
}

export interface Stream {
  id: string;
  label: string;
  original_url: string;
  proxy_path: string;
  active_preset: string;
  format: "hls" | "dash";
	protection_mode: "clear" | "clearkey";
	track_selection: "highest" | "all";
	license_path?: string;
	capture_progress: number;
	video_track_count: number;
	audio_track_count: number;
	subtitle_track_count: number;
	source_live: boolean;
	expires_at?: string;
  owner_id: string | null;
  mode: "proxy" | "clone";
  capture_status: "queued" | "capturing" | "ready" | "failed";
  requested_duration_seconds: number;
  duration_seconds?: number;
  total_bytes?: number;
  resource_count?: number;
  error_code?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  presets: Preset[];
}

export interface ProxyRequest {
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
  client_range?: string;
  forwarded_range?: string;
  upstream_status?: number;
  content_range?: string;
  content_length?: number;
  range_result: "not_requested" | "satisfied" | "ignored" | "missing_content_range" | "failed";
  diagnostic?: string;
	intervention?: "latency" | "http_error" | "latency_and_http_error" | "license_latency" | "license_http_error" | "license_retry" | "wrong_clearkey" | "malformed_license";
  added_latency_ms?: number;
  injected_status?: number;
	started_at_ms: number;
	completed_at_ms: number;
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
  hit_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface CMCDIssue { code: string; key?: string }

export interface RequestCMCD {
	version: number;
	valid: boolean;
	validation_errors?: CMCDIssue[] | string[];
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
}

export interface PlaybackSession {
	id: string;
	workspace_slug: string;
	stream_id: string;
	cmcd_session_id: string;
	content_id?: string;
	cmcd_version: number;
	player_name?: string;
	player_version?: string;
	user_agent?: string;
	initial_preset: string;
	observer_connected: boolean;
	started_at_ms: number;
	last_seen_at_ms: number;
	ended_at_ms?: number;
	created_at_ms: number;
}

export interface SessionSummary {
	observed_duration_ms: number;
	request_count: number;
	bytes: number;
	error_count: number;
	urgent_request_count: number;
	starvation_count: number;
	deadline_miss_count: number;
	intervention_count: number;
	minimum_bitrate_kbps?: number;
	maximum_bitrate_kbps?: number;
	average_bitrate_kbps?: number;
	event_count: number;
	startup_time_ms?: number;
	startup_method?: string;
	rebuffer_count: number;
	rebuffer_duration_ms: number;
	dropped_frames: number;
}

export interface RequestPoint {
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
}

export interface PlaybackEvent {
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
}

export type TimelineEntry =
	| { kind: "request"; at_ms: number; request: RequestPoint }
	| { kind: "event"; at_ms: number; event: PlaybackEvent };

export interface Finding {
	rule_id: string;
	rule_version: number;
	occurrences?: number;
	severity: "info" | "warning" | "error";
	confidence: "low" | "medium" | "high";
	message: string;
	evidence?: Array<{ kind: "request" | "event"; id: string }>;
	measurements?: Array<{ name: string; value: number; unit: string }>;
}

export interface PlaybackTimeline {
	session: PlaybackSession;
	summary: SessionSummary;
	entries: TimelineEntry[];
}

export interface SessionListItem { session: PlaybackSession; summary: SessionSummary }

export interface CreatedPlaybackSession {
	session: PlaybackSession;
	cmcd_session_id: string;
	content_id: string;
	playback_url: string;
	ingest_url: string;
	ingest_expires_at_ms: number;
	protection_mode: "clear" | "clearkey";
	license_url?: string;
}

export const DEFAULT_PRESETS: Preset[] = [
  { key: "clean", label: "Clean", description: "Pass-through with zero modification." },
  { key: "subway_3g", label: "Subway 3G", description: "1500-3000ms artificial latency and a 10% chance of HTTP 504." },
  { key: "cdn_degradation", label: "CDN Degradation", description: "20% of segment requests fail with HTTP 500." },
  { key: "stale_live_manifest", label: "Stale Live Manifest", description: "Manifest refresh responses delayed by 4000ms." },
  { key: "drm_license_latency", label: "DRM License Latency", description: "ClearKey license responses are delayed by 3000ms." },
  { key: "drm_license_failure", label: "DRM License Failure", description: "ClearKey license requests fail with HTTP 503." },
  { key: "drm_license_recovery", label: "DRM License Recovery", description: "The first two ClearKey license requests fail, then recover." },
  { key: "drm_wrong_key", label: "DRM Wrong Key", description: "The license response contains a deliberately incorrect content key." },
  { key: "drm_malformed_license", label: "DRM Malformed License", description: "The license server returns malformed JSON." },
];
