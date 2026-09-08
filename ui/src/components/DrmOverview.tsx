import { useId } from 'react'
import type { DashDrmDeclaration, DashPsshDeclaration, UnifiedMedia } from '../snapshot'

const SYSTEM_LABELS: Record<string, string> = {
  'adobe-primetime': 'Adobe Primetime',
  'common-pssh': 'Common PSSH',
  fairplay: 'FairPlay',
  'mp4-protection': 'Proteção MP4',
  playready: 'PlayReady',
  widevine: 'Widevine',
}

function HelpLabel({ label, help }: { label: string; help: string }) {
  const tooltipId = useId()
  return (
    <span className="metric-help" tabIndex={0} aria-describedby={tooltipId}>
      {label}<span className="metric-help-icon" aria-hidden="true">?</span>
      <span className="metric-tooltip" id={tooltipId} role="tooltip">{help}</span>
    </span>
  )
}

function scopeLabel(item: DashDrmDeclaration): string {
  if (item.scope === 'representation') {
    return `Representação ${item.representation_id ?? 'sem ID'}`
  }
  if (item.scope === 'adaptation_set') {
    return `AdaptationSet ${item.adaptation_set_id ?? item.group_kind ?? 'sem ID'}`
  }
  return `Período ${item.period_id ?? item.period_index}`
}

function psshLabel(pssh: DashPsshDeclaration): string {
  if (pssh.status === 'invalid_base64') return `inválido · ${pssh.encoded_length} caracteres`
  if (pssh.status === 'empty') return 'vazio'
  const hash = pssh.sha256 ? ` · hash ${pssh.sha256.slice(0, 12)}…` : ''
  return `${pssh.decoded_size ?? 0} B${hash}`
}

export function DrmOverview({ media }: { media: UnifiedMedia | null }) {
  const declarations = media?.protocol === 'DASH' ? media.dash_drm ?? [] : []
  if (declarations.length === 0) return null

  const systems = [...new Set(declarations.map((item) => SYSTEM_LABELS[item.system] ?? item.system))]

  return (
    <section className="drm-overview" aria-labelledby="drm-overview-heading">
      <header>
        <div>
          <span className="eyebrow">Proteção de conteúdo</span>
          <h2 id="drm-overview-heading">DRM declarado no MPD</h2>
        </div>
        <span>{systems.join(' · ')}</span>
      </header>
      <p>
        Estas são declarações do manifesto DASH. Elas ajudam a conferir sinalização e
        consistência, mas não testam aquisição de licença, CDM nem compatibilidade do dispositivo.
      </p>
      <div className="table-scroll">
        <table className="structure-table drm-table">
          <thead>
            <tr>
              <th><HelpLabel label="Escopo" help="Nível do MPD onde ContentProtection foi declarado. Uma declaração no período ou AdaptationSet pode valer para representações descendentes." /></th>
              <th><HelpLabel label="Sistema" help="Nome reconhecido a partir do UUID ou URI de schemeIdUri. Indica o DRM anunciado, não confirma que uma licença poderá ser obtida." /></th>
              <th><HelpLabel label="Esquema" help="schemeIdUri e value declarados em ContentProtection. O esquema descreve o formato ou sistema de proteção usado pelo conteúdo." /></th>
              <th><HelpLabel label="KID padrão" help="Identificador da chave de conteúdo (default_KID). Não é a chave de descriptografia e não é segredo; divergências podem revelar configuração ou rotação inconsistente." /></th>
              <th><HelpLabel label="PSSH" help="Initialization data enviada ao DRM/CDM. O Stream Lens não guarda o conteúdo: mostra apenas validade, tamanho e um hash curto para comparar declarações." /></th>
            </tr>
          </thead>
          <tbody>
            {declarations.map((item, index) => (
              <tr key={`${item.scope}-${item.period_index}-${item.adaptation_set_id}-${item.representation_id}-${item.system}-${index}`}>
                <td>{scopeLabel(item)}</td>
                <td><strong>{SYSTEM_LABELS[item.system] ?? item.system}</strong></td>
                <td><code>{item.scheme_id_uri || 'não declarado'}</code>{item.value ? <small>value: {item.value}</small> : null}</td>
                <td>{item.default_kids.length ? item.default_kids.map((kid) => <code key={kid}>{kid}</code>) : 'não declarado'}</td>
                <td>{item.pssh.length ? item.pssh.map((pssh, psshIndex) => <span key={`${pssh.sha256}-${psshIndex}`}>{psshLabel(pssh)}</span>) : 'não declarado'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
