import type pg from "pg";
import { RecordingJobLeaseLostError, type ClaimedRecordingJob, type RecordingLifecycleEvent, type RecordingTransition } from "../domain/recording-job.js";
import type { RecordingJobFailureDisposition, RecordingJobRepository } from "../ports/recording-job.js";

type ClaimedRow = {
  id: string; attempts: number; max_attempts: number; recording_id: string; source_url: string;
  protocol: "hls" | "dash"; requested_duration_seconds: number; requested_start_seconds: number;
};

export class PostgresRecordingJobRepository implements RecordingJobRepository {
  constructor(private readonly pool: pg.Pool) {}

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedRecordingJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ClaimedRow>(
        `WITH candidate AS (
           SELECT id FROM recording_jobs
            WHERE attempts < max_attempts AND (status = 'pending' OR (status = 'running' AND locked_until < now()))
            ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
         ), claimed AS (
           UPDATE recording_jobs AS job SET status = 'running', attempts = attempts + 1, locked_by = $1,
             locked_until = now() + ($2 * interval '1 millisecond'), heartbeat_at = now(),
             started_at = COALESCE(started_at, now()), error_code = NULL, error_message = NULL
            FROM candidate WHERE job.id = candidate.id RETURNING job.*
         )
         SELECT claimed.id, claimed.attempts, claimed.max_attempts, claimed.recording_id,
                recording.source_url, recording.protocol, recording.requested_duration_seconds, recording.requested_start_seconds
           FROM claimed JOIN recordings AS recording ON recording.id = claimed.recording_id`,
        [workerId, leaseMs],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return row ? { id: row.id, attempts: row.attempts, maxAttempts: row.max_attempts, recording: {
        id: row.recording_id, sourceUrl: row.source_url, protocol: row.protocol,
        requestedDurationSeconds: row.requested_duration_seconds, requestedStartSeconds: row.requested_start_seconds,
      } } : null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE recording_jobs SET heartbeat_at = now(), locked_until = now() + ($3 * interval '1 millisecond')
        WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now()`, [jobId, workerId, leaseMs]);
    return result.rowCount === 1;
  }

  async transition(jobId: string, workerId: string, leaseMs: number, transition: RecordingTransition): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const recordingId = await renewLease(client, jobId, workerId, leaseMs);
      await client.query(`UPDATE recordings SET state = $2, updated_at = now() WHERE id = $1`, [recordingId, transition.state]);
      await insertEvent(client, recordingId, transition.event);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async complete(jobId: string, workerId: string, result: { coverageSeconds: number; totalBytes: number; resources: import("../domain/recorded-resource.js").RecordedResource[] }, event: RecordingLifecycleEvent): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const recordingId = await assertLease(client, jobId, workerId);
      if (result.resources.length === 0) throw new Error("A recording must include at least one registered resource");
      for (const resource of result.resources) {
        await client.query(`INSERT INTO recorded_resources (id, recording_id, logical_path, kind, storage_key, content_type, size_bytes, sha256, metadata)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [
          resource.id, recordingId, resource.logicalPath, resource.kind, resource.storageKey,
          resource.contentType ?? null, resource.sizeBytes, resource.sha256, JSON.stringify(resource.metadata),
        ]);
      }
      await client.query(`UPDATE recordings SET state = 'ready', coverage_seconds = $2, total_bytes = $3,
        error_code = NULL, error_message = NULL, updated_at = now(), completed_at = now() WHERE id = $1`, [recordingId, result.coverageSeconds, result.totalBytes]);
      await client.query(`UPDATE recording_jobs SET status = 'completed', completed_at = now(), locked_by = NULL,
        locked_until = NULL, heartbeat_at = now(), error_code = NULL, error_message = NULL WHERE id = $1`, [jobId]);
      await insertEvent(client, recordingId, event);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async fail(jobId: string, workerId: string, errorCode: string, errorMessage: string, retryable: boolean): Promise<RecordingJobFailureDisposition> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ recording_id: string; attempts: number; max_attempts: number }>(
        `SELECT recording_id, attempts, max_attempts FROM recording_jobs
          WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now() FOR UPDATE`, [jobId, workerId]);
      const job = locked.rows[0];
      if (!job) { await client.query("ROLLBACK"); return "lease_lost"; }
      const finalFailure = !retryable || job.attempts >= job.max_attempts;
      await client.query(`UPDATE recording_jobs SET status = $2, locked_by = NULL, locked_until = NULL,
        error_code = $3, error_message = $4, completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END WHERE id = $1`,
        [jobId, finalFailure ? "failed" : "pending", errorCode, errorMessage]);
      await client.query(`UPDATE recordings SET state = $2, updated_at = now(),
        error_code = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END,
        error_message = CASE WHEN $2 = 'failed' THEN $4 ELSE NULL END,
        completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END WHERE id = $1`,
        [job.recording_id, finalFailure ? "failed" : "queued", errorCode, errorMessage]);
      await insertEvent(client, job.recording_id, finalFailure ? {
        type: "recording.failed", actor: "system", message: errorMessage, payload: { state: "failed", errorCode },
      } : {
        type: "recording.retry_scheduled", actor: "system", message: `${errorMessage} The recording was safely queued for another attempt.`,
        payload: { state: "queued", errorCode, nextAttempt: job.attempts + 1 },
      });
      await client.query("COMMIT");
      return finalFailure ? "failed" : "retrying";
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }
}

async function renewLease(client: pg.PoolClient, jobId: string, workerId: string, leaseMs: number): Promise<string> {
  const result = await client.query<{ recording_id: string }>(`UPDATE recording_jobs
    SET heartbeat_at = now(), locked_until = now() + ($3 * interval '1 millisecond')
    WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now() RETURNING recording_id`, [jobId, workerId, leaseMs]);
  const recordingId = result.rows[0]?.recording_id;
  if (!recordingId) throw new RecordingJobLeaseLostError();
  return recordingId;
}

async function assertLease(client: pg.PoolClient, jobId: string, workerId: string): Promise<string> {
  const result = await client.query<{ recording_id: string }>(`UPDATE recording_jobs SET heartbeat_at = now()
    WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now() RETURNING recording_id`, [jobId, workerId]);
  const recordingId = result.rows[0]?.recording_id;
  if (!recordingId) throw new RecordingJobLeaseLostError();
  return recordingId;
}

async function insertEvent(client: pg.PoolClient, recordingId: string, event: RecordingLifecycleEvent): Promise<void> {
  await client.query(`INSERT INTO recording_events (recording_id, type, actor, message, payload)
    VALUES ($1, $2, $3, $4, $5::jsonb)`, [recordingId, event.type, event.actor, event.message, JSON.stringify(event.payload)]);
}
