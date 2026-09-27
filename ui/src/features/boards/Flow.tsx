import { useState } from 'react';
import { dimensions, qualityColors, qualityLabels, metricLabels, statusFor, formatMetric, type BoardNode, type BoardView, type Dimension, type QualityMetric, type QualityStatus } from './data';

type LayoutNode = BoardNode & { x: number; y: number; height: number };
export function Flow({ view, columns, metric, notes, selectedId, onSelect }: {
  view: BoardView; columns: Dimension[]; metric: QualityMetric; notes: string; selectedId: string | null; onSelect: (node: BoardNode) => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const width = columns.length * 230 + 10;
  const scale = 360 / Math.max(view.sessionCount, 1);
  const nodes: LayoutNode[] = columns.flatMap((dimension, col) => {
    let y = 62;
    return view.nodes.filter(node => node.dimension === dimension).map(node => {
      const layout = { ...node, x: 30 + col * 230, y, height: node.volume * scale };
      y += Math.max(layout.height, node.model ? 48 : 33) + 25;
      return layout;
    });
  });
  const chartHeight = Math.max(610, ...nodes.map(node => node.y + Math.max(node.height, node.model ? 48 : 33) + 40));
  const sourceOffsets = new Map<string, number>(), targetOffsets = new Map<string, number>();
  const links = view.links.flatMap(link => {
    const source = nodes.find(node => node.id === link.source), target = nodes.find(node => node.id === link.target);
    if (!source || !target) return [];
    const thickness = link.volume * scale;
    const sy = source.y + (sourceOffsets.get(source.id) ?? 0), ty = target.y + (targetOffsets.get(target.id) ?? 0);
    sourceOffsets.set(source.id, (sourceOffsets.get(source.id) ?? 0) + thickness);
    targetOffsets.set(target.id, (targetOffsets.get(target.id) ?? 0) + thickness);
    const sx = source.x + 14, tx = target.x;
    const distribution = link.metrics[metric]?.distribution;
    const counts: [QualityStatus, number][] = distribution
      ? (['good', 'warning', 'bad', 'unknown'] as const).map(status => [status, distribution[status]])
      : [[statusFor(link.metrics[metric]), link.volume]];
    let offset = 0;
    const bands = counts.filter(([, count]) => count > 0).map(([status, count]) => {
      const height = count * scale;
      const topSource = sy + offset, topTarget = ty + offset;
      offset += height;
      return { status, count, path: `M ${sx} ${topSource} C ${sx + 105} ${topSource}, ${tx - 105} ${topTarget}, ${tx} ${topTarget} L ${tx} ${topTarget + height} C ${tx - 105} ${topTarget + height}, ${sx + 105} ${topSource + height}, ${sx} ${topSource + height} Z` };
    });
    return [{ ...link, sourceLabel: source.label, targetLabel: target.label, bands }];
  });
  const activeId = hoverId ?? selectedId;
  const hoveredNode = nodes.find(node => node.id === hoverId);
  const hoveredLink = links.find(link => link.id === hoverId);
  const distributionText = (item: { volume: number; metrics: BoardNode['metrics'] }) => {
    const distribution = item.metrics[metric]?.distribution;
    return distribution ? Object.entries(distribution).map(([status, count]) => `${qualityLabels[status as QualityStatus]}: ${count} (${item.volume ? (count / item.volume * 100).toFixed(1) : '0'}%)`).join(' · ') : 'Distribuição por sessão indisponível';
  };
  const description = (item: { volume: number; metrics: BoardNode['metrics'] }) => `${item.volume} sessões · ${metricLabels[metric]}: ${formatMetric(item.metrics[metric])} · ${qualityLabels[statusFor(item.metrics[metric])]}${item.metrics[metric]?.sample_count !== undefined ? ` · ${item.metrics[metric]!.sample_count} amostras · ${item.metrics[metric]!.violations ?? 0} no limite crítico` : ''}`;
  return <div className="boards-flow-wrap">
    <div className="boards-flow-scroll"><svg className="boards-flow" viewBox={`0 0 ${width} ${chartHeight}`} style={{ minWidth: columns.length * 190 }} role="img" aria-label="Fluxo informado no payload do board">
      {columns.map((dimension, i) => <g key={dimension}><text x={30 + i * 230} y={25} className="flow-column">{dimensions.find(d => d.key === dimension)!.label.toUpperCase()}</text><line x1={30 + i * 230} y1={40} x2={190 + i * 230} y2={40} stroke="#283443" /></g>)}
      {links.map(link => <g key={link.id} onMouseEnter={() => setHoverId(link.id)} onMouseLeave={() => setHoverId(null)}>{link.bands.map(band => <path key={band.status} d={band.path} fill={qualityColors[band.status]} opacity={activeId ? (link.id === activeId || link.source === activeId || link.target === activeId ? .85 : .12) : .65} className="flow-link"><title>{`${link.sourceLabel} → ${link.targetLabel} · ${distributionText(link)} · ${description(link)} · ${notes}`}</title></path>)}</g>)}
      {nodes.map(node => <g key={node.id} tabIndex={0} role="button" aria-label={`${node.nextViewId || node.filter ? 'Filtrar' : 'Ver detalhes de'} ${dimensions.find(d => d.key === node.dimension)!.label}: ${node.label}${node.model ? `, ${node.model}` : ''}`} className="flow-node" onClick={() => onSelect(node)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node); } }} onMouseEnter={() => setHoverId(node.id)} onMouseLeave={() => setHoverId(null)}>
        <rect x={node.x - 4} y={node.y - 3} width={22} height={node.height + 6} rx={5} fill={qualityColors[statusFor(node.metrics[metric])]} opacity={selectedId === node.id ? .3 : .08} />
        <rect x={node.x} y={node.y} width={14} height={node.height} rx={3} fill={qualityColors[statusFor(node.metrics[metric])]} />
        <text x={node.x + 23} y={node.y + 13} className="flow-label">{node.label.length > 23 ? `${node.label.slice(0, 21)}…` : node.label}</text>
        <text x={node.x + 23} y={node.y + (node.model ? 43 : 28)} className="flow-count">{node.volume} sessões · {formatMetric(node.metrics[metric])}</text>
        {node.model && <text x={node.x + 23} y={node.y + 28} className="flow-count">{node.model}</text>}
        <title>{`${node.label}${node.model ? ` · ${node.model}` : ""} · ${description(node)} · ${notes}`}</title>
      </g>)}
    </svg></div>
    <div className="boards-flow-caption" aria-live="polite">{hoveredNode || hoveredLink ? <><strong>{hoveredNode?.label ?? `${hoveredLink!.sourceLabel} → ${hoveredLink!.targetLabel}`}</strong><span>{distributionText(hoveredNode ?? hoveredLink!)}</span></> : <><strong>Explore o fluxo</strong><span>Selecione uma entidade para ver detalhes ou restringir este recorte.</span></>}</div>
  </div>;
}
