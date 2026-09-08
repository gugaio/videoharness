import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Inspect } from './Inspect'

const DETAIL = {
  inspection_id: 'abc-123',
  status: 'completed',
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-01T01:00:00Z',
  protocol: 'HLS',
  manifest: {
    protocol: 'HLS',
    kind: 'hls_master_playlist',
    is_live: false,
    variant_count: 2,
    segment_count: null,
    rendition_count: 1,
  },
  error_stage: null,
  error_message: null,
  snapshot_url: '/api/v1/inspections/abc-123/snapshot',
}

const SNAPSHOT = {
  schema_version: '0.1',
  analyzer_version: '0.1.0',
  inspection_id: 'abc-123',
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-01T01:00:00Z',
  source: {
    display_url: 'fixture://hls-ts/master.m3u8',
    protocol: 'HLS',
    is_live: false,
  },
  manifest: DETAIL.manifest,
  media: null,
  capture: null,
  segments: [],
  timeline: [],
  containers: [],
  warnings: [],
}

function renderInspect(id = 'abc-123') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/inspect/${id}`]}>
        <Routes>
          <Route path="/inspect/:inspectionId" element={<Inspect />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function stubApi(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((path: string) => {
    for (const [prefix, payload] of Object.entries(responses)) {
      if (path.startsWith(prefix)) {
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  })
}

describe('Inspect', () => {
  it('mostra detalhes e snapshot da inspeção concluída', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi({
        '/api/v1/inspections/abc-123/snapshot': SNAPSHOT,
        '/api/v1/inspections/abc-123': DETAIL,
      }),
    )

    renderInspect()

    expect(await screen.findByText('Master playlist')).toBeInTheDocument()
    expect(screen.getByText('Variantes')).toBeInTheDocument()
    expect(await screen.findByText('fixture://hls-ts/master.m3u8')).toBeInTheDocument()
    expect(await screen.findByText('0.1')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('aceita snapshot legado sem blocos aditivos de captura ou containers', async () => {
    const { segments: _segments, timeline: _timeline, containers: _containers, ...legacy } = SNAPSHOT
    vi.stubGlobal(
      'fetch',
      stubApi({
        '/api/v1/inspections/abc-123/snapshot': legacy,
        '/api/v1/inspections/abc-123': DETAIL,
      }),
    )

    renderInspect()

    expect(await screen.findByText('Master playlist')).toBeInTheDocument()
    expect(await screen.findByText('Dados técnicos e JSON')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('mostra mensagem de falha para inspeção não encontrada', async () => {
    vi.stubGlobal('fetch', stubApi({}))
    renderInspect('inexistente')

    expect(await screen.findByRole('alert')).toHaveTextContent('Inspeção não encontrada')
    vi.unstubAllGlobals()
  })

  it('mostra estado de andamento enquanto o job executa', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi({
        '/api/v1/inspections/running-1': {
          ...DETAIL,
          inspection_id: 'running-1',
          status: 'fetching_manifest',
          protocol: null,
          manifest: null,
        },
      }),
    )
    renderInspect('running-1')

    expect(await screen.findByRole('status')).toHaveTextContent('obtendo manifesto')
    vi.unstubAllGlobals()
  })

  it('mostra estado distinto para inspeção expirada (410)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'inspeção expirada' }), {
          status: 410,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    renderInspect('expirada-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('expirou')
    vi.unstubAllGlobals()
  })
})
