import { useState, type CSSProperties } from 'react'
import type {
  BoxNodeDTO,
  ContainerDTO,
  ContainerSampleDTO,
  ProbeFrameDTO,
  ProbeGopDTO,
} from '../snapshot'

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

function visualUnitStyle(
  byteSize: number | null,
  minSize: number,
  maxSize: number,
  color: string,
  border: string,
): CSSProperties {
  const normalized = byteSize === null
    ? null
    : maxSize === minSize
      ? 0.5
      : (Math.sqrt(byteSize) - Math.sqrt(minSize)) / (Math.sqrt(maxSize) - Math.sqrt(minSize))
  return {
    '--sample-width': `${normalized === null ? 96 : 86 + normalized * 110}px`,
    '--sample-height': `${normalized === null ? 66 : 58 + normalized * 24}px`,
    '--sample-color': color,
    '--sample-border': border,
  } as CSSProperties
}

function probeFramePalette(pictType: ProbeFrameDTO['pict_type']): { color: string; border: string } {
  if (pictType === 'I') return { color: 'hsl(38 70% 43%)', border: 'hsl(38 78% 62%)' }
  if (pictType === 'P') return { color: 'hsl(200 70% 35%)', border: 'hsl(200 78% 52%)' }
  if (pictType === 'B') return { color: 'hsl(274 48% 38%)', border: 'hsl(274 67% 63%)' }
  return { color: '#26323c', border: '#667581' }
}

function formatProbeTime(time: string | null, ticks: number | null): string | null {
  if (time !== null) {
    const seconds = Number(time)
    if (Number.isFinite(seconds)) return `${seconds.toFixed(3)}s`
  }
  return ticks === null ? null : `${ticks} ticks`
}

function probeFrameAriaLabel(frame: ProbeFrameDTO): string {
  const parts = [
    `Frame ${frame.index + 1}`,
    `tipo ${frame.pict_type ?? 'não identificado'}`,
    frame.byte_size !== null ? formatBytes(frame.byte_size) : 'tamanho não disponível',
  ]
  if (frame.pts !== null) parts.push(`PTS ${frame.pts}`)
  if (frame.dts !== null) parts.push(`DTS ${frame.dts}`)
  if (frame.key_frame === true) parts.push('keyframe')
  return parts.join(', ')
}

function formatGopFrameInterval(gop: ProbeGopDTO): string {
  const values = gop.intervals.map((interval) => interval.frame_count)
  if (values.length === 0) {
    const observed = gop.trailing_gop?.observed_frame_count
    return observed === undefined
      ? '—'
      : `${observed}+ ${observed === 1 ? 'frame' : 'frames'}`
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return `${min} ${min === 1 ? 'frame' : 'frames'}`
  const average = values.reduce((total, value) => total + value, 0) / values.length
  return `${min}–${max} frames · média ${average.toFixed(1)}`
}

function formatGopTimeInterval(gop: ProbeGopDTO): string {
  const values = gop.intervals.flatMap((interval) => (
    interval.duration_seconds === null ? [] : [interval.duration_seconds]
  ))
  if (values.length === 0) {
    const observed = gop.trailing_gop?.observed_duration_seconds
    return observed === undefined || observed === null ? '—' : `${observed.toFixed(3)}s+`
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return `${min.toFixed(3)}s`
  const average = values.reduce((total, value) => total + value, 0) / values.length
  return `${min.toFixed(3)}–${max.toFixed(3)}s · média ${average.toFixed(3)}s`
}

function gopObservation(gop: ProbeGopDTO): string {
  if (gop.key_frame_count === 0) {
    return 'Nenhum ponto de acesso foi reportado nesta janela.'
  }
  if (gop.starts_with_key_frame === false && gop.first_key_frame_index !== null) {
    const count = gop.first_key_frame_index
    return `${count} ${count === 1 ? 'frame aparece' : 'frames aparecem'} antes do primeiro ponto de acesso.`
  }
  if (gop.intervals.length === 0) {
    return 'O “+” indica um limite inferior: o próximo keyframe não aparece neste segmento.'
  }
  return 'Os intervalos usam somente pares de keyframes observados nesta janela.'
}

function GopSummary({ gop }: { gop: ProbeGopDTO | null }) {
  if (!gop) return null
  const startsWithKeyframe = gop.starts_with_key_frame === null
    ? 'Indeterminado'
    : gop.starts_with_key_frame ? 'Sim' : 'Não'

  return (
    <section className="gop-summary" aria-labelledby="gop-summary-heading">
      <div className="gop-summary-heading">
        <div>
          <span className="eyebrow">Acesso e seek</span>
          <h6 id="gop-summary-heading">GOP observado</h6>
        </div>
        <span>{gop.intervals.length} {gop.intervals.length === 1 ? 'intervalo completo' : 'intervalos completos'}</span>
      </div>
      <dl className="gop-facts">
        <div>
          <dt>Ponto de acesso no início</dt>
          <dd>{startsWithKeyframe}</dd>
        </div>
        <div>
          <dt>Keyframes observados</dt>
          <dd>{gop.key_frame_count}</dd>
        </div>
        <div>
          <dt>GOP em frames</dt>
          <dd>{formatGopFrameInterval(gop)}</dd>
        </div>
        <div>
          <dt>GOP em tempo</dt>
          <dd>{formatGopTimeInterval(gop)}</dd>
        </div>
        <div>
          <dt>Distribuição</dt>
          <dd>
            I {gop.i_frame_count} · P {gop.p_frame_count} · B {gop.b_frame_count}
            {gop.unknown_frame_count > 0 ? ` · ? ${gop.unknown_frame_count}` : ''}
          </dd>
        </div>
      </dl>
      <p className="gop-note">
        {gopObservation(gop)} Intervalos maiores podem aumentar o tempo até o próximo
        ponto de entrada durante início ou seek. A leitura não classifica GOP aberto ou fechado.
      </p>
      {gop.truncated && (
        <p className="inline-warning">O resumo considera somente os frames coletados antes do limite.</p>
      )}
    </section>
  )
}

function formatTimingSeconds(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(3)}s`
}

function timingTrackLabel(track: { track_id: number | null; pid: number | null }): string {
  if (track.track_id !== null) return `Track ${track.track_id}`
  if (track.pid !== null) return `PID 0x${track.pid.toString(16).padStart(4, '0')}`
  return 'Track não identificado'
}

function TimingHealth({ container }: { container: ContainerDTO }) {
  const timing = container.analysis.timing
  if (!timing || timing.tracks.length === 0) return null

  return (
    <section className="timing-health" aria-labelledby="timing-health-heading">
      <div className="container-section-heading timing-health-heading">
        <div>
          <span className="eyebrow">Continuidade entre segmentos</span>
          <h5 id="timing-health-heading">Saúde temporal</h5>
        </div>
        <span className="provenance">timestamps do container</span>
      </div>
      <p className="timing-health-note">
        Valores ausentes significam que o fim observável não estava nos bytes; não são
        considerados continuidade.
      </p>
      <div className="table-scroll">
        <table className="structure-table timing-table">
          <thead>
            <tr>
              <th>Track</th>
              <th>PTS</th>
              <th>DTS</th>
              <th>Duração observada</th>
              <th>Manifesto</th>
              <th>Fronteira anterior</th>
            </tr>
          </thead>
          <tbody>
            {timing.tracks.map((track) => {
              const delta = track.boundary_delta_seconds
              const boundary = delta === null
                ? 'não comparável'
                : delta === 0
                  ? 'contínua'
                  : delta > 0
                    ? `gap ${formatTimingSeconds(delta)}`
                    : `overlap ${formatTimingSeconds(Math.abs(delta))}`
              return (
                <tr key={timingTrackLabel(track)} className={delta && delta !== 0 ? 'row-warning' : ''}>
                  <td>{timingTrackLabel(track)}</td>
                  <td>{track.start_pts ?? '—'} → {track.end_pts ?? '—'}</td>
                  <td>{track.start_dts ?? '—'} → {track.end_dts ?? '—'}</td>
                  <td>{formatTimingSeconds(track.observed_duration_seconds)}</td>
                  <td>{formatTimingSeconds(timing.declared_duration_seconds)}</td>
                  <td>{boundary}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ProbeFrameTimeline({ container }: { container: ContainerDTO }) {
  const frames = container.probe?.frames ?? []
  if (frames.length === 0) return null

  const groups = new Map<number | null, ProbeFrameDTO[]>()
  for (const frame of frames) {
    const group = groups.get(frame.stream_index)
    if (group) group.push(frame)
    else groups.set(frame.stream_index, [frame])
  }

  return (
    <section className="sample-map" aria-labelledby="probe-frame-map-heading">
      <div className="container-section-heading sample-map-heading">
        <div>
          <span className="eyebrow">Ordem reportada pelo decoder</span>
          <h5 id="probe-frame-map-heading">Frames do segmento</h5>
        </div>
        <span className="provenance">derivado por ffprobe</span>
      </div>
      <GopSummary gop={container.probe?.gop ?? null} />
      <div className="sample-legend" aria-label="Legenda dos tipos de frame e tamanhos">
        <span><i className="sample-size-axis" aria-hidden="true">↔</i>largura e altura = bytes</span>
        <span><i className="sample-type-key type-keyframe" />I-frame</span>
        <span><i className="sample-type-key type-interframe" />P-frame</span>
        <span><i className="sample-type-key type-bframe" />B-frame</span>
        <span><i className="sample-type-key type-unknown" />tipo não identificado</span>
      </div>
      {[...groups.entries()].map(([streamIndex, group]) => {
        const sizes = group.flatMap((frame) => frame.byte_size === null ? [] : [frame.byte_size])
        const minSize = sizes.length > 0 ? Math.min(...sizes) : 0
        const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0
        const streamLabel = streamIndex === null ? 'Stream de vídeo' : `Stream ${streamIndex}`
        return (
          <div className="sample-lane" key={streamIndex ?? 'video'}>
            <header>
              <strong>{streamLabel}</strong>
              <span>{group.length} {group.length === 1 ? 'frame' : 'frames'}</span>
            </header>
            <div className="sample-track" role="list" aria-label={`Frames decodificados: ${streamLabel}`}>
              {group.map((frame) => {
                const palette = probeFramePalette(frame.pict_type)
                const pts = formatProbeTime(frame.pts_time, frame.pts)
                const dts = formatProbeTime(frame.dts_time, frame.dts)
                return (
                  <div
                    className={`sample-block ${frame.key_frame === true ? 'is-sync' : ''}`}
                    key={`${streamIndex ?? 'video'}-${frame.index}`}
                    role="listitem"
                    style={visualUnitStyle(frame.byte_size, minSize, maxSize, palette.color, palette.border)}
                    title={probeFrameAriaLabel(frame)}
                    aria-label={probeFrameAriaLabel(frame)}
                  >
                    <span className="sample-index">{frame.pict_type ?? '?'} {String(frame.index + 1).padStart(2, '0')}</span>
                    <strong>{frame.byte_size === null ? '—' : formatBytes(frame.byte_size)}</strong>
                    <span className="sample-time">PTS {pts ?? '—'}</span>
                    <span className="sample-time">DTS {dts ?? '—'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {container.probe?.frames_truncated && (
        <p className="inline-warning">Visualização derivada limitada aos primeiros {frames.length} frames.</p>
      )}
    </section>
  )
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
                const typeColor = sample.is_sync === true
                  ? { color: 'hsl(38 70% 43%)', border: 'hsl(38 78% 62%)' }
                  : sample.is_sync === false
                    ? { color: 'hsl(200 70% 35%)', border: 'hsl(200 78% 52%)' }
                    : { color: '#26323c', border: '#667581' }
                const style = visualUnitStyle(
                  sample.byte_size,
                  minSize,
                  maxSize,
                  typeColor.color,
                  typeColor.border,
                )
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
  const hasDerivedFrames = (container.probe?.frames?.length ?? 0) > 0
  return (
    <div className="container-inspector">
      {hasDerivedFrames
        ? <ProbeFrameTimeline container={container} />
        : <SampleTimeline container={container} />}
      <TimingHealth container={container} />
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
