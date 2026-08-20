import { JsonStore } from "../../store/json-file.js";
import type { RecordingDeletionRepository, RecordingDeletionResult } from "../application/recording-deletion-repository.js";

export class FilesystemRecordingDeletion implements RecordingDeletionRepository {
  constructor(private readonly store: JsonStore) {}

  async canDelete(recordingId: string): Promise<"ready" | "not_found" | "linked_to_experiment"> {
    const exists = await this.store.exists("recordings", recordingId, "recording.json");
    if (!exists) return "not_found";
    return await this.isLinked(recordingId) ? "linked_to_experiment" : "ready";
  }

  async delete(recordingId: string): Promise<RecordingDeletionResult> {
    const exists = await this.store.exists("recordings", recordingId, "recording.json");
    if (!exists) return "not_found";
    if (await this.isLinked(recordingId)) return "linked_to_experiment";
    await this.store.removeDirectory("recordings", recordingId);
    return "deleted";
  }

  private async isLinked(recordingId: string): Promise<boolean> {
    const experimentIds = await this.store.listSubdirectories("experiments");
    for (const experimentId of experimentIds) {
      const clones = await this.store.listFiles("experiments", experimentId, "clones");
      for (const clone of clones) {
        const stored = await this.store.readJson<{ recordingId?: string }>(
          "experiments", experimentId, "clones", clone,
        );
        if (stored?.recordingId === recordingId) return true;
      }
    }
    return false;
  }
}