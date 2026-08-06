import type { Recording } from "../domain/recording.js";

export type CreateRecordingRecords = {
  recordingId: string;
  jobId: string;
  idempotencyKey: string;
  requestSignature: string;
  sourceUrl: string;
  protocol: "hls";
  requestedDurationSeconds: number;
  requestedStartSeconds: number;
  initialEvent: { type: "recording.created"; actor: "system"; message: string; payload: Record<string, unknown> };
};

export type RecordingIntakeResult = { recording: Recording; created: boolean };

export interface RecordingIntakeRepository {
  createOrGet(input: CreateRecordingRecords): Promise<RecordingIntakeResult>;
}

export class RecordingIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with a different recording request");
    this.name = "RecordingIdempotencyConflictError";
  }
}
