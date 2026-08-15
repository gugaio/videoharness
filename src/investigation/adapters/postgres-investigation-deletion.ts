import type pg from "pg";
import type { InvestigationDeletionRepository, InvestigationDeletionResult } from "../ports/investigation-deletion.js";

export class PostgresInvestigationDeletion implements InvestigationDeletionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async delete(investigationId: string): Promise<InvestigationDeletionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const exists = await client.query<{ id: string }>(
        `SELECT id FROM investigations WHERE id = $1 FOR UPDATE`,
        [investigationId],
      );
      if (!exists.rows[0]) {
        await client.query("ROLLBACK");
        return { deleted: false, recordingIds: [] };
      }
      const recordings = await client.query<{ recording_id: string }>(
        `SELECT DISTINCT clones.recording_id
           FROM experiment_clones clones
           JOIN experiments ON experiments.id = clones.experiment_id
          WHERE experiments.investigation_id = $1`,
        [investigationId],
      );
      const recordingIds = recordings.rows.map((row) => row.recording_id);
      await client.query(`DELETE FROM investigations WHERE id = $1`, [investigationId]);
      await client.query("COMMIT");
      return { deleted: true, recordingIds };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
