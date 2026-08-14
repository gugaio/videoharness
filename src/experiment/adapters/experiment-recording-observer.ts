import type { FilesystemRecordingStore } from "../../record/adapters/filesystem-recording-store.js";
import type { RecordingObserver } from "../../record/ports/recording-observer.js";
import type { ExperimentRepository } from "../ports/experiment-repository.js";
import { verifyCloneOutput } from "../application/verify-clone.js";

type ObserverLogger = {
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
};

export class ExperimentRecordingObserver implements RecordingObserver {
  constructor(
    private readonly repository: ExperimentRepository,
    private readonly store: FilesystemRecordingStore,
    private readonly logger: ObserverLogger,
  ) {}

  async started({ job }: Parameters<RecordingObserver["started"]>[0]): Promise<void> {
    await this.repository.markCloneStarted(job.recording.id, job.id);
    const clone = await this.repository.findCloneByRecordingId(job.recording.id);
    if (clone) this.logger.info("experiment.clone_job_started", ids(clone, { jobId: job.id }));
  }

  async completed({ job, result }: Parameters<RecordingObserver["completed"]>[0]): Promise<void> {
    const clone = await this.repository.findCloneByRecordingId(job.recording.id);
    if (!clone) return;
    await this.repository.markCloneVerifying(job.recording.id);
    const manifestPath = clone.executionPlan.protocol === "dash" ? "index.mpd" : "index.m3u8";
    let verification;
    try {
      const manifestBytes = await this.store.readPublishedRecordingResource(job.recording.id, manifestPath);
      verification = verifyCloneOutput({
        spec: clone.spec,
        plan: clone.executionPlan,
        manifestText: new TextDecoder().decode(manifestBytes),
        resources: result.resources,
      });
    } catch (error) {
      verification = {
        verifiedAt: new Date().toISOString(),
        status: "FAILED" as const,
        manifest: {},
        requested: {
          videoRepresentationIds: clone.executionPlan.selection.videoRepresentationIds,
          audioMode: clone.executionPlan.selection.audioMode,
        },
        outputArtifactIds: result.resources.map((entry) => entry.id),
        warnings: [],
        errors: [error instanceof Error ? error.message : "Clone verification failed unexpectedly."],
      };
    }
    await this.repository.completeClone({
      recordingId: job.recording.id,
      verification,
      provenance: {
        endedAt: new Date().toISOString(),
        jobId: job.id,
        generatedPlan: clone.executionPlan,
        outputDeterministicArtifactIds: result.resources.map((entry) => entry.id),
        manifestDiff: { type: "declarative", transformations: clone.executionPlan.transformations },
        workerLogs: [{ event: "recording.completed", jobId: job.id, at: new Date().toISOString(), resourceCount: result.resources.length }],
        coverageSeconds: result.coverageSeconds,
        totalBytes: result.totalBytes,
      },
    });
    const details = ids(clone, { jobId: job.id, verificationStatus: verification.status, errorCount: verification.errors.length });
    if (verification.status === "PASSED") this.logger.info("experiment.clone_verification_completed", details);
    else this.logger.warn("experiment.clone_verification_failed", details);
  }

  async failed({ job, errorCode, errorMessage }: Parameters<RecordingObserver["failed"]>[0]): Promise<void> {
    const clone = await this.repository.findCloneByRecordingId(job.recording.id);
    if (!clone) return;
    await this.repository.failClone({
      recordingId: job.recording.id,
      errorCode,
      errorMessage,
      provenance: { endedAt: new Date().toISOString(), jobId: job.id, workerLogs: [{ event: "recording.failed", jobId: job.id, at: new Date().toISOString(), errorCode }] },
    });
    this.logger.warn("experiment.clone_job_failed", ids(clone, { jobId: job.id, errorCode }));
  }
}

function ids(clone: { id: string; experimentId: string; iterationId: string }, extra: Record<string, unknown>): Record<string, unknown> {
  return { experimentId: clone.experimentId, iterationId: clone.iterationId, cloneId: clone.id, ...extra };
}
