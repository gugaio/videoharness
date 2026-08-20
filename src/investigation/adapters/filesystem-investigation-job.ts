import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import { JobLeaseLostError, type ClaimedInvestigationJob, type InvestigationTransition } from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type {
  InvestigationJobRepository,
  JobFailureDisposition,
  EvidenceArtifactRecord,
  EvidenceSnapshot,
} from "../ports/investigation-job.js";
import { EvidenceBundleV2Schema } from "../../contracts/investigation.js";
import type { EvidenceBundleV2 } from "../domain/evidence.js";
import type { AiPromptAudit } from "../../agents/domain/types.js";

type StoredJob = {
  id: string;
  kind: "investigation" | "investigation-analysis";
  investigationId: string;
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
  payload: Record<string, unknown>;
  createdAt: string;
};

type StoredInvestigation = {
  id: string;
  sourceUrl: string;
  problemDescription?: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type StoredArtifact = EvidenceArtifactRecord & { createdAt: string };

export class FilesystemInvestigationJobRepository implements InvestigationJobRepository {
  constructor(private readonly store: JsonStore) {}

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedInvestigationJob | null> {
    return this.claimNextByKind("investigation", workerId, leaseMs);
  }

  async claimNextAnalysis(workerId: string, leaseMs: number): Promise<ClaimedInvestigationJob | null> {
    return this.claimNextByKind("investigation-analysis", workerId, leaseMs);
  }

  private async claimNextByKind(
    kind: "investigation" | "investigation-analysis",
    workerId: string,
    leaseMs: number,
  ): Promise<ClaimedInvestigationJob | null> {
    const release = await this.store.acquireLock(`locks/job-claim-${kind}`);
    try {
      await this.failAbandonedExhaustedJobs(kind);
      const files = await this.store.listFiles("jobs", kind);
      const now = Date.now();
      const candidates: Array<{ file: string; job: StoredJob }> = [];
      for (const file of files) {
        const job = await this.store.readJson<StoredJob>("jobs", kind, file);
        if (!job) continue;
        const pending = job.status === "pending";
        const expired = job.status === "running" && job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < now;
        if ((!pending && !expired) || job.attempts >= job.maxAttempts) continue;
        candidates.push({ file, job });
      }
      candidates.sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt));
      for (const candidate of candidates) {
        const jobLock = await this.store.acquireLock(`locks/job-${kind}-${candidate.job.id}`);
        try {
          const fresh = await this.store.readJson<StoredJob>("jobs", kind, candidate.file);
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
          await this.store.writeJson(claimed, "jobs", kind, candidate.file);
          const investigation = await this.store.readJson<StoredInvestigation>(
            "investigations", fresh.investigationId, "investigation.json",
          );
          if (!investigation) continue;
          return {
            id: fresh.id,
            attempts: claimed.attempts,
            maxAttempts: fresh.maxAttempts,
            investigation: {
              id: investigation.id,
              sourceUrl: investigation.sourceUrl,
              ...(investigation.problemDescription ? { problemDescription: investigation.problemDescription } : {}),
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
        "jobs", job.kind, `${jobId}.json`,
      );
      return true;
    } finally {
      await release();
    }
  }

  async transition(
    jobId: string,
    workerId: string,
    leaseMs: number,
    transition: InvestigationTransition,
  ): Promise<void> {
    const job = await this.renewAndLoad(jobId, workerId, leaseMs);
    await this.mutateAggregate(job.investigationId, async () => {
      const investigation = await this.readInvestigation(job.investigationId);
      if (!investigation) throw new Error("Investigation missing during transition");
      await this.store.writeJson(
        { ...investigation, state: transition.state, updatedAt: new Date().toISOString() },
        "investigations", job.investigationId, "investigation.json",
      );
      await this.appendEvent(job.investigationId, transition.event);
    });
  }

  async recordEvidenceBatch(
    jobId: string,
    workerId: string,
    leaseMs: number,
    artifacts: EvidenceArtifactRecord[],
    evidence: EvidenceBundleV2,
    event: Parameters<InvestigationJobRepository["recordEvidenceBatch"]>[5],
  ): Promise<{ snapshotId: string; supersededStorageKeys: string[] }> {
    if (artifacts.length === 0) throw new Error("At least one evidence artifact is required");
    const logicalKeys = artifacts.map((artifact) => artifact.logicalKey);
    if (new Set(logicalKeys).size !== logicalKeys.length) {
      throw new Error("Evidence artifact logical keys must be unique within a batch");
    }
    const job = await this.renewAndLoad(jobId, workerId, leaseMs);
    let supersededStorageKeys: string[] = [];
    await this.mutateAggregate(job.investigationId, async () => {
      const existing = await this.store.readJson<StoredArtifact[]>(
        "investigations", job.investigationId, "artifacts.json",
      ) ?? [];
      const byKey = new Map(existing.map((artifact) => [artifact.logicalKey, artifact]));
      const now = new Date().toISOString();
      for (const artifact of artifacts) {
        const previous = byKey.get(artifact.logicalKey);
        if (previous) supersededStorageKeys.push(previous.storageKey);
        byKey.set(artifact.logicalKey, { ...artifact, createdAt: now });
      }
      await this.store.writeJson(Array.from(byKey.values()), "investigations", job.investigationId, "artifacts.json");

      const snapshotId = randomUUID();
      const latest = await this.store.readJson<{ revision: number }>(
        "investigations", job.investigationId, "evidence-latest.json",
      );
      const revision = (latest?.revision ?? 0) + 1;
      await this.store.writeJson({ id: snapshotId, revision, evidence }, "investigations", job.investigationId, "evidence", `${snapshotId}.json`);
      await this.store.writeJson({ snapshotId, revision }, "investigations", job.investigationId, "evidence-latest.json");

      const investigation = await this.readInvestigation(job.investigationId);
      if (investigation) {
        await this.store.writeJson(
          { ...investigation, state: "collecting", updatedAt: new Date().toISOString() },
          "investigations", job.investigationId, "investigation.json",
        );
      }
      await this.appendEvent(job.investigationId, event);
    });
    const currentStorageKeys = new Set(artifacts.map((artifact) => artifact.storageKey));
    return {
      snapshotId: (await this.store.readJson<{ snapshotId: string }>(
        "investigations", job.investigationId, "evidence-latest.json",
      ))?.snapshotId ?? "",
      supersededStorageKeys: supersededStorageKeys.filter((key) => !currentStorageKeys.has(key)),
    };
  }

  async recordAgentRuns(
    jobId: string,
    workerId: string,
    leaseMs: number,
    snapshotId: string,
    runs: AiPromptAudit[],
  ): Promise<void> {
    if (runs.length === 0) return;
    const job = await this.renewAndLoad(jobId, workerId, leaseMs);
    await this.mutateAggregate(job.investigationId, async () => {
      const existing = await this.store.readJsonl<AiPromptAudit & { evidenceSnapshotId?: string }>(
        "investigations", job.investigationId, "agent-runs.jsonl",
      );
      const previousAttempts = new Map<string, number>();
      for (const run of existing) {
        if (run.evidenceSnapshotId !== snapshotId) continue;
        const previous = previousAttempts.get(run.agentId) ?? 0;
        if (run.attempt > previous) previousAttempts.set(run.agentId, run.attempt);
      }
      for (const run of runs) {
        const attemptOffset = previousAttempts.get(run.agentId) ?? 0;
        await this.store.appendJsonl(
          { ...run, attempt: run.attempt + attemptOffset, evidenceSnapshotId: snapshotId, recordedAt: new Date().toISOString() },
          "investigations", job.investigationId, "agent-runs.jsonl",
        );
      }
      await this.appendEvent(job.investigationId, {
        type: "investigation.agent_runs_recorded",
        actor: "AI Investigation Team",
        message: `${runs.length} agent call${runs.length === 1 ? " was" : "s were"} recorded against the evidence snapshot.`,
        payload: { state: "analyzing", snapshotId, runCount: runs.length },
      });
    });
  }

  async loadLatestEvidence(investigationId: string): Promise<EvidenceSnapshot | null> {
    const latest = await this.store.readJson<{ snapshotId: string; revision: number }>(
      "investigations", investigationId, "evidence-latest.json",
    );
    if (!latest) return null;
    const snapshot = await this.store.readJson<{ id: string; revision: number; evidence: unknown }>(
      "investigations", investigationId, "evidence", `${latest.snapshotId}.json`,
    );
    if (!snapshot) return null;
    return {
      id: snapshot.id,
      evidence: EvidenceBundleV2Schema.parse(snapshot.evidence) as EvidenceBundleV2,
    };
  }

  async completeCollection(
    jobId: string,
    workerId: string,
    event: Parameters<InvestigationJobRepository["completeCollection"]>[2],
  ): Promise<void> {
    const job = await this.assertLeaseAndLoad(jobId, workerId);
    await this.mutateAggregate(job.investigationId, async () => {
      const investigation = await this.readInvestigation(job.investigationId);
      if (investigation) {
        await this.store.writeJson(
          { ...investigation, state: "evidence_ready", updatedAt: new Date().toISOString(), completedAt: undefined },
          "investigations", job.investigationId, "investigation.json",
        );
      }
      await this.store.writeJson(
        { ...job, status: "completed", completedAt: new Date().toISOString(), lockedBy: undefined, lockedUntil: undefined },
        "jobs", job.kind, `${jobId}.json`,
      );
      await this.appendEvent(job.investigationId, event);
    });
  }

  async complete(
    jobId: string,
    workerId: string,
    reportId: string,
    report: InvestigationReportContent,
    event: Parameters<InvestigationJobRepository["complete"]>[4],
  ): Promise<void> {
    const job = await this.assertLeaseAndLoad(jobId, workerId);
    await this.mutateAggregate(job.investigationId, async () => {
      const investigation = await this.readInvestigation(job.investigationId);
      if (investigation) {
        await this.store.writeJson(
          {
            ...investigation,
            state: "completed",
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            errorCode: undefined,
            errorMessage: undefined,
          },
          "investigations", job.investigationId, "investigation.json",
        );
      }
      await this.store.writeJson(
        {
          id: reportId,
          investigationId: job.investigationId,
          schemaVersion: 1,
          content: report,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        "investigations", job.investigationId, "report.json",
      );
      await this.store.writeJson(
        { ...job, status: "completed", completedAt: new Date().toISOString(), lockedBy: undefined, lockedUntil: undefined },
        "jobs", job.kind, `${jobId}.json`,
      );
      await this.appendEvent(job.investigationId, event);
    });
  }

  async fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    errorMessage: string,
    retryable: boolean,
  ): Promise<JobFailureDisposition> {
    const job = await this.loadJob(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) return "lease_lost";
    if (job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < Date.now()) return "lease_lost";

    const finalFailure = !retryable || job.attempts >= job.maxAttempts;
    const analysisJob = job.kind === "investigation-analysis";
    const retryState = analysisJob ? "analysis_queued" : "queued";
    const finalState = analysisJob ? "evidence_ready" : "failed";
    const disposition: JobFailureDisposition = finalFailure ? "failed" : "retrying";

    await this.mutateAggregate(job.investigationId, async () => {
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
        "jobs", job.kind, `${jobId}.json`,
      );
      const investigation = await this.readInvestigation(job.investigationId);
      if (investigation) {
        await this.store.writeJson(
          {
            ...investigation,
            state: finalFailure ? finalState : retryState,
            updatedAt: new Date().toISOString(),
            ...(finalFailure ? { errorCode, errorMessage, completedAt: new Date().toISOString() } : { errorCode: undefined, errorMessage: undefined }),
          },
          "investigations", job.investigationId, "investigation.json",
        );
      }
      await this.appendEvent(job.investigationId, buildFailureEvent(finalFailure, analysisJob, errorCode, errorMessage, retryable, job));
    });

    return disposition;
  }

  private async renewAndLoad(jobId: string, workerId: string, leaseMs: number): Promise<StoredJob> {
    const job = await this.loadJob(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) throw new JobLeaseLostError();
    if (job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < Date.now()) throw new JobLeaseLostError();
    await this.store.writeJson(
      { ...job, heartbeatAt: new Date().toISOString(), lockedUntil: new Date(Date.now() + leaseMs).toISOString() },
      "jobs", job.kind, `${jobId}.json`,
    );
    return job;
  }

  private async assertLeaseAndLoad(jobId: string, workerId: string): Promise<StoredJob> {
    const job = await this.loadJob(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) throw new JobLeaseLostError();
    if (job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < Date.now()) throw new JobLeaseLostError();
    return job;
  }

  private async loadJob(jobId: string): Promise<StoredJob | null> {
    for (const kind of ["investigation", "investigation-analysis"] as const) {
      const job = await this.store.readJson<StoredJob>("jobs", kind, `${jobId}.json`);
      if (job) return job;
    }
    return null;
  }

  private async failAbandonedExhaustedJobs(kind: "investigation" | "investigation-analysis"): Promise<void> {
    const files = await this.store.listFiles("jobs", kind);
    for (const file of files) {
      const job = await this.store.readJson<StoredJob>("jobs", kind, file);
      if (!job) continue;
      if (job.status !== "running" || job.attempts < job.maxAttempts) continue;
      if (job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() >= Date.now()) continue;
      await this.mutateAggregate(job.investigationId, async () => {
        await this.store.writeJson(
          { ...job, status: "failed", completedAt: new Date().toISOString(), lockedBy: undefined, lockedUntil: undefined, errorCode: "JOB_LEASE_EXHAUSTED", errorMessage: "Worker lease expired after the final attempt" },
          "jobs", kind, file,
        );
        const investigation = await this.readInvestigation(job.investigationId);
        if (investigation) {
          await this.store.writeJson(
            { ...investigation, state: kind === "investigation-analysis" ? "evidence_ready" : "failed", updatedAt: new Date().toISOString(), errorCode: "JOB_LEASE_EXHAUSTED", errorMessage: "Worker lease expired after the final attempt" },
            "investigations", job.investigationId, "investigation.json",
          );
        }
        await this.appendEvent(job.investigationId, kind === "investigation-analysis"
          ? {
              type: "investigation.analysis_failed",
              actor: "system",
              message: "Agent analysis exhausted its recovery attempts. The deterministic evidence remains available.",
              payload: { state: "evidence_ready", errorCode: "JOB_LEASE_EXHAUSTED" },
            }
          : {
              type: "investigation.failed",
              actor: "system",
              message: "The worker lease expired after the final recovery attempt.",
              payload: { state: "failed", errorCode: "JOB_LEASE_EXHAUSTED" },
            });
      });
    }
  }

  private async readInvestigation(id: string): Promise<StoredInvestigation | null> {
    return this.store.readJson<StoredInvestigation>("investigations", id, "investigation.json");
  }

  private async mutateAggregate(investigationId: string, fn: () => Promise<void>): Promise<void> {
    await this.store.mutate(`locks/investigation-${investigationId}`, fn);
  }

  private async appendEvent(
    investigationId: string,
    event: { type: string; actor: string; message: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await this.store.appendEventUnlocked({
      aggregate: ["investigations", investigationId],
      event,
    });
  }
}

function buildFailureEvent(
  finalFailure: boolean,
  analysisJob: boolean,
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
  job: StoredJob,
): { type: string; actor: string; message: string; payload: Record<string, unknown> } {
  if (finalFailure && analysisJob) {
    return {
      type: "investigation.analysis_failed",
      actor: "system",
      message: `Agent analysis could not complete. The deterministic evidence remains available: ${errorMessage}`,
      payload: { state: "evidence_ready", errorCode },
    };
  }
  if (finalFailure) {
    return {
      type: "investigation.failed",
      actor: "system",
      message: retryable
        ? `The investigation could not be completed after the configured attempts. Last failure: ${errorMessage}`
        : errorMessage,
      payload: { state: "failed", errorCode },
    };
  }
  return analysisJob
    ? {
        type: "investigation.analysis_retry_scheduled",
        actor: "system",
        message: `${errorMessage} Agent analysis was safely queued for another attempt.`,
        payload: { state: "analysis_queued", errorCode, nextAttempt: job.attempts + 1 },
      }
    : {
        type: "investigation.retry_scheduled",
        actor: "system",
        message: `${errorMessage} The investigation was safely queued for another attempt.`,
        payload: { state: "queued", errorCode, nextAttempt: job.attempts + 1 },
      };
}