import type {
  ClaimedInvestigationJob,
  InvestigationLifecycleEvent,
  InvestigationTransition,
} from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type { EvidenceBundle } from "../domain/evidence.js";
import type { EvidenceBundleV2 } from "../domain/evidence.js";
import type { AiPromptAudit } from "../../agents/domain/types.js";

export type JobFailureDisposition = "retrying" | "failed" | "lease_lost";

export type EvidenceArtifactRecord = {
  id: string;
  logicalKey: string;
  kind: "manifest" | "init-segment" | "media-segment";
  storageKey: string;
  contentType?: string;
  sizeBytes: number;
};

export type RecordEvidenceResult = {
  snapshotId: string;
  supersededStorageKeys: string[];
};

export type EvidenceSnapshot = {
  id: string;
  evidence: EvidenceBundleV2;
};

export interface InvestigationJobRepository {
  claimNext(workerId: string, leaseMs: number): Promise<ClaimedInvestigationJob | null>;
  claimNextAnalysis(workerId: string, leaseMs: number): Promise<ClaimedInvestigationJob | null>;
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  transition(
    jobId: string,
    workerId: string,
    leaseMs: number,
    transition: InvestigationTransition,
  ): Promise<void>;
  recordEvidenceBatch(
    jobId: string,
    workerId: string,
    leaseMs: number,
    artifacts: EvidenceArtifactRecord[],
    evidence: EvidenceBundle,
    event: InvestigationLifecycleEvent,
  ): Promise<RecordEvidenceResult>;
  recordAgentRuns(
    jobId: string,
    workerId: string,
    leaseMs: number,
    snapshotId: string,
    runs: AiPromptAudit[],
  ): Promise<void>;
  loadLatestEvidence(investigationId: string): Promise<EvidenceSnapshot | null>;
  completeCollection(
    jobId: string,
    workerId: string,
    event: InvestigationLifecycleEvent,
  ): Promise<void>;
  complete(
    jobId: string,
    workerId: string,
    reportId: string,
    report: InvestigationReportContent,
    event: InvestigationLifecycleEvent,
  ): Promise<void>;
  fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    errorMessage: string,
    retryable: boolean,
  ): Promise<JobFailureDisposition>;
}
