export type RecordingWorkspace = { recordingId: string; path: string };

export interface RecordingStore {
  prepareWorkspace(recordingId: string): Promise<RecordingWorkspace>;
  publish(workspace: RecordingWorkspace): Promise<void>;
  discardWorkspace(recordingId: string): Promise<void>;
  removePublished(recordingId: string): Promise<void>;
}
