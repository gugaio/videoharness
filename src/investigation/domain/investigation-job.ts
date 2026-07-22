import type { Investigation, InvestigationState } from "./investigation.js";

export type InvestigationExecutionContext = Pick<
  Investigation,
  "id" | "sourceUrl" | "problemDescription"
>;

export type ClaimedInvestigationJob = {
  id: string;
  attempts: number;
  maxAttempts: number;
  investigation: InvestigationExecutionContext;
};

export type InvestigationLifecycleEvent = {
  type: string;
  actor: string;
  message: string;
  payload: Record<string, unknown>;
};

export type InvestigationTransition = {
  state: Exclude<InvestigationState, "queued" | "completed" | "failed">;
  event: InvestigationLifecycleEvent;
};

export class JobLeaseLostError extends Error {
  constructor() {
    super("The investigation job lease is no longer owned by this worker");
    this.name = "JobLeaseLostError";
  }
}
