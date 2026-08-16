import type pg from "pg";

export type RecordingDeletionResult = "deleted" | "not_found" | "linked_to_experiment";

export class PostgresRecordingDeletion {
  constructor(private readonly pool: pg.Pool) {}

  async canDelete(recordingId: string): Promise<"ready" | "not_found" | "linked_to_experiment"> {
    const result = await this.pool.query<{ exists: boolean; linked: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM recordings WHERE id = $1) AS exists,
              EXISTS(SELECT 1 FROM experiment_clones WHERE recording_id = $1) AS linked`, [recordingId],
    );
    const row = result.rows[0];
    if (!row || !row.exists) return "not_found";
    return row.linked ? "linked_to_experiment" : "ready";
  }

  async delete(recordingId: string): Promise<RecordingDeletionResult> {
    const result = await this.pool.query<{ id: string }>(
      `DELETE FROM recordings WHERE id = $1
       AND NOT EXISTS (SELECT 1 FROM experiment_clones WHERE recording_id = $1)
       RETURNING id`, [recordingId],
    );
    if (result.rows[0]) return "deleted";
    return (await this.canDelete(recordingId)) === "linked_to_experiment" ? "linked_to_experiment" : "not_found";
  }
}
