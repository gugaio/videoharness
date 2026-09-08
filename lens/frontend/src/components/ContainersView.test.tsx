import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContainerInspector } from './ContainersView'
import type { ContainerDTO } from '../types'

const fmp4Container: ContainerDTO = {
  rep_id: 'v720',
  group_kind: 'video',
  index: 1,
  is_init: false,
  file: 'segments/0001_1.m4s',
  byte_size: 4096,
  analysis: {
    kind: 'mp4',
    error: null,
    ts: null,
    samples_truncated: false,
    samples: [
      {
        index: 0, unit_type: 'sample', byte_size: 1800, track_id: 1, pid: null,
        duration: 3000, dts: 180000, pts: 186000, composition_offset: 6000,
        timescale: 90000, is_sync: true,
      },
      {
        index: 1, unit_type: 'sample', byte_size: 420, track_id: 1, pid: null,
        duration: 3000, dts: 183000, pts: 180000, composition_offset: -3000,
        timescale: 90000, is_sync: false,
      },
    ],
    fmp4: {
      is_init: false,
      brands: ['iso6', 'cmfc'],
      track_ids: [1],
      timescales: { '1': 90000 },
      sequence_number: 7,
      base_media_decode_time: 180000,
      sample_counts: { '1': 120 },
      truncated: false,
      provenance: 'deterministic',
      boxes: [{
        type: 'moof', offset: 0, size: 256, fields: {},
        children: [{
          type: 'traf', offset: 24, size: 192, fields: { track_ID: 1 }, children: [],
        }],
      }],
    },
  },
  probe: {
    provenance: 'derived (ffprobe)',
    format_name: 'mov,mp4',
    duration: '4.000000',
    size: '4096',
    bit_rate: '8192',
    frames: [],
    frames_truncated: false,
    gop: null,
    streams: [{
      codec_name: 'h264', codec_type: 'video', profile: 'High', width: 1280,
      height: 720, sample_rate: null, channels: null,
    }],
  },
}

describe('ContainerInspector', () => {
  it('usa pict_type do ffprobe para separar frames I, P e B', () => {
    const withDerivedFrames: ContainerDTO = {
      ...fmp4Container,
      probe: {
        ...fmp4Container.probe!,
        frames: [
          {
            index: 0, stream_index: 0, pict_type: 'I', key_frame: true,
            byte_size: 1800, pts: 0, pts_time: '0.000000', dts: 0,
            dts_time: '0.000000', duration: 3000, duration_time: '0.033333',
          },
          {
            index: 1, stream_index: 0, pict_type: 'P', key_frame: false,
            byte_size: 700, pts: 6000, pts_time: '0.066667', dts: 3000,
            dts_time: '0.033333', duration: 3000, duration_time: '0.033333',
          },
          {
            index: 2, stream_index: 0, pict_type: 'B', key_frame: false,
            byte_size: 220, pts: 3000, pts_time: '0.033333', dts: 6000,
            dts_time: '0.066667', duration: 3000, duration_time: '0.033333',
          },
          {
            index: 3, stream_index: 0, pict_type: 'I', key_frame: true,
            byte_size: 1700, pts: 9000, pts_time: '0.100000', dts: 9000,
            dts_time: '0.100000', duration: 3000, duration_time: '0.033333',
          },
        ],
        gop: {
          starts_with_key_frame: true,
          first_key_frame_index: 0,
          key_frame_count: 2,
          i_frame_count: 2,
          p_frame_count: 1,
          b_frame_count: 1,
          unknown_frame_count: 0,
          intervals: [{
            start_frame_index: 0,
            next_key_frame_index: 3,
            frame_count: 3,
            duration_seconds: 0.1,
          }],
          trailing_gop: {
            start_frame_index: 3,
            observed_frame_count: 1,
            observed_duration_seconds: 0.033333,
          },
          truncated: false,
        },
      },
    }

    render(<ContainerInspector container={withDerivedFrames} />)

    const legend = screen.getByLabelText('Legenda dos tipos de frame e tamanhos')
    expect(within(legend).getByText('I-frame')).toBeInTheDocument()
    expect(within(legend).getByText('P-frame')).toBeInTheDocument()
    expect(within(legend).getByText('B-frame')).toBeInTheDocument()
    const frames = within(screen.getByRole('list', { name: 'Frames decodificados: Stream 0' }))
      .getAllByRole('listitem')
    expect(frames).toHaveLength(4)
    expect(frames[0]).toHaveTextContent('I 01')
    expect(frames[1]).toHaveTextContent('P 02')
    expect(frames[2]).toHaveTextContent('B 03')
    expect(frames[0]).toHaveTextContent('PTS 0.000s')
    const gop = screen.getByRole('region', { name: 'GOP observado' })
    expect(within(gop).getByText('Sim')).toBeInTheDocument()
    expect(within(gop).getByText('3 frames')).toBeInTheDocument()
    expect(within(gop).getByText('0.100s')).toBeInTheDocument()
    expect(within(gop).getByText('I 2 · P 1 · B 1')).toBeInTheDocument()
    expect(screen.getAllByText('derivado por ffprobe')).toHaveLength(2)
  })

  it('desenha frames em ordem com tamanho, PTS, DTS e sync visíveis', () => {
    render(<ContainerInspector container={fmp4Container} />)

    expect(screen.getByRole('heading', { name: 'Frames do segmento' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'GOP observado' })).not.toBeInTheDocument()
    const legend = screen.getByLabelText('Legenda dos frames e tamanhos')
    expect(within(legend).getByText('largura e altura = bytes')).toBeInTheDocument()
    expect(within(legend).getByText('quadro-chave (I/IDR/CRA)')).toBeInTheDocument()
    expect(within(legend).getByText('inter-frame (P/B)')).toBeInTheDocument()
    const track = screen.getByRole('list', { name: 'Frames do segmento: Track 1' })
    const frames = within(track).getAllByRole('listitem')
    expect(frames).toHaveLength(2)
    expect(frames[0]).toHaveTextContent('1.8 KiB')
    expect(frames[0]).toHaveTextContent('PTS 2.067s')
    expect(frames[0]).toHaveTextContent('DTS 2.000s')
    expect(frames[0]).toHaveTextContent('KEY 01')
    expect(frames[1]).toHaveTextContent('P/B 02')
    expect(frames[0]).toHaveClass('is-sync')
    expect(frames[0].style.getPropertyValue('--sample-width')).not.toBe(
      frames[1].style.getPropertyValue('--sample-width'),
    )
    expect(frames[0].style.getPropertyValue('--sample-color')).not.toBe(
      frames[1].style.getPropertyValue('--sample-color'),
    )
  })

  it('expõe duração e descontinuidade temporal sem tratá-las como diagnóstico', () => {
    const withTiming: ContainerDTO = {
      ...fmp4Container,
      analysis: {
        ...fmp4Container.analysis,
        timing: {
          declared_duration_seconds: 2,
          provenance: 'deterministic (container timestamps)',
          tracks: [{
            track_id: 1,
            pid: null,
            timescale: 90000,
            start_dts: 180000,
            end_dts: 360000,
            start_pts: 186000,
            end_pts: 366000,
            observed_duration_seconds: 2,
            boundary_delta_seconds: 0.066667,
          }],
        },
      },
    }

    render(<ContainerInspector container={withTiming} />)

    const section = screen.getByRole('heading', { name: 'Saúde temporal' }).closest('section')!
    expect(within(section).getAllByText('2.000s')).toHaveLength(2)
    expect(within(section).getByText('gap 0.067s')).toBeInTheDocument()
    expect(within(section).getByText(/não são considerados continuidade/)).toBeInTheDocument()
  })

  it('mostra fatos fMP4 e expande a árvore de boxes sob demanda', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ContainerInspector container={fmp4Container} />)

    expect(screen.getByRole('heading', { name: 'Árvore de boxes' })).toBeInTheDocument()
    expect(screen.getByText('media fragment')).toBeInTheDocument()
    expect(screen.getByText('iso6, cmfc')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /traf/ }))
    expect(screen.getByText('track_ID')).toBeInTheDocument()
    expect(screen.getAllByText('1')).toHaveLength(2)
  })

  it('mantém os dados do ffprobe recolhidos e marcados como derivados', () => {
    render(<ContainerInspector container={fmp4Container} />)
    expect(screen.getByText('Leitura de mídia')).toBeInTheDocument()
    expect(screen.getByText('derivado por ffprobe')).toBeInTheDocument()
    expect(screen.getByText('h264')).toBeInTheDocument()
  })

  it('mostra HDR estático e limita HDR dinâmico ao segmento observado', () => {
    const container: ContainerDTO = {
      ...fmp4Container,
      analysis: {
        ...fmp4Container.analysis,
        fmp4: {
          ...fmp4Container.analysis.fmp4!,
          hdr: {
            color_primaries: 'BT.2020',
            transfer_characteristics: 'PQ (ST 2084)',
            matrix_coefficients: 'BT.2020 non-constant',
            full_range: false,
            static_metadata: {
              mastering_display: { max_luminance_cd_m2: 1000, min_luminance_cd_m2: 0.005 },
              content_light_level: { max_cll_cd_m2: 1000, max_fall_cd_m2: 400 },
            },
            dynamic_metadata: ['HDR10+'],
            provenance: 'deterministic (ISOBMFF/HEVC bytes)',
          },
        },
      },
    }
    render(<ContainerInspector container={container} />)

    expect(screen.getByRole('heading', { name: 'HDR10 / PQ' })).toBeInTheDocument()
    expect(screen.getByText('BT.2020')).toBeInTheDocument()
    expect(screen.getByText('1000 / 400 cd/m²')).toBeInTheDocument()
    expect(screen.getByText('HDR10+ observado')).toBeInTheDocument()
    expect(screen.getByText(/somente neste segmento capturado/)).toBeInTheDocument()
  })
})
