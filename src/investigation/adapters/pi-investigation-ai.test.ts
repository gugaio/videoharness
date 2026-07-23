import { describe, expect, it, vi } from "vitest";
import type { EvidenceBundleV2 } from "../domain/evidence.js";
import type { AiAgentProgress } from "../ports/investigation-ai.js";
import { PiInvestigationAI, parseLeadOutput, parseSpecialistOutput } from "./pi-investigation-ai.js";

describe("Pi investigation output parsing", () => {
  it("accepts confidence numbers serialized as strings", () => {
    const output = parseSpecialistOutput({
      summary: "Timeline is continuous.",
      findings: [{
        title: "A/V offset", severity: "info", explanation: "Offset remains stable.",
        evidenceIds: ["sample:sample/variant/0/media/0"], confidence: "0.8",
      }],
      limitations: [],
    });

    expect(output.findings[0]?.confidence).toBe(0.8);
  });

  it("keeps the Lead confidence numeric after coercion", () => {
    const output = parseLeadOutput({
      summary: "No defect observed.", likelyCause: "Evidence is insufficient for a root cause.", confidence: "0.4",
      findings: [], recommendations: ["Collect a longer session."], limitations: [],
    });

    expect(output.confidence).toBe(0.4);
  });

  it("uses limited confidence when the model returns a non-finite value", () => {
    const output = parseSpecialistOutput({
      summary: "The available sample is not enough to establish causality.",
      findings: [{
        title: "Inconclusive timing",
        severity: "warning",
        explanation: "The bounded samples do not reproduce the reported failure.",
        evidenceIds: ["observation:0"],
        confidence: "NaN",
      }],
      limitations: ["A longer playback capture is required."],
    });

    expect(output.findings[0]?.confidence).toBe(0.2);
  });

  it("normalizes nullable and out-of-range confidence without overstating certainty", () => {
    const output = parseLeadOutput({
      summary: "Evidence is limited.",
      likelyCause: "No root cause can be confirmed.",
      confidence: null,
      findings: [
        {
          title: "Missing playback evidence",
          severity: "medium",
          explanation: "Only bounded samples were inspected.",
          evidenceIds: "observation:0",
          confidence: 80,
        },
      ],
      recommendations: ["Capture a longer playback session."],
      limitations: [],
    });

    expect(output.confidence).toBe(0.2);
    expect(output.findings[0]).toMatchObject({
      severity: "warning",
      evidenceIds: ["observation:0"],
      confidence: 0.2,
    });
  });

  it("keeps a specialist response when only one finding is malformed", () => {
    const output = parseSpecialistOutput({
      summary: "One supported observation remains.",
      findings: [
        {
          title: "",
          severity: "info",
          explanation: "This malformed item is ignored.",
          evidenceIds: ["observation:0"],
          confidence: 0.5,
        },
        {
          title: "Observed continuity",
          severity: "info",
          explanation: "The sampled manifest has no declared discontinuity.",
          evidenceIds: ["manifest:manifest/root"],
          confidence: 0.7,
        },
      ],
      limitations: [],
    });

    expect(output.summary).toBe("One supported observation remains.");
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.title).toBe("Observed continuity");
  });
});

type RunStructured = (
  investigationId: string,
  agentId: string,
  systemPrompt: string,
  prompt: string,
  parse: (value: unknown) => unknown,
  tools: unknown[],
) => Promise<unknown>;

const evidence: EvidenceBundleV2 = {
  schemaVersion: 2,
  collectedAt: "2026-07-23T00:00:00.000Z",
  source: {
    requestedUrl: "https://example.test/live/master.m3u8",
    finalUrl: "https://example.test/live/master.m3u8",
    protocol: "hls",
    httpStatus: 200,
  },
  manifests: [{
    artifactId: "11111111-1111-4111-8111-111111111111",
    logicalKey: "manifest/root",
    role: "root",
    requestedUrl: "https://example.test/live/master.m3u8",
    finalUrl: "https://example.test/live/master.m3u8",
    kind: "master",
    sizeBytes: 128,
    variantCount: 1,
  }],
  mediaSamples: [],
  observations: [],
  limitations: [],
};

function createAi(runStructured: RunStructured): PiInvestigationAI {
  const ai = new PiInvestigationAI({
    apiKey: "test-key",
    provider: "openai",
    apiUrl: "https://provider.test/v1",
    model: "test-model",
    timeoutMs: 1_000,
  });
  (ai as unknown as { runStructured: RunStructured }).runStructured = runStructured;
  return ai;
}

function successfulRun(investigationId: string, agentId: string): ReturnType<RunStructured> {
  void investigationId;
  return Promise.resolve(
    agentId === "lead-investigator"
      ? { summary: "Lead synthesis.", likelyCause: "No defect confirmed.", confidence: 0.5, findings: [], recommendations: [], limitations: [] }
      : { summary: `${agentId} summary.`, findings: [], limitations: [] },
  );
}

describe("Pi investigation progress reporting", () => {
  it("reports the real lifecycle of every bounded agent run", async () => {
    const ai = createAi(vi.fn<RunStructured>(successfulRun));
    const progress: AiAgentProgress[] = [];

    const result = await ai.investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence,
      onProgress: async (update) => {
        progress.push(update);
      },
    });

    expect(result.available).toBe(true);
    expect(progress).toEqual([
      { agent: "timeline-playback", stage: "started", completed: 0, total: 4 },
      { agent: "container-encoding", stage: "started", completed: 0, total: 4 },
      { agent: "manifest-delivery", stage: "started", completed: 0, total: 4 },
      { agent: "timeline-playback", stage: "completed", completed: 1, total: 4 },
      { agent: "container-encoding", stage: "completed", completed: 2, total: 4 },
      { agent: "manifest-delivery", stage: "completed", completed: 3, total: 4 },
      { agent: "lead-investigator", stage: "started", completed: 3, total: 4 },
      { agent: "lead-investigator", stage: "completed", completed: 4, total: 4 },
    ]);
  });

  it("reports a failed specialist with its public limitation without hiding the other runs", async () => {
    const ai = createAi(vi.fn<RunStructured>(async (investigationId, agentId) => {
      if (agentId === "container-encoding") throw new Error("Pi investigation timed out");
      return successfulRun(investigationId, agentId);
    }));
    const progress: AiAgentProgress[] = [];

    const result = await ai.investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence,
      onProgress: async (update) => {
        progress.push(update);
      },
    });

    expect(result.available).toBe(true);
    expect(progress).toContainEqual({
      agent: "container-encoding",
      stage: "failed",
      completed: expect.any(Number),
      total: 4,
      limitation: "The AI analysis timed out after retry.",
    });
    const failedIndex = progress.findIndex((update) => update.agent === "container-encoding" && update.stage === "failed");
    const leadStartedIndex = progress.findIndex((update) => update.agent === "lead-investigator" && update.stage === "started");
    expect(failedIndex).toBeGreaterThan(-1);
    expect(leadStartedIndex).toBeGreaterThan(failedIndex);
    expect(progress.at(-1)).toEqual({ agent: "lead-investigator", stage: "completed", completed: 4, total: 4 });
  });

  it("keeps the analysis running when the progress callback itself fails", async () => {
    const ai = createAi(vi.fn<RunStructured>(successfulRun));

    const result = await ai.investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence,
      onProgress: async () => {
        throw new Error("event store unavailable");
      },
    });

    expect(result.available).toBe(true);
    expect(result.agents.filter((agent) => agent.state === "completed")).toHaveLength(4);
  });
});
