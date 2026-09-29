import { z } from "zod";

const EntitySchema = z.string().trim().min(1).max(128);
const IsoInstantSchema = z.string().datetime({ offset: true });
const DAY_MS = 86_400_000;
// São Paulo has no DST, so BRT is a fixed UTC-3.
const BRT_OFFSET_MS = 3 * 3_600_000;
export const INCIDENT_MAX_WINDOW_DAYS = 31;

export const IncidentDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD")
  .refine(day => new Date(`${day}T00:00:00Z`).toISOString().startsWith(day), "day must be a valid calendar date");

const Band = z.object({ warning: z.number().finite().min(0).max(1), critical: z.number().finite().min(0).max(1) }).strict()
  .refine(band => band.warning < band.critical, "warning must be lower than critical");

export const IncidentSlasSchema = z.object({ startup_error: Band, buffer: Band }).strict();
export const IncidentWindowSchema = z.object({ from_day: IncidentDaySchema, to_day: IncidentDaySchema }).strict();

export const IncidentBoardDefinitionObjectSchema = z.object({
  board_type: z.literal("incident"),
  name: z.string().trim().min(1).max(100),
  incident: z.object({
    started_at: IsoInstantSchema,
    ended_at: IsoInstantSchema.optional(),
    description: z.string().trim().max(1_000).optional(),
  }).strict(),
  window: IncidentWindowSchema,
  slas: IncidentSlasSchema,
  source: z.object({
    system: EntitySchema,
    query: z.string().max(8_192),
    // A session counts as buffer-bad when its buffer_ratio is at or above this value.
    buffer_ratio_session_threshold: z.number().finite().min(0).max(1),
  }).strict(),
}).strict();

export const IncidentBoardDefinitionSchema = IncidentBoardDefinitionObjectSchema.superRefine((value, ctx) => {
  const span = daysBetween(value.window.from_day, value.window.to_day).length;
  if (span === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["window"], message: "from_day must not be after to_day" });
  else if (span > INCIDENT_MAX_WINDOW_DAYS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["window"], message: `window must span at most ${INCIDENT_MAX_WINDOW_DAYS} days` });
  if (value.incident.ended_at !== undefined && Date.parse(value.incident.ended_at) < Date.parse(value.incident.started_at)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["incident", "ended_at"], message: "ended_at must not be before started_at" });
});
export type IncidentBoardDefinition = z.infer<typeof IncidentBoardDefinitionSchema>;

const Count = z.number().int().safe().min(0);
export const IncidentUserDaySchema = z.object({
  user_id: EntitySchema,
  day: IncidentDaySchema,
  sessions: Count,
  startup_error_sessions: Count,
  // Counted among sessions that started successfully.
  buffer_over_sla_sessions: Count,
  buffer_ratio_avg: z.number().finite().min(0).max(1).optional(),
  join_time_ms_avg: z.number().finite().min(0).max(86_400_000).optional(),
}).strict().superRefine((item, ctx) => {
  if (item.startup_error_sessions > item.sessions) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startup_error_sessions"], message: "startup_error_sessions must not exceed sessions" });
  else if (item.buffer_over_sla_sessions > item.sessions - item.startup_error_sessions) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["buffer_over_sla_sessions"], message: "buffer_over_sla_sessions must not exceed sessions that started successfully" });
  if (item.sessions === 0 && (item.buffer_ratio_avg !== undefined || item.join_time_ms_avg !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "zero-session days cannot carry averages" });
});
export type IncidentUserDay = z.infer<typeof IncidentUserDaySchema>;

export const IncidentUsersSchema = z.object({ user_ids: z.array(EntitySchema).min(1).max(500) }).strict()
  .refine(value => new Set(value.user_ids).size === value.user_ids.length, "user_ids must be unique within a batch");
export const IncidentUserDaysIngestSchema = z.object({
  // Items are parsed one by one so a bad item does not reject the batch.
  user_days: z.array(z.unknown()).min(1).max(500),
}).strict();
export const DeleteIncidentUserDaysObjectSchema = z.object({
  user_ids: z.array(EntitySchema).min(1).max(500).optional(),
  days: z.array(IncidentDaySchema).min(1).max(INCIDENT_MAX_WINDOW_DAYS).optional(),
}).strict();
export const DeleteIncidentUserDaysSchema = DeleteIncidentUserDaysObjectSchema
  .refine(value => value.user_ids !== undefined || value.days !== undefined, "provide user_ids and/or days");
export type DeleteIncidentUserDaysInput = z.infer<typeof DeleteIncidentUserDaysSchema>;

export const IncidentMetricSchema = z.enum(["buffer", "startup_error"]);
export type IncidentMetric = z.infer<typeof IncidentMetricSchema>;
export const IncidentViewRequestSchema = z.object({
  metric: IncidentMetricSchema.default("buffer"),
  sort: z.enum(["worst", "user_id"]).default("worst"),
  offset: z.number().int().min(0).max(50_000).default(0),
  limit: z.number().int().min(1).max(500).default(100),
}).strict();
export type IncidentViewRequest = z.infer<typeof IncidentViewRequestSchema>;

export type IncidentStatus = "good" | "warning" | "bad" | "unknown";
export type IncidentCell = {
  day: string;
  sessions: number;
  denominator: number;
  bad_sessions: number;
  bad_share: number | null;
  status: IncidentStatus;
  // 0 = green, 0.5 = warning band start, 1 = critical band start or above; null without data.
  intensity: number | null;
  buffer_ratio_avg: number | null;
  join_time_ms_avg: number | null;
};
export type IncidentUserRow = {
  user_id: string;
  sessions: number;
  denominator: number;
  bad_sessions: number;
  bad_share: number | null;
  bad_days: number;
  status: IncidentStatus;
  cells: IncidentCell[];
};
export type IncidentDaySummary = { day: string; users_with_data: number; users_warning: number; users_bad: number; sessions: number; bad_sessions: number; bad_share: number | null };
export type IncidentBoardView = {
  board_type: "incident";
  id: string;
  board: import("./boards.js").IncidentBoardRecord;
  metric: IncidentMetric;
  sla: { warning: number; critical: number };
  days: string[];
  incident_start_day: string;
  incident_end_day: string | null;
  users: { rows: IncidentUserRow[]; total: number; with_data: number; offset: number; next_offset: number | null };
  daily: IncidentDaySummary[];
};

export function daysBetween(fromDay: string, toDay: string): string[] {
  const from = Date.parse(`${fromDay}T00:00:00Z`), to = Date.parse(`${toDay}T00:00:00Z`);
  if (!(from <= to)) return [];
  const days: string[] = [];
  for (let at = from; at <= to && days.length <= INCIDENT_MAX_WINDOW_DAYS; at += DAY_MS) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

export function brtDay(instant: string): string {
  return new Date(Date.parse(instant) - BRT_OFFSET_MS).toISOString().slice(0, 10);
}
