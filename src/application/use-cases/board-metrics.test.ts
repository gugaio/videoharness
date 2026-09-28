import { describe, expect, it } from "vitest";
import { BoardStore } from "../../adapters/outbound/sqlite/board-store.js";
import { ingestBoardMetrics, getAggregateBoardView } from "./board-metrics.js";
import { canonicalDimensionKey } from "../../domain/board-metrics.js";
import type { StoredMetricContribution } from "../ports/board-repository.js";
import type { AggregateBoardRecord, CreateBoardInput } from "../../domain/boards.js";

const slas = { startup_error_rate: { warning: 0.02, critical: 0.05 }, buffer_ratio: { warning: 0.005, critical: 0.01 }, join_time_ms: { warning: 8000, critical: 15000 } };
const definition = {
  board_type: "aggregate", name: "agg-test", focus: { type: "isp", isp: "Vivo" }, slas,
  granularity: "5m", window: { from: "2026-09-24T18:00:00-03:00", to: "2026-09-24T20:00:00-03:00" },
  primary_dimension: "pop", secondary_dimension: "media_id",
  source: { system: "test", query: "fixture; synthetic", sampling: { method: "none", coverage: 1 }, counting: "unique" },
} satisfies CreateBoardInput;

function aggregateBoard(input: CreateBoardInput = definition): { store: BoardStore; id: string } {
  const store = new BoardStore(":memory:");
  const board = store.create("owner", input) as AggregateBoardRecord;
  return { store, id: board.id };
}
function view(store: BoardStore, id: string, input: unknown) {
  const result = getAggregateBoardView(store, "owner", id, input);
  if (result.board_type !== "aggregate") throw new Error("expected aggregate view");
  return result;
}
const bucket = (pop: string, media_id: string, ts: string, overrides: Record<string, unknown> = {}) =>
  ({ dimension: { pop, media_id }, ts, volume: 100, buffer_ratio: 0.002, ...overrides });

describe("Aggregate metric ingestion", () => {
  it("isolates invalid items while persisting the valid ones with reasons", () => {
    const { store, id } = aggregateBoard();
    try {
      const response = ingestBoardMetrics(store, "owner", id, {
        buckets: [
          bucket("p1", "m1", "2026-09-24T18:00:00-03:00"),
          { dimension: { pop: "p1", media_id: "m1" }, ts: "2026-09-24T18:01:00-03:00", volume: 10, buffer_ratio: 0.1 },
          { dimension: { pop: "p1", media_id: "m1" }, ts: "2026-09-24T20:00:00-03:00", volume: 10 },
          { dimension: { pop: "p1", media_id: "m1", rogue: "x" }, ts: "2026-09-24T18:05:00-03:00", volume: 10 },
          { dimension: { pop: "p1" }, ts: "2026-09-24T18:05:00-03:00", volume: 10 },
          { dimension: { pop: "p1", media_id: "m1" }, ts: "2026-09-24T18:00:00-03:00", volume: 5, buffer_ratio: 0.2 },
          { dimension: { pop: "p1", media_id: "m1" }, ts: "2026-09-24T18:10:00-03:00", volume: 0, buffer_ratio: 0.2 },
        ],
      });
      expect(response).toMatchObject({ inserted: 1, updated: 0, rejected: 6 });
      expect(response.errors.map(error => error.index)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(response.errors).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("aligned to its granularity") }));
      expect(response.errors).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("unsupported dimension") }));
      expect(response.errors).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("duplicate dimension and timestamp") }));
      expect(store.allMetricBuckets("owner", id).buckets).toHaveLength(1);
    } finally { store.close(); }
  });

  it("coarsens the materialization when the cell index would exceed the per-board ceiling", () => {
    const { store, id } = aggregateBoard({ ...definition, granularity: "1m", window: { from: "2026-09-24T18:00:00-03:00", to: "2026-09-24T18:30:00-03:00" } });
    try {
      const dimensions = ["pop", "media_id"] as const;
      const start = Date.parse("2026-09-24T21:00:00Z");
      const buckets: StoredMetricContribution[] = [];
      for (let pop = 0; pop < 900; pop++) {
        for (let slot = 0; slot < 30; slot++) {
          const dimension = { pop: `edge-${pop}-sp`, media_id: "m1" };
          buckets.push({ dimension, dimension_key: canonicalDimensionKey(dimension, dimensions), ts: new Date(start + slot * 60_000).toISOString(), volume: 1, buffer_ratio: 0.002 });
        }
      }
      store.ingestMetrics("owner", id, buckets, []);
      const board = store.get("owner", id) as AggregateBoardRecord;
      const result = view(store, id, { metric: "buffer_ratio", dimension: "pop", limit: 1, time_limit: 1 });
      expect(board.effective_granularity).toBe("5m");
      expect(result.effective_granularity).toBe("5m");
      expect(result.coarsened).toBe(true);
      expect(result.requested_granularity).toBe("1m");
    } finally { store.close(); }
  });

  it("shows source percentiles only when a cell is backed by a single bucket", () => {
    const { store, id } = aggregateBoard();
    try {
      ingestBoardMetrics(store, "owner", id, {
        buckets: [
          bucket("p1", "m1", "2026-09-24T18:00:00-03:00", { join_time_ms_avg: 9000, join_time_ms_p50: 7000, join_time_ms_p95: 18000, join_time_ms_p99: 24000 }),
          bucket("p1", "m2", "2026-09-24T18:00:00-03:00", { join_time_ms_avg: 9000, join_time_ms_p50: 6000, join_time_ms_p95: 15000, join_time_ms_p99: 20000 }),
          bucket("p2", "m1", "2026-09-24T18:00:00-03:00", { join_time_ms_avg: 7000, join_time_ms_p50: 5000, join_time_ms_p95: 12000, join_time_ms_p99: 16000 }),
        ],
      });
      const result = view(store, id, { metric: "join_time_ms_avg", dimension: "pop", time_limit: 1 });
      const p1 = result.heatmap.entities.find(entity => entity.label === "p1")!.cells[0]!;
      const p2 = result.heatmap.entities.find(entity => entity.label === "p2")!.cells[0]!;
      expect([p1.p50, p1.p95, p1.p99]).toEqual([null, null, null]);
      expect([p2.p50, p2.p95, p2.p99]).toEqual([5000, 12000, 16000]);
    } finally { store.close(); }
  });

  it("annotates a z-score spike on the entity series", () => {
    const { store, id } = aggregateBoard({ ...definition, window: { from: "2026-09-24T18:00:00-03:00", to: "2026-09-24T19:05:00-03:00" } });
    try {
      const times = Array.from({ length: 13 }, (_, index) => new Date(Date.parse("2026-09-24T21:00:00Z") + index * 5 * 60_000).toISOString());
      ingestBoardMetrics(store, "owner", id, {
        buckets: times.map((ts, index) => bucket("p1", "m1", ts, { buffer_ratio: index === 12 ? 0.2 : index % 2 === 0 ? 0.002 : 0.0021 })),
      });
      const result = view(store, id, { metric: "buffer_ratio", dimension: "pop", time_limit: 36 });
      expect(result.annotations.length).toBeGreaterThanOrEqual(1);
      expect(result.annotations[0]).toMatchObject({ metric: "buffer_ratio", direction: "up" });
      expect(result.annotations[0]!.z_score).toBeGreaterThanOrEqual(3);
    } finally { store.close(); }
  });

  it("derives region from the POP suffix, honors explicit state and matches mixed origins", () => {
    const { store, id } = aggregateBoard();
    try {
      ingestBoardMetrics(store, "owner", id, {
        buckets: [
          bucket("edge-x-sp", "m1", "2026-09-24T18:00:00-03:00"),
          { ...bucket("edge-y-sp", "m1", "2026-09-24T18:00:00-03:00"), dimension: { pop: "edge-y-sp", media_id: "m1", state: "SP" } },
          { ...bucket("edge-z-rj", "m1", "2026-09-24T18:00:00-03:00"), dimension: { pop: "edge-z-rj", media_id: "m1", state: "SP" } },
        ],
      });
      const result = view(store, id, { metric: "buffer_ratio", dimension: "state", time_limit: 1 });
      const sp = result.heatmap.entities.find(entity => entity.label === "SP")!;
      expect(sp.volume).toBe(300);
      expect(sp.state_origin).toBe("mixed");
      const filtered = view(store, id, { metric: "buffer_ratio", dimension: "state", filters: [{ dimension: "state", entity: "sp" }], time_limit: 1 });
      expect(filtered.heatmap.entities).toHaveLength(1);
      expect(filtered.heatmap.entities[0]!.volume).toBe(300);
    } finally { store.close(); }
  });

  it("ranks by volume-weighted impact and paginates entities independently of time", () => {
    const { store, id } = aggregateBoard();
    try {
      ingestBoardMetrics(store, "owner", id, {
        buckets: [
          bucket("big", "m1", "2026-09-24T18:00:00-03:00", { volume: 100_000, buffer_ratio: 0.006 }),
          bucket("tiny", "m1", "2026-09-24T18:00:00-03:00", { volume: 10, buffer_ratio: 0.5 }),
          bucket("mid", "m1", "2026-09-24T18:00:00-03:00", { volume: 1_000, buffer_ratio: 0.004 }),
        ],
      });
      const result = view(store, id, { metric: "buffer_ratio", dimension: "pop", limit: 2, offset: 0, time_limit: 1 });
      expect(result.ranking.map(row => row.label)).toEqual(["big", "tiny"]);
      expect(result.ranking_total).toBe(3);
      expect(result.ranking[0]!.impact_score).toBeGreaterThan(result.ranking[1]!.impact_score);
      expect(result.heatmap.total).toBe(3);
      expect(result.heatmap.entities.map(entity => entity.label)).toEqual(["big", "mid"]);
      expect(result.heatmap.next_offset).toBe(2);
    } finally { store.close(); }
  });
});
