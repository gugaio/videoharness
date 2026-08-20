import { createHash } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import type { Recording } from "../domain/recording.js";
import {
  RecordingIdempotencyConflictError,
  type CreateRecordingRecords,
  type RecordingIntakeRepository,
  type RecordingIntakeResult,
} from "../ports/recording-intake.js";

export type StoredRecording = {
  id: string;
  sourceUrl: string;
  protocol: Recording["protocol"];
  state: Recording["state"];
  requestedDurationSeconds: number;
  requestedStartSeconds: number;
  idempotencyKey: string;
  requestSignature: string;
  coverageSeconds?: number;
  totalBytes?: number;
  errorCode?: string;
  errorMessage?: string;
  clonePlan?: unknown;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export class FilesystemRecordingIntake implements RecordingIntakeRepository {
  constructor(private readonly store: JsonStore) {}

  async createOrGet(input: CreateRecordingRecords): Promise<RecordingIntakeResult> {
    const keyHash = hashKey(input.idempotencyKey);
    const release = await this.store.acquireLock(`locks/idempotency-recording-${keyHash}`);
    try {
      const index = await this.store.readJson<{ recordingId: string; requestSignature: string }>(
        "index", "recording-idempotency", `${keyHash}.json`,
      );
      if (index) {
        if (index.requestSignature !== input.requestSignature) throw new RecordingIdempotencyConflictError();
        const existing = await this.readRecording(index.recordingId);
        if (!existing) throw new Error("Idempotent recording index points to a missing recording");
        return { recording: toRecording(existing), created: false };
      }

      const now = new Date().toISOString();
      const stored: StoredRecording = {
        id: input.recordingId,
        sourceUrl: input.sourceUrl,
        protocol: input.protocol,
        state: "queued",
        requestedDurationSeconds: input.requestedDurationSeconds,
        requestedStartSeconds: input.requestedStartSeconds,
        idempotencyKey: input.idempotencyKey,
        requestSignature: input.requestSignature,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.writeJson(stored, "recordings", input.recordingId, "recording.json");
      await this.store.writeJson(
        {
          id: input.jobId,
          kind: "recording",
          recordingId: input.recordingId,
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          payload: { recordingId: input.recordingId },
          createdAt: now,
        },
        "jobs", "recording", `${input.jobId}.json`,
      );
      await this.store.appendEvent({
        aggregate: ["recordings", input.recordingId],
        event: input.initialEvent,
      });
      await this.store.writeJson(
        { recordingId: input.recordingId, requestSignature: input.requestSignature },
        "index", "recording-idempotency", `${keyHash}.json`,
      );
      return { recording: toRecording(stored), created: true };
    } finally {
      await release();
    }
  }

  async readRecording(id: string): Promise<StoredRecording | null> {
    return this.store.readJson<StoredRecording>("recordings", id, "recording.json");
  }
}

export function toRecording(row: StoredRecording): Recording {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    protocol: row.protocol,
    state: row.state,
    requestedDurationSeconds: row.requestedDurationSeconds,
    requestedStartSeconds: row.requestedStartSeconds,
    ...(row.coverageSeconds === undefined ? {} : { coverageSeconds: row.coverageSeconds }),
    ...(row.totalBytes === undefined ? {} : { totalBytes: row.totalBytes }),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  };
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}