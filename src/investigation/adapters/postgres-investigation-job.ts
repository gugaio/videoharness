import { randomUUID } from "node:crypto";
import type pg from "pg";
import { JobLeaseLostError, type ClaimedInvestigationJob, type InvestigationTransition } from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type {
  InvestigationJobRepository,
  JobFailureDisposition,
} from "../ports/investigation-job.js";
import { EvidenceBundleV2Schema } from "../../contracts/investigation.js";
import type { EvidenceBundleV2 } from "../domain/evidence.js";

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
  kind: string;
};

type EvidenceSnapshotRow = { id: string; evidence: unknown };

export class PostgresInvestigationJobRepository implements InvestigationJobRepository {
  constructor(private readonly pool: pg.Pool) {}

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedInvestigationJob | null> {
    return this.claimNextByKind("investigation", workerId, leaseMs);
  }

  async claimNextAnalysis(workerId: string, leaseMs: number): Promise<ClaimedInvestigationJob | null> {
    return this.claimNextByKind("investigation-analysis", workerId, leaseMs);
  }

  private async claimNextByKind(
    kind: "investigation" | "investigation-analysis",
    workerId: string,
    leaseMs: number,
  ): Promise<ClaimedInvestigationJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await failAbandonedExhaustedJobs(client);
      const result = await client.query<ClaimedJobRow>(
        `WITH candidate AS (
           SELECT id
             FROM jobs
            WHERE kind = $3
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
        [workerId, leaseMs, kind],
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

  async loadLatestEvidence(investigationId: string): Promise<{ id: string; evidence: EvidenceBundleV2 } | null> {
    const result = await this.pool.query<EvidenceSnapshotRow>(
      `SELECT id, evidence
         FROM evidence_snapshots
        WHERE investigation_id = $1
        ORDER BY revision DESC
        LIMIT 1`,
      [investigationId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, evidence: EvidenceBundleV2Schema.parse(row.evidence) as EvidenceBundleV2 } : null;
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

  async completeCollection(
    jobId: string,
    workerId: string,
    event: Parameters<InvestigationJobRepository["completeCollection"]>[2],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const investigationId = await assertLeaseAndGetInvestigationId(client, jobId, workerId);
      await client.query(
        `UPDATE investigations
            SET state = 'evidence_ready', updated_at = now(), completed_at = NULL,
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

  async recordEvidenceBatch(
    jobId: string,
    workerId: string,
    leaseMs: number,
    artifacts: Parameters<InvestigationJobRepository["recordEvidenceBatch"]>[3],
    evidence: Parameters<InvestigationJobRepository["recordEvidenceBatch"]>[4],
    event: Parameters<InvestigationJobRepository["recordEvidenceBatch"]>[5],
  ): ReturnType<InvestigationJobRepository["recordEvidenceBatch"]> {
    if (artifacts.length === 0) throw new Error("At least one evidence artifact is required");
    const logicalKeys = artifacts.map((artifact) => artifact.logicalKey);
    if (new Set(logicalKeys).size !== logicalKeys.length) {
      throw new Error("Evidence artifact logical keys must be unique within a batch");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const investigationId = await renewAndGetInvestigationId(client, jobId, workerId, leaseMs);
      const existing = await client.query<{ logical_key: string; storage_key: string }>(
        `SELECT logical_key, storage_key
           FROM artifacts
          WHERE investigation_id = $1 AND logical_key = ANY($2::text[])
          FOR UPDATE`,
        [investigationId, logicalKeys],
      );
      for (const artifact of artifacts) {
        await client.query(
          `INSERT INTO artifacts (
             id, investigation_id, logical_key, kind, storage_key, content_type, size_bytes, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           ON CONFLICT (investigation_id, logical_key) WHERE logical_key IS NOT NULL
           DO UPDATE SET id = EXCLUDED.id,
                         kind = EXCLUDED.kind,
                         storage_key = EXCLUDED.storage_key,
                         content_type = EXCLUDED.content_type,
                         size_bytes = EXCLUDED.size_bytes,
                         metadata = EXCLUDED.metadata,
                         created_at = now()`,
          [
            artifact.id,
            investigationId,
            artifact.logicalKey,
            artifact.kind,
            artifact.storageKey,
            artifact.contentType ?? null,
            artifact.sizeBytes,
            "{}",
          ],
        );
      }
      const snapshotId = randomUUID();
      const revision = await client.query<{ revision: number }>(
        `SELECT revision
           FROM evidence_snapshots
          WHERE investigation_id = $1
          ORDER BY revision DESC
          LIMIT 1
          FOR UPDATE`,
        [investigationId],
      );
      await client.query(
        `INSERT INTO evidence_snapshots (id, investigation_id, revision, evidence)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [snapshotId, investigationId, (revision.rows[0]?.revision ?? 0) + 1, JSON.stringify(evidence)],
      );
      await client.query(
        `UPDATE investigations SET state = 'collecting', updated_at = now() WHERE id = $1`,
        [investigationId],
      );
      await insertEvent(client, investigationId, event);
      await client.query("COMMIT");
      const currentStorageKeys = new Set(artifacts.map((artifact) => artifact.storageKey));
      return {
        snapshotId,
        supersededStorageKeys: existing.rows
          .map((artifact) => artifact.storage_key)
          .filter((storageKey) => !currentStorageKeys.has(storageKey)),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAgentRuns(
    jobId: string,
    workerId: string,
    leaseMs: number,
    snapshotId: string,
    runs: Parameters<InvestigationJobRepository["recordAgentRuns"]>[4],
  ): Promise<void> {
    if (runs.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const investigationId = await renewAndGetInvestigationId(client, jobId, workerId, leaseMs);
      const previousAttempts = await client.query<{ agent_id: string; max_attempt: number }>(
        `SELECT agent_id, max(attempt)::integer AS max_attempt
           FROM agent_runs
          WHERE investigation_id = $1 AND evidence_snapshot_id = $2
          GROUP BY agent_id`,
        [investigationId, snapshotId],
      );
      const attemptOffset = new Map(previousAttempts.rows.map((row) => [row.agent_id, row.max_attempt]));
      for (const run of runs) {
        await client.query(
          `INSERT INTO agent_runs (
             id, investigation_id, evidence_snapshot_id, agent_id, attempt, state,
             provider, model, system_prompt, prompt, tool_names, tool_calls, packet_metrics, output
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb)
           ON CONFLICT (investigation_id, evidence_snapshot_id, agent_id, attempt) DO NOTHING`,
          [
            randomUUID(), investigationId, snapshotId, run.agentId, run.attempt + (attemptOffset.get(run.agentId) ?? 0), run.state,
            run.provider, run.model, run.systemPrompt, run.prompt,
            JSON.stringify(run.toolNames), JSON.stringify(run.toolCalls), JSON.stringify(run.packetMetrics ?? null), JSON.stringify(run.output ?? null),
          ],
        );
      }
      await insertEvent(client, investigationId, {
        type: "investigation.agent_runs_recorded",
        actor: "AI Investigation Team",
        message: `${runs.length} agent call${runs.length === 1 ? " was" : "s were"} recorded against the evidence snapshot.`,
        payload: { state: "analyzing", snapshotId, runCount: runs.length },
      });
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
    retryable: boolean,
  ): Promise<JobFailureDisposition> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ investigation_id: string; kind: string; attempts: number; max_attempts: number }>(
        `SELECT investigation_id, kind, attempts, max_attempts
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

      const finalFailure = !retryable || job.attempts >= job.max_attempts;
      const analysisJob = job.kind === "investigation-analysis";
      const retryState = analysisJob ? "analysis_queued" : "queued";
      const finalState = analysisJob ? "evidence_ready" : "failed";
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
        [job.investigation_id, finalFailure ? finalState : retryState, errorCode, errorMessage],
      );
      await insertEvent(client, job.investigation_id, finalFailure && analysisJob
        ? {
            type: "investigation.analysis_failed",
            actor: "system",
            message: `Agent analysis could not complete. The deterministic evidence remains available: ${errorMessage}`,
            payload: { state: "evidence_ready", errorCode },
          }
        : finalFailure
        ? {
            type: "investigation.failed",
            actor: "system",
            message: retryable
              ? `The investigation could not be completed after the configured attempts. Last failure: ${errorMessage}`
              : errorMessage,
            payload: { state: "failed", errorCode },
          }
        : analysisJob
          ? {
              type: "investigation.analysis_retry_scheduled",
              actor: "system",
              message: `${errorMessage} Agent analysis was safely queued for another attempt.`,
              payload: { state: "analysis_queued", errorCode, nextAttempt: job.attempts + 1 },
            }
          : {
            type: "investigation.retry_scheduled",
            actor: "system",
            message: `${errorMessage} The investigation was safely queued for another attempt.`,
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
    `SELECT id, investigation_id, kind
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
    const analysisJob = job.kind === "investigation-analysis";
    await client.query(
      `UPDATE investigations
          SET state = $2, updated_at = now(), completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END,
              error_code = 'JOB_LEASE_EXHAUSTED', error_message = 'Worker lease expired after the final attempt'
        WHERE id = $1`,
      [job.investigation_id, analysisJob ? "evidence_ready" : "failed"],
    );
    await insertEvent(client, job.investigation_id, analysisJob ? {
      type: "investigation.analysis_failed",
      actor: "system",
      message: "Agent analysis exhausted its recovery attempts. The deterministic evidence remains available.",
      payload: { state: "evidence_ready", errorCode: "JOB_LEASE_EXHAUSTED" },
    } : {
      type: "investigation.failed",
      actor: "system",
      message: "The worker lease expired after the final recovery attempt.",
      payload: { state: "failed", errorCode: "JOB_LEASE_EXHAUSTED" },
    });
  }
}
