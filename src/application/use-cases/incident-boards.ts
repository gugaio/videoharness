import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { BoardError, type BoardRepository } from "../ports/board-repository.js";
import { BOARD_LIMITS, type BoardRecord, type IncidentBoardRecord } from "../../domain/boards.js";
import {
  DeleteIncidentUserDaysSchema, IncidentUserDaySchema, IncidentUserDaysIngestSchema, IncidentUsersSchema, IncidentViewRequestSchema,
  brtDay, daysBetween,
  type IncidentBoardView, type IncidentCell, type IncidentDaySummary, type IncidentMetric, type IncidentStatus, type IncidentUserDay, type IncidentUserRow,
} from "../../domain/incident-boards.js";

function incidentBoard(repository: BoardRepository, ownerId: string, id: string): IncidentBoardRecord {
  const board: BoardRecord | undefined = repository.get(ownerId, id);
  if (!board) throw new BoardError("board_not_found", 404);
  if (board.board_type !== "incident") throw new BoardError("invalid_board_type", 400);
  return board;
}

export function addIncidentUsers(repository: BoardRepository, ownerId: string, id: string, input: unknown) {
  incidentBoard(repository, ownerId, id);
  return repository.addIncidentUsers(ownerId, id, IncidentUsersSchema.parse(input).user_ids);
}
export function removeIncidentUsers(repository: BoardRepository, ownerId: string, id: string, input: unknown) {
  incidentBoard(repository, ownerId, id);
  return repository.removeIncidentUsers(ownerId, id, IncidentUsersSchema.parse(input).user_ids);
}
export function deleteIncidentUserDays(repository: BoardRepository, ownerId: string, id: string, input: unknown) {
  incidentBoard(repository, ownerId, id);
  return repository.deleteIncidentUserDays(ownerId, id, DeleteIncidentUserDaysSchema.parse(input));
}

export type IncidentUserDayItemError = { index: number; reason: string };
export type IncidentUserDaysIngestResponse = { inserted: number; updated: number; rejected: number; errors: IncidentUserDayItemError[] };

export function ingestIncidentUserDays(repository: BoardRepository, ownerId: string, id: string, input: unknown): IncidentUserDaysIngestResponse {
  const serialized = JSON.stringify(input);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > BOARD_LIMITS.incident_body_bytes) throw new BoardError("board_metrics_body_too_large", 413);
  const envelope = IncidentUserDaysIngestSchema.parse(input);
  const board = incidentBoard(repository, ownerId, id);
  const cohort = new Set(repository.incidentUsers(ownerId, id));
  const days = new Set(daysBetween(board.window.from_day, board.window.to_day));
  const errors: IncidentUserDayItemError[] = [];
  const items: IncidentUserDay[] = [];
  const seen = new Set<string>();
  envelope.user_days.forEach((raw, index) => {
    const parsed = IncidentUserDaySchema.safeParse(raw);
    if (!parsed.success) { errors.push({ index, reason: parsed.error.issues.map(issue => `${issue.path.join(".") || "item"}: ${issue.message}`).join("; ") }); return; }
    const item = parsed.data;
    if (!cohort.has(item.user_id)) { errors.push({ index, reason: "user_id is not part of the incident board" }); return; }
    if (!days.has(item.day)) { errors.push({ index, reason: "day is outside the board window" }); return; }
    const identity = JSON.stringify([item.user_id, item.day]);
    if (seen.has(identity)) { errors.push({ index, reason: "duplicate user_id and day in batch" }); return; }
    seen.add(identity);
    items.push(item);
  });
  if (items.length === 0) return { inserted: 0, updated: 0, rejected: errors.length, errors };
  const result = repository.ingestIncidentUserDays(ownerId, id, items);
  return { inserted: result.inserted, updated: result.updated, rejected: errors.length, errors };
}

function statusFor(share: number | null, band: { warning: number; critical: number }): IncidentStatus {
  if (share === null) return "unknown";
  return share >= band.critical ? "bad" : share >= band.warning ? "warning" : "good";
}
// Piecewise linear: 0 at share 0, 0.5 at warning, 1 at critical and above.
function intensityFor(share: number, band: { warning: number; critical: number }): number {
  if (share >= band.critical) return 1;
  if (share >= band.warning) return 0.5 + 0.5 * (share - band.warning) / (band.critical - band.warning);
  return 0.5 * share / band.warning;
}
function counts(item: IncidentUserDay | undefined, metric: IncidentMetric): { denominator: number; bad: number } {
  if (!item) return { denominator: 0, bad: 0 };
  return metric === "startup_error"
    ? { denominator: item.sessions, bad: item.startup_error_sessions }
    : { denominator: item.sessions - item.startup_error_sessions, bad: item.buffer_over_sla_sessions };
}

export function getIncidentBoardView(repository: BoardRepository, ownerId: string, id: string, input: unknown): IncidentBoardView {
  const board = incidentBoard(repository, ownerId, id);
  const request = IncidentViewRequestSchema.parse(input ?? {});
  const band = board.slas[request.metric === "buffer" ? "buffer" : "startup_error"];
  const days = daysBetween(board.window.from_day, board.window.to_day);
  const byUserDay = new Map<string, IncidentUserDay>();
  for (const item of repository.allIncidentUserDays(ownerId, id)) byUserDay.set(JSON.stringify([item.user_id, item.day]), item);

  const daily = new Map<string, { with_data: number; warning: number; bad: number; denominator: number; badSessions: number }>(days.map(day => [day, { with_data: 0, warning: 0, bad: 0, denominator: 0, badSessions: 0 }]));
  const rows: IncidentUserRow[] = repository.incidentUsers(ownerId, id).map(userId => {
    let sessions = 0, denominator = 0, badSessions = 0, badDays = 0;
    const cells: IncidentCell[] = days.map(day => {
      const item = byUserDay.get(JSON.stringify([userId, day]));
      const { denominator: cellDenominator, bad } = counts(item, request.metric);
      const share = cellDenominator > 0 ? bad / cellDenominator : null;
      const status = statusFor(share, band);
      sessions += item?.sessions ?? 0; denominator += cellDenominator; badSessions += bad;
      if (status === "bad") badDays++;
      const summary = daily.get(day);
      if (summary && share !== null) {
        summary.with_data++; summary.denominator += cellDenominator; summary.badSessions += bad;
        if (status === "warning") summary.warning++; else if (status === "bad") summary.bad++;
      }
      return { day, sessions: item?.sessions ?? 0, denominator: cellDenominator, bad_sessions: bad, bad_share: share, status, intensity: share === null ? null : intensityFor(share, band), buffer_ratio_avg: item?.buffer_ratio_avg ?? null, join_time_ms_avg: item?.join_time_ms_avg ?? null };
    });
    const share = denominator > 0 ? badSessions / denominator : null;
    return { user_id: userId, sessions, denominator, bad_sessions: badSessions, bad_share: share, bad_days: badDays, status: statusFor(share, band), cells };
  });

  const withData = rows.filter(row => row.bad_share !== null).length;
  if (request.sort === "worst") {
    rows.sort((a, b) => (b.bad_share ?? -1) - (a.bad_share ?? -1) || b.bad_sessions - a.bad_sessions || a.user_id.localeCompare(b.user_id));
  }
  const page = rows.slice(request.offset, request.offset + request.limit);
  const summaries: IncidentDaySummary[] = days.map(day => {
    const summary = daily.get(day)!;
    return { day, users_with_data: summary.with_data, users_warning: summary.warning, users_bad: summary.bad, sessions: summary.denominator, bad_sessions: summary.badSessions, bad_share: summary.denominator > 0 ? summary.badSessions / summary.denominator : null };
  });
  return {
    board_type: "incident",
    id: createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 16),
    board, metric: request.metric, sla: band, days,
    incident_start_day: brtDay(board.incident.started_at),
    incident_end_day: board.incident.ended_at ? brtDay(board.incident.ended_at) : null,
    users: { rows: page, total: rows.length, with_data: withData, offset: request.offset, next_offset: request.offset + request.limit < rows.length ? request.offset + request.limit : null },
    daily: summaries,
  };
}
