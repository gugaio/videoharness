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
  segment_sequence?: number | null
  declared_duration_seconds: number | null
  byte_range: ByteRange | null
  byte_size: number | null
  sha256: string | null
  http_status: number | null
  fetched_at: string | null
  file: string | null
  error: string | null
  delivery?: DeliveryObservation | null
}

export interface DeliveryObservation {
  http_status: number | null
  ttfb_ms: number | null
  download_duration_ms: number | null
  effective_throughput_bps: number | null
  redirect_count: number | null
  cache_control: string[]
  cache_max_age_seconds: number | null
  cache_age_seconds: number | null
  cache_etag_present: boolean | null
  provenance: string
}

export interface LivePlaylistObservation {
  rep_id: string | null
  playlist_url: string
  observed_at: string
  media_sequence: number | null
  last_segment_sequence: number | null
  target_duration_seconds: number | null
  playlist_window_duration_seconds: number | null
  live_edge_program_date_time: string | null
  live_edge_distance_seconds: number | null
  delivery: DeliveryObservation | null
  advancement: string
  provenance: string
}

export interface DeliveryReport {
  manifest_requests: { url: string; delivery: DeliveryObservation | null }[]
  live_playlists: LivePlaylistObservation[]
  live_note: string | null
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
  segment_sequence?: number | null
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

export interface AbrSegmentAlignment {
  index: number
  candidate_index?: number | null
  segment_sequence?: number | null
  declared_start_delta_seconds: number | null
  declared_duration_delta_seconds: number | null
  keyframe_pts_delta_seconds: number | null
}

export interface AbrAlignment {
  group_kind: string
  reference_rep_id: string
  rep_id: string
  segments: AbrSegmentAlignment[]
  comparison_basis?: string
  unmatched_reference_segments?: number
  unmatched_candidate_segments?: number
  comparable_declared_segments: number
  comparable_keyframes: number
  max_abs_declared_start_delta_seconds: number | null
  max_abs_declared_duration_delta_seconds: number | null
  max_abs_keyframe_pts_delta_seconds: number | null
  declared_provenance: string
  keyframe_provenance: string
}

export interface SegmentBitrate {
  index: number
  byte_size: number
  duration_seconds: number
  duration_provenance: string
  bitrate_bps: number
  bitrate_ratio_to_declared: number | null
  unit_count: number
  average_unit_bytes: number | null
  largest_unit_bytes: number | null
  unit_provenance: string | null
}

export interface RepresentationBitrate {
  group_kind: string
  rep_id: string
  declared_bandwidth_bps: number | null
  segments: SegmentBitrate[]
  average_bitrate_bps: number | null
  peak_bitrate_bps: number | null
  lowest_bitrate_bps: number | null
  bitrate_provenance: string
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

export interface ContainerSampleDTO {
  index: number
  unit_type: 'sample' | 'pes'
  byte_size: number | null
  track_id: number | null
  pid: number | null
  duration: number | null
  dts: number | null
  pts: number | null
  composition_offset: number | null
  timescale: number | null
  is_sync: boolean | null
}

export interface TimingTrackDTO {
  track_id: number | null
  pid: number | null
  timescale: number | null
  start_dts: number | null
  end_dts: number | null
  start_pts: number | null
  end_pts: number | null
  observed_duration_seconds: number | null
  boundary_delta_seconds: number | null
}

export interface ContainerTimingDTO {
  declared_duration_seconds: number | null
  tracks: TimingTrackDTO[]
  provenance: string
}

export interface ProbeStreamDTO {
  index?: number | null
  codec_name: string | null
  codec_type: string | null
  profile: string | null
  level?: number | null
  pix_fmt?: string | null
  width: number | null
  height: number | null
  r_frame_rate?: string | null
  sample_rate: string | null
  channels: number | null
  channel_layout?: string | null
  start_time?: string | null
  color_range?: string | null
  color_space?: string | null
  color_transfer?: string | null
  color_primaries?: string | null
  bits_per_raw_sample?: string | null
  hdr_side_data?: string[]
}

export interface ProbeFrameDTO {
  index: number
  stream_index: number | null
  pict_type: 'I' | 'P' | 'B' | null
  key_frame: boolean | null
  byte_size: number | null
  pts: number | null
  pts_time: string | null
  dts: number | null
  dts_time: string | null
  duration: number | null
  duration_time: string | null
}

export interface ProbeGopIntervalDTO {
  start_frame_index: number
  next_key_frame_index: number
  frame_count: number
  duration_seconds: number | null
}

export interface ProbeTrailingGopDTO {
  start_frame_index: number
  observed_frame_count: number
  observed_duration_seconds: number | null
}

export interface ProbeGopDTO {
  starts_with_key_frame: boolean | null
  first_key_frame_index: number | null
  key_frame_count: number
  i_frame_count: number
  p_frame_count: number
  b_frame_count: number
  unknown_frame_count: number
  intervals: ProbeGopIntervalDTO[]
  trailing_gop: ProbeTrailingGopDTO | null
  truncated: boolean
}

export interface ProbeDTO {
  provenance: string
  format_name: string | null
  duration: string | null
  size: string | null
  bit_rate: string | null
  streams: ProbeStreamDTO[]
  frames: ProbeFrameDTO[]
  frames_truncated: boolean
  gop: ProbeGopDTO | null
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
    samples: ContainerSampleDTO[]
    samples_truncated: boolean
    timing?: ContainerTimingDTO | null
    error: string | null
  }
  probe: ProbeDTO | null
}

export interface EffectiveStreamConfiguration {
  stream_index: number | null
  kind: 'video' | 'audio'
  codec_name: string | null
  profile: string | null
  level: number | null
  pixel_format: string | null
  width: number | null
  height: number | null
  frame_rate: string | null
  sample_rate: number | null
  channels: number | null
  channel_layout: string | null
  start_time_seconds: number | null
}

export interface BitstreamSegmentObservation {
  index: number
  segment_sequence: number | null
  streams: EffectiveStreamConfiguration[]
  video_start_pts: number | null
  video_start_seconds: number | null
  audio_start_pts: number | null
  audio_start_seconds: number | null
  av_start_delta_seconds: number | null
  av_start_provenance: string
}

export interface BitstreamConfigurationChange {
  from_index: number
  to_index: number
  changed_fields: string[]
}

export interface RepresentationBitstream {
  group_kind: string
  rep_id: string
  observed_segments: BitstreamSegmentObservation[]
  configuration_changes: BitstreamConfigurationChange[]
  provenance: string
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
  abr_alignment?: AbrAlignment[]
  bitrate_observations?: RepresentationBitrate[]
  delivery?: DeliveryReport | null
  bitstream_observations?: RepresentationBitstream[]
  warnings: string[]
}
