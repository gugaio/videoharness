import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TimelineView } from './TimelineView'
import type {
  CapturedSegment,
  CaptureReport,
  ContainerDTO,
  RepresentationTimeline,
  UnifiedMedia,
  AbrAlignment,
  RepresentationBitrate,
  DeliveryReport,
  RepresentationBitstream,
} from '../types'

const timeline: RepresentationTimeline[] = [
  {
    rep_id: 'v360',
    group_kind: 'video',
    entries: [
      { index: -1, start_seconds: null, duration_seconds: null, status: 'init', discontinuity: false },
      { index: 1, start_seconds: 0, duration_seconds: 4, status: 'captured', discontinuity: false },
      { index: 2, start_seconds: 4, duration_seconds: 4, status: 'failed', discontinuity: false },
      { index: 3, start_seconds: 8, duration_seconds: 4, status: 'captured', discontinuity: true },
    ],
  },
]

const segments: CapturedSegment[] = [
  {
    rep_id: 'v360', group_kind: 'video', uri: 'fixture://x/init.mp4', index: -1, is_init: true,
    declared_duration_seconds: null, byte_range: null, byte_size: 1024, sha256: 'a'.repeat(64),
    http_status: null, fetched_at: '2026-09-05T00:00:00Z', file: 'segments/0000_init.mp4', error: null,
  },
  {
    rep_id: 'v360', group_kind: 'video', uri: 'fixture://x/1.ts', index: 1, is_init: false,
    declared_duration_seconds: 4, byte_range: null, byte_size: 2048, sha256: 'b'.repeat(64),
    http_status: 200, fetched_at: '2026-09-05T00:00:01Z', file: 'segments/0001_1.ts', error: null,
  },
  {
    rep_id: 'v360', group_kind: 'video', uri: 'fixture://x/2.ts', index: 2, is_init: false,
    declared_duration_seconds: 4, byte_range: null, byte_size: null, sha256: null,
    http_status: null, fetched_at: '2026-09-05T00:00:02Z', file: null, error: 'fixture não encontrada',
  },
]

const capture: CaptureReport = {
  window_seconds: 10,
  max_total_bytes: 8_000_000,
  max_segment_bytes: 2_000_000,
  max_playlists_followed: 8,
  planned: 4,
  captured: 3,
  failed: 1,
  total_bytes: 3072,
}

const abrAlignment: AbrAlignment[] = [{
  group_kind: 'video', reference_rep_id: 'v360', rep_id: 'v720', segments: [],
  comparison_basis: 'canonical segment sequence',
  unmatched_reference_segments: 1, unmatched_candidate_segments: 1,
  comparable_declared_segments: 2, comparable_keyframes: 1,
  max_abs_declared_start_delta_seconds: 0,
  max_abs_declared_duration_delta_seconds: 0,
  max_abs_keyframe_pts_delta_seconds: 0.033333,
  declared_provenance: 'declared (manifest timeline)', keyframe_provenance: 'derived (ffprobe)',
}]

const bitrateObservations: RepresentationBitrate[] = [{
  group_kind: 'video', rep_id: 'v360', declared_bandwidth_bps: 800_000,
  average_bitrate_bps: 4_096, peak_bitrate_bps: 4_096, lowest_bitrate_bps: 4_096,
  bitrate_provenance: 'calculated (captured segment bytes / duration)',
  segments: [{
    index: 1, byte_size: 2048, duration_seconds: 4,
    duration_provenance: 'declared (manifest duration)', bitrate_bps: 4_096,
    bitrate_ratio_to_declared: 0.0051, unit_count: 0, average_unit_bytes: null,
    largest_unit_bytes: null, unit_provenance: null,
  }],
}]

const delivery: DeliveryReport = {
  manifest_requests: [{ url: 'https://cdn.example/live.m3u8', delivery: { http_status: 200, ttfb_ms: 18, download_duration_ms: 24, effective_throughput_bps: 80_000, redirect_count: 0, cache_control: ['public'], cache_max_age_seconds: 10, cache_age_seconds: 2, cache_etag_present: true, provenance: 'observed (HTTP client)' } }],
  live_note: null,
  live_playlists: [{ rep_id: 'v360', playlist_url: 'https://cdn.example/live.m3u8', observed_at: '2026-01-01T00:00:20Z', media_sequence: 12, last_segment_sequence: 13, target_duration_seconds: 4, playlist_window_duration_seconds: 8, live_edge_program_date_time: '2026-01-01T00:00:16Z', live_edge_distance_seconds: 4, delivery: null, advancement: 'not measured (single playlist observation)', provenance: 'declared (HLS playlist)' }],
}

const bitstreamObservations: RepresentationBitstream[] = [{
  group_kind: 'video', rep_id: 'v360', provenance: 'derived (ffprobe stream configuration)',
  observed_segments: [{
    index: 1, segment_sequence: 101,
    video_start_pts: 90_000, video_start_seconds: 0,
    audio_start_pts: 2_304, audio_start_seconds: 0.048,
    av_start_delta_seconds: 0.048, av_start_provenance: 'derived (ffprobe presentation timestamps)',
    streams: [
      { stream_index: 0, kind: 'video', codec_name: 'h264', profile: 'High', level: 41, pixel_format: 'yuv420p', width: 1280, height: 720, frame_rate: '30000/1001', sample_rate: null, channels: null, channel_layout: null, start_time_seconds: 0 },
      { stream_index: 1, kind: 'audio', codec_name: 'aac', profile: 'LC', level: null, pixel_format: null, width: null, height: null, frame_rate: null, sample_rate: 48000, channels: 2, channel_layout: 'stereo', start_time_seconds: 0.048 },
    ],
  }, {
    index: 2, segment_sequence: 102,
    video_start_pts: 93_000, video_start_seconds: 0.033333,
    audio_start_pts: null, audio_start_seconds: null,
    av_start_delta_seconds: null, av_start_provenance: 'not available',
    streams: [
      { stream_index: 0, kind: 'video', codec_name: 'h264', profile: 'Main', level: 41, pixel_format: 'yuv420p', width: 1280, height: 720, frame_rate: '30000/1001', sample_rate: null, channels: null, channel_layout: null, start_time_seconds: 0 },
    ],
  }],
  configuration_changes: [{ from_index: 1, to_index: 2, changed_fields: ['profile', 'streams'] }],
}]

const media: UnifiedMedia = {
  protocol: 'HLS',
  kind: 'hls_master_playlist',
  is_live: false,
  track_groups: [{
    kind: 'video', name: 'variants', language: null,
    representations: [{
      id: 'v360', uri: 'video/360p.m3u8', codecs: 'avc1.64000d',
      bandwidth_bps: 800_000, average_bandwidth_bps: null,
      resolution: { width: 640, height: 360 }, frame_rate: 30,
      audio_sampling_rate: null, language: null, roles: [], init_segment: null,
      segments: [], segment_count_declared: 3, total_duration_seconds: 12,
    }],
  }],
  drm_systems: [], protocol_specific: { hls: {} }, capabilities: {}, warnings: [],
}

const container: ContainerDTO = {
  rep_id: 'v360', group_kind: 'video', index: 1, is_init: false,
  file: 'segments/0001_1.ts', byte_size: 2048,
  analysis: {
    kind: 'mpeg-ts', fmp4: null, error: null,
    samples_truncated: false,
    samples: [{
      index: 0, unit_type: 'pes', byte_size: 840, track_id: null, pid: 256,
      duration: 3600, dts: null, pts: 90000, composition_offset: null,
      timescale: 90000, is_sync: null,
    }],
    ts: {
      packet_count: 12, sync_errors: 0, programs: { '1': 256 }, provenance: 'deterministic',
      pids: [{
        pid: 256, stream_type: 27, stream_kind: 'video', packet_count: 8,
        continuity_errors: 0, pes_count: 1, first_pts: 90000, last_pts: 180000,
        first_dts: null, pcr_count: 1, last_pcr: 27000000,
      }],
    },
  },
  probe: null,
}

describe('TimelineView', () => {
  it('separa alinhamento declarado de evidência derivada de keyframe', () => {
    render(<TimelineView media={media} timeline={timeline} segments={segments} capture={capture} abrAlignment={abrAlignment} />)
    const matrix = screen.getByRole('heading', { name: 'Matriz de alinhamento ABR' }).closest('section')!
    expect(within(matrix).getByText('2 pares')).toBeInTheDocument()
    expect(within(matrix).getByText('pareado por sequência do segmento')).toBeInTheDocument()
    expect(within(matrix).getByText(/janela diferente: 1 sem par na referência; 1 na rendição/)).toBeInTheDocument()
    expect(within(matrix).getByText('0.033s')).toBeInTheDocument()
    expect(within(matrix).getByText(/ausência de keyframe não confirma/)).toBeInTheDocument()
    expect(within(matrix).getByText('Maior desvio no início')).toBeInTheDocument()
    expect(within(matrix).getByRole('tooltip', { name: /inícios declarados.*MEDIA-SEQUENCE/ })).toBeInTheDocument()
  })

  it('explica bitrate calculado sem chamar tamanho de payload de complexidade', () => {
    render(<TimelineView media={media} timeline={timeline} segments={segments} capture={capture} bitrateObservations={bitrateObservations} />)
    const panel = screen.getByRole('heading', { name: 'Bitrate por segmento' }).closest('section')!
    expect(within(panel).getAllByText('4 kbps')).toHaveLength(3)
    expect(within(panel).getByText(/não mede a complexidade nem a qualidade/)).toBeInTheDocument()
    expect(within(panel).getByRole('tooltip', { name: /bytes dos segmentos capturados dividido/ })).toBeInTheDocument()
  })

  it('separa medição HTTP da evidência live e explica a ausência de avanço', () => {
    render(<TimelineView media={media} timeline={timeline} segments={[{ ...segments[1], delivery: { http_status: 200, ttfb_ms: 18, download_duration_ms: 24, effective_throughput_bps: 80_000, redirect_count: 0, cache_control: ['public'], cache_max_age_seconds: 10, cache_age_seconds: 2, cache_etag_present: true, provenance: 'observed (HTTP client)' } }]} capture={capture} delivery={delivery} />)
    const panel = screen.getByRole('heading', { name: 'Entrega HTTP e live' }).closest('section')!
    expect(within(panel).getByText('18 ms')).toBeInTheDocument()
    expect(within(panel).getByText('80 kbps')).toBeInTheDocument()
    expect(within(panel).getByText('not measured (single playlist observation)')).toBeInTheDocument()
    expect(within(panel).getByRole('tooltip', { name: /Tempo entre iniciar a requisição/ })).toBeInTheDocument()
  })

  it('expõe configuração efetiva e delta A/V sem prometer compatibilidade', () => {
    render(<TimelineView media={media} timeline={timeline} segments={segments} capture={capture} bitstreamObservations={bitstreamObservations} />)
    const panel = screen.getByRole('heading', { name: 'Bitstream e sincronismo A/V' }).closest('section')!
    expect(within(panel).getByText('profile · streams presentes')).toBeInTheDocument()
    expect(within(panel).getByText('0.048s')).toBeInTheDocument()
    expect(within(panel).getByText('90000 (0.000000s)')).toBeInTheDocument()
    expect(within(panel).getByText('2304 (0.048000s)')).toBeInTheDocument()
    expect(within(panel).getByText(/não mede compatibilidade de dispositivo nem o sincronismo percebido/i)).toBeInTheDocument()
    expect(within(panel).getByRole('tooltip', { name: /PTS de apresentação inicial do áudio/ })).toBeInTheDocument()
  })

  it('resume a captura sem separar a timeline da visão principal', () => {
    render(<TimelineView media={media} timeline={timeline} segments={segments} capture={capture} />)
    const summary = screen.getByLabelText('Resumo da captura')
    expect(summary).toHaveTextContent('3/4 segmentos capturados')
    expect(summary).toHaveTextContent('1 falhas')
    expect(summary).toHaveTextContent('10s de janela')
  })

  it('coloca bitrate, identidade e segmentos dentro da mesma row', () => {
    render(<TimelineView media={media} timeline={timeline} segments={segments} capture={capture} />)
    const row = screen.getByRole('article', { name: 'Representação v360' })
    expect(within(row).getByText('360p')).toBeTruthy()
    expect(within(row).getByText('800 kbps')).toBeTruthy()
    const codec = within(row).getByLabelText(/avc1\.64000d.*profile High.*level 1\.3/i)
    expect(codec).toHaveTextContent('Profile High')
    expect(codec).toHaveTextContent('Level 1.3')
    const [profileTooltip, levelTooltip] = within(codec).getAllByRole('tooltip')
    expect(profileTooltip).toHaveTextContent('streaming HD')
    expect(profileTooltip).toHaveTextContent('Resolução e fps são limitados pelo Level')
    expect(levelTooltip).toHaveTextContent('320×240')
    expect(levelTooltip).toHaveTextContent('Não mede a qualidade')
    expect(codec.querySelector('.codec-profile')).toHaveAttribute('aria-describedby', profileTooltip.id)
    expect(codec.querySelector('.codec-level')).toHaveAttribute('aria-describedby', levelTooltip.id)
    expect(within(row).getByRole('group', { name: 'Segmentos de v360' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: /Segmento 2.*falhou/ })).toBeTruthy()
  })

  it('explica e colore profile e level HEVC', () => {
    const hevcMedia: UnifiedMedia = {
      ...media,
      track_groups: [{
        ...media.track_groups[0],
        representations: [{
          ...media.track_groups[0].representations[0],
          codecs: 'hvc1.2.4.L93.90',
        }],
      }],
    }
    render(<TimelineView media={hevcMedia} timeline={timeline} segments={segments} capture={capture} />)

    const row = screen.getByRole('article', { name: 'Representação v360' })
    const codec = within(row).getByLabelText(/hvc1\.2\.4\.L93\.90.*profile Main 10.*level 3\.1/i)
    expect(codec).toHaveTextContent('H.265/HEVC')
    expect(codec).toHaveTextContent('Tier Main')
    expect(codec).toHaveTextContent('Profile Main 10')
    expect(codec).toHaveTextContent('Level 3.1')
    expect(codec.querySelector('.codec-profile-byte')).toHaveTextContent('2')
    expect(codec.querySelector('.codec-tier-byte')).toHaveTextContent('L')
    expect(codec.querySelector('.codec-level-byte')).toHaveTextContent('93')
    const [profileTooltip, levelTooltip] = within(codec).getAllByRole('tooltip')
    expect(profileTooltip).toHaveTextContent('10 bits')
    expect(levelTooltip).toHaveTextContent('1280×720')
  })

  it('abre o erro do segmento diretamente sob a representação', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<TimelineView media={media} timeline={timeline} segments={segments} capture={capture} />)

    await user.click(screen.getByRole('button', { name: /Segmento 2.*falhou/ }))

    expect(screen.getByRole('region', { name: 'Detalhes de segmento 2' })).toHaveTextContent('fixture não encontrada')
  })

  it('faz o drill-down do segmento para a estrutura do container', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(
      <TimelineView
        media={media}
        timeline={timeline}
        segments={segments}
        capture={capture}
        containers={[container]}
      />,
    )

    expect(screen.queryByRole('heading', { name: 'Container MPEG-TS' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Segmento 1.*capturado/ }))

    expect(screen.getByRole('heading', { name: 'Container MPEG-TS' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Programas e PIDs' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Unidades PES do segmento' })).toBeInTheDocument()
    expect(screen.getByText('tipo de frame não disponível no PES')).toBeInTheDocument()
    expect(screen.getByText(/Uma unidade PES pode conter mais de um frame/)).toBeInTheDocument()
    expect(screen.getByText('0x0100')).toBeInTheDocument()
    expect(screen.getByText('2.0 KiB')).toBeInTheDocument()
  })
})
