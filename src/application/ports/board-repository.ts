import type { AggregateBoardRecord, BoardRecord, BoardSession, CreateBoardInput, DeleteBoardSessionsInput } from "../../domain/boards.js";
import type { BoardBaselineBucket, BoardMetricBucket, DeleteBoardMetricsInput, PatchAggregateBoard } from "../../domain/board-metrics.js";
import type { DeleteIncidentUserDaysInput, IncidentUserDay } from "../../domain/incident-boards.js";
export class BoardError extends Error {
  constructor(readonly code: "board_not_found" | "board_limit" | "board_session_limit" | "board_owner_session_limit" | "board_metric_limit" | "board_owner_metric_limit" | "board_metrics_body_too_large" | "board_user_limit" | "board_owner_user_day_limit" | "invalid_board_filter" | "invalid_board_type" | "invalid_board_patch" | "invalid_board_selection" | "linked_board_not_found", readonly status: number) { super(code); }
}
export type StoredMetricContribution = BoardMetricBucket & { dimension_key: string; state_origin?: "explicit" | "derived" };
export type MetricIngestResult = {
  inserted: number;
  updated: number;
  rejected: number;
  effective_granularity: AggregateBoardRecord["granularity"];
  coarsened: boolean;
  bucket_count: number;
};
export type SessionDeleteResult = { deleted: number; remaining: number };
export type MetricDeleteResult = { deleted: number; deleted_baseline: number; remaining: number; bucket_count: number };
export type ResetBoardResult = { board_type: "sessions" | "aggregate" | "incident"; deleted_sessions: number; deleted_contributions: number };
export type IncidentUsersAddResult = { added: number; existing: number; total: number };
export type IncidentUsersRemoveResult = { deleted: number; deleted_user_days: number; remaining: number };
export type IncidentUserDaysIngestResult = { inserted: number; updated: number; total: number };
export type IncidentUserDaysDeleteResult = { deleted: number; remaining: number };
export interface BoardRepository {
  create(ownerId: string, input: CreateBoardInput): BoardRecord;
  get(ownerId: string, boardId: string): BoardRecord | undefined;
  list(ownerId: string, offset: number, limit: number): { boards: BoardRecord[]; total: number; next_offset: number | null };
  ingest(ownerId: string, boardId: string, sessions: BoardSession[]): { inserted: number; updated: number; total: number };
  sessions(ownerId: string, boardId: string, offset: number, limit: number): { sessions: BoardSession[]; total: number; next_offset: number | null };
  allSessions(ownerId: string, boardId: string): BoardSession[];
  patch(ownerId: string, boardId: string, input: PatchAggregateBoard): BoardRecord;
  ingestMetrics(ownerId: string, boardId: string, buckets: StoredMetricContribution[], baseline: BoardBaselineBucket[]): MetricIngestResult;
  allMetricBuckets(ownerId: string, boardId: string): { buckets: StoredMetricContribution[]; baseline: BoardBaselineBucket[] };
  deleteSessions(ownerId: string, boardId: string, input: DeleteBoardSessionsInput): SessionDeleteResult;
  deleteMetrics(ownerId: string, boardId: string, input: DeleteBoardMetricsInput): MetricDeleteResult;
  resetBoard(ownerId: string, boardId: string): ResetBoardResult;
  addIncidentUsers(ownerId: string, boardId: string, userIds: string[]): IncidentUsersAddResult;
  removeIncidentUsers(ownerId: string, boardId: string, userIds: string[]): IncidentUsersRemoveResult;
  incidentUsers(ownerId: string, boardId: string): string[];
  ingestIncidentUserDays(ownerId: string, boardId: string, items: IncidentUserDay[]): IncidentUserDaysIngestResult;
  allIncidentUserDays(ownerId: string, boardId: string): IncidentUserDay[];
  deleteIncidentUserDays(ownerId: string, boardId: string, input: DeleteIncidentUserDaysInput): IncidentUserDaysDeleteResult;
  delete(ownerId: string, boardId: string): boolean;
}
