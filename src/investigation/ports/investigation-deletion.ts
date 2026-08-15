export type InvestigationDeletionResult = {
  deleted: boolean;
  /** Recordings created through experiments of this investigation. The filesystem
   * keeps their workspaces and published directories, so callers remove them. */
  recordingIds: string[];
};

export interface InvestigationDeletionRepository {
  /** Deletes the investigation and everything the database cascades from it:
   * jobs, events, artifacts, reports, snapshots, agent runs, playback sessions,
   * shell runs and experiments (with their clones/recordings). Returns the
   * linked recording IDs so the caller can remove their files. */
  delete(investigationId: string): Promise<InvestigationDeletionResult>;
}
