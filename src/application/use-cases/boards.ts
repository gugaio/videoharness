import { createHash } from "node:crypto";
import { BoardError, type BoardRepository } from "../ports/board-repository.js";
import { BOARD_LIMITS, CreateBoardSchema, DeleteBoardSessionsSchema, IngestBoardSessionsSchema, SessionBoardViewRequestSchema, type BoardFilter, type BoardMetric, type BoardMetricName, type BoardRecord, type BoardSession, type BoardSlas, type BoardView, type BoardViewRequest, type BoardNode, type SessionBoardRecord } from "../../domain/boards.js";
import { deriveStateFromPop, PatchAggregateBoardSchema } from "../../domain/board-metrics.js";
import { getAggregateBoardView } from "./board-metrics.js";
import { getIncidentBoardView } from "./incident-boards.js";

export function createBoard(repository: BoardRepository, ownerId: string, input: unknown) { return repository.create(ownerId, CreateBoardSchema.parse(input)); }
export function getBoard(repository: BoardRepository, ownerId: string, id: string) { const board = repository.get(ownerId,id); if (!board) throw new BoardError("board_not_found",404); return board; }
export function patchBoard(repository: BoardRepository, ownerId: string, id: string, input: unknown) {
  getBoard(repository,ownerId,id);
  const board = repository.get(ownerId,id);
  if (!board) throw new BoardError("board_not_found",404);
  if (board.board_type !== "aggregate") throw new BoardError("invalid_board_type",400);
  const parsed = PatchAggregateBoardSchema.parse(input);
  return repository.patch(ownerId,id,parsed);
}
export function ingestBoardSessions(repository: BoardRepository, ownerId: string, id: string, input: unknown) {
  const board=getBoard(repository,ownerId,id);
  if (board.board_type !== "sessions") throw new BoardError("invalid_board_type",400);
  return repository.ingest(ownerId,id,IngestBoardSessionsSchema.parse(input).sessions);
}
export function deleteBoardSessions(repository: BoardRepository, ownerId: string, id: string, input: unknown) {
  const board=getBoard(repository,ownerId,id);
  if (board.board_type !== "sessions") throw new BoardError("invalid_board_type",400);
  return repository.deleteSessions(ownerId,id,DeleteBoardSessionsSchema.parse(input));
}
export function resetBoard(repository: BoardRepository, ownerId: string, id: string) {
  getBoard(repository,ownerId,id);
  return repository.resetBoard(ownerId,id);
}
const columns: Record<SessionBoardRecord["focus"]["type"], BoardFilter["dimension"][]> = { user: ["user","device","isp","pop","media"], device: ["device","isp","pop","media"], isp: ["isp","pop","media"], pop: ["pop","isp","media"] };
function matches(session: BoardSession, filter: BoardFilter): boolean {
  if (filter.dimension === "device") return session.user_id === filter.user_id && session.device.id === filter.entity;
  if (filter.dimension === "state") return deriveStateFromPop(session.pop) === filter.entity.toUpperCase();
  if (filter.dimension === "device_type") return session.device_type === filter.entity;
  const entity = filter.dimension === "user" ? session.user_id : filter.dimension === "media" ? session.media_id : session[filter.dimension];
  return entity === filter.entity;
}
function rootFilter(board: SessionBoardRecord): BoardFilter {
  const focus = board.focus;
  if (focus.type === "device") return { dimension: "device", entity: focus.device_id, user_id: focus.user_id };
  return { dimension: focus.type, entity: focus.type === "user" ? focus.user_id : focus.type === "isp" ? focus.isp : focus.pop };
}
function sessionFilter(session: BoardSession, dimension: BoardFilter["dimension"]): BoardFilter {
  if (dimension === "device") return { dimension, entity: session.device.id, user_id: session.user_id };
  if (dimension === "state") return { dimension, entity: deriveStateFromPop(session.pop) ?? "unknown" };
  if (dimension === "device_type") return { dimension, entity: session.device_type ?? "unknown" };
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
  if (board.board_type === "aggregate") return getAggregateBoardView(repository,ownerId,id,input);
  if (board.board_type === "incident") return getIncidentBoardView(repository,ownerId,id,input);
  return getSessionBoardView(repository,ownerId,id,board,input);
}
function getSessionBoardView(repository:BoardRepository,ownerId:string,id:string,board:SessionBoardRecord,input:unknown):Extract<BoardView,{board_type:"sessions"}>{
  const { filters } = SessionBoardViewRequestSchema.parse(input);
  const boardColumns = columns[board.focus.type];
  const supplemental: BoardFilter["dimension"][] = ["state","device_type"];
  if (filters.some(filter => !boardColumns.includes(filter.dimension) && !supplemental.includes(filter.dimension))) throw new BoardError("invalid_board_filter",400);
  const allSessions=repository.allSessions(ownerId,id);
  let sessions = allSessions.filter(session => matches(session,rootFilter(board)) && filters.every(filter => matches(session,filter)));
  const { time_window, quality } = SessionBoardViewRequestSchema.parse(input);
  let excludedMissingTimestamp=0;
  if (time_window) { excludedMissingTimestamp=sessions.filter(session=>session.started_at===undefined).length;sessions=sessions.filter(session=>session.started_at!==undefined && Date.parse(session.started_at)>=Date.parse(time_window.from) && Date.parse(session.started_at)<Date.parse(time_window.to)); }
  if (quality) sessions=sessions.filter(session=>matchesQuality(session,quality,board));
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
  return { board_type:"sessions", id: createHash("sha256").update(JSON.stringify({filters,time_window,quality})).digest("hex").slice(0,16), board, filters, columns: boardColumns, sessionCount: sessions.length, excluded_missing_timestamp_count:excludedMissingTimestamp, metrics: metrics(sessions,board.slas), nodes, links: [...edges.entries()].map(([id,edge]) => ({id,source:edge.source,target:edge.target,volume:edge.sessions.length,metrics:metrics(edge.sessions,board.slas)})) };
}
function matchesQuality(session:BoardSession,quality:NonNullable<BoardViewRequest["quality"]>,board:SessionBoardRecord):boolean{
 if(quality==="startup_error")return session.startup_error;
 if(session.startup_error)return quality==="any_sla_violation";
 const bufferWarning=session.buffer_ratio>=board.slas.buffer_ratio.warning;
 const joinSla=board.slas.join_time_ms;
 const joinWarning=joinSla!==undefined&&session.join_time_ms>=joinSla.warning;
 if(quality==="critical_buffer")return session.buffer_ratio>=board.slas.buffer_ratio.critical;
 if(quality==="critical_join")return joinSla!==undefined&&session.join_time_ms>=joinSla.critical;
 if(quality==="warning_buffer")return bufferWarning;
 if(quality==="warning_join")return joinWarning;
 return bufferWarning||joinWarning;
}
export const boardSchemaDescription = {
  version: 1, units: {startup_error_rate:"0..1, failed starts / all sessions",buffer_ratio:"0..1, arithmetic mean of successful session ratios; not time weighted",join_time_ms:"milliseconds, arithmetic mean over successful sessions"},
  session_distribution: "Each metric includes distribution counts good/warning/bad/unknown. Startup: successful/failed starts, no warning band per session. Buffer/join: classify each successful session against its SLA; failed startups are unknown. Counts sum to volume. Aggregate status still uses the aggregate value.",
  limits: BOARD_LIMITS, sla_ranges:"value < warning: good; warning <= value < critical: warning; value >= critical: bad; no successful samples: unknown. Critical violations count samples >= critical.",
  identity:"owner is derived from authentication, never user_id. Device is identified by (user_id,device.id). Session ID is upserted within a board. Sessions outside the board focus may be stored but are excluded from its view.",
  create_example:{name:"User 42 streaming",focus:{type:"user",user_id:"user-42"},slas:{startup_error_rate:{warning:0.01,critical:0.05},buffer_ratio:{warning:0.02,critical:0.05},join_time_ms:{warning:2000,critical:5000}}},
  ingest_example:{sessions:[{session_id:"s-1",user_id:"user-42",device:{id:"tv-living-room",model:"Samsung Tizen"},isp:"Vivo",pop:"GRU",media_id:"match-123",started_at:"2026-09-24T21:00:00Z",startup_error:false,join_time_ms:1800,buffer_ratio:0.012},{session_id:"s-2",user_id:"user-42",device:{id:"phone",model:"iPhone"},isp:"Claro",pop:"GRU",media_id:"match-123",started_at:"2026-09-24T21:02:00Z",startup_error:true}]},
  device_focus_example:{type:"device",user_id:"user-42",device_id:"tv-living-room"},device_filter_example:{dimension:"device",entity:"tv-living-room",user_id:"user-42"},
  aggregate:{version:1,board_type:"aggregate",units:{rates:"0..1 supplied by source",join_time_ms:"milliseconds supplied by source",volume:"required non-negative integer weight"},view_metrics:["startup_error_rate","buffer_ratio","join_time_ms_avg","join_over_sla_pct"],join_time_fields:"join_time_ms aliases join_time_ms_avg; join_time_ms_sum + join_time_ms_count compose the mean exactly (weight = count) instead of volume-weighting it",defaults:{buffer_ratio:{warning:0.005,critical:0.01},join_time_ms:{warning:8000,critical:15000}},limits:{batch_buckets:BOARD_LIMITS.metric_batch_buckets,batch_bytes:BOARD_LIMITS.metric_body_bytes,materialized_per_board:BOARD_LIMITS.metric_buckets_per_board,contributions_per_board:BOARD_LIMITS.metric_contributions_per_board},counting_touch:"POP rows count touches and are not additive to distinct focus totals; baseline must be ingested separately.",percentiles:"Only source-provided per-bucket percentiles are shown; percentiles are not rolled up or averaged.",example:{board_type:"aggregate",name:"Vivo ISP",focus:{type:"isp",isp:"Vivo"},granularity:"5m",window:{from:"2026-09-24T21:00:00-03:00",to:"2026-09-25T00:00:00-03:00"},primary_dimension:"pop",secondary_dimension:"media_id",slas:{startup_error_rate:{warning:0.01,critical:0.05},buffer_ratio:{warning:0.005,critical:0.01},join_time_ms:{warning:8000,critical:15000}},source:{system:"npaw",query:"select views, bufferRatio, join_over_sla_metric ... group by extraparam15",sampling:{method:"none",coverage:1},counting:"touch"}}},
  incident:{version:1,board_type:"incident",
    units:{day:"YYYY-MM-DD in America/Sao_Paulo (fixed UTC-3)",counts:"non-negative integers of sessions per user and day",slas:"warning/critical are fractions 0..1 of a user's daily sessions that are bad"},
    metrics:{buffer:"bad = buffer_over_sla_sessions over sessions that started successfully (sessions - startup_error_sessions)",startup_error:"bad = startup_error_sessions over sessions"},
    color:"cell intensity is 0 at share 0, 0.5 at warning and 1 at critical or above; no denominator means unknown (no data).",
    limits:{users_per_board:BOARD_LIMITS.incident_users_per_board,batch_items:BOARD_LIMITS.incident_batch_items,batch_bytes:BOARD_LIMITS.incident_body_bytes,window_days:31},
    flow:"create the board, add the cohort with add_incident_users, then upsert daily counts with ingest_incident_user_days; items for unknown users or days outside the window are rejected individually. Retries replace.",
    create_example:{board_type:"incident",name:"Incidente POP vm-sp",incident:{started_at:"2026-09-24T18:00:00-03:00",description:"Buffering elevado no POP vm-sp"},window:{from_day:"2026-09-21",to_day:"2026-09-27"},slas:{startup_error:{warning:0.1,critical:0.3},buffer:{warning:0.1,critical:0.3}},source:{system:"npaw",query:"select views, ... group by userId, day",buffer_ratio_session_threshold:0.01}},
    user_day_example:{user_id:"user-42",day:"2026-09-24",sessions:12,startup_error_sessions:1,buffer_over_sla_sessions:5,buffer_ratio_avg:0.012,join_time_ms_avg:3200}},
};
