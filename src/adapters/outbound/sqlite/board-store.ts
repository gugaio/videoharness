import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { BoardError, type BoardRepository, type IncidentUserDaysDeleteResult, type IncidentUserDaysIngestResult, type IncidentUsersAddResult, type IncidentUsersRemoveResult, type MetricDeleteResult, type MetricIngestResult, type ResetBoardResult, type SessionDeleteResult, type StoredMetricContribution } from "../../../application/ports/board-repository.js";
import { BOARD_LIMITS, StoredBoardDefinitionSchema, BoardSessionSchema, type BoardRecord, type BoardSession, type CreateBoardInput, type DeleteBoardSessionsInput } from "../../../domain/boards.js";
import { AggregateBoardDefinitionSchema, AggregateGranularitySchema, BoardBaselineBucketSchema, BoardMetricBucketSchema, COARSENING_ORDER, GRANULARITY_MS, deriveStateFromPop, type AggregateDimension, type BoardBaselineBucket, type DeleteBoardMetricsInput, type PatchAggregateBoard } from "../../../domain/board-metrics.js";
import { IncidentBoardDefinitionSchema, IncidentUserDaySchema, type DeleteIncidentUserDaysInput, type IncidentUserDay } from "../../../domain/incident-boards.js";

type Row = { id: string; name: string; focus: string; slas: string; created_at: string; board_type: string; aggregate_definition: string | null; incident_definition: string | null; effective_granularity: string | null; session_count: number; bucket_count: number; user_count: number; user_day_count: number };
const selectBoard = `SELECT b.*,
  (SELECT COUNT(*) FROM board_sessions s WHERE s.board_id=b.id) AS session_count,
  (SELECT COUNT(*) FROM board_metric_cells c WHERE c.board_id=b.id) AS bucket_count,
  (SELECT COUNT(*) FROM incident_board_users u WHERE u.board_id=b.id) AS user_count,
  (SELECT COUNT(*) FROM incident_user_days d WHERE d.board_id=b.id) AS user_day_count FROM boards b`;

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
      if (!columns.has("incident_definition")) this.db.exec("ALTER TABLE boards ADD COLUMN incident_definition TEXT");
      this.db.exec(`CREATE TABLE IF NOT EXISTS incident_board_users (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
        PRIMARY KEY(board_id,user_id));
        CREATE TABLE IF NOT EXISTS incident_user_days (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, user_id TEXT NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(board_id,user_id,day));`);
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
    if (row.board_type === "incident") {
      const definition = IncidentBoardDefinitionSchema.parse(JSON.parse(row.incident_definition ?? "null"));
      return { ...definition, ...common, session_count: 0, bucket_count: row.user_day_count, user_count: row.user_count };
    }
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
      const incident = input.board_type === "incident" ? input : undefined;
      this.checkLink(ownerId, aggregate?.linked_sessions_board_id);
      const id = randomUUID(), created_at = new Date().toISOString();
      const definition = aggregate ? { ...aggregate, window: { from: new Date(aggregate.window.from).toISOString(), to: new Date(aggregate.window.to).toISOString() } } : undefined;
      this.db.prepare("INSERT INTO boards (id,owner_id,name,focus,slas,created_at,board_type,aggregate_definition,effective_granularity,incident_definition) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(id, ownerId, input.name, JSON.stringify(incident ? null : (input as { focus: unknown }).focus), JSON.stringify(input.slas), created_at, aggregate ? "aggregate" : incident ? "incident" : "sessions", definition ? JSON.stringify(definition) : null, aggregate?.granularity ?? null, incident ? JSON.stringify(incident) : null);
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
      const materialized = this.materialize(ownerId, board);
      return { inserted, updated: contributions.length - inserted, rejected: 0, effective_granularity: materialized.effective_granularity, coarsened: materialized.effective_granularity !== board.granularity, bucket_count: materialized.count };
    });
  }
  private materialize(ownerId: string, board: Extract<BoardRecord, { board_type: "aggregate" }>): { effective_granularity: Extract<BoardRecord, { board_type: "aggregate" }>["granularity"]; count: number } {
    const anchor = Date.parse(board.window.from);
    const countAt = this.db.prepare(`SELECT COUNT(*) AS count FROM (
      SELECT series,dimension_key,CAST((ts_ms-?)/? AS INTEGER) AS slot FROM board_metric_contributions
      WHERE board_id=? GROUP BY series,dimension_key,slot)`);
    let effective = board.effective_granularity;
    let count = (countAt.get(anchor, GRANULARITY_MS[effective], board.id) as { count: number }).count;
    for (const candidate of COARSENING_ORDER) {
      if (count <= BOARD_LIMITS.metric_buckets_per_board) break;
      if (GRANULARITY_MS[candidate] <= GRANULARITY_MS[effective]) continue;
      effective = candidate;
      count = (countAt.get(anchor, GRANULARITY_MS[effective], board.id) as { count: number }).count;
    }
    if (count > BOARD_LIMITS.metric_buckets_per_board) throw new BoardError("board_metric_limit", 429);
    this.db.prepare("DELETE FROM board_metric_cells WHERE board_id=?").run(board.id);
    this.db.prepare(`INSERT INTO board_metric_cells (board_id,series,dimension_key,ts_ms)
      SELECT board_id,series,dimension_key,? + CAST((ts_ms-?)/? AS INTEGER)*? FROM board_metric_contributions
      WHERE board_id=? GROUP BY board_id,series,dimension_key,CAST((ts_ms-?)/? AS INTEGER)`)
      .run(anchor, anchor, GRANULARITY_MS[effective], GRANULARITY_MS[effective], board.id, anchor, GRANULARITY_MS[effective]);
    this.db.prepare("UPDATE boards SET effective_granularity=? WHERE id=?").run(effective, board.id);
    return { effective_granularity: effective, count };
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
  deleteSessions(ownerId: string, id: string, input: DeleteBoardSessionsInput): SessionDeleteResult {
    return this.transaction(() => {
      const board = this.owned(ownerId, id);
      if (board.board_type !== "sessions") throw new BoardError("invalid_board_type", 400);
      const remove = this.db.prepare("DELETE FROM board_sessions WHERE board_id=? AND session_id=?");
      let deleted = 0;
      if (input.session_ids) {
        for (const sessionId of input.session_ids) deleted += Number(remove.run(id, sessionId).changes);
      } else if (input.time_window) {
        const from = Date.parse(input.time_window.from), to = Date.parse(input.time_window.to);
        const rows = this.db.prepare("SELECT session_id,payload FROM board_sessions WHERE board_id=?").all(id) as { session_id: string; payload: string }[];
        for (const row of rows) {
          const session = BoardSessionSchema.parse(JSON.parse(row.payload));
          if (session.started_at === undefined) continue;
          const started = Date.parse(session.started_at);
          if (started >= from && started < to) deleted += Number(remove.run(id, row.session_id).changes);
        }
      } else throw new BoardError("invalid_board_selection", 400);
      return { deleted, remaining: board.session_count - deleted };
    });
  }
  private entityDimensionFor(payload: string, dimension: AggregateDimension): string | undefined {
    const { state_origin: _stateOrigin, ...rest } = z.object({ state_origin: z.enum(["explicit", "derived"]).optional() }).passthrough().parse(JSON.parse(payload));
    const bucket = BoardMetricBucketSchema.parse(rest);
    if (dimension === "state") return bucket.dimension.state?.toUpperCase() ?? (bucket.dimension.pop ? deriveStateFromPop(bucket.dimension.pop) : undefined);
    return bucket.dimension[dimension];
  }
  deleteMetrics(ownerId: string, id: string, input: DeleteBoardMetricsInput): MetricDeleteResult {
    return this.transaction(() => {
      const board = this.owned(ownerId, id);
      if (board.board_type !== "aggregate") throw new BoardError("invalid_board_type", 400);
      const rows = this.db.prepare("SELECT series,dimension_key,ts,ts_ms,payload FROM board_metric_contributions WHERE board_id=?").all(id) as { series: string; dimension_key: string; ts: string; ts_ms: number; payload: string }[];
      const remove = this.db.prepare("DELETE FROM board_metric_contributions WHERE board_id=? AND series=? AND dimension_key=? AND ts=?");
      const from = input.time_window ? Date.parse(input.time_window.from) : undefined;
      const to = input.time_window ? Date.parse(input.time_window.to) : undefined;
      const entity = input.entity?.toUpperCase();
      let deleted = 0, deletedBaseline = 0;
      for (const row of rows) {
        if (input.dimension) {
          if (row.series !== "entity" || input.entity === undefined) continue;
          const matches = this.entityDimensionFor(row.payload, input.dimension) === (input.dimension === "state" ? entity : input.entity);
          if (!matches) continue;
        }
        if (from !== undefined && to !== undefined && (row.ts_ms < from || row.ts_ms >= to)) continue;
        const removed = Number(remove.run(id, row.series, row.dimension_key, row.ts).changes);
        if (row.series === "baseline") deletedBaseline += removed; else deleted += removed;
      }
      const materialized = this.materialize(ownerId, board);
      return { deleted, deleted_baseline: deletedBaseline, remaining: rows.length - deleted - deletedBaseline, bucket_count: materialized.count };
    });
  }
  resetBoard(ownerId: string, id: string): ResetBoardResult {
    return this.transaction(() => {
      const board = this.owned(ownerId, id);
      if (board.board_type === "sessions") {
        const deleted = Number(this.db.prepare("DELETE FROM board_sessions WHERE board_id=?").run(id).changes);
        return { board_type: "sessions", deleted_sessions: deleted, deleted_contributions: 0 };
      }
      if (board.board_type === "incident") {
        // The cohort is part of the incident definition, so only the per-day evidence is cleared.
        const deleted = Number(this.db.prepare("DELETE FROM incident_user_days WHERE board_id=?").run(id).changes);
        return { board_type: "incident", deleted_sessions: 0, deleted_contributions: deleted };
      }
      const deleted = Number(this.db.prepare("DELETE FROM board_metric_contributions WHERE board_id=?").run(id).changes);
      this.materialize(ownerId, board);
      return { board_type: "aggregate", deleted_sessions: 0, deleted_contributions: deleted };
    });
  }
  private incidentBoard(ownerId: string, id: string) {
    const board = this.owned(ownerId, id);
    if (board.board_type !== "incident") throw new BoardError("invalid_board_type", 400);
    return board;
  }
  addIncidentUsers(ownerId: string, id: string, userIds: string[]): IncidentUsersAddResult {
    return this.transaction(() => {
      const board = this.incidentBoard(ownerId, id);
      const exists = this.db.prepare("SELECT 1 FROM incident_board_users WHERE board_id=? AND user_id=?");
      const fresh = userIds.filter(userId => !exists.get(id, userId));
      if (board.user_count + fresh.length > BOARD_LIMITS.incident_users_per_board) throw new BoardError("board_user_limit", 429);
      const insert = this.db.prepare("INSERT INTO incident_board_users (board_id,user_id) VALUES (?,?)");
      for (const userId of fresh) insert.run(id, userId);
      return { added: fresh.length, existing: userIds.length - fresh.length, total: board.user_count + fresh.length };
    });
  }
  removeIncidentUsers(ownerId: string, id: string, userIds: string[]): IncidentUsersRemoveResult {
    return this.transaction(() => {
      const board = this.incidentBoard(ownerId, id);
      const removeDays = this.db.prepare("DELETE FROM incident_user_days WHERE board_id=? AND user_id=?");
      const removeUser = this.db.prepare("DELETE FROM incident_board_users WHERE board_id=? AND user_id=?");
      let deleted = 0, deletedDays = 0;
      for (const userId of userIds) {
        deletedDays += Number(removeDays.run(id, userId).changes);
        deleted += Number(removeUser.run(id, userId).changes);
      }
      return { deleted, deleted_user_days: deletedDays, remaining: board.user_count - deleted };
    });
  }
  incidentUsers(ownerId: string, id: string): string[] {
    this.incidentBoard(ownerId, id);
    return (this.db.prepare("SELECT user_id FROM incident_board_users WHERE board_id=? ORDER BY user_id").all(id) as { user_id: string }[]).map(row => row.user_id);
  }
  ingestIncidentUserDays(ownerId: string, id: string, items: IncidentUserDay[]): IncidentUserDaysIngestResult {
    return this.transaction(() => {
      const board = this.incidentBoard(ownerId, id);
      const exists = this.db.prepare("SELECT 1 FROM incident_user_days WHERE board_id=? AND user_id=? AND day=?");
      const inserted = items.filter(item => !exists.get(id, item.user_id, item.day)).length;
      const ownerCount = (this.db.prepare("SELECT COUNT(*) AS count FROM incident_user_days d JOIN boards b ON b.id=d.board_id WHERE b.owner_id=?").get(ownerId) as { count: number }).count;
      if (ownerCount + inserted > BOARD_LIMITS.incident_user_days_per_owner) throw new BoardError("board_owner_user_day_limit", 429);
      const upsert = this.db.prepare("INSERT INTO incident_user_days (board_id,user_id,day,payload) VALUES (?,?,?,?) ON CONFLICT(board_id,user_id,day) DO UPDATE SET payload=excluded.payload");
      for (const item of items) upsert.run(id, item.user_id, item.day, JSON.stringify(item));
      return { inserted, updated: items.length - inserted, total: board.bucket_count + inserted };
    });
  }
  allIncidentUserDays(ownerId: string, id: string): IncidentUserDay[] {
    this.incidentBoard(ownerId, id);
    const rows = this.db.prepare("SELECT payload FROM incident_user_days WHERE board_id=? ORDER BY user_id,day").all(id) as { payload: string }[];
    return rows.map(row => IncidentUserDaySchema.parse(JSON.parse(row.payload)));
  }
  deleteIncidentUserDays(ownerId: string, id: string, input: DeleteIncidentUserDaysInput): IncidentUserDaysDeleteResult {
    return this.transaction(() => {
      const board = this.incidentBoard(ownerId, id);
      const users = input.user_ids ? new Set(input.user_ids) : undefined, days = input.days ? new Set(input.days) : undefined;
      const rows = this.db.prepare("SELECT user_id,day FROM incident_user_days WHERE board_id=?").all(id) as { user_id: string; day: string }[];
      const remove = this.db.prepare("DELETE FROM incident_user_days WHERE board_id=? AND user_id=? AND day=?");
      let deleted = 0;
      for (const row of rows) if ((!users || users.has(row.user_id)) && (!days || days.has(row.day))) deleted += Number(remove.run(id, row.user_id, row.day).changes);
      return { deleted, remaining: board.bucket_count - deleted };
    });
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
