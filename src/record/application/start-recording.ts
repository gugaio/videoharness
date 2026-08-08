import { createHash, randomUUID } from "node:crypto";
import type { RecordingIntakeRepository, RecordingIntakeResult } from "../ports/recording-intake.js";

export type StartRecordingInput = { sourceUrl: string; protocol: "hls" | "dash"; durationSeconds: number; startSeconds: number; idempotencyKey: string };
export type StartRecording = (input: StartRecordingInput) => Promise<RecordingIntakeResult>;

export function createStartRecording(repository: RecordingIntakeRepository): StartRecording {
  return async (input) => {
    const sourceUrl = new URL(input.sourceUrl).toString();
    const requestSignature = createHash("sha256")
      .update(JSON.stringify({ sourceUrl, protocol: input.protocol, durationSeconds: input.durationSeconds, startSeconds: input.startSeconds }))
      .digest("hex");
    return repository.createOrGet({
      recordingId: randomUUID(),
      jobId: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      requestSignature,
      sourceUrl,
      protocol: input.protocol,
      requestedDurationSeconds: input.durationSeconds,
      requestedStartSeconds: input.startSeconds,
      initialEvent: {
        type: "recording.created",
        actor: "system",
        message: "Recording created and queued.",
        payload: { state: "queued", protocol: input.protocol },
      },
    });
  };
}
