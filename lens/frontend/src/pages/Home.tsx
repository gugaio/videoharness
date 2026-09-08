import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createInspection } from '../api'

export function Home() {
  const [url, setUrl] = useState('')
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: createInspection,
    onSuccess: (result) => navigate(`/inspect/${result.inspection_id}`),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = url.trim()
    if (trimmed) mutation.mutate({ url: trimmed })
  }

  return (
    <section className="home">
      <h1 className="home-title">Inspecione um stream</h1>

      <form onSubmit={onSubmit} className="url-form">
        <label htmlFor="manifest-url" className="url-label">
          URL do manifesto
        </label>
        <div className="url-row">
          <input
            id="manifest-url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://exemplo.com/master.m3u8"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-invalid={mutation.isError}
            aria-describedby="url-help"
            className="url-input"
          />
          <button type="submit" disabled={mutation.isPending || url.trim().length === 0}>
            {mutation.isPending ? 'Inspecionando…' : 'Inspecionar'}
          </button>
        </div>
        <p id="url-help" className="url-help">
          Aceita HLS ou DASH.
        </p>
        {mutation.isError && (
          <p role="alert" className="url-error">
            {mutation.error.message}
          </p>
        )}
      </form>
    </section>
  )
}
