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
    expect(within(matrix).getByText('2 segmentos')).toBeInTheDocument()
    expect(within(matrix).getByText('0.033s')).toBeInTheDocument()
    expect(within(matrix).getByText(/ausência de keyframe não confirma/)).toBeInTheDocument()
    expect(within(matrix).getByText('Maior desvio no início')).toBeInTheDocument()
    expect(within(matrix).getByRole('tooltip', { name: /início declarados no manifesto/ })).toBeInTheDocument()
  })

  it('explica bitrate calculado sem chamar tamanho de payload de complexidade', () => {
    render(<TimelineView media={media} timeline={timeline} segments={segments} capture={capture} bitrateObservations={bitrateObservations} />)
    const panel = screen.getByRole('heading', { name: 'Bitrate por segmento' }).closest('section')!
    expect(within(panel).getAllByText('4 kbps')).toHaveLength(3)
    expect(within(panel).getByText(/não mede a complexidade nem a qualidade/)).toBeInTheDocument()
    expect(within(panel).getByRole('tooltip', { name: /bytes dos segmentos capturados dividido/ })).toBeInTheDocument()
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
