import { JsonStore } from "../../store/json-file.js";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";
import type { PlaybackRunRepository } from "../../record/ports/playback-run.js";
import { buildPlaybackRunAbrSwitchEvidence } from "../../record/application/build-abr-switch-evidence.js";
import type { PlaybackCorrelationProvider } from "../ports/playback-correlation.js";

export class FilesystemPlaybackCorrelation implements PlaybackCorrelationProvider {
  constructor(private readonly store: JsonStore, private readonly runs: PlaybackRunRepository) {}

  async listObservedSwitches(investigationId: string): Promise<AbrSwitchEvidence[]> {
    const experimentIds = await this.store.listSubdirectories("experiments");
    const related: Array<{ recordingId: string; runId: string }> = [];
    for (const experimentId of experimentIds) {
      const experiment = await this.store.readJson<{ investigationId?: string }>(
        "experiments", experimentId, "experiment.json",
      );
      if (!experiment || experiment.investigationId !== investigationId) continue;
      const clones = await this.store.listFiles("experiments", experimentId, "clones");
      for (const clone of clones) {
        const stored = await this.store.readJson<{ recordingId?: string }>(
          "experiments", experimentId, "clones", clone,
        );
        if (!stored?.recordingId) continue;
        const runIds = await this.store.listFiles("recordings", stored.recordingId, "runs");
        for (const run of runIds) {
          const hasDeliveries = await this.store.exists("recordings", stored.recordingId, "runs", `${run}.deliveries.jsonl`);
          if (hasDeliveries) related.push({ recordingId: stored.recordingId, runId: run });
        }
      }
    }

    const switches: AbrSwitchEvidence[] = [];
    const seen = new Set<string>();
    for (const { recordingId, runId } of related) {
      const observed = await buildPlaybackRunAbrSwitchEvidence({
        recordingId,
        runId,
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