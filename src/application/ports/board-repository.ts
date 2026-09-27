import type { BoardRecord, BoardSession, CreateBoardInput } from "../../domain/boards.js";
export class BoardError extends Error {
  constructor(readonly code: "board_not_found" | "board_limit" | "board_session_limit" | "board_owner_session_limit" | "invalid_board_filter", readonly status: number) { super(code); }
}
export interface BoardRepository {
  create(ownerId: string, input: CreateBoardInput): BoardRecord;
  get(ownerId: string, boardId: string): BoardRecord | undefined;
  list(ownerId: string, offset: number, limit: number): { boards: BoardRecord[]; total: number; next_offset: number | null };
  ingest(ownerId: string, boardId: string, sessions: BoardSession[]): { inserted: number; updated: number; total: number };
  sessions(ownerId: string, boardId: string, offset: number, limit: number): { sessions: BoardSession[]; total: number; next_offset: number | null };
  allSessions(ownerId: string, boardId: string): BoardSession[];
  delete(ownerId: string, boardId: string): boolean;
}
