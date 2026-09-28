import type { AggregateBoardRecord, BoardRecord, BoardSession, CreateBoardInput } from "../../domain/boards.js";
import type { BoardBaselineBucket, BoardMetricBucket, PatchAggregateBoard } from "../../domain/board-metrics.js";
export class BoardError extends Error {
  constructor(readonly code: "board_not_found" | "board_limit" | "board_session_limit" | "board_owner_session_limit" | "board_metric_limit" | "board_owner_metric_limit" | "board_metrics_body_too_large" | "invalid_board_filter" | "invalid_board_type" | "invalid_board_patch" | "linked_board_not_found", readonly status: number) { super(code); }
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
  delete(ownerId: string, boardId: string): boolean;
}
