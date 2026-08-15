import { randomUUID } from "node:crypto";
import { JobLeaseLostError, type InvestigationTransition } from "../domain/investigation-job.js";
import type { WorkerLogger } from "../../infra/logger.js";
import type { InvestigationJobRepository } from "../ports/investigation-job.js";
import type { AiAgentProgress, AiAgentRun, InvestigationAI } from "../ports/investigation-ai.js";
import type { PlaybackCorrelationProvider } from "../ports/playback-correlation.js";
import { buildManifestReport } from "./build-manifest-evidence.js";
import type { InvestigationWorker } from "./run-investigation.js";

export function createInvestigationAnalysisWorker(input: {
  repository: InvestigationJobRepository;
  ai: InvestigationAI;
  workerId: string;
  leaseMs: number;
  heartbeatMs?: number;
  playbackCorrelation?: PlaybackCorrelationProvider;
  logger?: WorkerLogger;
}): InvestigationWorker {
  const heartbeatMs = input.heartbeatMs ?? Math.max(1_000, Math.floor(input.leaseMs / 3));
  const log = input.logger ?? noopLogger;

  return {
    async runNext(): Promise<boolean> {
      const job = await input.repository.claimNextAnalysis(input.workerId, input.leaseMs);
      if (!job) return false;
      log.info("worker.job_claimed", {
        jobId: job.id,
        jobKind: "investigation-analysis",
        investigationId: job.investigation.id,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      });

      let leaseLost = false;
      let activeHeartbeat: Promise<void> | undefined;
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
        const snapshot = await input.repository.loadLatestEvidence(job.investigation.id);
        if (!snapshot) throw new Error("The analysis job has no deterministic evidence snapshot");

        if (input.playbackCorrelation) {
          const observedSwitches = await input.playbackCorrelation.listObservedSwitches(job.investigation.id);
          if (observedSwitches.length > 0) {
            snapshot.evidence.playbackSwitches = observedSwitches;
            await input.repository.transition(job.id, input.workerId, input.leaseMs, {
              state: "analyzing",
              event: {
                type: "investigation.observation",
                actor: "Playback Correlation",
                message: `${observedSwitches.length} observed playback switch${observedSwitches.length === 1 ? "" : "es"} from related Record playback runs were attached to this analysis.`,
                payload: { state: "analyzing", stage: "playback_correlation", switchCount: observedSwitches.length },
              },
            });
            log.info("investigation.analysis_playback_correlation", {
              jobId: job.id,
              investigationId: job.investigation.id,
              switchCount: observedSwitches.length,
            });
          }
        }

        await input.repository.transition(job.id, input.workerId, input.leaseMs, {
          state: "analyzing",
          event: {
            type: "investigation.state_changed",
            actor: "AI Investigation Team",
            message: "Specialists are correlating the selected deterministic evidence snapshot.",
            payload: { state: "analyzing", stage: "ai_specialists", snapshotId: snapshot.id },
          },
        });
        log.info("investigation.state_changed", {
          jobId: job.id,
          investigationId: job.investigation.id,
          state: "analyzing",
          snapshotId: snapshot.id,
          attempt: job.attempts,
        });

        let progressChain: Promise<void> = Promise.resolve();
        const onProgress = (update: AiAgentProgress): Promise<void> => {
          progressChain = progressChain.then(() => input.repository.transition(
            job.id,
            input.workerId,
            input.leaseMs,
            { state: "analyzing", event: buildAiAgentProgressEvent(update) },
          ));
          return progressChain;
        };
        const result = await input.ai.investigate({
          investigationId: job.investigation.id,
          ...(job.investigation.problemDescription
            ? { problemDescription: job.investigation.problemDescription }
            : {}),
          evidence: snapshot.evidence,
          onProgress,
        });
        await progressChain;
        await input.repository.recordAgentRuns(
          job.id,
          input.workerId,
          input.leaseMs,
          snapshot.id,
          result.promptAudits,
        );
        await input.repository.transition(job.id, input.workerId, input.leaseMs, {
          state: "analyzing",
          event: {
            type: "investigation.observation",
            actor: "AI Investigation Team",
            message: result.available
              ? `${result.agents.filter((agent) => agent.state === "completed").length} agent runs completed.`
              : "Agent analysis is unavailable; the deterministic evidence remains authoritative.",
            payload: { state: "analyzing", stage: "ai_complete", available: result.available },
          },
        });
        if (!result.available) {
          log.warn("investigation.analysis_unavailable", {
            jobId: job.id,
            investigationId: job.investigation.id,
            attempt: job.attempts,
          });
        }
        await input.repository.transition(job.id, input.workerId, input.leaseMs, {
          state: "synthesizing",
          event: {
            type: "investigation.state_changed",
            actor: "Lead Investigator",
            message: "Preparing the investigation synthesis from agent outputs and evidence.",
            payload: { state: "synthesizing" },
          },
        });
        log.info("investigation.state_changed", {
          jobId: job.id,
          investigationId: job.investigation.id,
          state: "synthesizing",
          attempt: job.attempts,
        });

        clearInterval(heartbeatTimer);
        await activeHeartbeat;
        if (leaseLost) throw new JobLeaseLostError();
        await input.repository.complete(
          job.id,
          input.workerId,
          randomUUID(),
          buildManifestReport(job, snapshot.evidence, result),
          {
            type: "investigation.report_ready",
            actor: "Lead Investigator",
            message: "Agent analysis and the evidence-linked report are ready.",
            payload: { state: "completed", placeholder: false, protocol: snapshot.evidence.source.protocol },
          },
        );
        log.info("investigation.report_ready", {
          jobId: job.id,
          investigationId: job.investigation.id,
          snapshotId: snapshot.id,
          available: result.available,
          agentCount: result.agents.length,
          findingCount: result.findings.length,
          attempt: job.attempts,
        });
      } catch (error) {
        const failure = classifyFailure(error);
        await input.repository.fail(job.id, input.workerId, failure.code, failure.message, failure.retryable);
        log.error("worker.job_failed", {
          jobId: job.id,
          jobKind: "investigation-analysis",
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

const AI_AGENT_LABELS: Record<AiAgentRun["id"], string> = {
  "timeline-playback": "Timeline & Playback",
  "container-encoding": "Container & Encoding",
  "manifest-delivery": "Manifest & Delivery",
  "abr-switch-investigator": "ABR Quality Investigator",
  "lead-investigator": "Lead Investigator",
  "experiment-evidence-auditor": "Experiment Evidence Auditor",
  "experiment-causal-analyst": "Experiment Causal Analyst",
  "experiment-lead-investigator": "Lead Experiment Investigator",
};

function buildAiAgentProgressEvent(update: AiAgentProgress): InvestigationTransition["event"] {
  const label = AI_AGENT_LABELS[update.agent];
  const message = update.stage === "started"
    ? `${label} analysis started.`
    : update.stage === "completed"
      ? `${label} analysis complete.`
      : `${label} analysis could not complete${update.limitation ? `: ${update.limitation}` : "."}`;
  return {
    type: "investigation.observation",
    actor: update.agent,
    message,
    payload: {
      state: "analyzing",
      stage: "ai_agent",
      agent: update.agent,
      agentStage: update.stage,
      completed: update.completed,
      total: update.total,
    },
  };
}

function classifyFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof JobLeaseLostError) {
    return { code: "JOB_LEASE_LOST", message: error.message, retryable: true };
  }
  return {
    code: "ANALYSIS_FAILED",
    message: error instanceof Error ? error.message : "Unknown agent analysis failure",
    retryable: true,
  };
}

const noopLogger: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function truncateLogMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}
