export interface Preset {
  key: string;
  label: string;
  description: string;
}

export interface Stream {
  id: string;
  original_url: string;
  proxy_path: string;
  active_preset: string;
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
  workspace_slug: string;
  stream_id: string;
  kind: "master" | "variant" | "segment" | "asset";
  target_url: string;
  status: number;
  duration_ms: number;
  bytes: number;
  client_ip: string;
  active_preset: string;
  hit_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export const DEFAULT_PRESETS: Preset[] = [
  { key: "clean", label: "Clean", description: "Pass-through with zero modification." },
  { key: "subway_3g", label: "Subway 3G", description: "1500-3000ms artificial latency and a 10% chance of HTTP 504." },
  { key: "cdn_degradation", label: "CDN Degradation", description: "20% of segment requests fail with HTTP 500." },
  { key: "stale_live_manifest", label: "Stale Live Manifest", description: "Manifest refresh responses delayed by 4000ms." },
];
