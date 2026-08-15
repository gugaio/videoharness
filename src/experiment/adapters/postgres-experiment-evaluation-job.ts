import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ClaimedExperimentEvaluationJob, ExperimentEvaluationJob, ExperimentEvaluationJobRepository } from "../ports/experiment-evaluation-job.js";

type JobRow = {
  id: string;
  experiment_id: string;
  iteration_id: string;
  status: ExperimentEvaluationJob["status"];
  attempts: number;
  max_attempts: number;
  created_at: Date;
};

export class PostgresExperimentEvaluationJobs implements ExperimentEvaluationJobRepository {
  constructor(private readonly pool: pg.Pool) {}

  async request(experimentId: string): Promise<{ job: ExperimentEvaluationJob; replayed: boolean } | "not_found" | "not_ready"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const experiment = await client.query<{ status: string }>("SELECT status FROM experiments WHERE id = $1 FOR UPDATE", [experimentId]);
      if (!experiment.rows[0]) { await client.query("ROLLBACK"); return "not_found"; }
      const active = await client.query<JobRow>(
        "SELECT * FROM experiment_evaluation_jobs WHERE experiment_id = $1 AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1",
        [experimentId],
      );
      if (active.rows[0]) { await client.query("COMMIT"); return { job: toJob(active.rows[0]), replayed: true }; }
      if (!["EVALUATING", "CONCLUDED", "FOLLOWUP_REQUIRED"].includes(experiment.rows[0].status)) {
        await client.query("ROLLBACK");
        return "not_ready";
      }
      const iteration = await client.query<{ id: string }>(
        "SELECT id FROM experiment_iterations WHERE experiment_id = $1 ORDER BY iteration_number DESC LIMIT 1",
        [experimentId],
      );
      if (!iteration.rows[0]) { await client.query("ROLLBACK"); return "not_ready"; }
      const pending = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM test_requests WHERE iteration_id = $1 AND status <> 'COMPLETED'",
        [iteration.rows[0].id],
      );
      if (Number(pending.rows[0]?.count ?? 0) > 0) { await client.query("ROLLBACK"); return "not_ready"; }
      const created = await client.query<JobRow>(
        `INSERT INTO experiment_evaluation_jobs (id, experiment_id, iteration_id, status)
         VALUES ($1,$2,$3,'pending') RETURNING *`,
        [randomUUID(), experimentId, iteration.rows[0].id],
      );
      await client.query("UPDATE experiments SET status = 'EVALUATING', updated_at = now() WHERE id = $1", [experimentId]);
      await client.query("UPDATE experiment_iterations SET status = 'EVALUATING', updated_at = now() WHERE id = $1", [iteration.rows[0].id]);
      await client.query("COMMIT");
      return { job: toJob(created.rows[0]!), replayed: false };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedExperimentEvaluationJob | null> {
    const result = await this.pool.query<JobRow>(
      `WITH candidate AS (
         SELECT id FROM experiment_evaluation_jobs
          WHERE attempts < max_attempts
            AND (status = 'pending' OR (status = 'running' AND locked_until < now()))
          ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE experiment_evaluation_jobs AS job
          SET status = 'running', attempts = attempts + 1, locked_by = $1,
              locked_until = now() + ($2 * interval '1 millisecond'), heartbeat_at = now(),
              started_at = COALESCE(started_at, now()), error_code = NULL, error_message = NULL
         FROM candidate WHERE job.id = candidate.id RETURNING job.*`,
      [workerId, leaseMs],
    );
    const row = result.rows[0];
    return row ? { ...toJob(row), status: "running" } : null;
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE experiment_evaluation_jobs
          SET heartbeat_at = now(), locked_until = now() + ($3 * interval '1 millisecond')
        WHERE id = $1 AND status = 'running' AND locked_by = $2 AND locked_until > now()`,
      [jobId, workerId, leaseMs],
    );
    return result.rowCount === 1;
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE experiment_evaluation_jobs
          SET status = 'completed', completed_at = now(), heartbeat_at = now(), locked_by = NULL, locked_until = NULL
        WHERE id = $1 AND status = 'running' AND locked_by = $2`,
      [jobId, workerId],
    );
    return result.rowCount === 1;
  }

  async fail(jobId: string, workerId: string, code: string, message: string): Promise<"retrying" | "failed" | "lease_lost"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query<JobRow>("SELECT * FROM experiment_evaluation_jobs WHERE id = $1 FOR UPDATE", [jobId]);
      const job = row.rows[0];
      if (!job) { await client.query("ROLLBACK"); return "lease_lost"; }
      const owned = await client.query<{ owned: boolean }>(
        "SELECT (status = 'running' AND locked_by = $2) AS owned FROM experiment_evaluation_jobs WHERE id = $1",
        [jobId, workerId],
      );
      if (!owned.rows[0]?.owned) { await client.query("ROLLBACK"); return "lease_lost"; }
      const exhausted = job.attempts >= job.max_attempts;
      await client.query(
        `UPDATE experiment_evaluation_jobs
            SET status = $3, error_code = $4, error_message = $5, locked_by = NULL, locked_until = NULL,
                completed_at = CASE WHEN $3 = 'failed' THEN now() ELSE NULL END
          WHERE id = $1 AND locked_by = $2`,
        [jobId, workerId, exhausted ? "failed" : "pending", code, message.slice(0, 1_000)],
      );
      if (exhausted) {
        await client.query("UPDATE experiments SET status = 'FOLLOWUP_REQUIRED', updated_at = now() WHERE id = $1 AND status = 'EVALUATING'", [job.experiment_id]);
        await client.query("UPDATE experiment_iterations SET status = 'COMPLETED', updated_at = now() WHERE id = $1 AND status = 'EVALUATING'", [job.iteration_id]);
      }
      await client.query("COMMIT");
      return exhausted ? "failed" : "retrying";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}

function toJob(row: JobRow): ExperimentEvaluationJob {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    iterationId: row.iteration_id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at.toISOString(),
  };
}
