import type { InvestigationQueries } from "../../investigation/application/investigation-queries.js";
import type { WorkerLogger } from "../../infra/logger.js";
import type { ExperimentRepository } from "../ports/experiment-repository.js";
import type { ExperimentAnalysisTeam } from "../ports/experiment-analysis.js";
import type { ExperimentEvaluationJobRepository } from "../ports/experiment-evaluation-job.js";
import { applyExperimentAgentAnalysis } from "./apply-agent-analysis.js";
import { evaluateExperimentEvidence } from "./evaluate-experiment.js";

export function createExperimentEvaluationWorker(input: {
  jobs: ExperimentEvaluationJobRepository;
  experiments: ExperimentRepository;
  investigations: InvestigationQueries;
  analysisTeam: ExperimentAnalysisTeam;
  workerId: string;
  leaseMs: number;
  heartbeatMs?: number;
  logger?: WorkerLogger;
}) {
  const log = input.logger ?? noopLogger;
  const heartbeatMs = input.heartbeatMs ?? Math.max(1_000, Math.floor(input.leaseMs / 3));
  return {
    async runNext(): Promise<boolean> {
      const job = await input.jobs.claimNext(input.workerId, input.leaseMs);
      if (!job) return false;
      log.info("worker.job_claimed", { jobId: job.id, jobKind: "experiment-evaluation", experimentId: job.experimentId, attempt: job.attempts, maxAttempts: job.maxAttempts });
      let leaseLost = false;
      let heartbeatActive: Promise<void> | undefined;
      const heartbeat = (): void => {
        if (heartbeatActive || leaseLost) return;
        heartbeatActive = input.jobs.heartbeat(job.id, input.workerId, input.leaseMs)
          .then((renewed) => { leaseLost = !renewed; })
          .catch(() => { leaseLost = true; })
          .finally(() => { heartbeatActive = undefined; });
      };
      const timer = setInterval(heartbeat, heartbeatMs);
      try {
        const experiment = await input.experiments.findById(job.experimentId);
        if (!experiment) throw new Error("Experiment evaluation job references a missing experiment");
        const report = await input.investigations.getReport(experiment.investigationId);
        if (!report) throw new Error("Original investigation report is unavailable");
        const evidence = report.content.placeholder ? undefined : report.content.evidence;
        const deterministic = evaluateExperimentEvidence({
          experiment,
          originalEvidence: {
            reportId: report.id,
            ...(evidence ? { schemaVersion: evidence.schemaVersion, sourceProtocol: evidence.source.protocol } : {}),
            ...(evidence && evidence.schemaVersion !== 1 ? { artifactIds: [...evidence.manifests.map((entry) => entry.artifactId), ...evidence.mediaSamples.map((entry) => entry.artifactId)] } : {}),
            ...(evidence && evidence.schemaVersion !== 1 && evidence.abr ? { abrVerdict: evidence.abr.verdict } : {}),
            limitationCount: evidence?.limitations.length ?? 0,
          },
        });
        log.info("experiment.agent_analysis_started", { jobId: job.id, experimentId: job.experimentId, deterministicOutcome: deterministic.analysis?.outcome });
        const agentResult = await input.analysisTeam.analyze({ experiment, evaluation: deterministic });
        const evaluation = applyExperimentAgentAnalysis(deterministic, agentResult);
        if (leaseLost) throw new Error("Experiment evaluation job lease was lost");
        const saved = await input.experiments.saveEvaluation(evaluation);
        if (saved === "invalid_state") throw new Error("Experiment changed state before evaluation could be saved");
        if (!await input.jobs.complete(job.id, input.workerId)) throw new Error("Experiment evaluation job lease was lost before completion");
        log.info("experiment.agent_analysis_completed", {
          jobId: job.id,
          experimentId: job.experimentId,
          evaluationId: saved.id,
          status: saved.status,
          confidence: saved.confidence,
          source: saved.analysis?.source,
          completedAgents: saved.analysis?.agents.filter((entry) => entry.state === "COMPLETED").length ?? 0,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown experiment evaluation failure";
        const disposition = await input.jobs.fail(job.id, input.workerId, "EXPERIMENT_EVALUATION_FAILED", message);
        log.error("worker.job_failed", { jobId: job.id, jobKind: "experiment-evaluation", experimentId: job.experimentId, attempt: job.attempts, disposition, message: message.slice(0, 500) });
      } finally {
        clearInterval(timer);
        await heartbeatActive;
      }
      return true;
    },
  };
}

const noopLogger: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
