import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Home } from './Home'

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Home', () => {
  it('renderiza o formulário com uma URL HTTP como exemplo', () => {
    renderHome()
    expect(screen.getByLabelText('URL do manifesto')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('https://exemplo.com/master.m3u8')).toBeInTheDocument()
  })

  it('submete a URL e navega para a inspeção criada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          inspection_id: 'abc-123',
          status: 'completed',
          status_url: '/api/v1/inspections/abc-123',
          view_url: '/inspect/abc-123',
          expires_at: '2026-01-01T01:00:00Z',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderHome()
    await user.type(screen.getByLabelText('URL do manifesto'), 'https://exemplo.com/master.m3u8')
    await user.click(screen.getByRole('button', { name: 'Inspecionar' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/v1/inspections')
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://exemplo.com/master.m3u8' })
    vi.unstubAllGlobals()
  })

  it('exibe erro da API sem quebrar a página', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'fetching_manifest: não suportada' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderHome()
    await user.type(screen.getByLabelText('URL do manifesto'), 'https://exemplo.com/x.m3u8')
    await user.click(screen.getByRole('button', { name: 'Inspecionar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('fetching_manifest')
    vi.unstubAllGlobals()
  })
})
