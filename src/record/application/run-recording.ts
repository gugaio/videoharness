import { RecordingJobLeaseLostError, type ClaimedRecordingJob, type RecordingTransition } from "../domain/recording-job.js";
import type { RecordingJobRepository } from "../ports/recording-job.js";
import type { RecordingMaterializer } from "../ports/recording-materializer.js";
import type { RecordingStore } from "../ports/recording-store.js";

export type RecordingWorker = { runNext(): Promise<boolean> };

/** Runs one durable recording job. The HLS collector is injected so this flow stays deterministic and transport-agnostic. */
export function createRecordingWorker(input: {
  repository: RecordingJobRepository;
  materializer: RecordingMaterializer;
  store: RecordingStore;
  workerId: string;
  leaseMs: number;
  heartbeatMs?: number;
}): RecordingWorker {
  const heartbeatMs = input.heartbeatMs ?? Math.max(1_000, Math.floor(input.leaseMs / 3));
  return {
    async runNext(): Promise<boolean> {
      const job = await input.repository.claimNext(input.workerId, input.leaseMs);
      if (!job) return false;

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
        await input.repository.transition(job.id, input.workerId, input.leaseMs, validatingTransition(job));
        const workspace = await input.store.prepareWorkspace(job.recording.id);
        await input.repository.transition(job.id, input.workerId, input.leaseMs, collectingTransition(job));
        const result = await input.materializer.materialize({
          job,
          workspace,
          onProgress: (event) => input.repository.transition(job.id, input.workerId, input.leaseMs, {
            state: "collecting",
            event: { actor: "Recorder", ...event, payload: { state: "collecting", ...event.payload } },
          }),
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
          message: "The HLS VOD recording is ready to be served locally.",
          payload: { state: "ready", coverageSeconds: result.coverageSeconds, totalBytes: result.totalBytes, resourceCount: result.resources.length },
        });
      } catch (error) {
        await input.store.discardWorkspace(job.recording.id).catch(() => undefined);
        if (published) await input.store.removePublished(job.recording.id).catch(() => undefined);
        const failure = classifyFailure(error);
        await input.repository.fail(job.id, input.workerId, failure.code, failure.message, failure.retryable);
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
      type: "recording.state_changed", actor: "Recorder", message: "Validating the HLS source and recording limits.",
      payload: { state: "validating", protocol: job.recording.protocol },
    },
  };
}

function collectingTransition(job: ClaimedRecordingJob): RecordingTransition {
  return {
    state: "collecting",
    event: {
      type: "recording.state_changed", actor: "Recorder", message: "Collecting a bounded HLS VOD window into private storage.",
      payload: { state: "collecting", requestedDurationSeconds: job.recording.requestedDurationSeconds },
    },
  };
}

function classifyFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof RecordingJobLeaseLostError) return { code: "JOB_LEASE_LOST", message: "The worker lease was lost before the recording could be committed.", retryable: true };
  const message = error instanceof Error ? error.message : "Recording failed unexpectedly";
  return { code: "RECORDING_FAILED", message: message.slice(0, 500), retryable: true };
}
