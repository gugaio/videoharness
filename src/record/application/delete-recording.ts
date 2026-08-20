import type { FilesystemRecordingStore } from "../adapters/filesystem-recording-store.js";
import type { RecordingDeletionRepository } from "./recording-deletion-repository.js";

export type DeleteRecording = (recordingId: string) => Promise<RecordingDeletionResult>;

export type RecordingDeletionResult = "deleted" | "not_found" | "linked_to_experiment";

/** Removes local bytes first so a successful deletion can never leave media orphaned on disk. */
export function createDeleteRecording(repository: RecordingDeletionRepository, store: FilesystemRecordingStore): DeleteRecording {
  return async (recordingId) => {
    const eligibility = await repository.canDelete(recordingId);
    if (eligibility !== "ready") return eligibility;
    await Promise.all([store.removePublished(recordingId), store.discardWorkspace(recordingId)]);
    return repository.delete(recordingId);
  };
}
