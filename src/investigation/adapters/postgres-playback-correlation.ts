import type pg from "pg";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";
import type { PlaybackRunRepository } from "../../record/ports/playback-run.js";
import { buildPlaybackRunAbrSwitchEvidence } from "../../record/application/build-abr-switch-evidence.js";
import type { PlaybackCorrelationProvider } from "../ports/playback-correlation.js";

type RelatedRunRow = { recording_id: string; run_id: string };

export class PostgresPlaybackCorrelation implements PlaybackCorrelationProvider {
  constructor(private readonly pool: pg.Pool, private readonly runs: PlaybackRunRepository) {}

  async listObservedSwitches(investigationId: string): Promise<AbrSwitchEvidence[]> {
    const result = await this.pool.query<RelatedRunRow>(
      `SELECT clone.recording_id, run.id AS run_id
         FROM experiments AS experiment
         JOIN experiment_clones AS clone ON clone.experiment_id = experiment.id
         JOIN recordings AS recording ON recording.id = clone.recording_id
         JOIN playback_runs AS run ON run.recording_id = recording.id
        WHERE experiment.investigation_id = $1
          AND EXISTS (
            SELECT 1 FROM delivery_requests AS delivery
             WHERE delivery.playback_run_id = run.id
          )
        ORDER BY run.created_at DESC`,
      [investigationId],
    );
    const switches: AbrSwitchEvidence[] = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
      const observed = await buildPlaybackRunAbrSwitchEvidence({
        recordingId: row.recording_id,
        runId: row.run_id,
        repository: this.runs,
      });
      if (observed === "unavailable") continue;
      for (const entry of observed) {
        if (seen.has(entry.switchId)) continue;
        seen.add(entry.switchId);
        switches.push(entry);
      }
    }
    return switches;
  }
}
