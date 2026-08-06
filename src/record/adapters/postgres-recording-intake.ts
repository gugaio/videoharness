import type pg from "pg";
import type { Recording } from "../domain/recording.js";
import {
  RecordingIdempotencyConflictError,
  type CreateRecordingRecords,
  type RecordingIntakeRepository,
  type RecordingIntakeResult,
} from "../ports/recording-intake.js";

type Row = {
  id: string; source_url: string; protocol: Recording["protocol"]; state: Recording["state"];
  requested_duration_seconds: number; requested_start_seconds: number; request_signature: string;
  coverage_seconds: string | null; total_bytes: string | null; error_code: string | null; error_message: string | null;
  created_at: Date; updated_at: Date; completed_at: Date | null;
};

function toRecording(row: Row): Recording {
  return {
    id: row.id, sourceUrl: row.source_url, protocol: row.protocol, state: row.state,
    requestedDurationSeconds: row.requested_duration_seconds, requestedStartSeconds: row.requested_start_seconds,
    ...(row.coverage_seconds === null ? {} : { coverageSeconds: Number(row.coverage_seconds) }),
    ...(row.total_bytes === null ? {} : { totalBytes: Number(row.total_bytes) }),
    ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  };
}

const columns = `id, source_url, protocol, state, requested_duration_seconds, requested_start_seconds,
  request_signature, coverage_seconds, total_bytes, error_code, error_message, created_at, updated_at, completed_at`;

export class PostgresRecordingIntake implements RecordingIntakeRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createOrGet(input: CreateRecordingRecords): Promise<RecordingIntakeResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.idempotencyKey]);
      const existing = await client.query<Row>(`SELECT ${columns} FROM recordings WHERE idempotency_key=$1`, [input.idempotencyKey]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_signature !== input.requestSignature) throw new RecordingIdempotencyConflictError();
        await client.query("COMMIT");
        return { recording: toRecording(existing.rows[0]), created: false };
      }
      const inserted = await client.query<Row>(
        `INSERT INTO recordings (id, source_url, protocol, state, requested_duration_seconds, requested_start_seconds, idempotency_key, request_signature)
         VALUES ($1,$2,$3,'queued',$4,$5,$6,$7) RETURNING ${columns}`,
        [input.recordingId, input.sourceUrl, input.protocol, input.requestedDurationSeconds, input.requestedStartSeconds, input.idempotencyKey, input.requestSignature],
      );
      await client.query(`INSERT INTO recording_jobs (id, recording_id, status) VALUES ($1,$2,'pending')`, [input.jobId, input.recordingId]);
      await client.query(
        `INSERT INTO recording_events (recording_id,type,actor,message,payload) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [input.recordingId, input.initialEvent.type, input.initialEvent.actor, input.initialEvent.message, JSON.stringify(input.initialEvent.payload)],
      );
      await client.query("COMMIT");
      return { recording: toRecording(inserted.rows[0]!), created: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
