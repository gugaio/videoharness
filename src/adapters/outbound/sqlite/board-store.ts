import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { BoardError, type BoardRepository } from "../../../application/ports/board-repository.js";
import { BOARD_LIMITS, StoredBoardDefinitionSchema, BoardSessionSchema, type BoardRecord, type BoardSession, type CreateBoardInput } from "../../../domain/boards.js";

type Row = { id: string; name: string; focus: string; slas: string; created_at: string; session_count: number };
export class BoardStore implements BoardRepository {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, focus TEXT NOT NULL, slas TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS boards_owner ON boards(owner_id);
      CREATE TABLE IF NOT EXISTS board_sessions (board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, session_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(board_id,session_id));`);
  }
  private record(row: Row): BoardRecord {
    const input = StoredBoardDefinitionSchema.parse({ name: row.name, focus: JSON.parse(row.focus), slas: JSON.parse(row.slas) });
    return { ...input, id: row.id, created_at: row.created_at, session_count: row.session_count, view_path: `/dashboard/boards/${row.id}` };
  }
  private owned(ownerId: string, id: string): BoardRecord { const board = this.get(ownerId, id); if (!board) throw new BoardError("board_not_found", 404); return board; }
  create(ownerId: string, input: CreateBoardInput): BoardRecord {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const count = this.db.prepare("SELECT COUNT(*) AS count FROM boards WHERE owner_id=?").get(ownerId) as { count: number };
      if (count.count >= BOARD_LIMITS.boards_per_owner) throw new BoardError("board_limit", 429);
      const id = randomUUID(), created_at = new Date().toISOString();
      this.db.prepare("INSERT INTO boards VALUES (?,?,?,?,?,?)").run(id, ownerId, input.name, JSON.stringify(input.focus), JSON.stringify(input.slas), created_at);
      this.db.exec("COMMIT");
      return { ...input, id, created_at, session_count: 0, view_path: `/dashboard/boards/${id}` };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  get(ownerId: string, id: string): BoardRecord | undefined {
    const row = this.db.prepare("SELECT b.*, (SELECT COUNT(*) FROM board_sessions s WHERE s.board_id=b.id) AS session_count FROM boards b WHERE owner_id=? AND id=?").get(ownerId,id) as Row | undefined;
    return row ? this.record(row) : undefined;
  }
  list(ownerId: string, offset: number, limit: number) {
    const total = (this.db.prepare("SELECT COUNT(*) AS count FROM boards WHERE owner_id=?").get(ownerId) as { count: number }).count;
    const rows = this.db.prepare("SELECT b.*, (SELECT COUNT(*) FROM board_sessions s WHERE s.board_id=b.id) AS session_count FROM boards b WHERE owner_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?").all(ownerId,limit,offset) as Row[];
    return { boards: rows.map(row => this.record(row)), total, next_offset: offset+limit < total ? offset+limit : null };
  }
  ingest(ownerId: string, id: string, sessions: BoardSession[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const board = this.owned(ownerId,id);
      const exists = this.db.prepare("SELECT 1 FROM board_sessions WHERE board_id=? AND session_id=?");
      const inserted = sessions.filter(session => !exists.get(id,session.session_id)).length;
      if (board.session_count+inserted > BOARD_LIMITS.sessions_per_board) throw new BoardError("board_session_limit",429);
      const ownerCount = (this.db.prepare("SELECT COUNT(*) AS count FROM board_sessions s JOIN boards b ON b.id=s.board_id WHERE b.owner_id=?").get(ownerId) as { count: number }).count;
      if (ownerCount+inserted > BOARD_LIMITS.sessions_per_owner) throw new BoardError("board_owner_session_limit",429);
      const upsert = this.db.prepare("INSERT INTO board_sessions VALUES (?,?,?) ON CONFLICT(board_id,session_id) DO UPDATE SET payload=excluded.payload");
      for (const session of sessions) upsert.run(id,session.session_id,JSON.stringify(session));
      this.db.exec("COMMIT");
      return { inserted, updated: sessions.length-inserted, total: board.session_count+inserted };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  sessions(ownerId: string, id: string, offset: number, limit: number) {
    const board = this.owned(ownerId,id);
    const rows = this.db.prepare("SELECT payload FROM board_sessions WHERE board_id=? ORDER BY session_id LIMIT ? OFFSET ?").all(id,limit,offset) as { payload: string }[];
    return { sessions: rows.map(row => BoardSessionSchema.parse(JSON.parse(row.payload))), total: board.session_count, next_offset: offset+limit < board.session_count ? offset+limit : null };
  }
  allSessions(ownerId: string, id: string): BoardSession[] { this.owned(ownerId,id); const rows = this.db.prepare("SELECT payload FROM board_sessions WHERE board_id=? ORDER BY session_id").all(id) as { payload: string }[]; return rows.map(row => BoardSessionSchema.parse(JSON.parse(row.payload))); }
  delete(ownerId: string, id: string): boolean { return Number(this.db.prepare("DELETE FROM boards WHERE owner_id=? AND id=?").run(ownerId,id).changes)>0; }
  close() { this.db.close(); }
}
