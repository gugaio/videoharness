import type pg from "pg";
import type { Investigation } from "../domain/investigation.js";
import {
  IdempotencyConflictError,
  type CreateInvestigationRecords,
  type InvestigationIntakeRepository,
  type InvestigationIntakeResult,
} from "../ports/investigation-intake.js";

type InvestigationRow = {
  id: string;
  source_url: string;
  problem_description: string | null;
  state: Investigation["state"];
  request_signature: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

function toInvestigation(row: InvestigationRow): Investigation {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    ...(row.problem_description ? { problemDescription: row.problem_description } : {}),
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  };
}

export class PostgresInvestigationIntake implements InvestigationIntakeRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createOrGet(input: CreateInvestigationRecords): Promise<InvestigationIntakeResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.idempotencyKey]);
      const existing = await client.query<InvestigationRow>(
        `SELECT id, source_url, problem_description, state, request_signature,
                created_at, updated_at, completed_at
           FROM investigations
          WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        if (existingRow.request_signature !== input.requestSignature) {
          throw new IdempotencyConflictError();
        }
        await client.query("COMMIT");
        return { investigation: toInvestigation(existingRow), created: false };
      }

      const inserted = await client.query<InvestigationRow>(
        `INSERT INTO investigations (
           id, source_url, problem_description, state, idempotency_key, request_signature
         ) VALUES ($1, $2, $3, 'queued', $4, $5)
         RETURNING id, source_url, problem_description, state, request_signature,
                   created_at, updated_at, completed_at`,
        [
          input.investigationId,
          input.sourceUrl,
          input.problemDescription ?? null,
          input.idempotencyKey,
          input.requestSignature,
        ],
      );
      await client.query(
        `INSERT INTO jobs (id, investigation_id, status, payload)
         VALUES ($1, $2, 'pending', $3::jsonb)`,
        [input.jobId, input.investigationId, JSON.stringify({ investigationId: input.investigationId })],
      );
      await client.query(
        `INSERT INTO investigation_events (investigation_id, type, actor, message, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          input.investigationId,
          input.initialEvent.type,
          input.initialEvent.actor,
          input.initialEvent.message,
          JSON.stringify(input.initialEvent.payload),
        ],
      );
      await client.query("COMMIT");
      return { investigation: toInvestigation(inserted.rows[0]!), created: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
