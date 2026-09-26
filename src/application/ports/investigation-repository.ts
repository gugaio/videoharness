import type { Investigation, InvestigationCapture } from "../../domain/investigations.js";

export class InvestigationBudgetError extends Error {
  constructor(message = "investigation_budget_exceeded") {
    super(message);
    this.name = "InvestigationBudgetError";
  }
}

export class InvestigationIdempotencyError extends Error {
  constructor() {
    super("idempotency_key_reused_with_different_request");
    this.name = "InvestigationIdempotencyError";
  }
}

export interface InvestigationRepository {
  create(ownerId: string, investigationId: string, inspectionId: string, budgetBytes: number): Investigation;
  get(ownerId: string, investigationId: string): Investigation | undefined;
  list(ownerId: string): Investigation[];
  reserveCapture(
    ownerId: string,
    investigationId: string,
    captureId: string,
    idempotencyKeyHash: string,
    requestHash: string,
    requestedBytes: number,
    request: Record<string, unknown>,
  ): { capture: InvestigationCapture; created: boolean };
  getCapture(ownerId: string, investigationId: string, captureId: string): InvestigationCapture | undefined;
  listCaptures(ownerId: string, investigationId: string): InvestigationCapture[];
  updateCapture(
    ownerId: string,
    investigationId: string,
    captureId: string,
    lensStatus: Record<string, unknown>,
  ): InvestigationCapture | undefined;
}
