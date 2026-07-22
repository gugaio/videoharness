import { createHash, randomUUID } from "node:crypto";
import type { InvestigationIntakeRepository, InvestigationIntakeResult } from "../ports/investigation-intake.js";

export type StartInvestigationInput = {
  sourceUrl: string;
  problemDescription?: string;
  idempotencyKey: string;
};

export type StartInvestigation = (input: StartInvestigationInput) => Promise<InvestigationIntakeResult>;

export function createStartInvestigation(repository: InvestigationIntakeRepository): StartInvestigation {
  return async (input) => {
    const normalizedUrl = new URL(input.sourceUrl).toString();
    const problemDescription = input.problemDescription?.trim() || undefined;
    const requestSignature = createHash("sha256")
      .update(JSON.stringify({ sourceUrl: normalizedUrl, problemDescription: problemDescription ?? null }))
      .digest("hex");

    return repository.createOrGet({
      investigationId: randomUUID(),
      jobId: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      requestSignature,
      sourceUrl: normalizedUrl,
      ...(problemDescription ? { problemDescription } : {}),
      initialEvent: {
        type: "investigation.state_changed",
        actor: "system",
        message: "Investigation created and queued.",
        payload: { state: "queued" },
      },
    });
  };
}
