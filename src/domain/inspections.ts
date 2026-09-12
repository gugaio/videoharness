export type ManifestSummary = {
  protocol: string;
  kind: string;
  is_live: boolean;
  variant_count?: number | null;
  segment_count?: number | null;
  rendition_count?: number | null;
};

export type InspectionCreated = {
  inspection_id: string;
  status: string;
  status_url: string;
  view_url: string;
  expires_at: string;
};

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

export type InspectionHistoryItem = {
  inspection_id: string;
  source_url: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  snapshot_available: boolean;
};

export function isTerminalInspectionStatus(status: string): boolean {
  return status === "completed" || status === "partial" || status === "failed";
}
