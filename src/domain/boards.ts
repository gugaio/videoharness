import { z } from "zod";
import { AggregateBoardDefinitionSchema, AggregateDimensionSchema, AggregateMetricSchema, type AggregateBoardDefinition, type BoardAggregateView } from "./board-metrics.js";

export const BoardIdSchema = z.string().min(1).max(128);
const EntitySchema = z.string().trim().min(1).max(128);
export const BoardFocusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), user_id: EntitySchema }).strict(),
  z.object({ type: z.literal("device"), user_id: EntitySchema, device_id: EntitySchema }).strict(),
  z.object({ type: z.literal("isp"), isp: EntitySchema }).strict(),
  z.object({ type: z.literal("pop"), pop: EntitySchema }).strict(),
]);
const ratioBand = z.object({ warning: z.number().finite().min(0).max(1), critical: z.number().finite().min(0).max(1) }).strict().refine(s => s.warning < s.critical, "warning must be lower than critical");
const timeBand = z.object({ warning: z.number().finite().min(0).max(86_400_000), critical: z.number().finite().min(0).max(86_400_000) }).strict().refine(s => s.warning < s.critical, "warning must be lower than critical");
export const BoardSlasSchema = z.object({ startup_error_rate: ratioBand, buffer_ratio: ratioBand, join_time_ms: timeBand.optional() }).strict();
export const StoredBoardDefinitionSchema = z.object({ name: z.string().trim().min(1).max(100), focus: BoardFocusSchema, slas: BoardSlasSchema }).strict();
export const CreateSessionBoardSchema = StoredBoardDefinitionSchema.extend({ slas: BoardSlasSchema.required({ join_time_ms: true }), board_type: z.literal("sessions").optional() });
export const CreateAggregateBoardSchema = AggregateBoardDefinitionSchema;
export const CreateBoardSchema = z.union([CreateAggregateBoardSchema, CreateSessionBoardSchema]);
export const CreateAnyBoardSchema = CreateBoardSchema;
const sessionCore = { session_id: EntitySchema, user_id: EntitySchema, device: z.object({ id: EntitySchema, model: EntitySchema.optional() }).strict(), isp: EntitySchema, pop: EntitySchema, media_id: EntitySchema, device_type: EntitySchema.optional() };
// Stored sessions keep started_at optional so rows written before temporal
// evidence existed remain readable. Ingest requires it explicitly.
export const BoardSessionSchema = z.discriminatedUnion("startup_error", [
  z.object({ ...sessionCore, started_at: z.string().datetime({ offset: true }).optional(), startup_error: z.literal(true) }).strict(),
  z.object({ ...sessionCore, started_at: z.string().datetime({ offset: true }).optional(), startup_error: z.literal(false), join_time_ms: z.number().finite().min(0).max(86_400_000), buffer_ratio: z.number().finite().min(0).max(1) }).strict(),
]);
const IngestBoardSessionSchema = z.discriminatedUnion("startup_error", [
  z.object({ ...sessionCore, started_at: z.string().datetime({ offset: true }), startup_error: z.literal(true) }).strict(),
  z.object({ ...sessionCore, started_at: z.string().datetime({ offset: true }), startup_error: z.literal(false), join_time_ms: z.number().finite().min(0).max(86_400_000), buffer_ratio: z.number().finite().min(0).max(1) }).strict(),
]);
export const IngestBoardSessionsSchema = z.object({ sessions: z.array(IngestBoardSessionSchema).min(1).max(500) }).strict().refine(s => new Set(s.sessions.map(item => item.session_id)).size === s.sessions.length, "session_id must be unique within a batch");
export const BoardFilterSchema = z.discriminatedUnion("dimension", [
  z.object({ dimension: z.literal("user"), entity: EntitySchema }).strict(),
  z.object({ dimension: z.literal("device"), entity: EntitySchema, user_id: EntitySchema }).strict(),
  z.object({ dimension: z.literal("isp"), entity: EntitySchema }).strict(),
  z.object({ dimension: z.literal("pop"), entity: EntitySchema }).strict(),
  z.object({ dimension: z.literal("media"), entity: EntitySchema }).strict(),
  z.object({ dimension: z.literal("state"), entity: EntitySchema }).strict(),
  z.object({ dimension: z.literal("device_type"), entity: EntitySchema }).strict(),
]);
const oneFilterPerDimension = (value: { filters: Array<{ dimension: string }> }) => new Set(value.filters.map(filter => filter.dimension)).size === value.filters.length;
const elementWindowSchema = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict().refine(w => Date.parse(w.from) < Date.parse(w.to), "time_window.from must be before time_window.to");
const qualityFilterSchema = z.enum(["startup_error", "warning_buffer", "critical_buffer", "warning_join", "critical_join", "any_sla_violation"]);
const sessionViewFields = { filters: z.array(BoardFilterSchema).max(4).default([]), time_window: elementWindowSchema.optional(), quality: qualityFilterSchema.optional() };
export const BoardViewRequestSchema = z.object(sessionViewFields).strict().refine(oneFilterPerDimension, "one filter per dimension");
// A single MCP tool schema is shared by both board types. Sessions accept the
// aggregate-only parameters declared there and ignore them (metric/dimension
// and pagination only apply to aggregate heatmaps). This keeps the advertised
// contract and the runtime behavior aligned instead of rejecting valid calls.
export const SessionBoardViewRequestSchema = z.object({
  ...sessionViewFields,
  metric: AggregateMetricSchema.optional(),
  dimension: AggregateDimensionSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(25_000).optional(),
  time_offset: z.number().int().min(0).max(25_000).optional(),
  time_limit: z.number().int().min(1).max(720).optional(),
}).strict().refine(oneFilterPerDimension, "one filter per dimension");
export const DeleteBoardSessionsObjectSchema = z.object({
  session_ids: z.array(EntitySchema).min(1).max(500).optional(),
  time_window: elementWindowSchema.optional(),
}).strict();
export const DeleteBoardSessionsSchema = DeleteBoardSessionsObjectSchema.refine(value => (value.session_ids !== undefined) !== (value.time_window !== undefined), "provide exactly one of session_ids or time_window");
export type DeleteBoardSessionsInput = z.infer<typeof DeleteBoardSessionsSchema>;
export const BoardPageSchema = z.object({ offset: z.number().int().min(0).max(50_000).default(0), limit: z.number().int().min(1).max(50).default(20) }).strict();
export type CreateBoardInput = z.infer<typeof CreateBoardSchema>;
export type BoardSession = z.infer<typeof BoardSessionSchema>;
export type BoardFilter = z.infer<typeof BoardFilterSchema>;
export type BoardSlas = z.infer<typeof BoardSlasSchema>;
export type SessionBoardRecord = z.infer<typeof StoredBoardDefinitionSchema> & { board_type: "sessions"; id: string; created_at: string; session_count: number; bucket_count: 0; view_path: string };
export type AggregateBoardRecord = AggregateBoardDefinition & { id: string; created_at: string; session_count: 0; bucket_count: number; effective_granularity: AggregateBoardDefinition["granularity"]; view_path: string };
export type BoardRecord = SessionBoardRecord | AggregateBoardRecord;
export type BoardMetricName = keyof BoardSlas;
export type BoardMetric = { value: number | null; status: "good" | "warning" | "bad" | "unknown"; unit: "ratio" | "ms"; sample_count: number; distribution: Record<"good" | "warning" | "bad" | "unknown", number>; violations: number; sla: { warning: number; critical: number } };
export type BoardNode = { id: string; dimension: BoardFilter["dimension"]; label: string; volume: number; metrics: Partial<Record<BoardMetricName, BoardMetric>>; model?: string; filter?: BoardFilter };
export type BoardLink = { id: string; source: string; target: string; volume: number; metrics: Partial<Record<BoardMetricName, BoardMetric>> };
export type BoardViewRequest = z.infer<typeof BoardViewRequestSchema>;
export type SessionBoardView = { board_type: "sessions"; id: string; sessionCount: number; metrics: Partial<Record<BoardMetricName, BoardMetric>>; nodes: BoardNode[]; links: BoardLink[]; filters: BoardFilter[]; columns: BoardFilter["dimension"][]; board: SessionBoardRecord; excluded_missing_timestamp_count: number };
export type BoardView = SessionBoardView | BoardAggregateView;
export const BOARD_LIMITS = { boards_per_owner: 100, sessions_per_board: 10_000, sessions_per_owner: 50_000, sessions_per_batch: 500, body_bytes: 32_768, session_body_bytes: 262_144, metric_batch_buckets: 500, metric_body_bytes: 262_144, metric_buckets_per_board: 25_000, metric_contributions_per_board: 100_000, metric_buckets_per_owner: 250_000, nodes_per_column: 8, filters: 4 } as const;
