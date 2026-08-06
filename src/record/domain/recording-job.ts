import type { RecordingState } from "./recording.js";

export type ClaimedRecordingJob = {
  id: string;
  attempts: number;
  maxAttempts: number;
  recording: {
    id: string;
    sourceUrl: string;
    protocol: "hls" | "dash";
    requestedDurationSeconds: number;
    requestedStartSeconds: number;
  };
};

export type RecordingLifecycleEvent = {
  type: string;
  actor: string;
  message: string;
  payload: Record<string, unknown>;
};

export type RecordingTransition = { state: Extract<RecordingState, "validating" | "collecting">; event: RecordingLifecycleEvent };

export class RecordingJobLeaseLostError extends Error {
  constructor() {
    super("Recording worker lease was lost");
    this.name = "RecordingJobLeaseLostError";
  }
}
