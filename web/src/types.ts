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
  created_at: string;
  presets: Preset[];
}

export const DEFAULT_PRESETS: Preset[] = [
  { key: "clean", label: "Clean", description: "Pass-through with zero modification." },
  { key: "subway_3g", label: "Subway 3G", description: "1500-3000ms artificial latency and a 10% chance of HTTP 504." },
  { key: "cdn_degradation", label: "CDN Degradation", description: "20% of segment requests fail with HTTP 500." },
  { key: "stale_live_manifest", label: "Stale Live Manifest", description: "Manifest refresh responses delayed by 4000ms." },
];