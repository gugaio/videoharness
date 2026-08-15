import { randomUUID } from "node:crypto";
import type pg from "pg";
import type {
  StartInvestigationAnalysis,
  StartInvestigationAnalysisResult,
} from "../ports/investigation-analysis.js";

type InvestigationStateRow = { state: string };

export class PostgresInvestigationAnalysis {
  constructor(private readonly pool: pg.Pool) {}

  readonly start: StartInvestigationAnalysis = async (
    investigationId,
    options,
  ): Promise<StartInvestigationAnalysisResult> => {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<InvestigationStateRow>(
        "SELECT state FROM investigations WHERE id = $1 FOR UPDATE",
        [investigationId],
      );
      const state = result.rows[0]?.state;
      if (!state) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (["analysis_queued", "analyzing", "synthesizing"].includes(state) || (state === "completed" && !options?.rerun)) {
        await client.query("COMMIT");
        return "already_started";
      }
      if (state !== "evidence_ready" && state !== "completed") {
        await client.query("ROLLBACK");
        return "not_ready";
      }

      await client.query(
        `INSERT INTO jobs (id, investigation_id, kind, status, payload)
         VALUES ($1, $2, 'investigation-analysis', 'pending', $3::jsonb)`,
        [randomUUID(), investigationId, JSON.stringify({ investigationId, rerun: state === "completed" })],
      );
      await client.query(
        `UPDATE investigations
            SET state = 'analysis_queued', updated_at = now(),
                error_code = NULL, error_message = NULL, completed_at = NULL
          WHERE id = $1`,
        [investigationId],
      );
      await client.query(
        `INSERT INTO investigation_events (investigation_id, type, actor, message, payload)
         VALUES ($1, 'investigation.analysis_requested', 'User',
                 $3,
                 $2::jsonb)`,
        [
          investigationId,
          JSON.stringify({ state: "analysis_queued", rerun: state === "completed" }),
          state === "completed"
            ? "Agent reanalysis was requested for the current evidence snapshot."
            : "Agent analysis was requested for the current evidence snapshot.",
        ],
      );
      await client.query("COMMIT");
      return "started";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
}
