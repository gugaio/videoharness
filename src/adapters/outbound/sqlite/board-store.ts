import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { BoardError, type BoardRepository, type StoredMetricContribution, type MetricIngestResult } from "../../../application/ports/board-repository.js";
import { BOARD_LIMITS, StoredBoardDefinitionSchema, BoardSessionSchema, type BoardRecord, type BoardSession, type CreateBoardInput } from "../../../domain/boards.js";
import { AggregateBoardDefinitionSchema, AggregateGranularitySchema, BoardBaselineBucketSchema, BoardMetricBucketSchema, COARSENING_ORDER, GRANULARITY_MS, type BoardBaselineBucket, type PatchAggregateBoard } from "../../../domain/board-metrics.js";

type Row = { id: string; name: string; focus: string; slas: string; created_at: string; board_type: string; aggregate_definition: string | null; effective_granularity: string | null; session_count: number; bucket_count: number };
const selectBoard = `SELECT b.*,
  (SELECT COUNT(*) FROM board_sessions s WHERE s.board_id=b.id) AS session_count,
  (SELECT COUNT(*) FROM board_metric_cells c WHERE c.board_id=b.id) AS bucket_count FROM boards b`;

export class BoardStore implements BoardRepository {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`);
    this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, focus TEXT NOT NULL, slas TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS boards_owner ON boards(owner_id);
        CREATE TABLE IF NOT EXISTS board_sessions (board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, session_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(board_id,session_id));`);
      const columns = new Set((this.db.prepare("PRAGMA table_info(boards)").all() as { name: string }[]).map(column => column.name));
      if (!columns.has("board_type")) this.db.exec("ALTER TABLE boards ADD COLUMN board_type TEXT NOT NULL DEFAULT 'sessions'");
      if (!columns.has("aggregate_definition")) this.db.exec("ALTER TABLE boards ADD COLUMN aggregate_definition TEXT");
      if (!columns.has("effective_granularity")) this.db.exec("ALTER TABLE boards ADD COLUMN effective_granularity TEXT");
      this.db.exec(`CREATE TABLE IF NOT EXISTS board_metric_contributions (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        series TEXT NOT NULL CHECK(series IN ('entity','baseline')),
        dimension_key TEXT NOT NULL, ts TEXT NOT NULL, ts_ms INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(board_id,series,dimension_key,ts));
        CREATE INDEX IF NOT EXISTS board_metric_time ON board_metric_contributions(board_id,ts_ms);
        CREATE TABLE IF NOT EXISTS board_metric_cells (
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          series TEXT NOT NULL, dimension_key TEXT NOT NULL, ts_ms INTEGER NOT NULL,
          PRIMARY KEY(board_id,series,dimension_key,ts_ms));`);
    });
  }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private record(row: Row): BoardRecord {
    const common = { id: row.id, created_at: row.created_at, view_path: `/dashboard/boards/${row.id}` };
    if (row.board_type === "aggregate") {
      const definition = AggregateBoardDefinitionSchema.parse(JSON.parse(row.aggregate_definition ?? "null"));
      return { ...definition, ...common, session_count: 0, bucket_count: row.bucket_count, effective_granularity: AggregateGranularitySchema.parse(row.effective_granularity) };
    }
    const input = StoredBoardDefinitionSchema.parse({ name: row.name, focus: JSON.parse(row.focus), slas: JSON.parse(row.slas) });
    return { ...input, ...common, board_type: "sessions", session_count: row.session_count, bucket_count: 0 };
  }
  private owned(ownerId: string, id: string): BoardRecord { const board = this.get(ownerId, id); if (!board) throw new BoardError("board_not_found", 404); return board; }
  private checkLink(ownerId: string, linkedId: string | undefined | null) {
    if (!linkedId) return;
    const linked = this.get(ownerId, linkedId);
    if (!linked || linked.board_type !== "sessions") throw new BoardError("linked_board_not_found", 404);
  }
  create(ownerId: string, input: CreateBoardInput): BoardRecord {
    return this.transaction(() => {
      const count = this.db.prepare("SELECT COUNT(*) AS count FROM boards WHERE owner_id=?").get(ownerId) as { count: number };
      if (count.count >= BOARD_LIMITS.boards_per_owner) throw new BoardError("board_limit", 429);
      const aggregate = input.board_type === "aggregate" ? input : undefined;
      this.checkLink(ownerId, aggregate?.linked_sessions_board_id);
      const id = randomUUID(), created_at = new Date().toISOString();
      const definition = aggregate ? { ...aggregate, window: { from: new Date(aggregate.window.from).toISOString(), to: new Date(aggregate.window.to).toISOString() } } : undefined;
      this.db.prepare("INSERT INTO boards (id,owner_id,name,focus,slas,created_at,board_type,aggregate_definition,effective_granularity) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, ownerId, input.name, JSON.stringify(input.focus), JSON.stringify(input.slas), created_at, aggregate ? "aggregate" : "sessions", definition ? JSON.stringify(definition) : null, aggregate?.granularity ?? null);
      return this.owned(ownerId, id);
    });
  }
  get(ownerId: string, id: string): BoardRecord | undefined {
    const row = this.db.prepare(`${selectBoard} WHERE owner_id=? AND id=?`).get(ownerId, id) as Row | undefined;
    return row ? this.record(row) : undefined;
  }
  list(ownerId: string, offset: number, limit: number) {
    const total = (this.db.prepare("SELECT COUNT(*) AS count FROM boards WHERE owner_id=?").get(ownerId) as { count: number }).count;
    const rows = this.db.prepare(`${selectBoard} WHERE owner_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(ownerId, limit, offset) as Row[];
    return { boards: rows.map(row => this.record(row)), total, next_offset: offset + limit < total ? offset + limit : null };
  }
  ingest(ownerId: string, id: string, sessions: BoardSession[]) {
    return this.transaction(() => {
      const board = this.owned(ownerId, id);
      if (board.board_type !== "sessions") throw new BoardError("invalid_board_type", 400);
      const exists = this.db.prepare("SELECT 1 FROM board_sessions WHERE board_id=? AND session_id=?");
      const inserted = sessions.filter(session => !exists.get(id, session.session_id)).length;
      if (board.session_count + inserted > BOARD_LIMITS.sessions_per_board) throw new BoardError("board_session_limit", 429);
      const ownerCount = (this.db.prepare("SELECT COUNT(*) AS count FROM board_sessions s JOIN boards b ON b.id=s.board_id WHERE b.owner_id=?").get(ownerId) as { count: number }).count;
      if (ownerCount + inserted > BOARD_LIMITS.sessions_per_owner) throw new BoardError("board_owner_session_limit", 429);
      const upsert = this.db.prepare("INSERT INTO board_sessions (board_id,session_id,payload) VALUES (?,?,?) ON CONFLICT(board_id,session_id) DO UPDATE SET payload=excluded.payload");
      for (const session of sessions) upsert.run(id, session.session_id, JSON.stringify(session));
      return { inserted, updated: sessions.length - inserted, total: board.session_count + inserted };
    });
  }
  sessions(ownerId: string, id: string, offset: number, limit: number) {
    const board = this.owned(ownerId, id);
    if (board.board_type !== "sessions") throw new BoardError("invalid_board_type", 400);
    const rows = this.db.prepare("SELECT payload FROM board_sessions WHERE board_id=? ORDER BY session_id LIMIT ? OFFSET ?").all(id, limit, offset) as { payload: string }[];
    return { sessions: rows.map(row => BoardSessionSchema.parse(JSON.parse(row.payload))), total: board.session_count, next_offset: offset + limit < board.session_count ? offset + limit : null };
  }
  allSessions(ownerId: string, id: string): BoardSession[] {
    if (this.owned(ownerId, id).board_type !== "sessions") throw new BoardError("invalid_board_type", 400);
    const rows = this.db.prepare("SELECT payload FROM board_sessions WHERE board_id=? ORDER BY session_id").all(id) as { payload: string }[];
    return rows.map(row => BoardSessionSchema.parse(JSON.parse(row.payload)));
  }
  patch(ownerId: string, id: string, input: PatchAggregateBoard): BoardRecord {
    return this.transaction(() => {
      const board = this.owned(ownerId, id);
      if (board.board_type !== "aggregate") throw new BoardError("invalid_board_type", 400);
      this.checkLink(ownerId, input.linked_sessions_board_id);
      const row = this.db.prepare("SELECT aggregate_definition FROM boards WHERE id=?").get(id) as { aggregate_definition: string };
      const definition = AggregateBoardDefinitionSchema.parse(JSON.parse(row.aggregate_definition));
      const { linked_sessions_board_id: _oldLink, ...withoutLink } = definition;
      const { linked_sessions_board_id: linkPatch, ...metadata } = input;
      const link = linkPatch === null ? undefined : linkPatch ?? definition.linked_sessions_board_id;
      const next = AggregateBoardDefinitionSchema.parse({ ...withoutLink, ...metadata, ...(link ? { linked_sessions_board_id: link } : {}) });
      this.db.prepare("UPDATE boards SET name=?,slas=?,aggregate_definition=? WHERE id=? AND owner_id=?")
        .run(next.name, JSON.stringify(next.slas), JSON.stringify(next), id, ownerId);
      return this.owned(ownerId, id);
    });
  }
  ingestMetrics(ownerId: string, id: string, buckets: StoredMetricContribution[], baseline: BoardBaselineBucket[]): MetricIngestResult {
    return this.transaction(() => {
      const board = this.owned(ownerId, id);
      if (board.board_type !== "aggregate") throw new BoardError("invalid_board_type", 400);
      const contributions = [
        ...buckets.map(({ dimension_key, ...bucket }) => ({ series: "entity", key: dimension_key, ts: bucket.ts, payload: bucket })),
        ...baseline.map(bucket => ({ series: "baseline", key: "", ts: bucket.ts, payload: bucket })),
      ];
      const exists = this.db.prepare("SELECT 1 FROM board_metric_contributions WHERE board_id=? AND series=? AND dimension_key=? AND ts=?");
      const inserted = contributions.filter(item => !exists.get(id, item.series, item.key, item.ts)).length;
      const boardCount = (this.db.prepare("SELECT COUNT(*) AS count FROM board_metric_contributions WHERE board_id=?").get(id) as { count: number }).count;
      if (boardCount + inserted > BOARD_LIMITS.metric_contributions_per_board) throw new BoardError("board_metric_limit", 429);
      const ownerCount = (this.db.prepare("SELECT COUNT(*) AS count FROM board_metric_contributions c JOIN boards b ON b.id=c.board_id WHERE b.owner_id=?").get(ownerId) as { count: number }).count;
      if (ownerCount + inserted > BOARD_LIMITS.metric_buckets_per_owner) throw new BoardError("board_owner_metric_limit", 429);
      const upsert = this.db.prepare(`INSERT INTO board_metric_contributions (board_id,series,dimension_key,ts,ts_ms,payload) VALUES (?,?,?,?,?,?)
        ON CONFLICT(board_id,series,dimension_key,ts) DO UPDATE SET payload=excluded.payload,ts_ms=excluded.ts_ms`);
      for (const item of contributions) upsert.run(id, item.series, item.key, item.ts, Date.parse(item.ts), JSON.stringify(item.payload));
      // Materialize the bounded cell index. Metrics are calculated from the
      // original contributions so sparse metric denominators and retries survive
      // coarsening without composing percentiles or accumulating rounding error.
      const anchor = Date.parse(board.window.from);
      const countAt = this.db.prepare(`SELECT COUNT(*) AS count FROM (
        SELECT series,dimension_key,CAST((ts_ms-?)/? AS INTEGER) AS slot FROM board_metric_contributions
        WHERE board_id=? GROUP BY series,dimension_key,slot)`);
      let effective = board.effective_granularity;
      let count = (countAt.get(anchor, GRANULARITY_MS[effective], id) as { count: number }).count;
      for (const candidate of COARSENING_ORDER) {
        if (count <= BOARD_LIMITS.metric_buckets_per_board) break;
        if (GRANULARITY_MS[candidate] <= GRANULARITY_MS[effective]) continue;
        effective = candidate;
        count = (countAt.get(anchor, GRANULARITY_MS[effective], id) as { count: number }).count;
      }
      if (count > BOARD_LIMITS.metric_buckets_per_board) throw new BoardError("board_metric_limit", 429);
      this.db.prepare("DELETE FROM board_metric_cells WHERE board_id=?").run(id);
      this.db.prepare(`INSERT INTO board_metric_cells (board_id,series,dimension_key,ts_ms)
        SELECT board_id,series,dimension_key,? + CAST((ts_ms-?)/? AS INTEGER)*? FROM board_metric_contributions
        WHERE board_id=? GROUP BY board_id,series,dimension_key,CAST((ts_ms-?)/? AS INTEGER)`)
        .run(anchor, anchor, GRANULARITY_MS[effective], GRANULARITY_MS[effective], id, anchor, GRANULARITY_MS[effective]);
      this.db.prepare("UPDATE boards SET effective_granularity=? WHERE id=?").run(effective, id);
      return { inserted, updated: contributions.length - inserted, rejected: 0, effective_granularity: effective, coarsened: effective !== board.granularity, bucket_count: count };
    });
  }
  allMetricBuckets(ownerId: string, id: string) {
    if (this.owned(ownerId, id).board_type !== "aggregate") throw new BoardError("invalid_board_type", 400);
    const rows = this.db.prepare("SELECT series,dimension_key,payload FROM board_metric_contributions WHERE board_id=? ORDER BY ts_ms,series,dimension_key").all(id) as { series: string; dimension_key: string; payload: string }[];
    const buckets: StoredMetricContribution[] = [], baseline: BoardBaselineBucket[] = [];
    for (const row of rows) {
      if (row.series === "baseline") baseline.push(BoardBaselineBucketSchema.parse(JSON.parse(row.payload)));
      else {
        const { state_origin, ...payload } = z.object({ state_origin: z.enum(["explicit", "derived"]).optional() }).passthrough().parse(JSON.parse(row.payload));
        buckets.push({ ...BoardMetricBucketSchema.parse(payload), dimension_key: row.dimension_key, ...(state_origin ? { state_origin } : {}) });
      }
    }
    return { buckets, baseline };
  }
  delete(ownerId: string, id: string): boolean {
    return this.transaction(() => {
      const removed = Number(this.db.prepare("DELETE FROM boards WHERE owner_id=? AND id=?").run(ownerId, id).changes) > 0;
      if (removed) this.db.prepare(`UPDATE boards SET aggregate_definition=json_remove(aggregate_definition,'$.linked_sessions_board_id')
        WHERE owner_id=? AND board_type='aggregate' AND json_extract(aggregate_definition,'$.linked_sessions_board_id')=?`).run(ownerId, id);
      return removed;
    });
  }
  close() { this.db.close(); }
}
