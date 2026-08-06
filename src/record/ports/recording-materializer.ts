import type { ClaimedRecordingJob } from "../domain/recording-job.js";
import type { RecordingWorkspace } from "./recording-store.js";
import type { RecordedResource } from "../domain/recorded-resource.js";

export type MaterializedRecording = { coverageSeconds: number; totalBytes: number; resources: RecordedResource[] };

/** Deterministic collector that writes a self-contained stream into a private workspace. */
export interface RecordingMaterializer {
  materialize(input: { job: ClaimedRecordingJob; workspace: RecordingWorkspace; onProgress?: (event: { type: string; message: string; payload: Record<string, unknown> }) => Promise<void> }): Promise<MaterializedRecording>;
}
