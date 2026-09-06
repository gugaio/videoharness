import { useId, useMemo, useState } from 'react'
import type {
  CapturedSegment,
  CaptureReport,
  ContainerDTO,
  Representation,
  RepresentationTimeline,
  TimelineEntry,
  TrackGroup,
  UnifiedMedia,
} from '../types'
import {
  decodeCodecList,
  describeAvcLevel,
  describeAvcProfile,
  describeHevcLevel,
  describeHevcProfile,
} from '../codec'
import { ContainerInspector } from './ContainersView'

const KIND_LABELS: Record<string, string> = {
  video: 'Vídeo',
  audio: 'Áudio',
  subtitle: 'Legendas',
  closed_captions: 'Closed captions',
  unknown: 'Mídia',
}

const STATUS_LABELS: Record<TimelineEntry['status'], string> = {
  captured: 'capturado',
  failed: 'falhou',
  planned: 'planejado',
  init: 'init',
}

interface DisplayRow {
  rep: Representation | null
  timeline: RepresentationTimeline | null
  repId: string
  kind: string
}

interface DisplayGroup {
  key: string
  kind: string
  name: string | null
  language: string | null
  rows: DisplayRow[]
}

function formatBytes(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MiB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${n} B`
}

function formatBandwidth(bps: number | null): string {
  if (bps === null) return '—'
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  return `${Math.round(bps / 1000)} kbps`
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
}

function segmentKey(repId: string, index: number, isInit: boolean): string {
  return `${repId}\u0000${isInit ? 'init' : index}`
}

function mediaGroups(media: UnifiedMedia | null, timeline: RepresentationTimeline[]): DisplayGroup[] {
  const usedTimeline = new Set<RepresentationTimeline>()
  const groups: DisplayGroup[] = (media?.track_groups ?? []).map((group, groupIndex) => ({
    key: `${group.kind}-${group.name ?? groupIndex}`,
    kind: group.kind,
    name: group.name,
    language: group.language,
    rows: [...group.representations]
      .sort((a, b) => (a.bandwidth_bps ?? a.average_bandwidth_bps ?? 0) - (b.bandwidth_bps ?? b.average_bandwidth_bps ?? 0))
      .map((rep) => {
        const matched = timeline.find(
          (item) => item.rep_id === rep.id && item.group_kind === group.kind && !usedTimeline.has(item),
        ) ?? timeline.find((item) => item.rep_id === rep.id && !usedTimeline.has(item)) ?? null
        if (matched) usedTimeline.add(matched)
        return { rep, timeline: matched, repId: rep.id, kind: group.kind }
      }),
  }))

  for (const orphan of timeline.filter((item) => !usedTimeline.has(item))) {
    let group = groups.find((item) => item.kind === orphan.group_kind && item.name === null)
    if (!group) {
      group = {
        key: `timeline-${orphan.group_kind}`,
        kind: orphan.group_kind,
        name: null,
        language: null,
        rows: [],
      }
      groups.push(group)
    }
    group.rows.push({ rep: null, timeline: orphan, repId: orphan.rep_id, kind: orphan.group_kind })
  }

  return groups.filter((group) => group.rows.length > 0)
}

function representationLabel(rep: Representation | null, group: Pick<TrackGroup, 'kind' | 'language' | 'name'>): string {
  if (rep?.resolution) return `${rep.resolution.height}p`
  if (group.kind === 'audio') return rep?.language ?? group.language ?? group.name ?? 'Áudio'
  if (group.kind === 'subtitle') return rep?.language ?? group.language ?? group.name ?? 'Legenda'
  return rep?.id.split('/').at(-1) ?? 'Faixa'
}

function representationSpecs(rep: Representation | null): string[] {
  if (!rep) return []
  const specs: string[] = []
  if (rep.resolution) specs.push(`${rep.resolution.width}×${rep.resolution.height}`)
  if (rep.frame_rate !== null) specs.push(`${rep.frame_rate} fps`)
  if (rep.audio_sampling_rate !== null) specs.push(`${(rep.audio_sampling_rate / 1000).toFixed(1)} kHz`)
  return specs
}

function CodecSummary({ value }: { value: string }) {
  const tooltipBaseId = useId()

  return (
    <div className="codec-stack">
      {decodeCodecList(value).map((codec, index) => {
        const profileTooltipId = `${tooltipBaseId}-profile-${index}`
        const levelTooltipId = `${tooltipBaseId}-level-${index}`
        if (codec.avc) {
          const avc = codec.avc
          return (
            <div
              className="codec-summary"
              key={`${codec.raw}-${index}`}
              aria-label={`${codec.raw}: ${codec.family}, profile ${avc.profile}, level ${avc.level}`}
            >
              <code
                className="codec-string"
                title={`${avc.profileHex} identifica o profile; ${avc.constraintsHex} contém as restrições; ${avc.levelHex} identifica o level`}
              >
                {avc.prefix}.<span className="codec-profile-byte">{avc.profileHex}</span>
                <span className="codec-constraints-byte">{avc.constraintsHex}</span>
                <span className="codec-level-byte">{avc.levelHex}</span>
              </code>
              <span className="codec-family">{codec.family}</span>
              <span className="codec-pill codec-profile codec-pill-help" tabIndex={0} aria-describedby={profileTooltipId}>
                Profile <strong>{avc.profile}</strong>
                <span className="codec-tooltip codec-tooltip-profile" id={profileTooltipId} role="tooltip">
                  <strong>O que significa Profile {avc.profile}?</strong>
                  <span>{describeAvcProfile(avc.profile)}</span>
                  <span>Profile define quais ferramentas de compressão o decoder deve conhecer. Resolução e fps são limitados pelo Level.</span>
                </span>
              </span>
              <span className="codec-pill codec-level codec-pill-help" tabIndex={0} aria-describedby={levelTooltipId}>
                Level <strong>{avc.level}</strong>
                <span className="codec-tooltip" id={levelTooltipId} role="tooltip">
                  <strong>O que significa Level {avc.level}?</strong>
                  <span>{describeAvcLevel(avc.level)}</span>
                  <span>É um limite de capacidade do decoder — combina resolução, fps, bitrate e buffer. Não mede a qualidade da imagem.</span>
                </span>
              </span>
            </div>
          )
        }

        if (codec.hevc) {
          const hevc = codec.hevc
          const profileId = `${hevc.profileSpace}${hevc.profileIdc}`
          return (
            <div
              className="codec-summary"
              key={`${codec.raw}-${index}`}
              aria-label={`${codec.raw}: ${codec.family}, profile ${hevc.profile}, ${hevc.tier === 'H' ? 'High' : 'Main'} tier, level ${hevc.level}`}
            >
              <code
                className="codec-string"
                title={`${profileId} identifica o profile; ${hevc.compatibilityFlags} são flags de compatibilidade; ${hevc.tier}${hevc.levelIdc} identifica tier e level`}
              >
                {hevc.prefix}.<span className="codec-profile-byte">{profileId}</span>.
                <span className="codec-constraints-byte">{hevc.compatibilityFlags}</span>.
                <span className="codec-tier-byte">{hevc.tier}</span><span className="codec-level-byte">{hevc.levelIdc}</span>
                {hevc.constraintFlags && <>.<span className="codec-constraints-byte">{hevc.constraintFlags}</span></>}
              </code>
              <span className="codec-family">{codec.family}</span>
              <span className="codec-pill codec-tier">Tier <strong>{hevc.tier === 'H' ? 'High' : 'Main'}</strong></span>
              <span className="codec-pill codec-profile codec-pill-help" tabIndex={0} aria-describedby={profileTooltipId}>
                Profile <strong>{hevc.profile}</strong>
                <span className="codec-tooltip codec-tooltip-profile" id={profileTooltipId} role="tooltip">
                  <strong>O que significa Profile {hevc.profile}?</strong>
                  <span>{describeHevcProfile(hevc.profile)}</span>
                  <span>Profile define recursos e profundidade de bits que o decoder HEVC precisa suportar.</span>
                </span>
              </span>
              <span className="codec-pill codec-level codec-pill-help" tabIndex={0} aria-describedby={levelTooltipId}>
                Level <strong>{hevc.level}</strong>
                <span className="codec-tooltip" id={levelTooltipId} role="tooltip">
                  <strong>O que significa Level {hevc.level}?</strong>
                  <span>{describeHevcLevel(hevc.level)}</span>
                  <span>{hevc.tier === 'H' ? 'High Tier' : 'Main Tier'} é sinalizado separadamente; level limita resolução, fps, bitrate e buffer, não a qualidade.</span>
                </span>
              </span>
            </div>
          )
        }

        return (
          <div className="codec-summary codec-unknown" key={`${codec.raw}-${index}`}>
            <code>{codec.raw}</code>
          </div>
        )
      })}
    </div>
  )
}

function SegmentDetail({
  repId,
  repLabel,
  entry,
  segment,
  container,
  onClose,
}: {
  repId: string
  repLabel: string
  entry: TimelineEntry
  segment: CapturedSegment | null
  container: ContainerDTO | null
  onClose: () => void
}) {
  const itemLabel = entry.status === 'init' ? 'Init segment' : `Segmento ${entry.index}`

  return (
    <section className="segment-detail" aria-label={`Detalhes de ${itemLabel.toLowerCase()}`}>
      <header className="segment-detail-header">
        <div>
          <nav className="detail-path" aria-label="Caminho da seleção">
            <span>{repLabel}</span>
            <span aria-hidden="true">/</span>
            <span>{itemLabel}</span>
            {container && (
              <>
                <span aria-hidden="true">/</span>
                <span>{container.analysis.kind}</span>
              </>
            )}
          </nav>
          <h4>{container ? `Container ${container.analysis.kind.toUpperCase()}` : itemLabel}</h4>
        </div>
        <button type="button" className="icon-button" aria-label="Fechar detalhes do segmento" onClick={onClose}>
          ×
        </button>
      </header>

      <dl className="segment-facts">
        <div>
          <dt>Status</dt>
          <dd className={`status-${entry.status}`}>{STATUS_LABELS[entry.status]}</dd>
        </div>
        <div>
          <dt>Duração</dt>
          <dd>{formatDuration(entry.duration_seconds ?? segment?.declared_duration_seconds ?? null)}</dd>
        </div>
        <div>
          <dt>Tamanho</dt>
          <dd>{formatBytes(segment?.byte_size ?? container?.byte_size ?? null)}</dd>
        </div>
        <div>
          <dt>HTTP</dt>
          <dd>{segment?.http_status ?? '—'}</dd>
        </div>
      </dl>

      {segment?.error && <p className="inline-warning" role="alert">{segment.error}</p>}
      {container ? (
        <ContainerInspector container={container} />
      ) : !segment?.error ? (
        <p className="empty-inline">Container não disponível para este segmento.</p>
      ) : null}

      {(segment || container) && (
        <details className="segment-trace">
          <summary>Arquivo e rastreabilidade</summary>
          <dl>
            <div>
              <dt>Representação</dt>
              <dd><code>{repId}</code></dd>
            </div>
            <div>
              <dt>Arquivo</dt>
              <dd><code>{container?.file ?? segment?.file ?? '—'}</code></dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd><code>{segment?.sha256 ?? '—'}</code></dd>
            </div>
          </dl>
        </details>
      )}
    </section>
  )
}

function RepresentationRow({
  row,
  group,
  maxBandwidth,
  segments,
  containers,
  selected,
  onSelect,
}: {
  row: DisplayRow
  group: DisplayGroup
  maxBandwidth: number
  segments: CapturedSegment[]
  containers: ContainerDTO[]
  selected: string | null
  onSelect: (key: string | null) => void
}) {
  const rep = row.rep
  const entries = row.timeline?.entries ?? []
  const bitrate = rep?.bandwidth_bps ?? rep?.average_bandwidth_bps ?? null
  const barWidth = bitrate !== null && maxBandwidth > 0 ? Math.max(5, (bitrate / maxBandwidth) * 100) : 0
  const label = representationLabel(rep, group)
  const specs = representationSpecs(rep)
  const captured = entries.filter((entry) => entry.status === 'captured').length
  const mediaEntries = entries.filter((entry) => entry.status !== 'init')

  const selectedEntry = entries.find((entry) => segmentKey(row.repId, entry.index, entry.status === 'init') === selected) ?? null
  const selectedSegment = selectedEntry
    ? segments.find(
        (item) => item.rep_id === row.repId && item.index === selectedEntry.index && item.is_init === (selectedEntry.status === 'init'),
      ) ?? null
    : null
  const selectedContainer = selectedEntry
    ? containers.find(
        (item) => item.rep_id === row.repId && item.index === selectedEntry.index && item.is_init === (selectedEntry.status === 'init'),
      ) ?? null
    : null

  return (
    <article className={`representation-row kind-${row.kind}`} aria-label={`Representação ${row.repId}`}>
      <div className="representation-identity">
        <span className="kind-marker" aria-hidden="true" />
        <div className="quality-block">
          <strong>{label}</strong>
          <span title={row.repId}>{row.repId}</span>
        </div>
        {specs.length > 0 && <p>{specs.join(' · ')}</p>}
        {rep?.codecs && <CodecSummary value={rep.codecs} />}
      </div>

      <div className="bitrate-cell">
        <div className="bitrate-value">
          <span>Bitrate</span>
          <strong>{formatBandwidth(bitrate)}</strong>
        </div>
        <div className="bitrate-track" aria-hidden="true">
          <span style={{ width: `${barWidth}%` }} />
        </div>
      </div>

      <div className="segments-cell">
        <div className="segments-head">
          <span>Segmentos</span>
          {mediaEntries.length > 0 && (
            <span>{captured}/{mediaEntries.length} capturados</span>
          )}
        </div>
        {entries.length > 0 ? (
          <div className="segment-track" role="group" aria-label={`Segmentos de ${row.repId}`}>
            {entries.map((entry, index) => {
              const isInit = entry.status === 'init'
              const key = segmentKey(row.repId, entry.index, isInit)
              const segment = segments.find(
                (item) => item.rep_id === row.repId && item.index === entry.index && item.is_init === isInit,
              )
              const container = containers.find(
                (item) => item.rep_id === row.repId && item.index === entry.index && item.is_init === isInit,
              )
              const canInspect = Boolean(segment || container)
              const segmentLabel = isInit ? 'init' : String(entry.index).padStart(2, '0')
              return (
                <button
                  key={`${key}-${index}`}
                  type="button"
                  className={`segment-block segment-${entry.status} ${selected === key ? 'is-selected' : ''} ${entry.discontinuity ? 'has-discontinuity' : ''}`}
                  style={{
                    flexGrow: Math.max(entry.duration_seconds ?? 1, 1),
                    flexBasis: `${Math.max(52, (entry.duration_seconds ?? 1) * 14)}px`,
                  }}
                  aria-label={`Segmento ${isInit ? 'init' : entry.index} de ${row.repId}: ${STATUS_LABELS[entry.status]}`}
                  aria-pressed={selected === key}
                  disabled={!canInspect}
                  onClick={() => onSelect(selected === key ? null : key)}
                >
                  <span className="segment-index">{segmentLabel}</span>
                  <span className="segment-duration">{isInit ? 'map' : formatDuration(entry.duration_seconds)}</span>
                  {container && <span className="container-mark" aria-hidden="true">◇</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="timeline-empty">
            {rep?.segment_count_declared !== null && rep?.segment_count_declared !== undefined
              ? `${rep.segment_count_declared} declarados · sem janela capturada`
              : 'Sem janela capturada'}
          </div>
        )}
      </div>

      {selectedEntry && (
        <SegmentDetail
          repId={row.repId}
          repLabel={label}
          entry={selectedEntry}
          segment={selectedSegment}
          container={selectedContainer}
          onClose={() => onSelect(null)}
        />
      )}
    </article>
  )
}

export function TimelineView({
  media = null,
  timeline,
  segments,
  containers = [],
  capture,
}: {
  media?: UnifiedMedia | null
  timeline: RepresentationTimeline[]
  segments: CapturedSegment[]
  containers?: ContainerDTO[]
  capture: CaptureReport | null
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const groups = useMemo(() => mediaGroups(media, timeline), [media, timeline])

  return (
    <section className="stream-map" aria-labelledby="representations-heading">
      <header className="stream-map-header">
        <div>
          <span className="eyebrow">Apresentação</span>
          <h2 id="representations-heading">Representações</h2>
        </div>
        {capture && (
          <div className="capture-inline" aria-label="Resumo da captura">
            <span><strong>{capture.captured}/{capture.planned}</strong> segmentos capturados</span>
            <span><strong>{formatBytes(capture.total_bytes)}</strong></span>
            <span><strong>{capture.window_seconds}s</strong> de janela</span>
            {capture.failed > 0 && <span className="value-warning"><strong>{capture.failed}</strong> falhas</span>}
          </div>
        )}
      </header>

      <div className="segment-legend" aria-label="Legenda dos segmentos">
        <span><i className="legend-dot captured" />capturado</span>
        <span><i className="legend-dot init" />init</span>
        <span><i className="legend-dot failed" />falhou</span>
        <span><i className="legend-container">◇</i>container</span>
      </div>

      <div className="track-groups">
        {groups.map((group) => {
          const maxBandwidth = Math.max(
            ...group.rows.map((row) => row.rep?.bandwidth_bps ?? row.rep?.average_bandwidth_bps ?? 0),
            1,
          )
          return (
            <section className="track-group" key={group.key} aria-labelledby={`track-group-${group.key}`}>
              <header className="track-group-header">
                <h3 id={`track-group-${group.key}`}>{KIND_LABELS[group.kind] ?? group.kind}</h3>
                {(group.language || group.name) && (
                  <span>{[group.language, group.name].filter(Boolean).join(' · ')}</span>
                )}
                <span>{group.rows.length}</span>
              </header>
              <div className="representation-list">
                {group.rows.map((row, index) => (
                  <RepresentationRow
                    key={`${group.key}-${row.repId}-${index}`}
                    row={row}
                    group={group}
                    maxBandwidth={maxBandwidth}
                    segments={segments}
                    containers={containers}
                    selected={selected}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}
