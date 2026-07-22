import type pg from "pg";
import { JobLeaseLostError, type ClaimedInvestigationJob, type InvestigationTransition } from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type {
  InvestigationJobRepository,
  JobFailureDisposition,
} from "../ports/investigation-job.js";

type ClaimedJobRow = {
  id: string;
  investigation_id: string;
  source_url: string;
  problem_description: string | null;
  attempts: number;
  max_attempts: number;
};

type ExhaustedJobRow = {
  id: string;
  investigation_id: string;
};

export class PostgresInvestigationJobRepository implements InvestigationJobRepository {
  constructor(private readonly pool: pg.Pool) {}

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedInvestigationJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await failAbandonedExhaustedJobs(client);
      const result = await client.query<ClaimedJobRow>(
        `WITH candidate AS (
           SELECT id
             FROM jobs
            WHERE kind = 'investigation'
              AND attempts < max_attempts
              AND (status = 'pending' OR (status = 'running' AND locked_until < now()))
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         ), claimed AS (
           UPDATE jobs AS job
              SET status = 'running',
                  attempts = attempts + 1,
                  locked_by = $1,
                  locked_until = now() + ($2 * interval '1 millisecond'),
                  heartbeat_at = now(),
                  started_at = COALESCE(started_at, now()),
                  error_code = NULL,
                  error_message = NULL
             FROM candidate
            WHERE job.id = candidate.id
            RETURNING job.*
         )
         SELECT claimed.id, claimed.investigation_id, claimed.attempts, claimed.max_attempts,
                investigation.source_url, investigation.problem_description
           FROM claimed
           JOIN investigations AS investigation ON investigation.id = claimed.investigation_id`,
        [workerId, leaseMs],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            attempts: row.attempts,
            maxAttempts: row.max_attempts,
            investigation: {
              id: row.investigation_id,
              sourceUrl: row.source_url,
              ...(row.problem_description ? { problemDescription: row.problem_description } : {}),
            },
          }
        : null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE jobs
          SET heartbeat_at = now(), locked_until = now() + ($3 * interval '1 millisecond')
        WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now()`,
      [jobId, workerId, leaseMs],
    );
    return result.rowCount === 1;
  }

  async transition(
    jobId: string,
    workerId: string,
    leaseMs: number,
    transition: InvestigationTransition,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const investigationId = await renewAndGetInvestigationId(client, jobId, workerId, leaseMs);
      await client.query(
        `UPDATE investigations SET state = $2, updated_at = now() WHERE id = $1`,
        [investigationId, transition.state],
      );
      await insertEvent(client, investigationId, transition.event);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(
    jobId: string,
    workerId: string,
    reportId: string,
    report: InvestigationReportContent,
    event: Parameters<InvestigationJobRepository["complete"]>[4],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const investigationId = await assertLeaseAndGetInvestigationId(client, jobId, workerId);
      await client.query(
        `INSERT INTO reports (id, investigation_id, schema_version, content)
         VALUES ($1, $2, 1, $3::jsonb)
         ON CONFLICT (investigation_id) DO UPDATE
         SET schema_version = EXCLUDED.schema_version, content = EXCLUDED.content, updated_at = now()`,
        [reportId, investigationId, JSON.stringify(report)],
      );
      await client.query(
        `UPDATE investigations
            SET state = 'completed', updated_at = now(), completed_at = now(),
                error_code = NULL, error_message = NULL
          WHERE id = $1`,
        [investigationId],
      );
      await client.query(
        `UPDATE jobs
            SET status = 'completed', completed_at = now(), locked_by = NULL,
                locked_until = NULL, heartbeat_at = now(), error_code = NULL, error_message = NULL
          WHERE id = $1`,
        [jobId],
      );
      await insertEvent(client, investigationId, event);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<JobFailureDisposition> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ investigation_id: string; attempts: number; max_attempts: number }>(
        `SELECT investigation_id, attempts, max_attempts
           FROM jobs
          WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now()
          FOR UPDATE`,
        [jobId, workerId],
      );
      const job = result.rows[0];
      if (!job) {
        await client.query("ROLLBACK");
        return "lease_lost";
      }

      const finalFailure = job.attempts >= job.max_attempts;
      await client.query(
        `UPDATE jobs
            SET status = $2, locked_by = NULL, locked_until = NULL,
                error_code = $3, error_message = $4,
                completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
          WHERE id = $1`,
        [jobId, finalFailure ? "failed" : "pending", errorCode, errorMessage],
      );
      await client.query(
        `UPDATE investigations
            SET state = $2, updated_at = now(),
                error_code = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END,
                error_message = CASE WHEN $2 = 'failed' THEN $4 ELSE NULL END,
                completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
          WHERE id = $1`,
        [job.investigation_id, finalFailure ? "failed" : "queued", errorCode, errorMessage],
      );
      await insertEvent(client, job.investigation_id, finalFailure
        ? {
            type: "investigation.failed",
            actor: "system",
            message: "The investigation could not be completed after the configured attempts.",
            payload: { state: "failed", errorCode },
          }
        : {
            type: "investigation.retry_scheduled",
            actor: "system",
            message: "The worker stopped unexpectedly. The investigation was safely queued for another attempt.",
            payload: { state: "queued", errorCode, nextAttempt: job.attempts + 1 },
          });
      await client.query("COMMIT");
      return finalFailure ? "failed" : "retrying";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function renewAndGetInvestigationId(
  client: pg.PoolClient,
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<string> {
  const result = await client.query<{ investigation_id: string }>(
    `UPDATE jobs
        SET heartbeat_at = now(), locked_until = now() + ($3 * interval '1 millisecond')
      WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now()
      RETURNING investigation_id`,
    [jobId, workerId, leaseMs],
  );
  const investigationId = result.rows[0]?.investigation_id;
  if (!investigationId) throw new JobLeaseLostError();
  return investigationId;
}

async function assertLeaseAndGetInvestigationId(
  client: pg.PoolClient,
  jobId: string,
  workerId: string,
): Promise<string> {
  const result = await client.query<{ investigation_id: string }>(
    `UPDATE jobs
        SET heartbeat_at = now()
      WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now()
      RETURNING investigation_id`,
    [jobId, workerId],
  );
  const investigationId = result.rows[0]?.investigation_id;
  if (!investigationId) throw new JobLeaseLostError();
  return investigationId;
}

async function insertEvent(
  client: pg.PoolClient,
  investigationId: string,
  event: { type: string; actor: string; message: string; payload: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `INSERT INTO investigation_events (investigation_id, type, actor, message, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [investigationId, event.type, event.actor, event.message, JSON.stringify(event.payload)],
  );
}

async function failAbandonedExhaustedJobs(client: pg.PoolClient): Promise<void> {
  const result = await client.query<ExhaustedJobRow>(
    `SELECT id, investigation_id
       FROM jobs
      WHERE status = 'running' AND locked_until < now() AND attempts >= max_attempts
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 20`,
  );
  for (const job of result.rows) {
    await client.query(
      `UPDATE jobs
          SET status = 'failed', locked_by = NULL, locked_until = NULL, completed_at = now(),
              error_code = 'JOB_LEASE_EXHAUSTED', error_message = 'Worker lease expired after the final attempt'
        WHERE id = $1`,
      [job.id],
    );
    await client.query(
      `UPDATE investigations
          SET state = 'failed', updated_at = now(), completed_at = now(),
              error_code = 'JOB_LEASE_EXHAUSTED', error_message = 'Worker lease expired after the final attempt'
        WHERE id = $1`,
      [job.investigation_id],
    );
    await insertEvent(client, job.investigation_id, {
      type: "investigation.failed",
      actor: "system",
      message: "The worker lease expired after the final recovery attempt.",
      payload: { state: "failed", errorCode: "JOB_LEASE_EXHAUSTED" },
    });
  }
}
