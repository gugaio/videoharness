import { describe, expect, it, vi } from "vitest";
import type { InvestigationIntakeRepository } from "../ports/investigation-intake.js";
import { createStartInvestigation } from "./start-investigation.js";

describe("startInvestigation", () => {
  it("normalizes input and requests all initial records atomically", async () => {
    const createOrGet = vi.fn<InvestigationIntakeRepository["createOrGet"]>(async (input) => ({
      created: true,
      investigation: {
        id: input.investigationId,
        sourceUrl: input.sourceUrl,
        ...(input.problemDescription ? { problemDescription: input.problemDescription } : {}),
        state: "queued",
        createdAt: "2026-07-21T12:00:00.000Z",
        updatedAt: "2026-07-21T12:00:00.000Z",
      },
    }));
    const start = createStartInvestigation({ createOrGet });

    const result = await start({
      sourceUrl: "https://example.test/live/master.m3u8",
      problemDescription: "  freezes after 15 minutes  ",
      idempotencyKey: "request-1",
    });

    expect(result.created).toBe(true);
    expect(createOrGet).toHaveBeenCalledOnce();
    expect(createOrGet).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: "https://example.test/live/master.m3u8",
      problemDescription: "freezes after 15 minutes",
      idempotencyKey: "request-1",
      requestSignature: expect.stringMatching(/^[a-f0-9]{64}$/),
      initialEvent: expect.objectContaining({ type: "investigation.state_changed" }),
    }));
  });
});
