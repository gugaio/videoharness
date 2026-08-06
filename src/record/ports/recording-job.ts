import type { ClaimedRecordingJob, RecordingLifecycleEvent, RecordingTransition } from "../domain/recording-job.js";
import type { RecordedResource } from "../domain/recorded-resource.js";

export type RecordingJobFailureDisposition = "retrying" | "failed" | "lease_lost";

export interface RecordingJobRepository {
  claimNext(workerId: string, leaseMs: number): Promise<ClaimedRecordingJob | null>;
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  transition(jobId: string, workerId: string, leaseMs: number, transition: RecordingTransition): Promise<void>;
  complete(jobId: string, workerId: string, result: { coverageSeconds: number; totalBytes: number; resources: RecordedResource[] }, event: RecordingLifecycleEvent): Promise<void>;
  fail(jobId: string, workerId: string, errorCode: string, errorMessage: string, retryable: boolean): Promise<RecordingJobFailureDisposition>;
}
