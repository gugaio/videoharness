import { createHash } from "node:crypto";
import { BoardError, type BoardRepository } from "../ports/board-repository.js";
import { BOARD_LIMITS, CreateBoardSchema, IngestBoardSessionsSchema, BoardViewRequestSchema, type BoardFilter, type BoardMetric, type BoardMetricName, type BoardRecord, type BoardSession, type BoardSlas, type BoardView, type BoardNode } from "../../domain/boards.js";

export function createBoard(repository: BoardRepository, ownerId: string, input: unknown) { return repository.create(ownerId, CreateBoardSchema.parse(input)); }
export function getBoard(repository: BoardRepository, ownerId: string, id: string) { const board = repository.get(ownerId,id); if (!board) throw new BoardError("board_not_found",404); return board; }
export function ingestBoardSessions(repository: BoardRepository, ownerId: string, id: string, input: unknown) { getBoard(repository,ownerId,id); return repository.ingest(ownerId,id,IngestBoardSessionsSchema.parse(input).sessions); }
const columns: Record<BoardRecord["focus"]["type"], BoardFilter["dimension"][]> = { user: ["user","device","isp","pop","media"], device: ["device","isp","pop","media"], isp: ["isp","pop","media"], pop: ["pop","isp","media"] };
function matches(session: BoardSession, filter: BoardFilter): boolean {
  if (filter.dimension === "device") return session.user_id === filter.user_id && session.device.id === filter.entity;
  const entity = filter.dimension === "user" ? session.user_id : filter.dimension === "media" ? session.media_id : session[filter.dimension];
  return entity === filter.entity;
}
function rootFilter(board: BoardRecord): BoardFilter {
  const focus = board.focus;
  if (focus.type === "device") return { dimension: "device", entity: focus.device_id, user_id: focus.user_id };
  return { dimension: focus.type, entity: focus.type === "user" ? focus.user_id : focus.type === "isp" ? focus.isp : focus.pop };
}
function sessionFilter(session: BoardSession, dimension: BoardFilter["dimension"]): BoardFilter {
  if (dimension === "device") return { dimension, entity: session.device.id, user_id: session.user_id };
  return { dimension, entity: dimension === "user" ? session.user_id : dimension === "media" ? session.media_id : session[dimension] };
}
const nodeKey = (filter: BoardFilter) => `n_${createHash("sha256").update(JSON.stringify(filter)).digest("hex").slice(0,24)}`;
function values(sessions: BoardSession[], metric: BoardMetricName): number[] {
  if (metric === "startup_error_rate") return sessions.map(session => session.startup_error ? 1 : 0);
  return sessions.flatMap(session => session.startup_error ? [] : [session[metric]]);
}
function metrics(sessions: BoardSession[], slas: BoardSlas) {
  const result: Partial<Record<BoardMetricName, BoardMetric>> = {};
  for (const metric of ["startup_error_rate","buffer_ratio","join_time_ms"] as const) {
    const sla = slas[metric]; if (!sla) continue;
    const samples = values(sessions,metric);
    const value = samples.length ? samples.reduce((sum,sample) => sum+sample,0)/samples.length : null;
    const distribution = { good: 0, warning: 0, bad: 0, unknown: sessions.length - samples.length };
    for (const sample of samples) {
      const status = metric === "startup_error_rate"
        ? (sample === 1 ? "bad" : "good")
        : sample >= sla.critical ? "bad" : sample >= sla.warning ? "warning" : "good";
      distribution[status]++;
    }
    result[metric] = { distribution, value, status: value === null ? "unknown" : value >= sla.critical ? "bad" : value >= sla.warning ? "warning" : "good", unit: metric === "join_time_ms" ? "ms" : "ratio", sample_count: samples.length, violations: samples.filter(sample => sample >= sla.critical).length, sla };
  }
  return result;
}
export function getBoardView(repository: BoardRepository, ownerId: string, id: string, input: unknown): BoardView {
  const board = getBoard(repository,ownerId,id);
  const { filters } = BoardViewRequestSchema.parse(input);
  const boardColumns = columns[board.focus.type];
  if (filters.some(filter => !boardColumns.includes(filter.dimension))) throw new BoardError("invalid_board_filter",400);
  const sessions = repository.allSessions(ownerId,id).filter(session => matches(session,rootFilter(board)) && filters.every(filter => matches(session,filter)));
  const grouped = new Map<string,{ filter?: BoardFilter; dimension: BoardFilter["dimension"]; label: string; sessions: BoardSession[] }>();
  const mapping = new Map<string,string>();
  for (const dimension of boardColumns) {
    const groups = new Map<string,{ filter: BoardFilter; sessions: BoardSession[] }>();
    for (const session of sessions) { const filter = sessionFilter(session,dimension), key = nodeKey(filter); const group = groups.get(key) ?? { filter, sessions: [] }; group.sessions.push(session); groups.set(key,group); }
    const sorted = [...groups.entries()].sort((a,b) => b[1].sessions.length-a[1].sessions.length || a[0].localeCompare(b[0]));
    sorted.forEach(([key,group], index) => {
      if (index < BOARD_LIMITS.nodes_per_column) {
        grouped.set(key,{ ...group, dimension, label: group.filter.dimension === "device" ? `${group.filter.user_id} · ${group.filter.entity}` : group.filter.entity }); mapping.set(key,key);
      } else {
        const otherKey = `other_${dimension}`; const other = grouped.get(otherKey) ?? { dimension,label:"Outros",sessions:[] }; other.sessions.push(...group.sessions); grouped.set(otherKey,other); mapping.set(key,otherKey);
      }
    });
  }
  const nodes: BoardNode[] = [...grouped.entries()].map(([id,group]) => {
    const models = new Set(group.sessions.flatMap(session => session.device.model ? [session.device.model] : []));
    const model = group.dimension === "device" && models.size === 1 ? [...models][0] : undefined;
    return { id, dimension: group.dimension, label: group.label, volume: group.sessions.length, metrics: metrics(group.sessions,board.slas), ...(group.filter ? { filter: group.filter } : {}), ...(model ? { model } : {}) };
  });
  const edges = new Map<string,{ source: string; target: string; sessions: BoardSession[] }>();
  for (const session of sessions) for (let i=0;i<boardColumns.length-1;i++) {
    const sourceDim=boardColumns[i], targetDim=boardColumns[i+1]; if (!sourceDim || !targetDim) continue;
    const source=mapping.get(nodeKey(sessionFilter(session,sourceDim))), target=mapping.get(nodeKey(sessionFilter(session,targetDim))); if (!source || !target) continue;
    const key=`${source}>${target}`, edge=edges.get(key) ?? {source,target,sessions:[]}; edge.sessions.push(session);edges.set(key,edge);
  }
  return { id: createHash("sha256").update(JSON.stringify(filters)).digest("hex").slice(0,16), board, filters, columns: boardColumns, sessionCount: sessions.length, metrics: metrics(sessions,board.slas), nodes, links: [...edges.entries()].map(([id,edge]) => ({id,source:edge.source,target:edge.target,volume:edge.sessions.length,metrics:metrics(edge.sessions,board.slas)})) };
}
export const boardSchemaDescription = {
  version: 1, units: {startup_error_rate:"0..1, failed starts / all sessions",buffer_ratio:"0..1, arithmetic mean of successful session ratios; not time weighted",join_time_ms:"milliseconds, arithmetic mean over successful sessions"},
  session_distribution: "Each metric includes distribution counts good/warning/bad/unknown. Startup: successful/failed starts, no warning band per session. Buffer/join: classify each successful session against its SLA; failed startups are unknown. Counts sum to volume. Aggregate status still uses the aggregate value.",
  limits: BOARD_LIMITS, sla_ranges:"value < warning: good; warning <= value < critical: warning; value >= critical: bad; no successful samples: unknown. Critical violations count samples >= critical.",
  identity:"owner is derived from authentication, never user_id. Device is identified by (user_id,device.id). Session ID is upserted within a board. Sessions outside the board focus may be stored but are excluded from its view.",
  create_example:{name:"User 42 streaming",focus:{type:"user",user_id:"user-42"},slas:{startup_error_rate:{warning:0.01,critical:0.05},buffer_ratio:{warning:0.02,critical:0.05},join_time_ms:{warning:2000,critical:5000}}},
  ingest_example:{sessions:[{session_id:"s-1",user_id:"user-42",device:{id:"tv-living-room",model:"Samsung Tizen"},isp:"Vivo",pop:"GRU",media_id:"match-123",startup_error:false,join_time_ms:1800,buffer_ratio:0.012},{session_id:"s-2",user_id:"user-42",device:{id:"phone",model:"iPhone"},isp:"Claro",pop:"GRU",media_id:"match-123",startup_error:true}]},
  device_focus_example:{type:"device",user_id:"user-42",device_id:"tv-living-room"},device_filter_example:{dimension:"device",entity:"tv-living-room",user_id:"user-42"},
};
