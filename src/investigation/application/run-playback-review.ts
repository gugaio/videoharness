import { InvestigationReportContentSchema } from "../../contracts/investigation.js";
import type { WorkerLogger } from "../../infra/logger.js";
import { JsonStore } from "../../store/json-file.js";
import type { EvidenceBundleV2, EvidenceBundleV3 } from "../domain/evidence.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type { InvestigationAI } from "../ports/investigation-ai.js";
import type { AiInvestigationResult } from "../ports/investigation-ai.js";
import type { PlaybackSession } from "../adapters/filesystem-playback-session.js";

type StoredJob = {
  id: string;
  kind: "playback-synthesis";
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
  payload: { playbackSessionId?: string };
  createdAt: string;
};

/** Runs a bounded report revision. The initial report remains published if this job fails. */
export async function runNextPlaybackReview(input: { store: JsonStore; workerId: string; leaseMs: number; ai?: InvestigationAI; logger?: WorkerLogger }): Promise<boolean> {
  const log = input.logger ?? noopLogger;
  const store = input.store;
  const claimed = await claimPlaybackJob(store, input.workerId, input.leaseMs);
  if (!claimed) return false;
  const job = claimed;

  log.info("worker.job_claimed", {
    jobId: job.id,
    jobKind: "playback_synthesis",
    investigationId: job.investigationId,
    playbackSessionId: job.payload.playbackSessionId,
  });

  try {
    const report = await store.readJson<{ content: unknown }>("investigations", job.investigationId, "report.json");
    if (!report) throw new Error("Playback review requires a published report");
    const parsed = InvestigationReportContentSchema.parse(report.content) as InvestigationReportContent;
    if (parsed.placeholder || parsed.evidence.schemaVersion === 1) throw new Error("Playback review requires deterministic media evidence");

    const sessions = await store.readJsonl<PlaybackSession>("investigations", job.investigationId, "playback-sessions.jsonl");
    const session = sessions.find((entry) => entry.id === job.payload.playbackSessionId && entry.investigationId === job.investigationId && entry.status === "completed");
    const telemetry = session?.telemetry;
    if (!session || !telemetry) throw new Error("Playback telemetry is unavailable");

    const evidence: EvidenceBundleV3 = { ...parsed.evidence as EvidenceBundleV2, schemaVersion: 3, playbackSessions: [{ id: session.artifactId ?? session.id, ...telemetry }] };
    const existingAi = ("ai" in parsed ? parsed.ai : undefined) as AiInvestigationResult | undefined;
    const aiResult = input.ai ? await input.ai.investigate({ investigationId: job.investigationId, ...(job.problemDescription ? { problemDescription: job.problemDescription } : {}), evidence }) : existingAi;
    const next: InvestigationReportContent = {
      ...parsed,
      summary: `${parsed.summary} Browser playback telemetry was added from a ${Math.round(telemetry.playedMs / 1000)}s validation run.`,
      findings: [...parsed.findings.filter((finding) => finding.title !== "Browser playback validation"), {
        title: "Browser playback validation", status: telemetry.errors.length || telemetry.stalls ? "limitation" : "observed",
        explanation: `${telemetry.engine} played ${Math.round(telemetry.playedMs / 1000)}s; ${telemetry.stalls} stall(s), ${telemetry.fragmentsLoaded} fragment(s), ${telemetry.errors.length} playback error(s).`,
      }],
      confidence: { level: "limited", explanation: aiResult?.likelyCause ? `AI synthesis after browser playback: ${aiResult.likelyCause}` : parsed.confidence.explanation },
      evidence, ...(aiResult ? { ai: aiResult } : {}), generatedBy: "deterministic-playback-v1",
    };

    await store.mutate(`locks/investigation-${job.investigationId}`, async () => {
      await store.writeJson(
        { ...report, content: next, updatedAt: new Date().toISOString() },
        "investigations", job.investigationId, "report.json",
      );
      await store.writeJson(
        { ...job, status: "completed", completedAt: new Date().toISOString(), lockedBy: undefined, lockedUntil: undefined },
        "jobs", "playback-synthesis", `${job.id}.json`,
      );
      await store.appendEventUnlocked({
        aggregate: ["investigations", job.investigationId],
        event: {
          type: "investigation.report_updated",
          actor: "Investigator",
          message: "Browser playback evidence has been incorporated into the report.",
          payload: { state: "completed", revision: "playback", playbackSessionId: job.payload.playbackSessionId },
        },
      });
    });

    log.info("playback.review_completed", {
      jobId: job.id,
      investigationId: job.investigationId,
      playbackSessionId: job.payload.playbackSessionId,
      playedSeconds: Math.round(telemetry.playedMs / 1000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown playback review failure";
    await store.writeJson(
      { ...job, status: "failed", completedAt: new Date().toISOString(), lockedBy: undefined, lockedUntil: undefined, errorCode: "PLAYBACK_REVIEW_FAILED", errorMessage: message },
      "jobs", "playback-synthesis", `${job.id}.json`,
    );
    log.error("worker.job_failed", {
      jobId: job.id,
      jobKind: "playback_synthesis",
      investigationId: job.investigationId,
      code: "PLAYBACK_REVIEW_FAILED",
      retryable: false,
      message: truncateLogMessage(message),
    });
  }
  return true;
}

async function claimPlaybackJob(store: JsonStore, workerId: string, leaseMs: number): Promise<(StoredJob & { problemDescription?: string }) | null> {
  const release = await store.acquireLock("locks/job-claim-playback-synthesis");
  try {
    const files = await store.listFiles("jobs", "playback-synthesis");
    const now = Date.now();
    const candidates: Array<{ file: string; job: StoredJob }> = [];
    for (const file of files) {
      const job = await store.readJson<StoredJob>("jobs", "playback-synthesis", file);
      if (!job) continue;
      const pending = job.status === "pending";
      const expired = job.status === "running" && job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < now;
      if ((!pending && !expired) || job.attempts >= job.maxAttempts) continue;
      candidates.push({ file, job });
    }
    candidates.sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt));
    for (const candidate of candidates) {
      const jobLock = await store.acquireLock(`locks/job-playback-synthesis-${candidate.job.id}`);
      try {
        const fresh = await store.readJson<StoredJob>("jobs", "playback-synthesis", candidate.file);
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
        await store.writeJson(claimed, "jobs", "playback-synthesis", candidate.file);
        const investigation = await store.readJson<{ problemDescription?: string }>("investigations", fresh.investigationId, "investigation.json");
        return { ...claimed, ...(investigation?.problemDescription ? { problemDescription: investigation.problemDescription } : {}) };
      } finally {
        await jobLock();
      }
    }
    return null;
  } finally {
    await release();
  }
}

const noopLogger: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function truncateLogMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}