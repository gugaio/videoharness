import { z } from "zod";

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
export const CreateBoardSchema = StoredBoardDefinitionSchema.extend({ slas: BoardSlasSchema.required({ join_time_ms: true }) });
const sessionBase = { session_id: EntitySchema, user_id: EntitySchema, device: z.object({ id: EntitySchema, model: EntitySchema.optional() }).strict(), isp: EntitySchema, pop: EntitySchema, media_id: EntitySchema };
export const BoardSessionSchema = z.discriminatedUnion("startup_error", [
  z.object({ ...sessionBase, startup_error: z.literal(true) }).strict(),
  z.object({ ...sessionBase, startup_error: z.literal(false), join_time_ms: z.number().finite().min(0).max(86_400_000), buffer_ratio: z.number().finite().min(0).max(1) }).strict(),
]);
export const IngestBoardSessionsSchema = z.object({ sessions: z.array(BoardSessionSchema).min(1).max(50) }).strict().refine(s => new Set(s.sessions.map(item => item.session_id)).size === s.sessions.length, "session_id must be unique within a batch");
export const BoardFilterSchema = z.discriminatedUnion("dimension", [
  z.object({ dimension: z.literal("user"), entity: EntitySchema }).strict(),
  z.object({ dimension: z.literal("device"), entity: EntitySchema, user_id: EntitySchema }).strict(),
  z.object({ dimension: z.literal("isp"), entity: EntitySchema }).strict(),
  z.object({ dimension: z.literal("pop"), entity: EntitySchema }).strict(),
  z.object({ dimension: z.literal("media"), entity: EntitySchema }).strict(),
]);
export const BoardViewRequestSchema = z.object({ filters: z.array(BoardFilterSchema).max(4).default([]) }).strict().refine(s => new Set(s.filters.map(f => f.dimension)).size === s.filters.length, "one filter per dimension");
export const BoardPageSchema = z.object({ offset: z.number().int().min(0).max(50_000).default(0), limit: z.number().int().min(1).max(50).default(20) }).strict();
export type CreateBoardInput = z.infer<typeof CreateBoardSchema>;
export type BoardSession = z.infer<typeof BoardSessionSchema>;
export type BoardFilter = z.infer<typeof BoardFilterSchema>;
export type BoardSlas = z.infer<typeof BoardSlasSchema>;
export type BoardRecord = z.infer<typeof StoredBoardDefinitionSchema> & { id: string; created_at: string; session_count: number; view_path: string };
export type BoardMetricName = keyof BoardSlas;
export type BoardMetric = { value: number | null; status: "good" | "warning" | "bad" | "unknown"; unit: "ratio" | "ms"; sample_count: number; violations: number; sla: { warning: number; critical: number } };
export type BoardNode = { id: string; dimension: BoardFilter["dimension"]; label: string; volume: number; metrics: Partial<Record<BoardMetricName, BoardMetric>>; model?: string; filter?: BoardFilter };
export type BoardLink = { id: string; source: string; target: string; volume: number; metrics: Partial<Record<BoardMetricName, BoardMetric>> };
export type BoardView = { id: string; sessionCount: number; metrics: Partial<Record<BoardMetricName, BoardMetric>>; nodes: BoardNode[]; links: BoardLink[]; filters: BoardFilter[]; columns: BoardFilter["dimension"][]; board: BoardRecord };
export const BOARD_LIMITS = { boards_per_owner: 100, sessions_per_board: 10_000, sessions_per_owner: 50_000, sessions_per_batch: 50, body_bytes: 32_768, nodes_per_column: 8, filters: 4 } as const;
