import type { FilesystemRecordingStore } from "../adapters/filesystem-recording-store.js";
import type { PostgresRecordingDeletion, RecordingDeletionResult } from "../adapters/postgres-recording-deletion.js";

export type DeleteRecording = (recordingId: string) => Promise<RecordingDeletionResult>;

/** Removes local bytes first so a successful deletion can never leave media orphaned on disk. */
export function createDeleteRecording(repository: PostgresRecordingDeletion, store: FilesystemRecordingStore): DeleteRecording {
  return async (recordingId) => {
    const eligibility = await repository.canDelete(recordingId);
    if (eligibility !== "ready") return eligibility;
    await Promise.all([store.removePublished(recordingId), store.discardWorkspace(recordingId)]);
    return repository.delete(recordingId);
  };
}
