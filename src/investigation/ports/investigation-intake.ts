import type { Investigation } from "../domain/investigation.js";

export type CreateInvestigationRecords = {
  investigationId: string;
  jobId: string;
  idempotencyKey: string;
  requestSignature: string;
  sourceUrl: string;
  problemDescription?: string;
  initialEvent: {
    type: "investigation.state_changed";
    actor: "system";
    message: string;
    payload: Record<string, unknown>;
  };
};

export type InvestigationIntakeResult = {
  investigation: Investigation;
  created: boolean;
};

export interface InvestigationIntakeRepository {
  createOrGet(input: CreateInvestigationRecords): Promise<InvestigationIntakeResult>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}
