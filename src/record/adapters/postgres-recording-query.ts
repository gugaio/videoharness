import type pg from "pg";
import type { RecordingEvent } from "../domain/recording-event.js";
import type { Recording } from "../domain/recording.js";
import type { RecordingQueryRepository } from "../ports/recording-query.js";

type RecordingRow = {
  id: string;
  source_url: string;
  protocol: Recording["protocol"];
  state: Recording["state"];
  requested_duration_seconds: number;
  requested_start_seconds: number;
  coverage_seconds: number | null;
  total_bytes: string | number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

type EventRow = {
  id: string;
  recording_id: string;
  type: string;
  actor: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

export class PostgresRecordingQuery implements RecordingQueryRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findById(id: string): Promise<Recording | null> {
    const result = await this.pool.query<RecordingRow>(
      `SELECT id, source_url, protocol, state, requested_duration_seconds, requested_start_seconds,
              coverage_seconds, total_bytes, error_code, error_message, created_at, updated_at, completed_at
         FROM recordings WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toRecording(result.rows[0]) : null;
  }

  async list(limit: number): Promise<Recording[]> {
    const result = await this.pool.query<RecordingRow>(
      `SELECT id, source_url, protocol, state, requested_duration_seconds, requested_start_seconds,
              coverage_seconds, total_bytes, error_code, error_message, created_at, updated_at, completed_at
         FROM recordings ORDER BY created_at DESC LIMIT $1`, [limit],
    );
    return result.rows.map(toRecording);
  }

  async listEventsAfter(recordingId: string, afterEventId: string, limit: number): Promise<RecordingEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT id, recording_id, type, actor, message, payload, created_at
         FROM recording_events
        WHERE recording_id = $1 AND id > $2::bigint
        ORDER BY id ASC LIMIT $3`,
      [recordingId, afterEventId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      recordingId: row.recording_id,
      type: row.type,
      actor: row.actor,
      message: row.message,
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
    }));
  }
}

function toRecording(row: RecordingRow): Recording {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    protocol: row.protocol,
    state: row.state,
    requestedDurationSeconds: row.requested_duration_seconds,
    requestedStartSeconds: row.requested_start_seconds,
    ...(row.coverage_seconds === null ? {} : { coverageSeconds: Number(row.coverage_seconds) }),
    ...(row.total_bytes === null ? {} : { totalBytes: Number(row.total_bytes) }),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  };
}
