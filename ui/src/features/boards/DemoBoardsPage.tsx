import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { boardRepository, dimensions, focusDimensions, flowColumns, entities, qualityColors, qualityLabels, metricLabels, payloadFor, formatMetric, statusFor, scenarios, type Board, type BoardNode, type BoardView, type FocusDimension, type QualityMetric, type Scenario } from './data';
import { Flow } from './Flow';
import './boards.css';

function Metrics({ view, metric }: { view: BoardView; metric: QualityMetric }) {
  const cards = [
    ['Sessões', view.sessionCount, 'Volume informado neste recorte'],
    [metricLabels[metric], formatMetric(view.metrics[metric]), 'Valor fornecido pelo agente'],
    ['Qualidade', qualityLabels[statusFor(view.metrics[metric])], 'Status fornecido pelo agente'],
    [metricLabels[metric === 'startup_error_rate' ? 'buffer_ratio' : 'startup_error_rate'], formatMetric(view.metrics[metric === 'startup_error_rate' ? 'buffer_ratio' : 'startup_error_rate']), 'Valor fornecido pelo agente'],
  ];
  return <div className="boards-metrics">{cards.map(([label, value, detail]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</div>;
}
export default function BoardsPage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState(boardRepository.list);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [dimension, setDimension] = useState<FocusDimension>('user');
  const [scenario, setScenario] = useState<Scenario>('network');
  const [entity, setEntity] = useState('user-001');
  const [error, setError] = useState('');
  const options = entities(scenario, dimension);
  return <div className="boards-page">
<div className="boards-heading">
<div>
<div className="boards-eyebrow">STREAMING OBSERVABILITY <span>Dados simulados</span>
</div>
<h1>Seus boards</h1>
<p>Um espaço para cada investigação. Explore o caminho das sessões e encontre onde a qualidade muda.</p>
</div>
<button className="boards-primary" onClick={() => setCreating(true)}>＋ Criar board</button>
</div>
    <div className="boards-notice">Protótipo de monitoramento · Boards salvos apenas neste navegador. As métricas são simuladas.</div>
    {creating && <form className="boards-create" onSubmit={e => { e.preventDefault(); const board: Board = { id: crypto.randomUUID(), name: name.trim(), dimension, entity, scenario, period: 60, createdAt: new Date().toISOString() }; if (!board.name) return; if (!boardRepository.save([...boards, board])) { setError('Não foi possível salvar no navegador. Verifique se o armazenamento está disponível.'); return; } navigate(`/dashboard/boards/demos/${board.id}`); }}>
<div className="boards-section-heading">
<h2>Novo board</h2>
<button type="button" className="boards-button" onClick={() => setCreating(false)}>Cancelar</button>
</div>
<div className="boards-form-grid">
<label>Nome<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Usuário X · travamentos" />
</label>
<label>Cenário simulado<select value={scenario} onChange={e => { const next = e.target.value as Scenario; setScenario(next); setEntity(entities(next, dimension)[0]!); }}>
{Object.entries(scenarios).map(([key, label]) => <option key={key} value={key}>
{label}
</option>)}
</select>
</label>
<label>Tipo de board<select value={dimension} onChange={e => { const next = e.target.value as FocusDimension; setDimension(next); setEntity(entities(scenario, next)[0]!); }}>
{focusDimensions.map(d => <option key={d.key} value={d.key}>
{d.label}
</option>)}
</select>
</label>
<label>Entidade<select value={entity} onChange={e => setEntity(e.target.value)}>
{options.map(option => <option key={option}>
{option}
</option>)}
</select>
</label>
</div>
{error && <p role="alert">
{error}
</p>}<button className="boards-primary" type="submit">Criar e explorar →</button>
</form>}
    <div className="boards-card-grid">
{boards.map(board => { const payload = payloadFor(board); const view = payload.views[payload.initialViewId]!; return <article className="boards-card" key={board.id}>
<div className="boards-card-top">
<span className="boards-chip">
{dimensions.find(d => d.key === board.dimension)!.label}
</span>
<span className="boards-signal">● Simulado</span>
</div>
<Link to={`/dashboard/boards/demos/${board.id}`}>
<h2>
{board.name}
</h2>
</Link>
<p>
{board.entity}
</p>
<div className="boards-mini-flow">
{flowColumns[board.dimension].map((dimension, index) => <i key={dimension} style={{ background: dimensions.find(d => d.key === dimension)!.color, height: `${18 + (index % 3) * 11}px` }} />)}<span />
</div>
<div className="boards-card-stats">
<div>
<strong>
{view.sessionCount}
</strong>
<span>sessões</span>
</div>
<div>
<strong>
{formatMetric(view.metrics.startup_error_rate)}
</strong>
<span>erro de startup</span>
</div>
</div>
<footer>
<span>
{scenarios[board.scenario]}</span>
<Link to={`/dashboard/boards/demos/${board.id}`}>Explorar ↗</Link>
</footer>
<button className="boards-delete" onClick={() => { if (!window.confirm(`Excluir o board “${board.name}”?`)) return; const next = boards.filter(b => b.id !== board.id); if (boardRepository.save(next)) setBoards(next); else setError('Não foi possível excluir o board.'); }}>Excluir board</button>
</article>; })}
</div>
{!boards.length && <div className="boards-empty">Crie seu primeiro board para explorar a saúde das sessões.</div>}{error && !creating && <p role="alert">
{error}
</p>}
</div>;
}

export function DemoBoardDetailPage() {
  const { boardId } = useParams();
  const [board, setBoard] = useState(() => boardRepository.list().find(b => b.id === boardId));
  const [trail, setTrail] = useState<{ viewId: string; label: string }[]>([]);
  const [metric, setMetric] = useState<QualityMetric>('startup_error_rate');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { setBoard(boardRepository.list().find(b => b.id === boardId)); setTrail([]); setSelectedId(null); setMetric('startup_error_rate'); }, [boardId]);
  if (!board) return <div className="boards-page boards-empty"><h1>Board não encontrado</h1><Link to="/dashboard/boards/demos">Voltar aos boards</Link></div>;

  const payload = payloadFor(board);
  const viewId = trail[trail.length - 1]?.viewId ?? payload.initialViewId;
  const view = payload.views[viewId];
  if (!view) return <div className="boards-page boards-empty">O payload não contém este recorte.</div>;
  const selected = view.nodes.find(node => node.id === selectedId) ?? view.nodes.find(node => node.id === 'root');
  const notes = payload.metricNotes[metric] ?? 'Métrica e status fornecidos pelo agente.';
  const label = (dimension: BoardNode['dimension']) => dimensions.find(d => d.key === dimension)!.label;
  function select(node: BoardNode) {
    setSelectedId(node.id);
    if (node.nextViewId && payload.views[node.nextViewId]) setTrail(previous => [...previous, { viewId: node.nextViewId!, label: node.label }]);
  }
  function returnTo(count: number) { setTrail(previous => previous.slice(0, count)); setSelectedId(null); }
  return <div className="boards-page boards-detail">
    <Link className="boards-back" to="/dashboard/boards/demos">← Todos os boards</Link>
    <div className="boards-heading"><div><div className="boards-eyebrow">QUALITY EXPLORER <span>Dados simulados</span></div><h1>{board.name}</h1><p>{label(board.dimension)}: <strong>{board.entity}</strong></p></div></div>
    <nav className="boards-breadcrumb" aria-label="Recortes fornecidos do board">
      <button className="boards-button" disabled={!trail.length} onClick={() => returnTo(trail.length - 1)}>← Voltar</button>
      <ol>{[{ viewId: payload.initialViewId, label: board.entity }, ...trail].map((item, index) => <li key={`${index}:${item.viewId}`}><button aria-current={index === trail.length ? 'location' : undefined} onClick={() => returnTo(index)}><small>{index === 0 ? 'Board completo' : 'Recorte fornecido'}</small>{item.label}</button></li>)}</ol>
      {!!trail.length && <button className="boards-button" onClick={() => returnTo(0)}>Limpar filtros</button>}
    </nav>
    <Metrics view={view} metric={metric} />
    <div className="boards-workspace">
      <section className="boards-canvas">
        <div className="boards-section-heading"><div><h2>Fluxo de qualidade</h2><p>{payload.columns.map(label).join(' → ')}</p><p>Explore os recortes preparados; valores e status são fornecidos pelo agente.</p></div>
          <div className="boards-metric-switch" role="group" aria-label="Métrica de qualidade">{(['startup_error_rate', 'buffer_ratio'] as const).map(option => <button key={option} aria-pressed={metric === option} onClick={() => setMetric(option)}>{metricLabels[option]}</button>)}</div>
        </div>
        <div className="boards-thresholds">{notes}<small>As cores exibem o status fornecido. Métrica ausente aparece em cinza.</small></div>
        <div className="boards-legend">{Object.entries(qualityLabels).map(([key, qualityLabel]) => <span key={key}><i style={{ background: qualityColors[key as keyof typeof qualityColors] }} />{qualityLabel}</span>)}<span>Largura = volume informado</span></div>
        <Flow key={`${board.id}:${view.id}:${metric}`} view={view} columns={payload.columns} metric={metric} notes={notes} selectedId={selectedId} onSelect={select} />
      </section>
      <aside className="boards-inspector">
        <div className="boards-eyebrow">DETALHES FORNECIDOS</div>
        {selected && <><span className="boards-chip">{label(selected.dimension)}</span><h2>{selected.label}</h2><p>{selected.volume} sessões informadas neste recorte</p>{selected.model && <p>Modelo: {selected.model}</p>}
          <div className="boards-quality-bar"><i style={{ background: qualityColors[statusFor(selected.metrics[metric])], width: '100%' }} /></div>
          <dl><div><dt>{metricLabels[metric]}</dt><dd>{formatMetric(selected.metrics[metric])}</dd></div><div><dt>Qualidade fornecida</dt><dd>{qualityLabels[statusFor(selected.metrics[metric])]}</dd></div>{selected.metrics[metric]?.coverage && <div><dt>Cobertura informada</dt><dd>{selected.metrics[metric]!.coverage}</dd></div>}</dl>
          <small>{selected.nextViewId ? 'Há um recorte preparado para esta entidade.' : 'Sem novo recorte preparado: a seleção mostra somente os detalhes fornecidos.'}</small>
        </>}
        <div className="boards-comparison"><strong>Dados fornecidos pelo agente</strong><p>Cada recorte já contém seus volumes, métricas e qualidade.</p></div>
      </aside>
    </div>
    {view.annotation && <div className="boards-insight"><span>◎</span><div><strong>{view.annotation.title}</strong><p>{view.annotation.body}</p><small>Observação fornecida pelo agente simulado.</small></div></div>}
  </div>;
}
