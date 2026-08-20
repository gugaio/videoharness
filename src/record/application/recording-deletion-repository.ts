export type RecordingDeletionResult = "deleted" | "not_found" | "linked_to_experiment";

export interface RecordingDeletionRepository {
  canDelete(recordingId: string): Promise<"ready" | "not_found" | "linked_to_experiment">;
  delete(recordingId: string): Promise<RecordingDeletionResult>;
}