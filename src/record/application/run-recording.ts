import { RecordingJobLeaseLostError, type ClaimedRecordingJob, type RecordingTransition } from "../domain/recording-job.js";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import type { WorkerLogger } from "../../infra/logger.js";
import type { RecordingJobRepository } from "../ports/recording-job.js";
import type { RecordingMaterializer } from "../ports/recording-materializer.js";
import type { RecordingStore } from "../ports/recording-store.js";
import type { RecordingObserver } from "../ports/recording-observer.js";

export type RecordingWorker = { runNext(): Promise<boolean> };

/** Runs one durable recording job. The protocol collector is injected so this flow stays deterministic and transport-agnostic. */
export function createRecordingWorker(input: {
  repository: RecordingJobRepository;
  materializer: RecordingMaterializer;
  store: RecordingStore;
  workerId: string;
  leaseMs: number;
  heartbeatMs?: number;
  observer?: RecordingObserver;
  logger?: WorkerLogger;
}): RecordingWorker {
  const heartbeatMs = input.heartbeatMs ?? Math.max(1_000, Math.floor(input.leaseMs / 3));
  const log = input.logger ?? noopLogger;
  return {
    async runNext(): Promise<boolean> {
      const job = await input.repository.claimNext(input.workerId, input.leaseMs);
      if (!job) return false;
      log.info("worker.job_claimed", {
        jobId: job.id,
        jobKind: "recording",
        recordingId: job.recording.id,
        protocol: job.recording.protocol,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      });

      let leaseLost = false;
      let activeHeartbeat: Promise<void> | undefined;
      let published = false;
      const heartbeat = async (): Promise<void> => {
        if (activeHeartbeat || leaseLost) return activeHeartbeat;
        activeHeartbeat = input.repository.heartbeat(job.id, input.workerId, input.leaseMs)
          .then((renewed) => { leaseLost = !renewed; })
          .catch(() => { leaseLost = true; })
          .finally(() => { activeHeartbeat = undefined; });
        return activeHeartbeat;
      };
      const heartbeatTimer = setInterval(() => void heartbeat(), heartbeatMs);

      try {
        await input.observer?.started({ job }).catch(() => undefined);
        await input.repository.transition(job.id, input.workerId, input.leaseMs, validatingTransition(job));
        log.info("recording.state_changed", {
          jobId: job.id,
          recordingId: job.recording.id,
          protocol: job.recording.protocol,
          state: "validating",
          attempt: job.attempts,
        });
        const workspace = await input.store.prepareWorkspace(job.recording.id);
        await input.repository.transition(job.id, input.workerId, input.leaseMs, collectingTransition(job));
        log.info("recording.state_changed", {
          jobId: job.id,
          recordingId: job.recording.id,
          protocol: job.recording.protocol,
          state: "collecting",
          attempt: job.attempts,
        });
        const result = await input.materializer.materialize({
          job,
          workspace,
          onProgress: (event) => {
            if (event.type === "recording.resource_retry") {
              log.warn("recording.resource_retry", {
                jobId: job.id,
                recordingId: job.recording.id,
                ...event.payload,
              });
            } else if (event.type === "recording.variant_started" || event.type === "recording.variant_completed") {
              log.info("recording.variant_progress", {
                jobId: job.id,
                recordingId: job.recording.id,
                ...event.payload,
              });
            }
            return input.repository.transition(job.id, input.workerId, input.leaseMs, {
              state: "collecting",
              event: { actor: "Recorder", ...event, payload: { state: "collecting", ...event.payload } },
            });
          },
        });
        if (leaseLost) throw new RecordingJobLeaseLostError();
        clearInterval(heartbeatTimer);
        await activeHeartbeat;
        if (leaseLost) throw new RecordingJobLeaseLostError();
        await input.store.publish(workspace);
        published = true;
        await input.repository.complete(job.id, input.workerId, result, {
          type: "recording.ready",
          actor: "Recorder",
          message: `The ${job.recording.protocol.toUpperCase()} VOD recording is ready to be served locally.`,
          payload: { state: "ready", coverageSeconds: result.coverageSeconds, totalBytes: result.totalBytes, resourceCount: result.resources.length },
        });
        log.info("recording.ready", {
          jobId: job.id,
          recordingId: job.recording.id,
          protocol: job.recording.protocol,
          coverageSeconds: result.coverageSeconds,
          totalBytes: result.totalBytes,
          resourceCount: result.resources.length,
          attempt: job.attempts,
        });
        try {
          await input.observer?.completed({ job, result });
        } catch (observerError) {
          const message = observerError instanceof Error ? observerError.message : "Experiment clone observer failed";
          await input.observer?.failed({ job, errorCode: "CLONE_OBSERVER_FAILED", errorMessage: message.slice(0, 500) }).catch(() => undefined);
        }
      } catch (error) {
        await input.store.discardWorkspace(job.recording.id).catch(() => undefined);
        if (published) await input.store.removePublished(job.recording.id).catch(() => undefined);
        const failure = classifyFailure(error);
        const disposition = await input.repository.fail(job.id, input.workerId, failure.code, failure.message, failure.retryable);
        log.error("worker.job_failed", {
          jobId: job.id,
          jobKind: "recording",
          recordingId: job.recording.id,
          protocol: job.recording.protocol,
          attempt: job.attempts,
          code: failure.code,
          retryable: failure.retryable,
          disposition,
          message: truncateLogMessage(failure.message),
        });
        if (disposition === "failed") await input.observer?.failed({ job, errorCode: failure.code, errorMessage: failure.message }).catch(() => undefined);
      } finally {
        clearInterval(heartbeatTimer);
        await activeHeartbeat;
      }
      return true;
    },
  };
}

function validatingTransition(job: ClaimedRecordingJob): RecordingTransition {
  return {
    state: "validating",
    event: {
      type: "recording.state_changed", actor: "Recorder", message: `Validating the ${job.recording.protocol.toUpperCase()} source and recording limits.`,
      payload: { state: "validating", protocol: job.recording.protocol },
    },
  };
}

function collectingTransition(job: ClaimedRecordingJob): RecordingTransition {
  return {
    state: "collecting",
    event: {
      type: "recording.state_changed", actor: "Recorder", message: `Collecting a bounded ${job.recording.protocol.toUpperCase()} VOD window into private storage.`,
      payload: { state: "collecting", requestedDurationSeconds: job.recording.requestedDurationSeconds },
    },
  };
}

function classifyFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof RecordingJobLeaseLostError) return { code: "JOB_LEASE_LOST", message: "The worker lease was lost before the recording could be committed.", retryable: true };
  if (error instanceof StreamCollectionError) return { code: error.code, message: error.message.slice(0, 500), retryable: error.retryable };
  const message = error instanceof Error ? error.message : "Recording failed unexpectedly";
  return { code: "RECORDING_FAILED", message: message.slice(0, 500), retryable: true };
}

const noopLogger: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function truncateLogMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}
