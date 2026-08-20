import { createHash } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import type { Investigation } from "../domain/investigation.js";
import {
  IdempotencyConflictError,
  type CreateInvestigationRecords,
  type InvestigationIntakeRepository,
  type InvestigationIntakeResult,
} from "../ports/investigation-intake.js";

type StoredInvestigation = {
  id: string;
  sourceUrl: string;
  problemDescription?: string;
  state: Investigation["state"];
  idempotencyKey: string;
  requestSignature: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export class FilesystemInvestigationIntake implements InvestigationIntakeRepository {
  constructor(private readonly store: JsonStore) {}

  async createOrGet(input: CreateInvestigationRecords): Promise<InvestigationIntakeResult> {
    const keyHash = hashKey(input.idempotencyKey);
    const lock = await this.store.acquireLock(`locks/idempotency-investigation-${keyHash}`);
    try {
      const index = await this.store.readJson<{ investigationId: string; requestSignature: string }>(
        "index", "investigation-idempotency", `${keyHash}.json`,
      );
      if (index) {
        if (index.requestSignature !== input.requestSignature) throw new IdempotencyConflictError();
        const existing = await this.readInvestigation(index.investigationId);
        if (!existing) throw new Error("Idempotent investigation index points to a missing investigation");
        return { investigation: toInvestigation(existing), created: false };
      }

      const now = new Date().toISOString();
      const stored: StoredInvestigation = {
        id: input.investigationId,
        sourceUrl: input.sourceUrl,
        ...(input.problemDescription ? { problemDescription: input.problemDescription } : {}),
        state: "queued",
        idempotencyKey: input.idempotencyKey,
        requestSignature: input.requestSignature,
        createdAt: now,
        updatedAt: now,
      };
      const investigation = ["investigations", input.investigationId, "investigation.json"];
      await this.store.writeJson(stored, ...investigation);
      await this.store.writeJson(
        {
          id: input.jobId,
          kind: "investigation",
          investigationId: input.investigationId,
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          payload: { investigationId: input.investigationId },
          createdAt: now,
        },
        "jobs", "investigation", `${input.jobId}.json`,
      );
      await this.store.appendEvent({
        aggregate: ["investigations", input.investigationId],
        event: input.initialEvent,
      });
      await this.store.writeJson(
        { investigationId: input.investigationId, requestSignature: input.requestSignature },
        "index", "investigation-idempotency", `${keyHash}.json`,
      );
      return { investigation: toInvestigation(stored), created: true };
    } finally {
      await lock();
    }
  }

  private async readInvestigation(id: string): Promise<StoredInvestigation | null> {
    return this.store.readJson<StoredInvestigation>("investigations", id, "investigation.json");
  }
}

function toInvestigation(row: StoredInvestigation): Investigation {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    ...(row.problemDescription ? { problemDescription: row.problemDescription } : {}),
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  };
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}