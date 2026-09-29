import { describe, expect, it } from "vitest";
import { BoardStore } from "../../adapters/outbound/sqlite/board-store.js";
import { BoardError } from "../ports/board-repository.js";
import { createBoard, resetBoard } from "./boards.js";
import { addIncidentUsers, deleteIncidentUserDays, getIncidentBoardView, ingestIncidentUserDays, removeIncidentUsers } from "./incident-boards.js";
import type { IncidentBoardRecord } from "../../domain/boards.js";
import type { IncidentBoardView } from "../../domain/incident-boards.js";

const definition = {
  board_type: "incident", name: "incident-test",
  incident: { started_at: "2026-09-23T18:00:00-03:00", ended_at: "2026-09-23T21:00:00-03:00" },
  window: { from_day: "2026-09-21", to_day: "2026-09-27" },
  slas: { startup_error: { warning: 0.1, critical: 0.5 }, buffer: { warning: 0.2, critical: 0.6 } },
  source: { system: "test", query: "synthetic fixture", buffer_ratio_session_threshold: 0.01 },
};
const day = (user_id: string, d: string, sessions: number, startup_error_sessions: number, buffer_over_sla_sessions: number, extra: Record<string, unknown> = {}) =>
  ({ user_id, day: d, sessions, startup_error_sessions, buffer_over_sla_sessions, ...extra });

function setup() {
  const store = new BoardStore(":memory:");
  const board = createBoard(store, "owner", definition) as IncidentBoardRecord;
  return { store, id: board.id };
}
function view(store: BoardStore, id: string, input: unknown = {}): IncidentBoardView {
  const result = getIncidentBoardView(store, "owner", id, input);
  return result;
}

describe("Incident board", () => {
  it("creates a board with the cohort and window and rejects invalid definitions", () => {
    const { store, id } = setup();
    expect(store.get("owner", id)).toMatchObject({ board_type: "incident", user_count: 0, bucket_count: 0, session_count: 0 });
    const bad = [
      { ...definition, window: { from_day: "2026-09-27", to_day: "2026-09-21" } },
      { ...definition, window: { from_day: "2026-08-01", to_day: "2026-09-27" } },
      { ...definition, window: { from_day: "2026-02-30", to_day: "2026-03-02" } },
      { ...definition, slas: { ...definition.slas, buffer: { warning: 0.5, critical: 0.1 } } },
      { ...definition, incident: { started_at: "2026-09-23T18:00:00-03:00", ended_at: "2026-09-23T17:00:00-03:00" } },
    ];
    for (const input of bad) expect(() => createBoard(store, "owner", input)).toThrow();
  });

  it("adds and removes users idempotently and enforces the cohort limit", () => {
    const { store, id } = setup();
    expect(addIncidentUsers(store, "owner", id, { user_ids: ["u1", "u2"] })).toEqual({ added: 2, existing: 0, total: 2 });
    expect(addIncidentUsers(store, "owner", id, { user_ids: ["u2", "u3"] })).toEqual({ added: 1, existing: 1, total: 3 });
    expect(() => addIncidentUsers(store, "owner", id, { user_ids: ["a", "a"] })).toThrow();
    ingestIncidentUserDays(store, "owner", id, { user_days: [day("u1", "2026-09-23", 10, 0, 5)] });
    expect(removeIncidentUsers(store, "owner", id, { user_ids: ["u1", "ghost"] })).toEqual({ deleted: 1, deleted_user_days: 1, remaining: 2 });
    const bulk = (from: number) => ({ user_ids: Array.from({ length: 500 }, (_, i) => `bulk-${from + i}`) });
    addIncidentUsers(store, "owner", id, bulk(0));
    expect(() => addIncidentUsers(store, "owner", id, bulk(500))).toThrow(BoardError);
    expect(store.incidentUsers("owner", id)).toHaveLength(502);
  });

  it("isolates invalid items and upserts by user and day", () => {
    const { store, id } = setup();
    addIncidentUsers(store, "owner", id, { user_ids: ["u1"] });
    const response = ingestIncidentUserDays(store, "owner", id, {
      user_days: [
        day("u1", "2026-09-23", 10, 1, 4),
        day("ghost", "2026-09-23", 10, 0, 0),
        day("u1", "2026-09-28", 10, 0, 0),
        day("u1", "2026-09-22", 10, 11, 0),
        day("u1", "2026-09-22", 10, 4, 7),
        day("u1", "2026-09-22", 0, 0, 0, { buffer_ratio_avg: 0.1 }),
        day("u1", "2026-09-23", 5, 0, 0),
      ],
    });
    expect(response).toMatchObject({ inserted: 1, updated: 0, rejected: 6 });
    expect(response.errors.map(error => error.index)).toEqual([1, 2, 3, 4, 5, 6]);
    const retry = ingestIncidentUserDays(store, "owner", id, { user_days: [day("u1", "2026-09-23", 20, 2, 8)] });
    expect(retry).toMatchObject({ inserted: 0, updated: 1, rejected: 0 });
    expect(store.allIncidentUserDays("owner", id)).toEqual([day("u1", "2026-09-23", 20, 2, 8)]);
  });

  it("colors cells by the share of bad sessions and keeps users without data", () => {
    const { store, id } = setup();
    addIncidentUsers(store, "owner", id, { user_ids: ["good", "mid", "bad", "empty", "allfail"] });
    ingestIncidentUserDays(store, "owner", id, {
      user_days: [
        day("good", "2026-09-23", 10, 0, 0),
        // buffer denominator is 8 successful sessions: 2/8 = 0.25 (warning band 0.2..0.6 => intensity 0.5 + 0.5*0.05/0.4)
        day("mid", "2026-09-23", 10, 2, 2, { buffer_ratio_avg: 0.012 }),
        day("bad", "2026-09-23", 10, 0, 9),
        day("bad", "2026-09-24", 10, 0, 1),
        day("allfail", "2026-09-23", 4, 4, 0),
      ],
    });
    const result = view(store, id);
    expect(result.days).toHaveLength(7);
    expect(result.incident_start_day).toBe("2026-09-23");
    expect(result.incident_end_day).toBe("2026-09-23");
    expect(result.users).toMatchObject({ total: 5, with_data: 3 });
    expect(result.users.rows.map(row => row.user_id)).toEqual(["bad", "mid", "good", "allfail", "empty"]);
    const cell = (user: string, d: string) => result.users.rows.find(row => row.user_id === user)!.cells.find(item => item.day === d)!;
    expect(cell("good", "2026-09-23")).toMatchObject({ status: "good", intensity: 0, bad_share: 0 });
    expect(cell("mid", "2026-09-23")).toMatchObject({ denominator: 8, bad_share: 0.25, status: "warning", buffer_ratio_avg: 0.012 });
    expect(cell("mid", "2026-09-23").intensity).toBeCloseTo(0.5625);
    expect(cell("bad", "2026-09-23")).toMatchObject({ status: "bad", intensity: 1 });
    expect(cell("bad", "2026-09-24")).toMatchObject({ status: "good" });
    expect(cell("bad", "2026-09-24").intensity).toBeCloseTo(0.25);
    expect(cell("allfail", "2026-09-23")).toMatchObject({ denominator: 0, status: "unknown", intensity: null, bad_share: null });
    expect(cell("empty", "2026-09-23")).toMatchObject({ status: "unknown", intensity: null, sessions: 0 });
    expect(result.users.rows.find(row => row.user_id === "bad")).toMatchObject({ bad_days: 1, bad_sessions: 10, denominator: 20 });
    expect(result.daily.find(item => item.day === "2026-09-23")).toMatchObject({ users_with_data: 3, users_warning: 1, users_bad: 1, sessions: 28, bad_sessions: 11 });
    expect(result.daily.find(item => item.day === "2026-09-21")).toMatchObject({ users_with_data: 0, bad_share: null });
  });

  it("switches metric, sorts and paginates over the whole cohort", () => {
    const { store, id } = setup();
    addIncidentUsers(store, "owner", id, { user_ids: ["a", "b", "c"] });
    ingestIncidentUserDays(store, "owner", id, {
      user_days: [day("a", "2026-09-23", 10, 6, 0), day("b", "2026-09-23", 10, 1, 9), day("c", "2026-09-23", 10, 0, 0)],
    });
    const startup = view(store, id, { metric: "startup_error", limit: 2 });
    expect(startup.sla).toEqual(definition.slas.startup_error);
    expect(startup.users).toMatchObject({ total: 3, next_offset: 2 });
    expect(startup.users.rows.map(row => row.user_id)).toEqual(["a", "b"]);
    expect(startup.users.rows[0]!.cells.find(item => item.day === "2026-09-23")).toMatchObject({ status: "bad", bad_share: 0.6 });
    const byId = view(store, id, { sort: "user_id", offset: 1, limit: 5 });
    expect(byId.users.rows.map(row => row.user_id)).toEqual(["b", "c"]);
    expect(byId.users.next_offset).toBeNull();
    expect(() => view(store, id, { metric: "join" })).toThrow();
  });

  it("deletes days by user and day selectors and resets keeping the cohort", () => {
    const { store, id } = setup();
    addIncidentUsers(store, "owner", id, { user_ids: ["a", "b"] });
    ingestIncidentUserDays(store, "owner", id, { user_days: [day("a", "2026-09-23", 1, 0, 0), day("a", "2026-09-24", 1, 0, 0), day("b", "2026-09-23", 1, 0, 0)] });
    expect(() => deleteIncidentUserDays(store, "owner", id, {})).toThrow();
    expect(deleteIncidentUserDays(store, "owner", id, { user_ids: ["a"], days: ["2026-09-23"] })).toEqual({ deleted: 1, remaining: 2 });
    expect(deleteIncidentUserDays(store, "owner", id, { days: ["2026-09-23"] })).toEqual({ deleted: 1, remaining: 1 });
    expect(resetBoard(store, "owner", id)).toMatchObject({ board_type: "incident", deleted_contributions: 1 });
    expect(store.incidentUsers("owner", id)).toEqual(["a", "b"]);
  });

  it("isolates owners and rejects other board types", () => {
    const { store, id } = setup();
    expect(() => addIncidentUsers(store, "other", id, { user_ids: ["u"] })).toThrow(BoardError);
    expect(() => getIncidentBoardView(store, "other", id, {})).toThrow(BoardError);
    const sessions = createBoard(store, "owner", { name: "s", focus: { type: "user", user_id: "u" }, slas: { startup_error_rate: { warning: 0.1, critical: 0.5 }, buffer_ratio: { warning: 0.1, critical: 0.5 }, join_time_ms: { warning: 1000, critical: 2000 } } }) as { id: string };
    expect(() => addIncidentUsers(store, "owner", sessions.id, { user_ids: ["u"] })).toThrow(BoardError);
    expect(() => store.ingest("owner", id, [])).toThrow(BoardError);
  });
});
