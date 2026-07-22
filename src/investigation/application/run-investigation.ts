import { randomUUID } from "node:crypto";
import {
  JobLeaseLostError,
  type ClaimedInvestigationJob,
  type InvestigationTransition,
} from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type { InvestigationJobRepository } from "../ports/investigation-job.js";

export type InvestigationWorker = {
  runNext(): Promise<boolean>;
};

export function createInvestigationWorker(input: {
  repository: InvestigationJobRepository;
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
        await runLifecycle(job, async (transition) => {
          if (leaseLost) throw new JobLeaseLostError();
          await input.repository.transition(job.id, input.workerId, input.leaseMs, transition);
        });
        clearInterval(heartbeatTimer);
        await activeHeartbeat;
        if (leaseLost) throw new JobLeaseLostError();
        await input.repository.complete(
          job.id,
          input.workerId,
          randomUUID(),
          createPlaceholderReport(job),
          {
            type: "investigation.report_ready",
            actor: "Investigator",
            message: "Lifecycle validation completed and the technical fixture report is ready.",
            payload: { state: "completed", placeholder: true },
          },
        );
      } catch (error) {
        const errorCode = error instanceof JobLeaseLostError ? "JOB_LEASE_LOST" : "WORKER_PIPELINE_FAILED";
        const errorMessage = error instanceof Error ? error.message : "Unknown worker failure";
        await input.repository.fail(job.id, input.workerId, errorCode, errorMessage);
      } finally {
        clearInterval(heartbeatTimer);
        await activeHeartbeat;
      }
      return true;
    },
  };
}

async function runLifecycle(
  job: ClaimedInvestigationJob,
  transition: (transition: InvestigationTransition) => Promise<void>,
): Promise<void> {
  const stages: InvestigationTransition[] = [
    {
      state: "validating",
      event: {
        type: "investigation.state_changed",
        actor: "Investigator",
        message: "Investigation job claimed. Preparing the stream request for validation.",
        payload: { state: "validating", attempt: job.attempts },
      },
    },
    {
      state: "collecting",
      event: {
        type: "investigation.state_changed",
        actor: "Media Agent",
        message: "Phase 1 evidence collection fixture initialized. Stream tools are not enabled yet.",
        payload: { state: "collecting", placeholder: true },
      },
    },
    {
      state: "analyzing",
      event: {
        type: "investigation.state_changed",
        actor: "Playback Agent",
        message: "Phase 1 analysis fixture verified the persisted investigation lifecycle.",
        payload: { state: "analyzing", placeholder: true },
      },
    },
    {
      state: "synthesizing",
      event: {
        type: "investigation.state_changed",
        actor: "Investigator",
        message: "Generating a technical fixture report for the completed lifecycle.",
        payload: { state: "synthesizing", placeholder: true },
      },
    },
  ];

  for (const stage of stages) await transition(stage);
}

function createPlaceholderReport(job: ClaimedInvestigationJob): InvestigationReportContent {
  return {
    placeholder: true,
    title: "Investigation lifecycle validated",
    summary: "The persisted worker lifecycle completed successfully. No streaming evidence was collected in Phase 1.",
    ...(job.investigation.problemDescription
      ? { problemReported: job.investigation.problemDescription }
      : {}),
    findings: [
      {
        title: "Streaming evidence",
        status: "not_run",
        explanation: "Manifest, network, codec and timeline tools are introduced in Phase 2.",
      },
    ],
    confidence: {
      level: "not_assessed",
      explanation: "Root-cause confidence requires deterministic stream evidence and is intentionally unavailable here.",
    },
    generatedBy: "phase-1-lifecycle-fixture",
  };
}
