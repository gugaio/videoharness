import { randomUUID } from "node:crypto";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import type { WorkerLogger } from "../../infra/logger.js";
import {
  JobLeaseLostError,
  type ClaimedInvestigationJob,
  type InvestigationTransition,
} from "../domain/investigation-job.js";
import type { ArtifactStore } from "../ports/artifact-store.js";
import type { InvestigationJobRepository } from "../ports/investigation-job.js";
import type { ManifestCollector } from "../ports/manifest-collector.js";
import type { MediaProbe, MediaSampleCollector } from "../ports/media-sample-collector.js";
import type { ManifestCollection } from "../ports/manifest-collector.js";
import type { CollectionProgress } from "../ports/manifest-collector.js";
import { buildManifestEvidence } from "./build-manifest-evidence.js";
import { parseReportedContext } from "./parse-reported-context.js";
import type { AbrDecodeTester } from "../../abr/ports/abr-decode-tester.js";
import { attachPriorityAbrDecodeTests } from "../../abr/application/run-decode-tests.js";

export type InvestigationWorker = {
  runNext(): Promise<boolean>;
};

export function createInvestigationWorker(input: {
  repository: InvestigationJobRepository;
  collector: ManifestCollector;
  artifactStore: ArtifactStore;
  mediaCollector?: MediaSampleCollector;
  mediaProbe?: MediaProbe;
  abrDecodeTester?: AbrDecodeTester;
  labWorkspace?: { prepare(investigationId: string, collection: ManifestCollection): Promise<void> };
  workerId: string;
  leaseMs: number;
  heartbeatMs?: number;
  logger?: WorkerLogger;
}): InvestigationWorker {
  const heartbeatMs = input.heartbeatMs ?? Math.max(1_000, Math.floor(input.leaseMs / 3));
  const log = input.logger ?? noopLogger;

  return {
    async runNext(): Promise<boolean> {
      const job = await input.repository.claimNext(input.workerId, input.leaseMs);
      if (!job) return false;
      log.info("worker.job_claimed", {
        jobId: job.id,
        jobKind: "investigation",
        investigationId: job.investigation.id,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      });

      let leaseLost = false;
      let activeHeartbeat: Promise<void> | undefined;
      const uncommittedStorageKeys = new Set<string>();
      const heartbeat = async (): Promise<void> => {
        if (activeHeartbeat || leaseLost) return activeHeartbeat;
        activeHeartbeat = input.repository.heartbeat(job.id, input.workerId, input.leaseMs)
          .then((renewed) => {
            leaseLost = !renewed;
          })
          .catch(() => {
            leaseLost = true;
          })
          .finally(() => {
            activeHeartbeat = undefined;
          });
        return activeHeartbeat;
      };
      const heartbeatTimer = setInterval(() => void heartbeat(), heartbeatMs);

      try {
        await input.repository.transition(
          job.id,
          input.workerId,
          input.leaseMs,
          buildValidatingTransition(job),
        );
        log.info("investigation.state_changed", {
          jobId: job.id,
          investigationId: job.investigation.id,
          state: "validating",
          attempt: job.attempts,
        });
        const onCollectionProgress: (progress: CollectionProgress) => Promise<void> = (progress) => {
          if (progress.limitation) {
            log.warn("investigation.collection_limited", {
              jobId: job.id,
              investigationId: job.investigation.id,
              stage: progress.stage,
              errorCode: progress.limitation.errorCode,
              resourceKind: progress.limitation.resourceKind,
              ...(progress.limitation.logicalKey ? { logicalKey: progress.limitation.logicalKey } : {}),
              ...(progress.limitation.representationId ? { representationId: progress.limitation.representationId } : {}),
              ...(progress.limitation.sourceSegment === undefined ? {} : { sourceSegment: progress.limitation.sourceSegment }),
              ...(progress.completed === undefined ? {} : { completed: progress.completed }),
              ...(progress.total === undefined ? {} : { total: progress.total }),
            });
          }
          return input.repository.transition(job.id, input.workerId, input.leaseMs, {
            state: "collecting",
            event: buildCollectionProgressEvent(progress),
          });
        };
        await input.repository.transition(
          job.id,
          input.workerId,
          input.leaseMs,
          buildCollectingTransition(job),
        );
        log.info("investigation.state_changed", {
          jobId: job.id,
          investigationId: job.investigation.id,
          state: "collecting",
          attempt: job.attempts,
        });
        const collection = await input.collector.collect(job.investigation.sourceUrl, onCollectionProgress);
        if (job.investigation.problemDescription) {
          collection.reportedContext = parseReportedContext(job.investigation.problemDescription);
        }
        let probeCount = 0;
        if (input.mediaCollector && input.mediaProbe) {
          const collectedSamples = await input.mediaCollector.collect(collection, onCollectionProgress);
          collection.mediaSamples = collectedSamples.samples;
          collection.mediaLimitations = collectedSamples.limitations;
          for (const limitation of collectedSamples.limitations) {
            log.warn("investigation.collection_limited", {
              jobId: job.id,
              investigationId: job.investigation.id,
              stage: "media_sample",
              message: truncateLogMessage(limitation),
            });
          }
          const mediaSamples = collection.mediaSamples.filter((entry) => entry.kind === "media-segment");
          for (const [index, sample] of mediaSamples.entries()) {
            const init = collection.mediaSamples.find((entry) =>
              entry.kind === "init-segment" && entry.sourceManifestLogicalKey === sample.sourceManifestLogicalKey
                && entry.representationId === sample.representationId);
            await onCollectionProgress({
              stage: "media_probe",
              message: `Inspecting ${sample.logicalKey} with FFprobe…`,
              completed: index,
              total: mediaSamples.length,
            });
            try {
              sample.probe = await input.mediaProbe.probe({
                investigationId: job.investigation.id,
                sample,
                ...(init ? { initBytes: init.content.bytes } : {}),
              });
              probeCount += 1;
            } catch (error) {
              collection.mediaLimitations.push(`FFprobe could not inspect ${sample.logicalKey}: ${formatProbeFailure(error)}`);
              log.warn("investigation.media_probe_failed", {
                jobId: job.id,
                investigationId: job.investigation.id,
                logicalKey: sample.logicalKey,
                message: formatProbeFailure(error),
              });
            }
          }
        }
        if (input.labWorkspace && collection.manifests[0]?.inspection.protocol === "hls") {
          await input.labWorkspace.prepare(job.investigation.id, collection);
        }
        if (leaseLost) throw new JobLeaseLostError();

        for (const manifest of collection.manifests) {
          const artifactId = randomUUID();
          const stored = await input.artifactStore.put({
            investigationId: job.investigation.id,
            artifactId,
            extension: manifest.inspection.protocol === "hls" ? "m3u8" : "mpd",
            content: manifest.content.bytes,
          });
          uncommittedStorageKeys.add(stored.storageKey);
          manifest.artifact = {
            id: artifactId,
            storageKey: stored.storageKey,
            sizeBytes: stored.sizeBytes,
            ...(stored.sha256 ? { sha256: stored.sha256 } : {}),
          };
        }
        for (const sample of collection.mediaSamples ?? []) {
          const artifactId = randomUUID();
          const stored = await input.artifactStore.put({
            investigationId: job.investigation.id,
            artifactId,
            extension: "bin",
            content: sample.content.bytes,
          });
          uncommittedStorageKeys.add(stored.storageKey);
          sample.artifact = { id: artifactId, storageKey: stored.storageKey, sizeBytes: stored.sizeBytes, ...(stored.sha256 ? { sha256: stored.sha256 } : {}) };
        }
        const evidence = buildManifestEvidence(collection);
        if (input.abrDecodeTester && evidence.dash?.switches?.length) {
          try {
            await attachPriorityAbrDecodeTests(evidence, collection.mediaSamples ?? [], input.abrDecodeTester);
          } catch (error) {
            evidence.limitations.push(`ABR decode tests were unavailable: ${formatProbeFailure(error)}`);
            log.warn("investigation.abr_decode_tests_unavailable", {
              jobId: job.id,
              investigationId: job.investigation.id,
              message: formatProbeFailure(error),
            });
          }
        }
        const rootManifest = evidence.manifests[0]!;
        const recorded = await input.repository.recordEvidenceBatch(
          job.id,
          input.workerId,
          input.leaseMs,
          [
            ...collection.manifests.map((manifest) => {
            if (!manifest.artifact) throw new Error(`Manifest ${manifest.logicalKey} has no artifact`);
            return {
              id: manifest.artifact.id,
              logicalKey: manifest.logicalKey,
              kind: "manifest" as const,
              storageKey: manifest.artifact.storageKey,
              ...(manifest.source.contentType ? { contentType: manifest.source.contentType } : {}),
              sizeBytes: manifest.artifact.sizeBytes,
            };
            }),
            ...(collection.mediaSamples ?? []).map((sample) => {
              if (!sample.artifact) throw new Error(`Media sample ${sample.logicalKey} has no artifact`);
              return {
                id: sample.artifact.id,
                logicalKey: sample.logicalKey,
                kind: sample.kind,
                storageKey: sample.artifact.storageKey,
                sizeBytes: sample.artifact.sizeBytes,
              };
            }),
          ],
          evidence,
          {
            type: "investigation.evidence_found",
            actor: "Media Agent",
            message: `${evidence.manifests.length} ${evidence.source.protocol.toUpperCase()} manifest${evidence.manifests.length === 1 ? "" : "s"} and ${evidence.mediaSamples.length} media sample${evidence.mediaSamples.length === 1 ? "" : "s"} preserved as evidence.`,
            payload: {
              state: "collecting",
              artifactIds: evidence.manifests.map((manifest) => manifest.artifactId),
              logicalKeys: evidence.manifests.map((manifest) => manifest.logicalKey),
              mediaSampleCount: evidence.mediaSamples.length,
              protocol: evidence.source.protocol,
              manifestKind: rootManifest.kind,
              sizeBytes: rootManifest.sizeBytes,
            },
          },
        );
        uncommittedStorageKeys.clear();
        await Promise.all(recorded.supersededStorageKeys.map((storageKey) =>
          input.artifactStore.remove(storageKey).catch(() => undefined)));

        clearInterval(heartbeatTimer);
        await activeHeartbeat;
        if (leaseLost) throw new JobLeaseLostError();
        await input.repository.completeCollection(
          job.id,
          input.workerId,
          {
            type: "investigation.evidence_ready",
            actor: "Media Agent",
            message: "The deterministic stream evidence is ready for inspection.",
            payload: { state: "evidence_ready", snapshotId: recorded.snapshotId, protocol: evidence.source.protocol },
          },
        );
        log.info("investigation.evidence_ready", {
          jobId: job.id,
          investigationId: job.investigation.id,
          protocol: evidence.source.protocol,
          manifestCount: evidence.manifests.length,
          mediaSampleCount: evidence.mediaSamples.length,
          probeCount,
          limitationCount: evidence.limitations.length,
          snapshotId: recorded.snapshotId,
          attempt: job.attempts,
        });
      } catch (error) {
        await Promise.all(Array.from(uncommittedStorageKeys, (storageKey) =>
          input.artifactStore.remove(storageKey).catch(() => undefined)));
        const failure = classifyFailure(error);
        await input.repository.fail(job.id, input.workerId, failure.code, failure.message, failure.retryable);
        log.error("worker.job_failed", {
          jobId: job.id,
          jobKind: "investigation",
          investigationId: job.investigation.id,
          attempt: job.attempts,
          code: failure.code,
          retryable: failure.retryable,
          message: truncateLogMessage(failure.message),
        });
      } finally {
        clearInterval(heartbeatTimer);
        await activeHeartbeat;
      }
      return true;
    },
  };
}

function buildValidatingTransition(job: ClaimedInvestigationJob): InvestigationTransition {
  return {
    state: "validating",
    event: {
      type: "investigation.state_changed",
      actor: "Network Agent",
      message: "Validating the stream destination before any network access.",
      payload: { state: "validating", attempt: job.attempts },
    },
  };
}

function buildCollectingTransition(job: ClaimedInvestigationJob): InvestigationTransition {
  return {
    state: "collecting",
    event: {
      type: "investigation.state_changed",
      actor: "Media Agent",
      message: "Collecting manifests and bounded media samples as evidence.",
      payload: { state: "collecting", attempt: job.attempts },
    },
  };
}

const COLLECTION_PROGRESS_ACTORS: Record<CollectionProgress["stage"], string> = {
  root_manifest: "Network Agent",
  variant_manifest: "Network Agent",
  rendition_manifest: "Network Agent",
  media_sample: "Media Agent",
  media_probe: "Media Agent",
};

function buildCollectionProgressEvent(progress: CollectionProgress): InvestigationTransition["event"] {
  return {
    type: progress.limitation ? "investigation.collection_limited" : "investigation.observation",
    actor: COLLECTION_PROGRESS_ACTORS[progress.stage],
    message: progress.message,
    payload: {
      state: "collecting",
      stage: "collection",
      collectionStage: progress.stage,
      ...(progress.completed === undefined ? {} : { completed: progress.completed }),
      ...(progress.total === undefined ? {} : { total: progress.total }),
      ...(progress.limitation ? { limitation: progress.limitation } : {}),
    },
  };
}

function classifyFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof StreamCollectionError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof JobLeaseLostError) {
    return { code: "JOB_LEASE_LOST", message: error.message, retryable: true };
  }
  return {
    code: "WORKER_PIPELINE_FAILED",
    message: error instanceof Error ? error.message : "Unknown worker failure",
    retryable: true,
  };
}

function formatProbeFailure(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 320) : "Unknown probe failure";
}

const noopLogger: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function truncateLogMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}
