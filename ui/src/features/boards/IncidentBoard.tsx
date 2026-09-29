import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getIncidentView, type IncidentMetric, type IncidentView, type ServerBoard } from './api';
import { qualityColors, qualityLabels, type QualityStatus } from './data';
import './aggregate.css';
import './incident.css';

const PAGE_SIZE = 100;
const metricLabels: Record<IncidentMetric, string> = { buffer: 'Buffer acima do limiar', startup_error: 'Erro de startup' };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível carregar os dados.';
type Cell = IncidentView['users']['rows'][number]['cells'][number];

const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
function mix(from: string, to: string, ratio: number) {
  const a = channels(from), b = channels(to);
  return `rgb(${a.map((value, index) => Math.round(value + (b[index]! - value) * ratio)).join(',')})`;
}
// Gradient stops mirror the server intensity: 0 green, 0.5 warning, 1 critical.
export function intensityColor(intensity: number | null) {
  if (intensity === null) return qualityColors.unknown;
  return intensity <= 0.5 ? mix(qualityColors.good, qualityColors.warning, intensity / 0.5) : mix(qualityColors.warning, qualityColors.bad, (intensity - 0.5) / 0.5);
}
const percent = (share: number | null) => share === null ? '—' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
const dayLabel = (day: string) => { const [, month, date] = day.split('-'); return `${date}/${month}`; };
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });

export function IncidentBoardDetail({ board, userId }: { board: Extract<ServerBoard, { board_type: 'incident' }>; userId: string | null }) {
  const [metric, setMetric] = useState<IncidentMetric>('buffer'), [sort, setSort] = useState<'worst' | 'user_id'>('worst'), [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<{ user: string; day: string } | null>(null);
  const options = { metric, sort, offset, limit: PAGE_SIZE };
  const query = useQuery({ queryKey: ['incident-board-view', userId, board.id, options], queryFn: () => getIncidentView(board.id, options), refetchInterval: 15000 });
  const view = query.data;
  if (query.isPending) return <div className="boards-page">Carregando incidente…</div>;
  if (!view || query.error) return <div className="boards-page"><Link to="/dashboard/boards">← Todos os boards</Link><p role="alert">{errorText(query.error)}</p><button className="boards-button" onClick={() => void query.refetch()}>Tentar novamente</button></div>;

  const incidentEnd = view.incident_end_day ?? view.incident_start_day;
  const inIncident = (day: string) => day >= view.incident_start_day && day <= incidentEnd;
  const selectedRow = view.users.rows.find(row => row.user_id === selected?.user);
  const selectedCell: Cell | undefined = selectedRow?.cells.find(cell => cell.day === selected?.day);
  const threshold = board.source.buffer_ratio_session_threshold;
  const badLabel = metric === 'buffer' ? `sessões com buffer ≥ ${percent(threshold)}` : 'sessões com erro de startup';

  return <div className="aggregate-page">
    <div className="aggregate-title-row"><div><div className="boards-eyebrow">INCIDENTE · {board.source.system.toUpperCase()}</div><h1>{board.name}</h1><p>Início {new Date(board.incident.started_at).toLocaleString('pt-BR')}{board.incident.ended_at ? ` · fim ${new Date(board.incident.ended_at).toLocaleString('pt-BR')}` : ' · em andamento'} · dias {dayLabel(board.window.from_day)} a {dayLabel(board.window.to_day)} (BRT)</p>{board.incident.description && <p>{board.incident.description}</p>}</div><span className="aggregate-badge complete">{view.users.with_data} de {view.users.total} usuários com dados</span></div>
    <div className="aggregate-controls">
      <label>Métrica<select value={metric} onChange={event => { setMetric(event.target.value as IncidentMetric); setOffset(0); setSelected(null); }}>{(Object.keys(metricLabels) as IncidentMetric[]).map(name => <option key={name} value={name}>{metricLabels[name]}</option>)}</select></label>
      <label>Ordenar<select value={sort} onChange={event => { setSort(event.target.value as 'worst' | 'user_id'); setOffset(0); }}><option value="worst">Pior primeiro</option><option value="user_id">User ID</option></select></label>
      <div className="incident-scale" aria-label="Escala de cor"><span>Sessões ruins no dia</span><i className="incident-gradient" /><small>0% · {percent(view.sla.warning)} atenção · {percent(view.sla.critical)}+ crítico</small></div>
    </div>
    <section className="aggregate-heatmap-panel">
      <div className="aggregate-panel-heading"><div><h2>Situação de cada usuário por dia</h2><p>Cada célula é a fração de {badLabel} entre as sessões do usuário no dia. Cinza indica que não há sessões para calcular.</p></div><span>{view.users.total} usuários</span></div>
      <div className="aggregate-legend">{(['good', 'warning', 'bad', 'unknown'] as const).map(status => <span key={status}><i style={{ background: qualityColors[status] }} />{qualityLabels[status]}</span>)}</div>
      {!view.users.total ? <div className="aggregate-empty">Ainda não há usuários neste incidente. Peça ao agente para adicioná-los pelo MCP.</div> :
        <div className="aggregate-table-scroll"><table className="aggregate-heatmap"><thead><tr><th>User ID</th><th>Total</th>{view.days.map(day => <th key={day} className={inIncident(day) ? 'incident-day' : undefined} title={inIncident(day) ? 'Dia do incidente' : undefined}>{dayLabel(day)}<small>{weekday(day)}</small></th>)}</tr></thead>
          <tbody>{view.users.rows.map(row => <tr key={row.user_id}>
            <th scope="row" title={row.user_id}><strong>{row.user_id}</strong><small>{row.bad_days} dia(s) crítico(s) · {row.sessions} sessões</small></th>
            <td><span className="incident-total" style={{ '--cell-color': intensityColor(row.bad_share === null ? null : Math.min(1, row.bad_share / Math.max(view.sla.critical, 0.0001))) } as CSSProperties}>{percent(row.bad_share)}</span></td>
            {row.cells.map(cell => <td key={cell.day}>
              <button className="aggregate-cell" style={{ '--cell-color': intensityColor(cell.intensity) } as CSSProperties} aria-label={`${row.user_id}, ${dayLabel(cell.day)}, ${qualityLabels[cell.status]}, ${cell.denominator ? `${cell.bad_sessions} de ${cell.denominator} sessões ruins` : 'sem dados'}`} title={`${row.user_id} · ${dayLabel(cell.day)} · ${cell.denominator ? `${cell.bad_sessions}/${cell.denominator} sessões ruins (${percent(cell.bad_share)})` : 'sem sessões'}`} onClick={() => setSelected({ user: row.user_id, day: cell.day })}>
                <span>{percent(cell.bad_share)}</span>{cell.denominator > 0 && <small>{cell.bad_sessions}/{cell.denominator}</small>}
              </button></td>)}
          </tr>)}</tbody>
          <tfoot><tr><th scope="row"><strong>Usuários afetados</strong><small>atenção + crítico / com dados</small></th><td />{view.daily.map(day => <td key={day.day} title={`${day.users_warning} em atenção · ${day.users_bad} críticos · ${day.users_with_data} com dados`}><span className="incident-total" style={{ '--cell-color': intensityColor(day.users_with_data ? (day.users_warning + day.users_bad) / day.users_with_data : null) } as CSSProperties}>{day.users_with_data ? `${Math.round((day.users_warning + day.users_bad) / day.users_with_data * 100)}%` : '—'}</span></td>)}</tr></tfoot>
        </table></div>}
      <div className="aggregate-pagination">{offset > 0 && <button className="boards-button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Usuários anteriores</button>}{view.users.next_offset !== null && <button className="boards-button" onClick={() => setOffset(view.users.next_offset ?? offset + PAGE_SIZE)}>Mais usuários</button>}</div>
    </section>
    <aside className="aggregate-inspector incident-inspector"><div className="boards-eyebrow">DETALHE DO DIA</div>{selectedRow && selectedCell ? <><h2>{selectedRow.user_id}</h2><p>{dayLabel(selectedCell.day)} · {weekday(selectedCell.day)}{inIncident(selectedCell.day) ? ' · dia do incidente' : ''}</p>
      <dl><div><dt>Faixa</dt><dd>{qualityLabels[selectedCell.status as QualityStatus]}</dd></div><div><dt>Sessões</dt><dd>{selectedCell.sessions}</dd></div><div><dt>Sessões ruins</dt><dd>{selectedCell.bad_sessions} de {selectedCell.denominator} ({percent(selectedCell.bad_share)})</dd></div><div><dt>Buffer ratio médio</dt><dd>{selectedCell.buffer_ratio_avg === null ? '—' : percent(selectedCell.buffer_ratio_avg)}</dd></div><div><dt>Join time médio</dt><dd>{selectedCell.join_time_ms_avg === null ? '—' : `${selectedCell.join_time_ms_avg.toFixed(0)} ms`}</dd></div></dl></> : <p>Selecione uma célula para ver as contagens do usuário naquele dia.</p>}
      <small>No buffer, a base são as sessões que iniciaram com sucesso; no erro de startup, todas as sessões do dia.</small></aside>
  </div>;
}
