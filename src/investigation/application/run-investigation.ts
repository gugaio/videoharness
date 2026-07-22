import { randomUUID } from "node:crypto";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import type { EvidenceBundle } from "../domain/evidence.js";
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
      let uncommittedStorageKey: string | undefined;
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
        uncommittedStorageKey = stored.storageKey;
        const evidence = createEvidenceBundle(artifactId, stored.sizeBytes, collected);
        await input.repository.recordEvidence(
          job.id,
          input.workerId,
          input.leaseMs,
          {
            id: artifactId,
            storageKey: stored.storageKey,
            ...(collected.contentType ? { contentType: collected.contentType } : {}),
            sizeBytes: stored.sizeBytes,
            evidence,
          },
          {
            type: "investigation.evidence_found",
            actor: "Media Agent",
            message: `${evidence.source.protocol.toUpperCase()} ${evidence.manifest.kind} manifest collected and preserved as evidence.`,
            payload: {
              state: "collecting",
              artifactId,
              protocol: evidence.source.protocol,
              manifestKind: evidence.manifest.kind,
              sizeBytes: evidence.manifest.sizeBytes,
            },
          },
        );
        uncommittedStorageKey = undefined;

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
        if (uncommittedStorageKey) await input.artifactStore.remove(uncommittedStorageKey).catch(() => undefined);
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

function analysisTransition(evidence: EvidenceBundle): InvestigationTransition {
  const count = evidence.manifest.variantCount
    ?? evidence.manifest.representationCount
    ?? evidence.manifest.segmentCount
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
        manifestKind: evidence.manifest.kind,
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
): EvidenceBundle {
  return {
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    source: {
      requestedUrl: collected.requestedUrl,
      finalUrl: collected.finalUrl,
      protocol: collected.inspection.protocol,
      httpStatus: collected.statusCode,
      ...(collected.contentType ? { contentType: collected.contentType } : {}),
    },
    manifest: {
      artifactId,
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
    },
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
  evidence: EvidenceBundle,
): InvestigationReportContent {
  return {
    placeholder: false,
    title: `${evidence.source.protocol.toUpperCase()} manifest collected`,
    summary: `The root ${evidence.manifest.kind} manifest was fetched through the protected network boundary and preserved as evidence.`,
    ...(job.investigation.problemDescription
      ? { problemReported: job.investigation.problemDescription }
      : {}),
    findings: [
      {
        title: "Manifest detected",
        status: "observed",
        explanation: `${evidence.source.protocol.toUpperCase()} ${evidence.manifest.kind}, ${evidence.manifest.sizeBytes} bytes.`,
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
    generatedBy: "deterministic-manifest-v1",
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
