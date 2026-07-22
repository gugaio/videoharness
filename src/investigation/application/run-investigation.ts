import { randomUUID } from "node:crypto";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import type { EvidenceBundleV2, ManifestEvidence } from "../domain/evidence.js";
import {
  JobLeaseLostError,
  type ClaimedInvestigationJob,
  type InvestigationTransition,
} from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type { ArtifactStore } from "../ports/artifact-store.js";
import type { InvestigationJobRepository } from "../ports/investigation-job.js";
import type { StreamEvidenceCollector } from "../ports/stream-evidence-collector.js";

export type InvestigationWorker = {
  runNext(): Promise<boolean>;
};

export function createInvestigationWorker(input: {
  repository: InvestigationJobRepository;
  collector: StreamEvidenceCollector;
  artifactStore: ArtifactStore;
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
        await persistTransition(input.repository, job, input.workerId, input.leaseMs, validatingTransition(job));
        const collected = await input.collector.collectManifest(job.investigation.sourceUrl);
        if (leaseLost) throw new JobLeaseLostError();

        const artifactId = randomUUID();
        const stored = await input.artifactStore.put({
          investigationId: job.investigation.id,
          artifactId,
          extension: collected.inspection.protocol === "hls" ? "m3u8" : "mpd",
          content: collected.bytes,
        });
        uncommittedStorageKeys.add(stored.storageKey);
        const evidence = createEvidenceBundle(artifactId, stored.sizeBytes, collected);
        const rootManifest = evidence.manifests[0]!;
        const recorded = await input.repository.recordEvidenceBatch(
          job.id,
          input.workerId,
          input.leaseMs,
          [{
            id: artifactId,
            logicalKey: rootManifest.logicalKey,
            kind: "manifest",
            storageKey: stored.storageKey,
            ...(collected.contentType ? { contentType: collected.contentType } : {}),
            sizeBytes: stored.sizeBytes,
          }],
          evidence,
          {
            type: "investigation.evidence_found",
            actor: "Media Agent",
            message: `${evidence.source.protocol.toUpperCase()} ${rootManifest.kind} manifest collected and preserved as evidence.`,
            payload: {
              state: "collecting",
              artifactId,
              logicalKey: rootManifest.logicalKey,
              protocol: evidence.source.protocol,
              manifestKind: rootManifest.kind,
              sizeBytes: rootManifest.sizeBytes,
            },
          },
        );
        uncommittedStorageKeys.clear();
        await Promise.all(recorded.supersededStorageKeys.map((storageKey) =>
          input.artifactStore.remove(storageKey).catch(() => undefined)));

        await persistTransition(input.repository, job, input.workerId, input.leaseMs, analysisTransition(evidence));
        await persistTransition(input.repository, job, input.workerId, input.leaseMs, synthesisTransition());
        clearInterval(heartbeatTimer);
        await activeHeartbeat;
        if (leaseLost) throw new JobLeaseLostError();
        await input.repository.complete(
          job.id,
          input.workerId,
          randomUUID(),
          createManifestReport(job, evidence),
          {
            type: "investigation.report_ready",
            actor: "Investigator",
            message: "The deterministic manifest report is ready.",
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

async function persistTransition(
  repository: InvestigationJobRepository,
  job: ClaimedInvestigationJob,
  workerId: string,
  leaseMs: number,
  transition: InvestigationTransition,
): Promise<void> {
  await repository.transition(job.id, workerId, leaseMs, transition);
}

function validatingTransition(job: ClaimedInvestigationJob): InvestigationTransition {
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

function analysisTransition(evidence: EvidenceBundleV2): InvestigationTransition {
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
      message: `Manifest structure identified deterministically with ${count} primary entries.`,
      payload: {
        state: "analyzing",
        protocol: evidence.source.protocol,
        manifestKind: rootManifest.kind,
        entryCount: count,
      },
    },
  };
}

function synthesisTransition(): InvestigationTransition {
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

function createEvidenceBundle(
  artifactId: string,
  sizeBytes: number,
  collected: Awaited<ReturnType<StreamEvidenceCollector["collectManifest"]>>,
): EvidenceBundleV2 {
  return {
    schemaVersion: 2,
    collectedAt: new Date().toISOString(),
    source: {
      requestedUrl: collected.requestedUrl,
      finalUrl: collected.finalUrl,
      protocol: collected.inspection.protocol,
      httpStatus: collected.statusCode,
      ...(collected.contentType ? { contentType: collected.contentType } : {}),
    },
    manifests: [{
      artifactId,
      logicalKey: "manifest/root",
      role: "root",
      requestedUrl: collected.requestedUrl,
      finalUrl: collected.finalUrl,
      kind: collected.inspection.kind,
      sizeBytes,
      ...(collected.inspection.variantCount !== undefined
        ? { variantCount: collected.inspection.variantCount }
        : {}),
      ...(collected.inspection.segmentCount !== undefined
        ? { segmentCount: collected.inspection.segmentCount }
        : {}),
      ...(collected.inspection.representationCount !== undefined
        ? { representationCount: collected.inspection.representationCount }
        : {}),
    }],
    mediaSamples: [],
    observations: [{
      code: "MANIFEST_DETECTED",
      severity: "info",
      message: `${collected.inspection.protocol.toUpperCase()} ${collected.inspection.kind} manifest detected.`,
    }],
    limitations: [
      "Only the root manifest was collected in this investigation phase.",
      "Segments, codecs, timestamps and playback behavior were not analyzed yet.",
    ],
  };
}

function createManifestReport(
  job: ClaimedInvestigationJob,
  evidence: EvidenceBundleV2,
): InvestigationReportContent {
  const rootManifest: ManifestEvidence = evidence.manifests[0]!;
  return {
    placeholder: false,
    title: `${evidence.source.protocol.toUpperCase()} manifest collected`,
    summary: `The root ${rootManifest.kind} manifest was fetched through the protected network boundary and preserved as evidence.`,
    ...(job.investigation.problemDescription
      ? { problemReported: job.investigation.problemDescription }
      : {}),
    findings: [
      {
        title: "Manifest detected",
        status: "observed",
        explanation: `${evidence.source.protocol.toUpperCase()} ${rootManifest.kind}, ${rootManifest.sizeBytes} bytes.`,
      },
      {
        title: "Current analysis boundary",
        status: "limitation",
        explanation: evidence.limitations.join(" "),
      },
    ],
    confidence: {
      level: "limited",
      explanation: "The manifest format is directly observed, but root-cause confidence requires segment and media evidence.",
    },
    evidence,
    generatedBy: "deterministic-manifest-v2",
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
