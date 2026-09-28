import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { BoardError, type BoardRepository, type StoredMetricContribution } from "../ports/board-repository.js";
import { BOARD_LIMITS, type AggregateBoardRecord, type BoardRecord } from "../../domain/boards.js";
import {
  AggregateDimensions, BoardAggregateViewRequestSchema, BoardBaselineBucketSchema, BoardMetricBucketSchema,
  BoardMetricsIngestSchema, GRANULARITY_MS, canonicalDimensionKey, deriveStateFromPop, validBucketTime,
  type AggregateDimension, type AggregateGranularity, type BoardAggregateCell, type BoardBaselineBucket,
  type BoardMetricBucket, type BoardAggregateView,
} from "../../domain/board-metrics.js";

export type BoardMetricItemError = { item: "bucket" | "baseline"; index: number; reason: string };
export type BoardMetricIngestResponse = {
  inserted: number;
  updated: number;
  rejected: number;
  errors: BoardMetricItemError[];
  resolution: { requested_granularity: AggregateGranularity; effective_granularity: AggregateGranularity; coarsened: boolean; bucket_count: number };
};

export function ingestBoardMetrics(repository: BoardRepository, ownerId: string, id: string, input: unknown): BoardMetricIngestResponse {
  const serialized = JSON.stringify(input);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > BOARD_LIMITS.metric_body_bytes) throw new BoardError("board_metrics_body_too_large", 413);
  const envelope = BoardMetricsIngestSchema.parse(input);
  const board = repository.get(ownerId, id);
  if (!board) throw new BoardError("board_not_found", 404);
  if (board.board_type !== "aggregate") throw new BoardError("invalid_board_type", 400);

  const errors: BoardMetricItemError[] = [];
  const buckets: StoredMetricContribution[] = [];
  const baseline: BoardBaselineBucket[] = [];
  const seen = new Set<string>();
  const seenBaseline = new Set<string>();
  const allowedDimensions = new Set<string>(AggregateDimensions);
  const requiredDimensions = [board.primary_dimension, ...(board.secondary_dimension ? [board.secondary_dimension] : [])];
  const focus = board.focus;
  const focusValue = focus.type === "pop" ? focus.pop : focus.type === "isp" ? focus.isp : focus.type === "state" ? focus.state : focus.type === "media_id" ? focus.media_id : focus.device_type;

  envelope.buckets.forEach((raw, index) => {
    const result = BoardMetricBucketSchema.safeParse(raw);
    if (!result.success) { errors.push(itemError("bucket", index, result.error)); return; }
    const parsed: BoardMetricBucket = result.data;
    const bucket: BoardMetricBucket = { ...parsed, dimension: { ...parsed.dimension } };
    let stateOrigin: "explicit" | "derived" | undefined = bucket.dimension.state !== undefined ? "explicit" : undefined;
    if (bucket.dimension.state === undefined && bucket.dimension.pop !== undefined) {
      const derived = deriveStateFromPop(bucket.dimension.pop);
      if (derived !== undefined) { bucket.dimension.state = derived; stateOrigin = "derived"; }
    }
    if (bucket.dimension.state === undefined && focus.type === "state") { bucket.dimension.state = focus.state; stateOrigin = "derived"; }
    if (bucket.dimension[focus.type] === undefined) bucket.dimension[focus.type] = focusValue;
    const dimNames = Object.keys(bucket.dimension);
    if (requiredDimensions.some(dimension => !bucket.dimension[dimension])) { errors.push({ item: "bucket", index, reason: "dimension must include the board primary and configured secondary dimension" }); return; }
    if (dimNames.some(dimension => !allowedDimensions.has(dimension))) { errors.push({ item: "bucket", index, reason: "unsupported dimension" }); return; }
    if (!validBucketTime(bucket.ts, board.window.from, board.window.to, board.granularity)) { errors.push({ item: "bucket", index, reason: "timestamp must be inside the board window and aligned to its granularity" }); return; }
    const focusDimension = bucket.dimension[focus.type];
    if (focusDimension !== undefined && focusDimension !== focusValue) { errors.push({ item: "bucket", index, reason: "bucket is outside the board focus" }); return; }
    // An explicit region from the source wins; otherwise a recognized POP suffix was derived above.
    const dimension_key = canonicalDimensionKey(bucket.dimension, requiredDimensions);
    const ts = new Date(Date.parse(bucket.ts)).toISOString();
    const identity = `${dimension_key}\u0000${ts}`;
    if (seen.has(identity)) { errors.push({ item: "bucket", index, reason: "duplicate dimension and timestamp in batch" }); return; }
    seen.add(identity);
    buckets.push({ ...bucket, ts, dimension_key, ...(stateOrigin ? { state_origin: stateOrigin } : {}) });
  });
  (envelope.baseline ?? []).forEach((raw, index) => {
    const result = BoardBaselineBucketSchema.safeParse(raw);
    if (!result.success) { errors.push(itemError("baseline", index, result.error)); return; }
    const item = result.data;
    if (!validBucketTime(item.ts, board.window.from, board.window.to, board.granularity)) { errors.push({ item: "baseline", index, reason: "timestamp must be inside the board window and aligned to its granularity" }); return; }
    const ts = new Date(Date.parse(item.ts)).toISOString();
    if (seenBaseline.has(ts)) { errors.push({ item: "baseline", index, reason: "duplicate baseline timestamp in batch" }); return; }
    seenBaseline.add(ts);
    baseline.push({ ...item, ts });
  });

  if (buckets.length === 0 && baseline.length === 0) {
    return { inserted: 0, updated: 0, rejected: errors.length, errors, resolution: { requested_granularity: board.granularity, effective_granularity: board.effective_granularity, coarsened: board.effective_granularity !== board.granularity, bucket_count: board.bucket_count } };
  }
  const result = repository.ingestMetrics(ownerId, id, buckets, baseline);
  return {
    inserted: result.inserted,
    updated: result.updated,
    rejected: errors.length,
    errors,
    resolution: { requested_granularity: board.granularity, effective_granularity: result.effective_granularity, coarsened: result.coarsened, bucket_count: result.bucket_count },
  };
}

function itemError(item: "bucket" | "baseline", index: number, error: { issues: Array<{ path: (string | number)[]; message: string }> }): BoardMetricItemError {
  const issue = error.issues[0];
  return { item, index, reason: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid item" };
}

type MetricName = "startup_error_rate" | "buffer_ratio" | "join_time_ms_avg";
type Accumulator = {
  volume: number;
  sums: Record<MetricName, number>;
  weights: Record<MetricName, number>;
  sourceRows: number;
  percentiles: { p50: number | null; p95: number | null; p99: number | null };
};
const metricFields: Record<MetricName, "startup_error_rate" | "buffer_ratio" | "join_time_ms_avg"> = {
  startup_error_rate: "startup_error_rate", buffer_ratio: "buffer_ratio", join_time_ms_avg: "join_time_ms_avg",
};
function freshAccumulator(): Accumulator { return { volume: 0, sums: { startup_error_rate: 0, buffer_ratio: 0, join_time_ms_avg: 0 }, weights: { startup_error_rate: 0, buffer_ratio: 0, join_time_ms_avg: 0 }, sourceRows: 0, percentiles: { p50: null, p95: null, p99: null } }; }
function anchorTime(timestamp: string, origin: string, granularity: AggregateGranularity): string {
  const step = GRANULARITY_MS[granularity];
  const delta = Date.parse(timestamp) - Date.parse(origin);
  return new Date(Date.parse(origin) + Math.floor(delta / step) * step).toISOString();
}
function addMetricValues(target: Accumulator, item: BoardMetricBucket | BoardBaselineBucket): void {
  target.volume += item.volume;
  for (const metric of Object.keys(metricFields) as MetricName[]) {
    const field = metricFields[metric];
    const value = item[field];
    if (value !== undefined && item.volume > 0) { target.sums[metric] += value * item.volume; target.weights[metric] += item.volume; }
  }
  const p50 = item.join_time_ms_p50 ?? null, p95 = item.join_time_ms_p95 ?? null, p99 = item.join_time_ms_p99 ?? null;
  if (target.sourceRows === 0) target.percentiles = { p50, p95, p99 };
  else target.percentiles = { p50: null, p95: null, p99: null };
  target.sourceRows += 1;
}
function valueOf(acc: Accumulator, metric: MetricName): number | null {
  return acc.weights[metric] > 0 ? acc.sums[metric] / acc.weights[metric] : null;
}
function metricCoverage(acc: Accumulator | undefined, metric: MetricName): number {
  if (!acc || acc.volume <= 0) return 0;
  return acc.weights[metric] / acc.volume;
}
function entityFor(item: StoredMetricContribution, dimension: AggregateDimension): string | undefined {
  if (dimension === "state") return item.dimension.state?.toUpperCase() ?? (item.dimension.pop ? deriveStateFromPop(item.dimension.pop) : undefined);
  return item.dimension[dimension];
}
function matchesAggregateFilters(item: StoredMetricContribution, filters: Array<{ dimension: AggregateDimension; entity: string }>): boolean {
  return filters.every(filter => entityFor(item, filter.dimension) === (filter.dimension === "state" ? filter.entity.toUpperCase() : filter.entity));
}
function sla(board: AggregateBoardRecord, metric: MetricName) { return metric === "join_time_ms_avg" ? board.slas.join_time_ms : board.slas[metric]; }
function statusFor(value: number | null, warning: number, critical: number): "good" | "warning" | "bad" | "unknown" {
  if (value === null) return "unknown";
  return value >= critical ? "bad" : value >= warning ? "warning" : "good";
}
function hashView(boardId: string, request: unknown): string { return createHash("sha256").update(JSON.stringify({ boardId, request })).digest("hex").slice(0, 16); }

export function getAggregateBoardView(repository: BoardRepository, ownerId: string, id: string, input: unknown): BoardAggregateView {
  const board: BoardRecord | undefined = repository.get(ownerId, id);
  if (!board) throw new BoardError("board_not_found", 404);
  if (board.board_type !== "aggregate") throw new BoardError("invalid_board_type", 400);
  const request = BoardAggregateViewRequestSchema.parse(input);
  const dimension = request.dimension ?? board.primary_dimension;
  const relevantDimensions = new Set([board.primary_dimension, ...(board.secondary_dimension ? [board.secondary_dimension] : []), "state", board.focus.type]);
  if (!relevantDimensions.has(dimension)) throw new BoardError("invalid_board_filter", 400);
  if (request.filters.some(filter => !relevantDimensions.has(filter.dimension))) throw new BoardError("invalid_board_filter", 400);
  const selectedWindow = request.time_window ?? board.window;
  if (Date.parse(selectedWindow.from) < Date.parse(board.window.from) || Date.parse(selectedWindow.to) > Date.parse(board.window.to)) throw new BoardError("invalid_board_filter", 400);
  const { buckets: rawBuckets, baseline: rawBaseline } = repository.allMetricBuckets(ownerId, id);
  const filtered = rawBuckets.filter(bucket => matchesAggregateFilters(bucket, request.filters) && Date.parse(bucket.ts) >= Date.parse(selectedWindow.from) && Date.parse(bucket.ts) < Date.parse(selectedWindow.to));
  const metric = request.metric;
  const band = sla(board, metric);
  const from = board.window.from;
  const step = GRANULARITY_MS[board.effective_granularity];

  const entities = new Map<string, { label: string; state_origin?: "explicit" | "derived" | "mixed"; byTime: Map<string, Accumulator>; total: Accumulator; impact_score: number }>();
  for (const item of filtered) {
    const entity = entityFor(item, dimension);
    if (!entity) continue;
    const ts = anchorTime(item.ts, from, board.effective_granularity);
    const sourceOrigin = dimension === "state" ? item.state_origin ?? "explicit" : undefined;
    const group = entities.get(entity) ?? { label: entity, ...(sourceOrigin ? { state_origin: sourceOrigin } : {}), byTime: new Map<string, Accumulator>(), total: freshAccumulator(), impact_score: 0 };
    if (sourceOrigin && group.state_origin !== sourceOrigin) group.state_origin = "mixed";
    const point = group.byTime.get(ts) ?? freshAccumulator();
    addMetricValues(point, item); addMetricValues(group.total, item);
    const rawMetric = item[metricFields[metric]];
    if (rawMetric !== undefined && item.volume > 0) group.impact_score += item.volume * Math.max(0, rawMetric - band.warning);
    group.byTime.set(ts, point); entities.set(entity, group);
  }
  const entityRows = [...entities.entries()].map(([entity, group]) => ({
    entity, dim_key: canonicalDimensionKey({ [dimension]: entity }, [dimension]), label: group.label,
    volume: group.total.volume, value: valueOf(group.total, metric), group, impact_score: group.impact_score,
  })).sort((a, b) => b.volume - a.volume || a.label.localeCompare(b.label) || a.dim_key.localeCompare(b.dim_key));

  const baselineByTime = new Map<string, Accumulator>();
  for (const item of rawBaseline) {
    if (Date.parse(item.ts) < Date.parse(selectedWindow.from) || Date.parse(item.ts) >= Date.parse(selectedWindow.to)) continue;
    const ts = anchorTime(item.ts, from, board.effective_granularity);
    const aggregate = baselineByTime.get(ts) ?? freshAccumulator(); addMetricValues(aggregate, item); baselineByTime.set(ts, aggregate);
  }
  const seriesByTime = new Map<string, Accumulator>();
  for (const item of filtered) {
    if (Date.parse(item.ts) < Date.parse(selectedWindow.from) || Date.parse(item.ts) >= Date.parse(selectedWindow.to)) continue;
    const ts = anchorTime(item.ts, from, board.effective_granularity);
    const aggregate = seriesByTime.get(ts) ?? freshAccumulator(); addMetricValues(aggregate, item); seriesByTime.set(ts, aggregate);
  }
  const firstTs = anchorTime(selectedWindow.from, from, board.effective_granularity);
  const timeCount = Math.max(0, Math.ceil((Date.parse(selectedWindow.to) - Date.parse(firstTs)) / step));
  const safeTimeLimit = Math.min(request.time_limit, Math.max(1, Math.floor(1_000 / request.limit)));
  const timeOffset = Math.min(request.time_offset, Math.max(0, timeCount - 1));
  const pageTimes = Array.from({ length: Math.min(safeTimeLimit, Math.max(0, timeCount - timeOffset)) }, (_, index) => new Date(Date.parse(firstTs) + (timeOffset + index) * step).toISOString());
  const pageEntities = entityRows.slice(request.offset, request.offset + request.limit);
  const basePage = pageTimes.map(ts => {
    const aggregate = baselineByTime.get(ts);
    const value = aggregate ? valueOf(aggregate, metric) : null;
    return { ts, value, volume: aggregate?.volume ?? 0, metric_coverage: metricCoverage(aggregate, metric), status: statusFor(value, band.warning, band.critical) };
  });
  const series = pageTimes.map(ts => {
    const aggregate = seriesByTime.get(ts);
    const value = aggregate ? valueOf(aggregate, metric) : null;
    return { ts, value, volume: aggregate?.volume ?? 0, metric_coverage: metricCoverage(aggregate, metric), status: statusFor(value, band.warning, band.critical) };
  });
  const heatmapEntities = pageEntities.map(row => ({
    dim_key: row.dim_key, label: row.label, volume: row.volume, ...(row.group.state_origin ? { state_origin: row.group.state_origin } : {}),
    cells: pageTimes.map(ts => {
      const aggregate = row.group.byTime.get(ts);
      const value = aggregate ? valueOf(aggregate, metric) : null;
      const base = baselineByTime.get(ts);
      const baselineValue = base ? valueOf(base, metric) : null;
      return {
        ts, status: statusFor(value, band.warning, band.critical), value,
        volume: aggregate?.volume ?? 0,
        metric_coverage: metricCoverage(aggregate, metric),
        p50: metric === "join_time_ms_avg" && aggregate?.sourceRows === 1 ? aggregate.percentiles.p50 : null,
        p95: metric === "join_time_ms_avg" && aggregate?.sourceRows === 1 ? aggregate.percentiles.p95 : null,
        p99: metric === "join_time_ms_avg" && aggregate?.sourceRows === 1 ? aggregate.percentiles.p99 : null,
        baseline_value: baselineValue,
        baseline_delta: value !== null && baselineValue !== null ? value - baselineValue : null,
      } satisfies BoardAggregateCell;
    }),
  }));
  const rankingRows = [...entityRows].sort((a, b) => b.impact_score - a.impact_score || b.volume - a.volume || a.dim_key.localeCompare(b.dim_key));
  const ranking = rankingRows.slice(0, request.limit).map(row => ({
    dim_key: row.dim_key, label: row.label, volume: row.volume, value: row.value,
    status: statusFor(row.value, band.warning, band.critical),
    impact_score: row.impact_score,
    impact_unit: metric === "join_time_ms_avg" ? "play·ms" : "play-equivalents",
  }));
  const annotations: BoardAggregateView["annotations"] = [];
  for (const row of pageEntities) {
    const points = [...row.group.byTime.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([ts, point]) => {
      const value = valueOf(point, metric);
      return value === null ? [] : [{ ts, value }];
    });
    for (let index = 0; index < points.length; index++) {
      const currentPoint = points[index];
      if (!currentPoint) continue;
      const prior = points.slice(Math.max(0, index - 24), index).map(point => point.value);
      if (prior.length < 12) continue;
      const mean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
      const variance = prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / prior.length;
      const deviation = Math.sqrt(variance);
      if (deviation === 0) continue;
      const zScore = (currentPoint.value - mean) / deviation;
      if (Math.abs(zScore) >= 3 && pageTimes.includes(currentPoint.ts)) annotations.push({ ts: currentPoint.ts, dim_key: row.dim_key, metric, value: currentPoint.value, z_score: zScore, direction: zScore > 0 ? "up" : "down" });
    }
  }
  const identity = hashView(id, request);
  return {
    board_type: "aggregate", id: identity, board, provenance: board.source, sampling: board.source.sampling,
    counting: board.source.counting, coverage: board.source.sampling.coverage,
    requested_granularity: board.granularity, effective_granularity: board.effective_granularity,
    coarsened: board.granularity !== board.effective_granularity,
    metric_coverage: metricCoverage(filtered.reduce((aggregate, item) => { const next=aggregate ?? freshAccumulator();addMetricValues(next,item);return next; }, undefined as Accumulator | undefined), metric),
    heatmap: {
      dimension, metric, entities: heatmapEntities, total: entityRows.length,
      next_offset: request.offset + request.limit < entityRows.length ? request.offset + request.limit : null,
      time_offset: timeOffset, time_limit: pageTimes.length,
      next_time_offset: timeOffset + pageTimes.length < timeCount ? timeOffset + pageTimes.length : null,
    },
    ranking, ranking_total: rankingRows.length, baseline: basePage, series, annotations, filters: request.filters,
  };
}
