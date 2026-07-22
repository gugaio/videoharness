import type pg from "pg";
import type { InvestigationEvent } from "../domain/investigation-event.js";
import type { InvestigationReport, InvestigationReportContent } from "../domain/investigation-report.js";
import type { Investigation } from "../domain/investigation.js";
import type { InvestigationQueryRepository } from "../ports/investigation-query.js";

type InvestigationRow = {
  id: string;
  source_url: string;
  problem_description: string | null;
  state: Investigation["state"];
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

type InvestigationEventRow = {
  id: string;
  investigation_id: string;
  type: string;
  actor: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

type InvestigationReportRow = {
  id: string;
  investigation_id: string;
  schema_version: number;
  content: InvestigationReportContent;
  created_at: Date;
  updated_at: Date;
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

export class PostgresInvestigationQuery implements InvestigationQueryRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findById(id: string): Promise<Investigation | null> {
    const result = await this.pool.query<InvestigationRow>(
      `SELECT id, source_url, problem_description, state, created_at, updated_at, completed_at
         FROM investigations
        WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toInvestigation(result.rows[0]) : null;
  }

  async listEventsAfter(investigationId: string, afterEventId: string, limit: number): Promise<InvestigationEvent[]> {
    const result = await this.pool.query<InvestigationEventRow>(
      `SELECT id, investigation_id, type, actor, message, payload, created_at
         FROM investigation_events
        WHERE investigation_id = $1 AND id > $2::bigint
        ORDER BY id ASC
        LIMIT $3`,
      [investigationId, afterEventId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      investigationId: row.investigation_id,
      type: row.type,
      actor: row.actor,
      message: row.message,
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async findReport(investigationId: string): Promise<InvestigationReport | null> {
    const result = await this.pool.query<InvestigationReportRow>(
      `SELECT id, investigation_id, schema_version, content, created_at, updated_at
         FROM reports
        WHERE investigation_id = $1`,
      [investigationId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          investigationId: row.investigation_id,
          schemaVersion: row.schema_version,
          content: row.content,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        }
      : null;
  }
}
