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
    streams: [{
      codec_name: 'h264', codec_type: 'video', profile: 'High', width: 1280,
      height: 720, sample_rate: null, channels: null,
    }],
  },
}

describe('ContainerInspector', () => {
  it('desenha frames em ordem com tamanho, PTS, DTS e sync visíveis', () => {
    render(<ContainerInspector container={fmp4Container} />)

    expect(screen.getByRole('heading', { name: 'Frames do segmento' })).toBeInTheDocument()
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
