import { useState } from 'react'
import type { BoxNodeDTO, ContainerDTO } from '../types'

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MiB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${n} B`
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
