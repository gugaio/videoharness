import { JsonStore } from "../../store/json-file.js";
import { CloneExecutionPlanSchema } from "../../contracts/experiment.js";
import type { CloneExecutionPlan } from "../../experiment/domain/clone-spec.js";
import { RecordingJobLeaseLostError, type ClaimedRecordingJob, type RecordingLifecycleEvent, type RecordingTransition } from "../domain/recording-job.js";
import type { RecordingJobFailureDisposition, RecordingJobRepository } from "../ports/recording-job.js";
import type { RecordedResource } from "../domain/recorded-resource.js";
import type { StoredRecording } from "./filesystem-recording-intake.js";

type StoredJob = {
  id: string;
  kind: "recording";
  recordingId: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  lockedBy?: string;
  lockedUntil?: string;
  heartbeatAt?: string;
  startedAt?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
};

export class FilesystemRecordingJobRepository implements RecordingJobRepository {
  constructor(private readonly store: JsonStore) {}

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedRecordingJob | null> {
    const release = await this.store.acquireLock("locks/job-claim-recording");
    try {
      const files = await this.store.listFiles("jobs", "recording");
      const now = Date.now();
      const candidates: Array<{ file: string; job: StoredJob }> = [];
      for (const file of files) {
        const job = await this.store.readJson<StoredJob>("jobs", "recording", file);
        if (!job) continue;
        const pending = job.status === "pending";
        const expired = job.status === "running" && job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < now;
        if ((!pending && !expired) || job.attempts >= job.maxAttempts) continue;
        candidates.push({ file, job });
      }
      candidates.sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt));
      for (const candidate of candidates) {
        const jobLock = await this.store.acquireLock(`locks/job-recording-${candidate.job.id}`);
        try {
          const fresh = await this.store.readJson<StoredJob>("jobs", "recording", candidate.file);
          if (!fresh) continue;
          const stillPending = fresh.status === "pending";
          const stillExpired = fresh.status === "running" && fresh.lockedUntil !== undefined && new Date(fresh.lockedUntil).getTime() < now;
          if ((!stillPending && !stillExpired) || fresh.attempts >= fresh.maxAttempts) continue;
          const { errorCode: _previousErrorCode, errorMessage: _previousErrorMessage, ...claimBase } = fresh;
          const claimed: StoredJob = {
            ...claimBase,
            status: "running",
            attempts: fresh.attempts + 1,
            lockedBy: workerId,
            lockedUntil: new Date(now + leaseMs).toISOString(),
            heartbeatAt: new Date().toISOString(),
            startedAt: fresh.startedAt ?? new Date().toISOString(),
          };
          await this.store.writeJson(claimed, "jobs", "recording", candidate.file);
          const recording = await this.store.readJson<StoredRecording>("recordings", fresh.recordingId, "recording.json");
          if (!recording) continue;
          return {
            id: fresh.id,
            attempts: claimed.attempts,
            maxAttempts: fresh.maxAttempts,
            recording: {
              id: recording.id,
              sourceUrl: recording.sourceUrl,
              protocol: recording.protocol,
              requestedDurationSeconds: recording.requestedDurationSeconds,
              requestedStartSeconds: recording.requestedStartSeconds,
              ...(recording.clonePlan === undefined
                ? {}
                : { clonePlan: CloneExecutionPlanSchema.parse(recording.clonePlan) as unknown as CloneExecutionPlan }),
            },
          };
        } finally {
          await jobLock();
        }
      }
      return null;
    } finally {
      await release();
    }
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const release = await this.store.acquireLock(`locks/job-heartbeat-${jobId}`);
    try {
      const job = await this.loadJob(jobId);
      if (!job || job.status !== "running" || job.lockedBy !== workerId) return false;
      if (job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < Date.now()) return false;
      await this.store.writeJson(
        { ...job, heartbeatAt: new Date().toISOString(), lockedUntil: new Date(Date.now() + leaseMs).toISOString() },
        "jobs", "recording", `${jobId}.json`,
      );
      return true;
    } finally {
      await release();
    }
  }

  async transition(jobId: string, workerId: string, leaseMs: number, transition: RecordingTransition): Promise<void> {
    const job = await this.renewAndLoad(jobId, workerId, leaseMs);
    await this.mutateAggregate(job.recordingId, async () => {
      const recording = await this.readRecording(job.recordingId);
      if (!recording) throw new Error("Recording missing during transition");
      await this.store.writeJson(
        { ...recording, state: transition.state, updatedAt: new Date().toISOString() },
        "recordings", job.recordingId, "recording.json",
      );
      await this.appendEvent(job.recordingId, transition.event);
    });
  }

  async complete(
    jobId: string,
    workerId: string,
    result: { coverageSeconds: number; totalBytes: number; resources: RecordedResource[] },
    event: RecordingLifecycleEvent,
  ): Promise<void> {
    if (result.resources.length === 0) throw new Error("A recording must include at least one registered resource");
    const job = await this.assertLeaseAndLoad(jobId, workerId);
    await this.mutateAggregate(job.recordingId, async () => {
      const recording = await this.readRecording(job.recordingId);
      if (!recording) throw new Error("Recording missing during completion");
      await this.store.writeJson(
        {
          ...recording,
          state: "ready",
          coverageSeconds: result.coverageSeconds,
          totalBytes: result.totalBytes,
          errorCode: undefined,
          errorMessage: undefined,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
        "recordings", job.recordingId, "recording.json",
      );
      const resources = await this.store.readJson<RecordedResource[]>("recordings", job.recordingId, "resources.json") ?? [];
      await this.store.writeJson(
        [...resources.filter((entry) => !result.resources.some((resource) => resource.logicalPath === entry.logicalPath)), ...result.resources],
        "recordings", job.recordingId, "resources.json",
      );
      await this.store.writeJson(
        { ...job, status: "completed", completedAt: new Date().toISOString(), lockedBy: undefined, lockedUntil: undefined, errorCode: undefined, errorMessage: undefined },
        "jobs", "recording", `${jobId}.json`,
      );
      await this.appendEvent(job.recordingId, event);
    });
  }

  async fail(jobId: string, workerId: string, errorCode: string, errorMessage: string, retryable: boolean): Promise<RecordingJobFailureDisposition> {
    const job = await this.loadJob(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) return "lease_lost";
    if (job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < Date.now()) return "lease_lost";

    const finalFailure = !retryable || job.attempts >= job.maxAttempts;
    const disposition: RecordingJobFailureDisposition = finalFailure ? "failed" : "retrying";
    await this.mutateAggregate(job.recordingId, async () => {
      await this.store.writeJson(
        {
          ...job,
          status: finalFailure ? "failed" : "pending",
          lockedBy: undefined,
          lockedUntil: undefined,
          errorCode,
          errorMessage,
          completedAt: finalFailure ? new Date().toISOString() : undefined,
        },
        "jobs", "recording", `${jobId}.json`,
      );
      const recording = await this.readRecording(job.recordingId);
      if (recording) {
        await this.store.writeJson(
          {
            ...recording,
            state: finalFailure ? "failed" : "queued",
            updatedAt: new Date().toISOString(),
            ...(finalFailure
              ? { errorCode, errorMessage, completedAt: new Date().toISOString() }
              : { errorCode: undefined, errorMessage: undefined }),
          },
          "recordings", job.recordingId, "recording.json",
        );
      }
      await this.appendEvent(job.recordingId, finalFailure
        ? { type: "recording.failed", actor: "system", message: errorMessage, payload: { state: "failed", errorCode } }
        : {
            type: "recording.retry_scheduled",
            actor: "system",
            message: `${errorMessage} The recording was safely queued for another attempt.`,
            payload: { state: "queued", errorCode, nextAttempt: job.attempts + 1 },
          });
    });
    return disposition;
  }

  private async renewAndLoad(jobId: string, workerId: string, leaseMs: number): Promise<StoredJob> {
    const job = await this.assertLeaseAndLoad(jobId, workerId);
    await this.store.writeJson(
      { ...job, heartbeatAt: new Date().toISOString(), lockedUntil: new Date(Date.now() + leaseMs).toISOString() },
      "jobs", "recording", `${jobId}.json`,
    );
    return job;
  }

  private async assertLeaseAndLoad(jobId: string, workerId: string): Promise<StoredJob> {
    const job = await this.loadJob(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) throw new RecordingJobLeaseLostError();
    if (job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < Date.now()) throw new RecordingJobLeaseLostError();
    return job;
  }

  private async loadJob(jobId: string): Promise<StoredJob | null> {
    return this.store.readJson<StoredJob>("jobs", "recording", `${jobId}.json`);
  }

  private async readRecording(id: string): Promise<StoredRecording | null> {
    return this.store.readJson<StoredRecording>("recordings", id, "recording.json");
  }

  private async mutateAggregate(recordingId: string, fn: () => Promise<void>): Promise<void> {
    await this.store.mutate(`locks/recording-${recordingId}`, fn);
  }

  private async appendEvent(recordingId: string, event: RecordingLifecycleEvent): Promise<void> {
    await this.store.appendEventUnlocked({
      aggregate: ["recordings", recordingId],
      event,
    });
  }
}