import mockPayloads from './mockPayloads.json';

export type Dimension = 'user' | 'device' | 'model' | 'isp' | 'pop' | 'media';
export type FocusDimension = 'user' | 'device' | 'isp' | 'pop';
export type Scenario = 'network' | 'device' | 'pop' | 'media';
export type Board = { id: string; name: string; dimension: FocusDimension; entity: string; scenario: Scenario; period: number; createdAt: string };
export type QualityMetric = 'startup_error_rate' | 'buffer_ratio' | 'join_time_ms';
export type QualityStatus = 'good' | 'warning' | 'bad' | 'unknown';
// UI presentation types. Live boards receive deterministic aggregates from the app.
// Static demo payloads stay isolated from the session ingestion API.
export type SuppliedMetric = { distribution?: Record<QualityStatus, number>; value: number | null; status: QualityStatus; coverage?: string; unit?: "ratio" | "ms"; sample_count?: number; violations?: number; sla?: { warning: number; critical: number } };
export type Metrics = Partial<Record<QualityMetric, SuppliedMetric>>;
export type BoardFilter = { dimension: "user" | "isp" | "pop" | "media"; entity: string } | { dimension: "device"; entity: string; user_id: string };
export type BoardNode = { id: string; dimension: Dimension; label: string; volume: number; metrics: Metrics; model?: string; filter?: BoardFilter; nextViewId?: string };
export type BoardLink = { id: string; source: string; target: string; volume: number; metrics: Metrics };
export type BoardView = { id: string; sessionCount: number; metrics: Metrics; nodes: BoardNode[]; links: BoardLink[]; annotation?: { title: string; body: string } };
export type BoardPayload = { version: number; columns: Dimension[]; initialViewId: string; views: Record<string, BoardView>; metricNotes: Partial<Record<QualityMetric, string>> };
export const dimensions: { key: Dimension; label: string; color: string }[] = [
  { key: 'user', label: 'Usuário', color: '#8b7af0' }, { key: 'device', label: 'Device específico', color: '#54acd2' },
  { key: 'model', label: 'Modelo de device', color: '#54acd2' }, { key: 'isp', label: 'ISP', color: '#e1a64e' },
  { key: 'pop', label: 'POP / CDN', color: '#ed7ba1' }, { key: 'media', label: 'Mídia', color: '#52c8aa' },
];
export const focusDimensions = dimensions.filter((d): d is typeof d & { key: FocusDimension } => ['user', 'device', 'isp', 'pop'].includes(d.key));
export const flowColumns: Record<FocusDimension, Dimension[]> = {
  user: ['user', 'device', 'isp', 'pop', 'media'], device: ['device', 'isp', 'pop', 'media'],
  isp: ['isp', 'pop', 'media'], pop: ['pop', 'isp', 'media'],
};
export function isFocusDimension(dimension: Dimension): dimension is FocusDimension { return focusDimensions.some(d => d.key === dimension); }
export const scenarios: Record<Scenario, string> = { network: 'Rede do usuário', device: 'Modelo de device', pop: 'POP degradado', media: 'Problema na mídia' };
export const qualityColors: Record<QualityStatus, string> = { good: '#35bf9e', warning: '#f1b94c', bad: '#f26a83', unknown: '#72839a' };
export const qualityLabels: Record<QualityStatus, string> = { good: 'Saudável', warning: 'Atenção', bad: 'Degradada', unknown: 'Sem dados' };
export const metricLabels: Record<QualityMetric, string> = { startup_error_rate: 'Erro de startup', buffer_ratio: 'Buffer ratio', join_time_ms: 'Join time' };
export function statusFor(metric: SuppliedMetric | undefined): QualityStatus { return metric?.value == null ? 'unknown' : metric.status; }
export function formatMetric(metric: SuppliedMetric | undefined): string { return metric?.value == null ? 'Sem dados' : metric.unit === 'ms' ? `${metric.value.toFixed(0)} ms` : `${(metric.unit === 'ratio' ? metric.value * 100 : metric.value).toFixed(1)}%`; }
const entityOptions: Record<FocusDimension, string[]> = {
  user: ['user-001', 'user-002', 'user-003'], device: ['user-001 · TV sala', 'user-001 · Celular', 'user-002 · TV sala'],
  isp: ['Vivo Fibra', 'Claro', 'TIM'], pop: ['São Paulo · GRU', 'Rio · GIG', 'Curitiba · CWB'],
};
export function entities(_scenario: Scenario, dimension: FocusDimension) { return entityOptions[dimension]; }
export function payloadFor(board: Board): BoardPayload {
  // Local fixture adapter: only substitutes the board's entity label in ready payloads.
  const template = mockPayloads[board.scenario][board.dimension] as BoardPayload;
  return { ...template, views: Object.fromEntries(Object.entries(template.views).map(([id, view]) => [id, {
    ...view, nodes: view.nodes.map(node => node.id === 'root' ? { ...node, label: board.entity } : node),
  }])) };
}
const initial: Board[] = [
  { id: 'user-001', name: 'Usuário 001 · qualidade', dimension: 'user', entity: 'user-001', scenario: 'network', period: 60, createdAt: '2026-09-27T12:00:00Z' },
  { id: 'tizen', name: 'TV do usuário 001 · playback', dimension: 'device', entity: 'user-001 · TV sala', scenario: 'device', period: 60, createdAt: '2026-09-27T12:00:00Z' },
  { id: 'gru', name: 'POP São Paulo · saúde', dimension: 'pop', entity: 'São Paulo · GRU', scenario: 'pop', period: 60, createdAt: '2026-09-27T12:00:00Z' },
];
const key = 'vh.boards.v1';
export const boardRepository = {
  list(): Board[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initial.map(b => ({ ...b }));
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return initial.map(b => ({ ...b }));
      const valid = parsed.filter((b): b is Omit<Board, 'dimension'> & { dimension: Dimension } => !!b && typeof b === 'object' && typeof b.id === 'string' && typeof b.name === 'string' && dimensions.some(d => d.key === b.dimension) && typeof b.entity === 'string' && Object.hasOwn(scenarios, b.scenario) && [15, 30, 60].includes(b.period) && typeof b.createdAt === 'string');
      return valid.map(b => {
        // Early prototypes saved a clicked ISP/POP as the user demo's type.
        // Recognize only its original ID + name; preserve customized boards.
        const userDemo = initial[0]!;
        if (b.id === userDemo.id && b.name === userDemo.name && b.dimension !== 'user') {
          return { ...b, dimension: userDemo.dimension, entity: userDemo.entity };
        }
        if (isFocusDimension(b.dimension)) return { ...b, dimension: b.dimension };
        const dimension: FocusDimension = b.dimension === 'model' ? 'device' : 'user';
        return { ...b, dimension, entity: entityOptions[dimension][0]! };
      });
    } catch { return initial.map(b => ({ ...b })); }
  },
  save(boards: Board[]): boolean { try { localStorage.setItem(key, JSON.stringify(boards)); return true; } catch { return false; } },
};
