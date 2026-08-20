import { JsonStore } from "../../store/json-file.js";
import type { InvestigationDeletionRepository, InvestigationDeletionResult } from "../ports/investigation-deletion.js";

export class FilesystemInvestigationDeletion implements InvestigationDeletionRepository {
  constructor(private readonly store: JsonStore) {}

  async delete(investigationId: string): Promise<InvestigationDeletionResult> {
    const exists = await this.store.exists("investigations", investigationId, "investigation.json");
    if (!exists) return { deleted: false, recordingIds: [] };

    const recordingIds: string[] = [];
    const experimentIds = await this.store.listSubdirectories("experiments");
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
        if (stored?.recordingId) recordingIds.push(stored.recordingId);
      }
      await this.store.removeDirectory("experiments", experimentId);
    }

    await this.store.removeDirectory("investigations", investigationId);
    return { deleted: true, recordingIds };
  }
}