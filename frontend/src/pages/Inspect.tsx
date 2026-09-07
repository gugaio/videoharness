import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ApiError, getInspection, getSnapshot } from '../api'
import { TimelineView } from '../components/TimelineView'

const KIND_LABELS: Record<string, string> = {
  hls_master_playlist: 'Master playlist',
  hls_media_playlist: 'Media playlist',
  dash_mpd: 'MPD',
  unknown: 'Manifesto',
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Concluída',
  partial: 'Parcial',
  failed: 'Falhou',
  expired: 'Expirada',
}

const STAGE_LABELS: Record<string, string> = {
  queued: 'na fila',
  fetching_manifest: 'obtendo manifesto',
  parsing_manifest: 'interpretando manifesto',
  resolving_segments: 'resolvendo segmentos',
  capturing_segments: 'capturando segmentos',
  inspecting_containers: 'inspecionando containers',
  building_snapshot: 'construindo snapshot',
}

const ACTIVE_STATUSES = new Set([
  'queued',
  'fetching_manifest',
  'parsing_manifest',
  'resolving_segments',
  'capturing_segments',
  'inspecting_containers',
  'building_snapshot',
])
const TERMINAL_OK = new Set(['completed', 'partial'])

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MiB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${n} B`
}

function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="alert" className="state state-error">
      <p>{title}</p>
      {detail && <p className="state-detail">{detail}</p>}
      <p>
        <Link to="/">Voltar ao início</Link>
      </p>
    </div>
  )
}

export function Inspect() {
  const { inspectionId = '' } = useParams()

  const detail = useQuery({
    queryKey: ['inspection', inspectionId],
    queryFn: () => getInspection(inspectionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ACTIVE_STATUSES.has(status) ? 1000 : false
    },
  })

  const status = detail.data?.status
  const snapshot = useQuery({
    queryKey: ['snapshot', inspectionId],
    queryFn: () => getSnapshot(inspectionId),
    enabled: status !== undefined && TERMINAL_OK.has(status),
  })

  if (detail.isPending) return <p className="state">Carregando inspeção…</p>

  if (detail.isError) {
    const error = detail.error
    if (error instanceof ApiError && error.status === 410) {
      return <ErrorState title="Esta inspeção expirou (TTL)." />
    }
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorState title="Inspeção não encontrada." detail="O ID pode estar errado ou o resultado já expirou." />
    }
    return <ErrorState title="Falha ao carregar a inspeção." detail={error.message} />
  }

  const data = detail.data
  const isRunning = status !== undefined && ACTIVE_STATUSES.has(status)
  const timeline = snapshot.data?.timeline ?? []
  const segments = snapshot.data?.segments ?? []
  const containers = snapshot.data?.containers ?? []
  const manifest = snapshot.data?.manifest ?? data.manifest
  const source = snapshot.data?.source

  return (
    <section className="inspect">
      <nav aria-label="Navegação" className="breadcrumb">
        <Link to="/">← Nova inspeção</Link>
      </nav>

      <header className="inspection-summary">
        <div className="inspection-title">
          <div className="inspection-title-line">
            <span className={`badge badge-${status}`}>{STATUS_LABELS[status ?? ''] ?? status}</span>
            <h1>{data.protocol ?? (isRunning ? 'Inspeção' : status === 'failed' ? 'Inspeção não concluída' : 'Protocolo indisponível')}</h1>
            {manifest && <span className="manifest-kind">{KIND_LABELS[manifest.kind] ?? manifest.kind}</span>}
          </div>
          <p className="source-url" title={source?.display_url}>
            {source?.display_url ?? `ID ${data.inspection_id}`}
          </p>
        </div>

        {snapshot.data && (
          <button
            type="button"
            className="download-button"
            onClick={() => {
              const blob = new Blob([JSON.stringify(snapshot.data, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = `stream-lens-${snapshot.data?.inspection_id ?? 'snapshot'}.json`
              anchor.click()
              URL.revokeObjectURL(url)
            }}
          >
            <span aria-hidden="true">↓</span> Snapshot JSON
          </button>
        )}

        {manifest && (
          <dl className="inspection-metrics">
            <div>
              <dt>Modo</dt>
              <dd>{manifest.is_live ? 'Live' : 'VOD'}</dd>
            </div>
            {manifest.variant_count !== null && (
              <div>
                <dt>{manifest.protocol === 'DASH' ? 'Adaptation sets' : 'Variantes'}</dt>
                <dd>{manifest.variant_count}</dd>
              </div>
            )}
            {snapshot.data?.capture && (
              <div>
                <dt>Captura</dt>
                <dd>{snapshot.data.capture.captured}/{snapshot.data.capture.planned}</dd>
              </div>
            )}
            {snapshot.data?.capture && (
              <div>
                <dt>Dados</dt>
                <dd>{formatBytes(snapshot.data.capture.total_bytes)}</dd>
              </div>
            )}
            {containers.length > 0 && (
              <div>
                <dt>Containers</dt>
                <dd>{containers.length}</dd>
              </div>
            )}
          </dl>
        )}
      </header>

      {isRunning && (
        <p className="state progress-state" role="status">
          <span className="progress-pulse" aria-hidden="true" />
          {STAGE_LABELS[status!] ?? status}…
          {status === 'capturing_segments' && data.segments_planned !== null && (
            <span>
              {' '}{data.segments_captured ?? 0}
              {data.segments_failed ? ` + ${data.segments_failed} falhas` : ''}
              {' '}/ {data.segments_planned}
            </span>
          )}
        </p>
      )}

      {status === 'failed' && (
        <div role="alert" className="state state-error">
          {data.error_stage && (
            <p className="state-detail">
              estágio <code>{data.error_stage}</code>: {data.error_message}
            </p>
          )}
        </div>
      )}

      {snapshot.data && (timeline.length > 0 || snapshot.data.media?.track_groups.length) ? (
        <TimelineView
          media={snapshot.data.media}
          timeline={timeline}
          segments={segments}
          containers={containers}
          abrAlignment={snapshot.data.abr_alignment ?? []}
          bitrateObservations={snapshot.data.bitrate_observations ?? []}
          capture={snapshot.data.capture}
        />
      ) : null}

      {snapshot.isPending && TERMINAL_OK.has(status!) && (
        <p className="state progress-state" role="status">
          <span className="progress-pulse" aria-hidden="true" />
          Carregando snapshot…
        </p>
      )}

      {snapshot.data && timeline.length === 0 && !snapshot.data.media?.track_groups.length && (
        <div className="empty-surface">
          <p>Este snapshot não contém representações ou uma janela capturada.</p>
        </div>
      )}

      {snapshot.data?.warnings.length ? (
        <ul className="inspection-warnings" aria-label="Avisos da inspeção">
          {snapshot.data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      ) : null}

      {snapshot.data && (
        <details className="inspection-data">
          <summary>Dados técnicos e JSON</summary>
          <dl className="technical-meta">
            <div>
              <dt>Schema</dt>
              <dd>{snapshot.data.schema_version}</dd>
            </div>
            <div>
              <dt>Analyzer</dt>
              <dd>{snapshot.data.analyzer_version}</dd>
            </div>
            <div>
              <dt>Criada em</dt>
              <dd>{formatDateTime(data.created_at)}</dd>
            </div>
            <div>
              <dt>Expira em</dt>
              <dd>{formatDateTime(data.expires_at)}</dd>
            </div>
          </dl>

          {snapshot.data.media?.drm_systems.length ? (
            <p className="technical-note">
              DRM sinalizado: {snapshot.data.media.drm_systems.map((item) => item.system).join(', ')}
            </p>
          ) : null}

          {snapshot.data.media?.warnings.length ? (
            <ul className="inspection-warnings" aria-label="Avisos do manifesto">
              {snapshot.data.media.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          ) : null}

          {snapshot.data.media && Object.keys(snapshot.data.media.capabilities).length > 0 && (
            <div className="capabilities" aria-label="Capacidades do analyzer">
              {Object.entries(snapshot.data.media.capabilities).map(([name, capability]) => (
                <span key={name} className={`cap cap-${capability.status}`} title={capability.reason ?? undefined}>
                  {name} · {capability.status.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          )}

          {snapshot.data.media && Object.keys(snapshot.data.media.protocol_specific).length > 0 && (
            <details className="raw-json nested-details">
              <summary>Detalhes específicos do protocolo</summary>
              <pre><code>{JSON.stringify(snapshot.data.media.protocol_specific, null, 2)}</code></pre>
            </details>
          )}
          <details className="raw-json nested-details">
            <summary>JSON bruto</summary>
            <pre><code>{JSON.stringify(snapshot.data, null, 2)}</code></pre>
          </details>
        </details>
      )}
    </section>
  )
}
