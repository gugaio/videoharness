import { useState, type CSSProperties } from 'react'
import type { BoxNodeDTO, ContainerDTO, ContainerSampleDTO } from '../types'

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MiB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${n} B`
}

function formatContainerTime(value: number | null, timescale: number | null): string | null {
  if (value === null) return null
  if (timescale && timescale > 0) return `${(value / timescale).toFixed(3)}s`
  return `${value} ticks`
}

function sampleGroupKey(sample: ContainerSampleDTO): string {
  if (sample.track_id !== null) return `track-${sample.track_id}`
  if (sample.pid !== null) return `pid-${sample.pid}`
  return 'unmapped'
}

function sampleGroupLabel(sample: ContainerSampleDTO): string {
  if (sample.track_id !== null) return `Track ${sample.track_id}`
  if (sample.pid !== null) return `PID 0x${sample.pid.toString(16).padStart(4, '0')}`
  return 'Track não identificado'
}

function sampleAriaLabel(sample: ContainerSampleDTO): string {
  const parts = [
    `${sample.unit_type === 'pes' ? 'PES' : 'Sample'} ${sample.index + 1}`,
    sample.byte_size !== null ? formatBytes(sample.byte_size) : 'tamanho não declarado',
  ]
  if (sample.pts !== null) parts.push(`PTS ${sample.pts} ticks`)
  if (sample.dts !== null) parts.push(`DTS ${sample.dts} ticks`)
  if (sample.duration !== null) parts.push(`duração ${sample.duration} ticks`)
  if (sample.is_sync === true) parts.push('sync sample')
  if (sample.is_sync === false) parts.push('non-sync sample')
  return parts.join(', ')
}

function sampleTypeLabel(sample: ContainerSampleDTO): string {
  if (sample.unit_type === 'pes') return 'PES'
  if (sample.is_sync === true) return 'KEY'
  if (sample.is_sync === false) return 'P/B'
  return '?'
}

function SampleTimeline({ container }: { container: ContainerDTO }) {
  const samples = container.analysis.samples ?? []
  if (samples.length === 0) return null

  const groups = new Map<string, ContainerSampleDTO[]>()
  for (const sample of samples) {
    const key = sampleGroupKey(sample)
    const group = groups.get(key)
    if (group) group.push(sample)
    else groups.set(key, [sample])
  }
  const heading = container.analysis.kind === 'mpeg-ts'
    ? 'Unidades PES do segmento'
    : container.group_kind === 'video'
      ? 'Frames do segmento'
      : 'Samples do segmento'

  return (
    <section className="sample-map" aria-labelledby="sample-map-heading">
      <div className="container-section-heading sample-map-heading">
        <div>
          <span className="eyebrow">Ordem no container</span>
          <h5 id="sample-map-heading">{heading}</h5>
        </div>
        <span className="provenance">bytes do arquivo</span>
      </div>
      <div className="sample-legend" aria-label="Legenda dos frames e tamanhos">
        <span><i className="sample-size-axis" aria-hidden="true">↔</i>largura e altura = bytes</span>
        {container.analysis.kind === 'mp4' && container.group_kind === 'video' ? (
          <>
            <span><i className="sample-type-key type-keyframe" />quadro-chave (I/IDR/CRA)</span>
            <span><i className="sample-type-key type-interframe" />inter-frame (P/B)</span>
            <span><i className="sample-type-key type-unknown" />tipo não sinalizado</span>
          </>
        ) : container.analysis.kind === 'mpeg-ts' ? (
          <span><i className="sample-type-key type-unknown" />tipo de frame não disponível no PES</span>
        ) : (
          <span><i className="sample-type-key type-unknown" />tipo não sinalizado</span>
        )}
      </div>
      {[...groups.entries()].map(([key, group]) => {
        const sizes = group.flatMap((sample) => sample.byte_size === null ? [] : [sample.byte_size])
        const minSize = sizes.length > 0 ? Math.min(...sizes) : 0
        const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0
        return (
          <div className="sample-lane" key={key}>
            <header>
              <strong>{sampleGroupLabel(group[0])}</strong>
              <span>{group.length} {group[0].unit_type === 'pes' ? 'PES' : group.length === 1 ? 'sample' : 'samples'}</span>
            </header>
            <div className="sample-track" role="list" aria-label={`${heading}: ${sampleGroupLabel(group[0])}`}>
              {group.map((sample) => {
                const normalized = sample.byte_size === null
                  ? null
                  : maxSize === minSize
                    ? 0.5
                    : (Math.sqrt(sample.byte_size) - Math.sqrt(minSize)) / (Math.sqrt(maxSize) - Math.sqrt(minSize))
                const typeColor = sample.is_sync === true
                  ? { color: 'hsl(38 70% 43%)', border: 'hsl(38 78% 62%)' }
                  : sample.is_sync === false
                    ? { color: 'hsl(200 70% 35%)', border: 'hsl(200 78% 52%)' }
                    : { color: '#26323c', border: '#667581' }
                const style = {
                  '--sample-width': `${normalized === null ? 96 : 86 + normalized * 110}px`,
                  '--sample-height': `${normalized === null ? 66 : 58 + normalized * 24}px`,
                  '--sample-color': typeColor.color,
                  '--sample-border': typeColor.border,
                } as CSSProperties
                const pts = formatContainerTime(sample.pts, sample.timescale)
                const dts = formatContainerTime(sample.dts, sample.timescale)
                return (
                  <div
                    className={`sample-block ${sample.is_sync === true ? 'is-sync' : ''}`}
                    key={`${key}-${sample.index}`}
                    role="listitem"
                    style={style}
                    title={sampleAriaLabel(sample)}
                    aria-label={sampleAriaLabel(sample)}
                  >
                    <span className="sample-index">{sampleTypeLabel(sample)} {String(sample.index + 1).padStart(2, '0')}</span>
                    <strong>{sample.byte_size === null ? '—' : formatBytes(sample.byte_size)}</strong>
                    <span className="sample-time">PTS {pts ?? '—'}</span>
                    <span className="sample-time">DTS {dts ?? '—'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {container.analysis.samples_truncated && (
        <p className="inline-warning">Visualização limitada aos primeiros {samples.length} itens na ordem do container.</p>
      )}
      {container.analysis.kind === 'mpeg-ts' && (
        <p className="container-note">Uma unidade PES pode conter mais de um frame; por isso ela não é classificada como frame sem evidência adicional.</p>
      )}
    </section>
  )
}

function BoxTree({ box, depth = 0 }: { box: BoxNodeDTO; depth?: number }) {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = box.children.length > 0
  const fields = Object.entries(box.fields)
  const expandable = hasChildren || fields.length > 0

  return (
    <li className="box-node" data-depth={depth}>
      <button
        type="button"
        className={`box-toggle ${hasChildren ? '' : 'box-leaf'}`}
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen(!open)}
        disabled={!expandable}
      >
        <span className="box-chevron" aria-hidden="true">
          {expandable ? (open ? '−' : '+') : '·'}
        </span>
        <code>{box.type}</code>
        <span className="box-meta">
          {formatBytes(box.size)} · offset {box.offset}
        </span>
      </button>

      {open && (
        <>
          {fields.length > 0 && (
            <dl className="box-fields">
              {fields.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {hasChildren && (
            <ul className="box-children">
              {box.children.map((child, index) => (
                <BoxTree key={`${child.type}-${child.offset}-${index}`} box={child} depth={depth + 1} />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  )
}

function HdrPanel({ container }: { container: ContainerDTO }) {
  const hdr = container.analysis.fmp4?.hdr
  if (!hdr) return null
  const mastering = hdr.static_metadata.mastering_display as Record<string, unknown> | undefined
  const light = hdr.static_metadata.content_light_level as Record<string, unknown> | undefined

  return (
    <section className="hdr-panel" aria-label="Metadados HDR">
      <div className="container-section-heading">
        <div>
          <span className="eyebrow">Metadados HDR</span>
          <h5>{hdr.transfer_characteristics === 'HLG' ? 'HLG' : hdr.transfer_characteristics?.includes('PQ') ? 'HDR10 / PQ' : 'Sinal de cor'}</h5>
        </div>
        <span className="provenance">bytes do arquivo</span>
      </div>
      <dl className="container-facts">
        <div><dt>Primárias</dt><dd>{hdr.color_primaries ?? 'não declaradas'}</dd></div>
        <div><dt>Transferência</dt><dd>{hdr.transfer_characteristics ?? 'não declarada'}</dd></div>
        <div><dt>Matriz</dt><dd>{hdr.matrix_coefficients ?? 'não declarada'}</dd></div>
        <div><dt>Range</dt><dd>{hdr.full_range === null ? 'não declarado' : hdr.full_range ? 'full' : 'limited'}</dd></div>
        {mastering && <div><dt>Mastering display</dt><dd>{String(mastering.max_luminance_cd_m2)} / {String(mastering.min_luminance_cd_m2)} cd/m²</dd></div>}
        {light && <div><dt>MaxCLL / MaxFALL</dt><dd>{String(light.max_cll_cd_m2)} / {String(light.max_fall_cd_m2)} cd/m²</dd></div>}
        {hdr.dynamic_metadata.length > 0 && <div><dt>HDR dinâmico</dt><dd>{hdr.dynamic_metadata.join(', ')} observado</dd></div>}
      </dl>
      {hdr.dynamic_metadata.length > 0 && <p className="container-note">Detectado somente neste segmento capturado; os parâmetros por cena/quadro não são decodificados.</p>}
    </section>
  )
}

function Fmp4Panel({ container }: { container: ContainerDTO }) {
  const fmp4 = container.analysis.fmp4!
  return (
    <section className="container-structure" aria-labelledby="box-tree-heading">
      <div className="container-section-heading">
        <div>
          <span className="eyebrow">Estrutura determinística</span>
          <h5 id="box-tree-heading">Árvore de boxes</h5>
        </div>
        <span className="provenance">bytes do arquivo</span>
      </div>
      <dl className="container-facts">
        <div>
          <dt>Tipo</dt>
          <dd>{fmp4.is_init ? 'init segment' : 'media fragment'}</dd>
        </div>
        <div>
          <dt>Brands</dt>
          <dd>{fmp4.brands.join(', ') || '—'}</dd>
        </div>
        <div>
          <dt>Tracks</dt>
          <dd>{fmp4.track_ids.join(', ') || '—'}</dd>
        </div>
        <div>
          <dt>Sequência</dt>
          <dd>{fmp4.sequence_number ?? '—'}</dd>
        </div>
        <div>
          <dt>Decode time</dt>
          <dd>{fmp4.base_media_decode_time ?? '—'}</dd>
        </div>
      </dl>
      <HdrPanel container={container} />
      {fmp4.truncated && <p className="inline-warning">Leitura estrutural truncada.</p>}
      <ul className="box-tree">
        {fmp4.boxes.map((box, index) => (
          <BoxTree key={`${box.type}-${box.offset}-${index}`} box={box} />
        ))}
      </ul>
    </section>
  )
}

function TsPanel({ container }: { container: ContainerDTO }) {
  const ts = container.analysis.ts!
  return (
    <section className="container-structure" aria-labelledby="pid-table-heading">
      <div className="container-section-heading">
        <div>
          <span className="eyebrow">Estrutura determinística</span>
          <h5 id="pid-table-heading">Programas e PIDs</h5>
        </div>
        <span className="provenance">bytes do arquivo</span>
      </div>
      <dl className="container-facts">
        <div>
          <dt>Pacotes</dt>
          <dd>{ts.packet_count}</dd>
        </div>
        <div>
          <dt>Programas</dt>
          <dd>{Object.keys(ts.programs).length}</dd>
        </div>
        <div>
          <dt>PIDs</dt>
          <dd>{ts.pids.length}</dd>
        </div>
        <div>
          <dt>Sync errors</dt>
          <dd className={ts.sync_errors > 0 ? 'value-warning' : undefined}>{ts.sync_errors}</dd>
        </div>
      </dl>
      <div className="table-scroll">
        <table className="structure-table">
          <thead>
            <tr>
              <th>PID</th>
              <th>Tipo</th>
              <th>Pacotes</th>
              <th>CC err</th>
              <th>PES</th>
              <th>PTS (1º / últ.)</th>
              <th>PCR</th>
            </tr>
          </thead>
          <tbody>
            {ts.pids.map((pid) => (
              <tr key={pid.pid} className={pid.continuity_errors > 0 ? 'row-warning' : undefined}>
                <td>
                  <code>0x{pid.pid.toString(16).padStart(4, '0')}</code>
                </td>
                <td>
                  {pid.stream_kind ??
                    (pid.stream_type !== null ? `type 0x${pid.stream_type.toString(16)}` : '—')}
                </td>
                <td>{pid.packet_count}</td>
                <td>{pid.continuity_errors}</td>
                <td>{pid.pes_count}</td>
                <td>{pid.first_pts !== null ? `${pid.first_pts} / ${pid.last_pts ?? '—'}` : '—'}</td>
                <td>{pid.pcr_count > 0 ? `${pid.pcr_count} · ${pid.last_pcr ?? '—'}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ProbePanel({ container }: { container: ContainerDTO }) {
  const probe = container.probe
  if (!probe) return null

  return (
    <details className="probe-details">
      <summary>
        <span>Leitura de mídia</span>
        <span className="provenance">derivado por ffprobe</span>
      </summary>
      <dl className="container-facts">
        <div>
          <dt>Formato</dt>
          <dd>{probe.format_name ?? '—'}</dd>
        </div>
        <div>
          <dt>Duração</dt>
          <dd>{probe.duration ? `${probe.duration}s` : '—'}</dd>
        </div>
        <div>
          <dt>Bitrate</dt>
          <dd>{probe.bit_rate ? `${probe.bit_rate} bps` : '—'}</dd>
        </div>
      </dl>
      <ul className="probe-streams">
        {probe.streams.map((stream, index) => (
          <li key={index}>
            <span>{stream.codec_type ?? 'stream'}</span>
            <code>{stream.codec_name ?? '—'}</code>
            {stream.profile && <span>{stream.profile}</span>}
            {stream.width && <span>{stream.width}×{stream.height}</span>}
            {stream.sample_rate && <span>{stream.sample_rate} Hz</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function ContainerInspector({ container }: { container: ContainerDTO }) {
  return (
    <div className="container-inspector">
      <SampleTimeline container={container} />
      {container.analysis.error ? (
        <p className="inline-warning" role="alert">{container.analysis.error}</p>
      ) : container.analysis.fmp4 ? (
        <Fmp4Panel container={container} />
      ) : container.analysis.ts ? (
        <TsPanel container={container} />
      ) : (
        <p className="empty-inline">Estrutura do container indisponível.</p>
      )}
      <ProbePanel container={container} />
    </div>
  )
}
