// Tipos espelham os DTOs do backend (adapters/inbound/http).
// Na Fase 3+ passaremos a gerá-los a partir do OpenAPI.

export interface CreateInspectionRequest {
  url: string
}

export interface InspectionResponse {
  inspection_id: string
  status: string
  status_url: string
  view_url: string
  expires_at: string
}

export interface ManifestSummary {
  protocol: string
  kind: string
  is_live: boolean
  variant_count: number | null
  segment_count: number | null
  rendition_count: number | null
}

export interface InspectionDetail {
  inspection_id: string
  status: string
  created_at: string
  expires_at: string
  protocol: string | null
  manifest: ManifestSummary | null
  error_stage: string | null
  error_message: string | null
  segments_planned: number | null
  segments_captured: number | null
  segments_failed: number | null
  snapshot_url: string | null
}

export interface SnapshotSource {
  display_url: string
  protocol: string
  is_live: boolean
}

export interface SegmentDeclaration {
  uri: string | null
  duration_seconds: number | null
  template: string | null
  timescale: number | null
  template_duration: number | null
  start_number: number | null
}

export interface Representation {
  id: string
  uri: string | null
  codecs: string | null
  bandwidth_bps: number | null
  average_bandwidth_bps: number | null
  resolution: { width: number; height: number } | null
  frame_rate: number | null
  audio_sampling_rate: number | null
  language: string | null
  roles: string[]
  init_segment: SegmentDeclaration | null
  segments: SegmentDeclaration[]
  segment_count_declared: number | null
  total_duration_seconds: number | null
}

export interface TrackGroup {
  kind: string
  name: string | null
  language: string | null
  representations: Representation[]
}

export interface DrmSystem {
  system: string
  details: string | null
}

export interface Capability {
  status: 'supported' | 'unsupported' | 'not_collected' | 'not_applicable'
  reason: string | null
}

export interface UnifiedMedia {
  protocol: string
  kind: string
  is_live: boolean
  track_groups: TrackGroup[]
  drm_systems: DrmSystem[]
  protocol_specific: Record<string, Record<string, unknown>>
  capabilities: Record<string, Capability>
  warnings: string[]
}

export interface ByteRange {
  offset: number
  length: number
}

export interface CapturedSegment {
  rep_id: string
  group_kind: string
  uri: string
  index: number
  is_init: boolean
  declared_duration_seconds: number | null
  byte_range: ByteRange | null
  byte_size: number | null
  sha256: string | null
  http_status: number | null
  fetched_at: string | null
  file: string | null
  error: string | null
}

export interface CaptureReport {
  window_seconds: number
  max_total_bytes: number
  max_segment_bytes: number
  max_playlists_followed: number
  planned: number
  captured: number
  failed: number
  total_bytes: number
}

export interface TimelineEntry {
  index: number
  start_seconds: number | null
  duration_seconds: number | null
  status: 'captured' | 'failed' | 'planned' | 'init'
  discontinuity: boolean
}

export interface RepresentationTimeline {
  rep_id: string
  group_kind: string
  entries: TimelineEntry[]
}

export interface BoxNodeDTO {
  type: string
  offset: number
  size: number
  fields: Record<string, unknown>
  children: BoxNodeDTO[]
}

export interface Fmp4InfoDTO {
  is_init: boolean
  brands: string[]
  boxes: BoxNodeDTO[]
  track_ids: number[]
  timescales: Record<string, number>
  sequence_number: number | null
  base_media_decode_time: number | null
  sample_counts: Record<string, number>
  hdr?: HdrInfoDTO | null
  truncated: boolean
  provenance: string
}

export interface HdrInfoDTO {
  color_primaries: string | null
  transfer_characteristics: string | null
  matrix_coefficients: string | null
  full_range: boolean | null
  static_metadata: Record<string, unknown>
  dynamic_metadata: string[]
  provenance: string
}

export interface TsPidDTO {
  pid: number
  stream_type: number | null
  stream_kind: string | null
  packet_count: number
  continuity_errors: number
  pes_count: number
  first_pts: number | null
  last_pts: number | null
  first_dts: number | null
  pcr_count: number
  last_pcr: number | null
}

export interface TsInfoDTO {
  packet_count: number
  sync_errors: number
  pids: TsPidDTO[]
  programs: Record<string, number>
  provenance: string
}

export interface ProbeStreamDTO {
  codec_name: string | null
  codec_type: string | null
  profile: string | null
  width: number | null
  height: number | null
  sample_rate: string | null
  channels: number | null
  color_range?: string | null
  color_space?: string | null
  color_transfer?: string | null
  color_primaries?: string | null
  bits_per_raw_sample?: string | null
  hdr_side_data?: string[]
}

export interface ProbeDTO {
  provenance: string
  format_name: string | null
  duration: string | null
  size: string | null
  bit_rate: string | null
  streams: ProbeStreamDTO[]
}

export interface ContainerDTO {
  rep_id: string
  group_kind: string
  index: number
  is_init: boolean
  file: string
  byte_size: number
  analysis: {
    kind: string
    fmp4: Fmp4InfoDTO | null
    ts: TsInfoDTO | null
    error: string | null
  }
  probe: ProbeDTO | null
}

export interface Snapshot {
  schema_version: string
  analyzer_version: string
  inspection_id: string
  created_at: string
  expires_at: string
  source: SnapshotSource
  manifest: ManifestSummary
  media: UnifiedMedia | null
  capture: CaptureReport | null
  segments: CapturedSegment[]
  timeline: RepresentationTimeline[]
  containers: ContainerDTO[]
  warnings: string[]
}
