import { z } from "zod";

export const AggregateDimensions = ["pop", "isp", "state", "media_id", "device_type"] as const;
export const AggregateDimensionSchema = z.enum(AggregateDimensions);
export type AggregateDimension = z.infer<typeof AggregateDimensionSchema>;

const EntitySchema = z.string().trim().min(1).max(128);
const IsoInstantSchema = z.string().datetime({ offset: true });
export const AggregateGranularitySchema = z.enum(["1m", "5m", "15m", "30m", "1h", "6h", "1d"]);
export type AggregateGranularity = z.infer<typeof AggregateGranularitySchema>;
export const GRANULARITY_MS: Record<AggregateGranularity, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "6h": 21_600_000, "1d": 86_400_000,
};
export const COARSENING_ORDER: AggregateGranularity[] = ["1m", "5m", "15m", "30m", "1h", "6h", "1d"];

export const AggregateFocusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pop"), pop: EntitySchema }).strict(),
  z.object({ type: z.literal("isp"), isp: EntitySchema }).strict(),
  z.object({ type: z.literal("state"), state: EntitySchema }).strict(),
  z.object({ type: z.literal("media_id"), media_id: EntitySchema }).strict(),
  z.object({ type: z.literal("device_type"), device_type: EntitySchema }).strict(),
]);
export const AggregateWindowSchema = z.object({ from: IsoInstantSchema, to: IsoInstantSchema }).strict().refine(
  value => Date.parse(value.from) < Date.parse(value.to), "window.from must be before window.to",
);
export const SamplingSchema = z.object({
  method: z.enum(["none", "random", "stratified", "systematic", "unknown"]),
  coverage: z.number().finite().min(0).max(1),
}).strict();
export const AggregateSourceSchema = z.object({
  system: EntitySchema,
  query: z.string().max(8_192),
  sampling: SamplingSchema,
  counting: z.enum(["touch", "unique"]),
  join_over_sla_threshold_ms: z.number().finite().min(0).max(86_400_000).optional(),
}).strict();
const RatioBand = z.object({ warning: z.number().finite().min(0).max(1), critical: z.number().finite().min(0).max(1) }).strict().refine(s => s.warning < s.critical, "warning must be lower than critical");
const TimeBand = z.object({ warning: z.number().finite().min(0).max(86_400_000), critical: z.number().finite().min(0).max(86_400_000) }).strict().refine(s => s.warning < s.critical, "warning must be lower than critical");
export const AggregateSlasSchema = z.object({
  startup_error_rate: RatioBand,
  buffer_ratio: RatioBand,
  join_time_ms: TimeBand,
  join_over_sla_pct: RatioBand.optional(),
}).strict();
export const AggregateBoardDefinitionObjectSchema = z.object({
  board_type: z.literal("aggregate"),
  name: z.string().trim().min(1).max(100),
  focus: AggregateFocusSchema,
  slas: AggregateSlasSchema,
  granularity: AggregateGranularitySchema,
  window: AggregateWindowSchema,
  primary_dimension: AggregateDimensionSchema,
  secondary_dimension: AggregateDimensionSchema.optional(),
  source: AggregateSourceSchema,
  linked_sessions_board_id: z.string().min(1).max(128).optional(),
}).strict();
export const AggregateBoardDefinitionSchema = AggregateBoardDefinitionObjectSchema
  .refine(value => value.secondary_dimension !== value.primary_dimension, "primary and secondary dimensions must differ")
  .refine(value => Date.parse(value.window.from) % GRANULARITY_MS[value.granularity] === 0 && Date.parse(value.window.to) % GRANULARITY_MS[value.granularity] === 0, "window boundaries must align with granularity");
export type AggregateBoardDefinition = z.infer<typeof AggregateBoardDefinitionSchema>;

const MetricFields = {
  startup_error_rate: z.number().finite().min(0).max(1).optional(),
  buffer_ratio: z.number().finite().min(0).max(1).optional(),
  // join_time_ms is an alias of join_time_ms_avg: the source mean for the bucket.
  join_time_ms: z.number().finite().min(0).max(86_400_000).optional(),
  join_time_ms_avg: z.number().finite().min(0).max(86_400_000).optional(),
  // Exact composition: when both are supplied the rollup uses sum/count instead
  // of volume-weighting the mean, which is only correct when every play joined.
  join_time_ms_sum: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  join_time_ms_count: z.number().int().safe().min(0).optional(),
  join_time_ms_p50: z.number().finite().min(0).max(86_400_000).optional(),
  join_time_ms_p95: z.number().finite().min(0).max(86_400_000).optional(),
  join_time_ms_p99: z.number().finite().min(0).max(86_400_000).optional(),
  join_over_sla_pct: z.number().finite().min(0).max(1).optional(),
};
type MetricCarrier = {
  volume: number;
  startup_error_rate?: number | undefined;
  buffer_ratio?: number | undefined;
  join_time_ms?: number | undefined;
  join_time_ms_avg?: number | undefined;
  join_time_ms_sum?: number | undefined;
  join_time_ms_count?: number | undefined;
  join_time_ms_p50?: number | undefined;
  join_time_ms_p95?: number | undefined;
  join_time_ms_p99?: number | undefined;
  join_over_sla_pct?: number | undefined;
};
function refineMetricFields(bucket: MetricCarrier, ctx: z.RefinementCtx): void {
  if (bucket.join_time_ms !== undefined && bucket.join_time_ms_avg !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["join_time_ms"], message: "provide only one of join_time_ms or join_time_ms_avg" });
  if ((bucket.join_time_ms_sum === undefined) !== (bucket.join_time_ms_count === undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["join_time_ms_sum"], message: "join_time_ms_sum and join_time_ms_count must be provided together" });
  if (bucket.join_time_ms_sum !== undefined && bucket.join_time_ms_count === 0 && bucket.join_time_ms_sum !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["join_time_ms_sum"], message: "zero join_time_ms_count requires zero join_time_ms_sum" });
  if (bucket.join_time_ms_p50 !== undefined && bucket.join_time_ms_p95 !== undefined && bucket.join_time_ms_p50 > bucket.join_time_ms_p95) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["join_time_ms_p95"], message: "p95 must be >= p50" });
  if (bucket.join_time_ms_p95 !== undefined && bucket.join_time_ms_p99 !== undefined && bucket.join_time_ms_p95 > bucket.join_time_ms_p99) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["join_time_ms_p99"], message: "p99 must be >= p95" });
  if (bucket.join_time_ms_p50 !== undefined && bucket.join_time_ms_p99 !== undefined && bucket.join_time_ms_p50 > bucket.join_time_ms_p99) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["join_time_ms_p99"], message: "p99 must be >= p50" });
  if (bucket.volume === 0 && (bucket.startup_error_rate !== undefined || bucket.buffer_ratio !== undefined || bucket.join_time_ms !== undefined || bucket.join_time_ms_avg !== undefined || bucket.join_time_ms_sum !== undefined || bucket.join_over_sla_pct !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "zero-volume buckets cannot carry rates or averages" });
}
export const BoardMetricBucketSchema = z.object({
  dimension: z.record(z.string(), EntitySchema),
  ts: IsoInstantSchema,
  volume: z.number().int().safe().min(0),
  ...MetricFields,
}).strict().superRefine(refineMetricFields);
export const BoardBaselineBucketSchema = z.object({
  ts: IsoInstantSchema,
  volume: z.number().int().safe().min(0),
  ...MetricFields,
}).strict().superRefine(refineMetricFields);
export const BoardMetricsIngestSchema = z.object({
  // Keep item parsing outside the envelope so a caller can report errors per item.
  buckets: z.array(z.unknown()).max(500),
  baseline: z.array(z.unknown()).max(500).optional(),
}).strict().refine(value => value.buckets.length + (value.baseline?.length ?? 0) > 0 && value.buckets.length + (value.baseline?.length ?? 0) <= 500, "batch must contain 1..500 total buckets");
export type BoardMetricBucket = z.infer<typeof BoardMetricBucketSchema>;
export type BoardBaselineBucket = z.infer<typeof BoardBaselineBucketSchema>;
export const AggregateFilterSchema = z.object({ dimension: AggregateDimensionSchema, entity: EntitySchema }).strict();
export const AggregateMetricSchema = z.enum(["startup_error_rate", "buffer_ratio", "join_time_ms_avg", "join_over_sla_pct"]);
export const BoardAggregateViewRequestSchema = z.object({
  dimension: AggregateDimensionSchema.optional(),
  metric: AggregateMetricSchema.default("buffer_ratio"),
  filters: z.array(AggregateFilterSchema).max(4).default([]),
  time_window: AggregateWindowSchema.optional(),
  offset: z.number().int().min(0).max(25_000).default(0),
  limit: z.number().int().min(1).max(100).default(10),
  time_offset: z.number().int().min(0).max(25_000).default(0),
  time_limit: z.number().int().min(1).max(720).default(36),
}).strict().refine(value => new Set(value.filters.map(filter => filter.dimension)).size === value.filters.length, "one filter per dimension");
export type BoardAggregateViewRequest = z.infer<typeof BoardAggregateViewRequestSchema>;
export const PatchAggregateBoardSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slas: AggregateSlasSchema.optional(),
  linked_sessions_board_id: z.string().min(1).max(128).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "at least one patch field is required");
export type PatchAggregateBoard = z.infer<typeof PatchAggregateBoardSchema>;
export const DeleteBoardMetricsObjectSchema = z.object({
  dimension: AggregateDimensionSchema.optional(),
  entity: EntitySchema.optional(),
  time_window: AggregateWindowSchema.optional(),
}).strict();
export const DeleteBoardMetricsSchema = DeleteBoardMetricsObjectSchema
  .refine(value => value.dimension !== undefined || value.time_window !== undefined, "provide dimension or time_window")
  .refine(value => (value.dimension === undefined) === (value.entity === undefined), "dimension and entity must be supplied together");
export type DeleteBoardMetricsInput = z.infer<typeof DeleteBoardMetricsSchema>;

export type BoardAggregateCell = { ts: string; status: "good" | "warning" | "bad" | "unknown"; value: number | null; volume: number; metric_coverage: number; p50: number | null; p95: number | null; p99: number | null; baseline_value: number | null; baseline_delta: number | null };
export type BoardAggregateEntity = { dim_key: string; label: string; volume: number; state_origin?: "explicit" | "derived" | "mixed"; cells: BoardAggregateCell[] };
export type BoardAggregateView = {
  board_type: "aggregate";
  id: string;
  board: import("./boards.js").AggregateBoardRecord;
  provenance: AggregateBoardDefinition["source"];
  sampling: AggregateBoardDefinition["source"]["sampling"];
  counting: AggregateBoardDefinition["source"]["counting"];
  coverage: number;
  requested_granularity: AggregateGranularity;
  effective_granularity: AggregateGranularity;
  coarsened: boolean;
  metric_coverage: number;
  heatmap: { dimension: AggregateDimension; metric: z.infer<typeof AggregateMetricSchema>; entities: BoardAggregateEntity[]; total: number; next_offset: number | null; time_offset: number; time_limit: number; next_time_offset: number | null };
  ranking: Array<{ dim_key: string; label: string; volume: number; value: number | null; status: "good" | "warning" | "bad" | "unknown"; impact_score: number; impact_unit: string }>;
  ranking_total: number;
  baseline: Array<{ ts: string; value: number | null; volume: number; metric_coverage: number; status: "good" | "warning" | "bad" | "unknown" }>;
  series: Array<{ ts: string; value: number | null; volume: number; metric_coverage: number; status: "good" | "warning" | "bad" | "unknown" }>;
  annotations: Array<{ ts: string; dim_key?: string; metric: z.infer<typeof AggregateMetricSchema>; value: number; z_score: number; direction: "up" | "down" }>;
  filters: z.infer<typeof AggregateFilterSchema>[];
};

export function canonicalDimensionKey(dimension: Record<string, string>, dimensions: readonly AggregateDimension[]): string {
  return JSON.stringify(dimensions.map(key => [key, dimension[key] ?? ""]));
}

export function floorTimestamp(timestamp: string, granularity: AggregateGranularity): number {
  const millis = Date.parse(timestamp);
  return Math.floor(millis / GRANULARITY_MS[granularity]) * GRANULARITY_MS[granularity];
}

export function validBucketTime(timestamp: string, from: string, to: string, granularity: AggregateGranularity): boolean {
  const millis = Date.parse(timestamp);
  return millis >= Date.parse(from) && millis < Date.parse(to) && millis % GRANULARITY_MS[granularity] === 0;
}

const recognizedStateCodes = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
export function deriveStateFromPop(pop: string): string | undefined {
  const suffix = pop.trim().split(/[-_]/).at(-1)?.toUpperCase();
  return suffix && recognizedStateCodes.has(suffix) ? suffix : undefined;
}
