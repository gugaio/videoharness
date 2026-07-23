import { randomUUID } from "node:crypto";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import type { EvidenceBundleV2 } from "../domain/evidence.js";
import {
  JobLeaseLostError,
  type ClaimedInvestigationJob,
  type InvestigationTransition,
} from "../domain/investigation-job.js";
import type { ArtifactStore } from "../ports/artifact-store.js";
import type { InvestigationJobRepository } from "../ports/investigation-job.js";
import type { ManifestCollector } from "../ports/manifest-collector.js";
import type { MediaProbe, MediaSampleCollector } from "../ports/media-sample-collector.js";
import type { AiInvestigationResult, InvestigationAI } from "../ports/investigation-ai.js";
import {
  buildManifestEvidence,
  buildManifestReport,
} from "./build-manifest-evidence.js";

export type InvestigationWorker = {
  runNext(): Promise<boolean>;
};

export function createInvestigationWorker(input: {
  repository: InvestigationJobRepository;
  collector: ManifestCollector;
  artifactStore: ArtifactStore;
  mediaCollector?: MediaSampleCollector;
  mediaProbe?: MediaProbe;
  ai?: InvestigationAI;
  workerId: string;
  leaseMs: number;
  heartbeatMs?: number;
}): InvestigationWorker {
  const heartbeatMs = input.heartbeatMs ?? Math.max(1_000, Math.floor(input.leaseMs / 3));

  return {
    async runNext(): Promise<boolean> {
      const job = await input.repository.claimNext(input.workerId, input.leaseMs);
      if (!job) return false;

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
        const collection = await input.collector.collect(job.investigation.sourceUrl);
        if (input.mediaCollector && input.mediaProbe) {
          const collectedSamples = await input.mediaCollector.collect(collection);
          collection.mediaSamples = collectedSamples.samples;
          collection.mediaLimitations = collectedSamples.limitations;
          for (const sample of collection.mediaSamples.filter((entry) => entry.kind === "media-segment")) {
            const init = collection.mediaSamples.find((entry) =>
              entry.kind === "init-segment" && entry.sourceManifestLogicalKey === sample.sourceManifestLogicalKey);
            try {
              sample.probe = await input.mediaProbe.probe({
                investigationId: job.investigation.id,
                sample,
                ...(init ? { initBytes: init.content.bytes } : {}),
              });
            } catch (error) {
              collection.mediaLimitations.push(`FFprobe could not inspect ${sample.logicalKey}: ${formatProbeFailure(error)}`);
            }
          }
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
          sample.artifact = { id: artifactId, storageKey: stored.storageKey, sizeBytes: stored.sizeBytes };
        }
        const evidence = buildManifestEvidence(collection);
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

        await input.repository.transition(
          job.id,
          input.workerId,
          input.leaseMs,
          buildAnalyzingTransition(evidence),
        );
        let aiResult: AiInvestigationResult | undefined;
        if (input.ai) {
          await input.repository.transition(job.id, input.workerId, input.leaseMs, {
            state: "analyzing",
            event: {
              type: "investigation.observation",
              actor: "AI Investigation Team",
              message: "Specialists are correlating the deterministic evidence.",
              payload: { state: "analyzing", stage: "ai_specialists" },
            },
          });
          aiResult = await input.ai.investigate({
            investigationId: job.investigation.id,
            ...(job.investigation.problemDescription ? { problemDescription: job.investigation.problemDescription } : {}),
            evidence,
          });
          await input.repository.transition(job.id, input.workerId, input.leaseMs, {
            state: "analyzing",
            event: {
              type: "investigation.observation",
              actor: "AI Investigation Team",
              message: aiResult.available
                ? `${aiResult.agents.filter((agent) => agent.state === "completed").length} AI agent runs completed.`
                : "AI analysis is unavailable; retaining the deterministic report.",
              payload: { state: "analyzing", stage: "ai_complete", available: aiResult.available },
            },
          });
        }
        await input.repository.transition(
          job.id,
          input.workerId,
          input.leaseMs,
          buildSynthesizingTransition(),
        );
        clearInterval(heartbeatTimer);
        await activeHeartbeat;
        if (leaseLost) throw new JobLeaseLostError();
        await input.repository.complete(
          job.id,
          input.workerId,
          randomUUID(),
          buildManifestReport(job, evidence, aiResult),
          {
            type: "investigation.report_ready",
            actor: "Investigator",
            message: "The deterministic media evidence report is ready.",
            payload: { state: "completed", placeholder: false, protocol: evidence.source.protocol },
          },
        );
      } catch (error) {
        await Promise.all(Array.from(uncommittedStorageKeys, (storageKey) =>
          input.artifactStore.remove(storageKey).catch(() => undefined)));
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

function buildAnalyzingTransition(evidence: EvidenceBundleV2): InvestigationTransition {
  const rootManifest = evidence.manifests[0]!;
  const count = rootManifest.variantCount
    ?? rootManifest.representationCount
    ?? rootManifest.segmentCount
    ?? 0;
  return {
    state: "analyzing",
    event: {
      type: "investigation.observation",
      actor: "Playback Agent",
      message: `Manifest structure identified deterministically with ${count} primary entries and ${evidence.manifests.length} preserved manifest${evidence.manifests.length === 1 ? "" : "s"}.`,
      payload: {
        state: "analyzing",
        protocol: evidence.source.protocol,
        manifestKind: rootManifest.kind,
        entryCount: count,
      },
    },
  };
}

function buildSynthesizingTransition(): InvestigationTransition {
  return {
    state: "synthesizing",
    event: {
      type: "investigation.state_changed",
      actor: "Investigator",
      message: "Preparing a report from the collected manifest evidence.",
      payload: { state: "synthesizing" },
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
