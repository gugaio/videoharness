import { describe, expect, it, vi } from "vitest";
import type { EvidenceBundleV2 } from "../domain/evidence.js";
import type { InvestigationLab } from "../ports/investigation-lab.js";
import type { AiAgentProgress } from "../ports/investigation-ai.js";
import { PiInvestigationAI, parseLeadOutput, parseSpecialistOutput } from "./pi-investigation-ai.js";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";

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

function successfulRun(investigationId: string, agentId: string): Promise<unknown> {
  void investigationId;
  return Promise.resolve(
    agentId === "lead-investigator"
      ? { summary: "Lead synthesis.", likelyCause: "No defect confirmed.", confidence: 0.5, findings: [], recommendations: [], limitations: [] }
      : agentId === "abr-switch-investigator"
        ? abrQualityOutput()
      : { summary: `${agentId} summary.`, findings: [], limitations: [] },
  );
}

function abrQualityOutput(): object { return { assessment_id: "abr-assessment:hls", summary: "ABR baseline complete.", abr_quality_explained: "The ladder was assessed within manifest coverage.", strongest_hypothesis: { category: "INCONCLUSIVE", confidence: "LOW", statement: "Playback behavior is not observed.", evidence_ids: [] }, findings: [], ruled_out_or_weakened_hypotheses: [], missing_evidence: ["player request sequence"], recommended_measurements: ["Run a controlled playback."], next_best_experiment: "Run a controlled playback." }; }

function createAi(runStructured: RunStructured, lab?: InvestigationLab): PiInvestigationAI {
  const ai = new PiInvestigationAI({
    apiKey: "test-key",
    provider: "openai",
    apiUrl: "https://provider.test/v1",
    model: "test-model",
    timeoutMs: 1_000,
    ...(lab ? { lab } : {}),
    runner: (input) => runStructured(input.investigationId, input.agentId, input.systemPrompt, input.prompt, (value) => value, [...input.tools]),
  });
  return ai;
}


describe("Pi investigation progress reporting", () => {
  it("runs the ABR quality specialist for a URL-only DASH candidate without platform-specific input", async () => {
    const run = vi.fn<RunStructured>(successfulRun);
    const ai = createAi(run);
    const dashEvidence: EvidenceBundleV2 = {
      ...structuredClone(evidence),
      source: { ...evidence.source, protocol: "dash" },
      dash: { type: "static", periods: [], adaptationSets: [], representations: [], limitations: [], switches: [abrCandidate()] },
    };
    const progress: AiAgentProgress[] = [];

    const result = await ai.investigate({ investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538", evidence: dashEvidence, onProgress: async (update) => { progress.push(update); } });

    expect(run).toHaveBeenCalledWith(expect.any(String), "abr-switch-investigator", expect.stringContaining("HLS e DASH"), expect.stringContaining("\"assessment_id\":\"abr-assessment:dash\""), expect.any(Function), expect.arrayContaining([expect.objectContaining({ name: "inspect_preserved_sample" })]));
    expect(result.agents).toContainEqual(expect.objectContaining({ id: "abr-switch-investigator", state: "completed" }));
    expect(progress).toContainEqual({ agent: "abr-switch-investigator", stage: "started", completed: 2, total: 5 });
    expect(progress.at(-1)).toEqual({ agent: "lead-investigator", stage: "completed", completed: 5, total: 5 });
  });

  it("runs freeze detection before synthesis when the reported symptom is repeated frames", async () => {
    const execute = vi.fn<InvestigationLab["execute"]>().mockResolvedValue({
      exitCode: 0,
      timedOut: false,
      durationMs: 120,
      stdout: "",
      stderr: "freeze_start: 2.96963\nfreeze_duration: 1.03437",
      outputTruncated: false,
    });
    const ai = createAi(vi.fn<RunStructured>(successfulRun), { execute });
    const investigationEvidence = structuredClone(evidence);

    await ai.investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      problemDescription: "A imagem congela e mostra frames repetidos.",
      evidence: investigationEvidence,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.stringContaining("freezedetect"),
      timeoutMs: 120_000,
    }));
    expect(investigationEvidence.observations).toContainEqual(expect.objectContaining({
      code: "FREEZE_DETECTION",
      message: expect.stringContaining("freeze_start: 2.96963"),
    }));
  });

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
    expect(result.promptAudits).toHaveLength(5);
    expect(result.promptAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: "timeline-playback",
        attempt: 1,
        state: "completed",
        provider: "openai",
        model: "test-model",
        systemPrompt: expect.stringContaining("Timeline & Playback"),
        prompt: expect.stringContaining("evidenceIndex"),
        toolNames: ["inspect_preserved_sample"],
      }),
      expect.objectContaining({
        agentId: "lead-investigator",
        prompt: expect.stringContaining("specialists"),
      }),
    ]));
    expect(progress).toEqual([
      { agent: "timeline-playback", stage: "started", completed: 0, total: 5 },
      { agent: "container-encoding", stage: "started", completed: 0, total: 5 },
      { agent: "timeline-playback", stage: "completed", completed: 1, total: 5 },
      { agent: "container-encoding", stage: "completed", completed: 2, total: 5 },
      { agent: "manifest-delivery", stage: "started", completed: 2, total: 5 },
      { agent: "abr-switch-investigator", stage: "started", completed: 2, total: 5 },
      { agent: "manifest-delivery", stage: "completed", completed: 3, total: 5 },
      { agent: "abr-switch-investigator", stage: "completed", completed: 4, total: 5 },
      { agent: "lead-investigator", stage: "started", completed: 4, total: 5 },
      { agent: "lead-investigator", stage: "completed", completed: 5, total: 5 },
    ]);
  });

  it("limits specialist provider calls to two concurrent generations", async () => {
    let active = 0;
    let maximum = 0;
    const run = vi.fn<RunStructured>(async (investigationId, agentId) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return successfulRun(investigationId, agentId);
    });

    await createAi(run).investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence,
    });

    expect(maximum).toBe(2);
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
      total: 5,
      limitation: "The AI analysis timed out after retry.",
    });
    const failedIndex = progress.findIndex((update) => update.agent === "container-encoding" && update.stage === "failed");
    const leadStartedIndex = progress.findIndex((update) => update.agent === "lead-investigator" && update.stage === "started");
    expect(failedIndex).toBeGreaterThan(-1);
    expect(leadStartedIndex).toBeGreaterThan(failedIndex);
    expect(progress.at(-1)).toEqual({ agent: "lead-investigator", stage: "completed", completed: 5, total: 5 });
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
    expect(result.agents.filter((agent) => agent.state === "completed")).toHaveLength(5);
  });
});

function abrCandidate(): AbrSwitchEvidence {
  return {
    evidenceId: "abr-switch:url-candidate:uhd->fhd", switchId: "url-candidate:uhd->fhd", evidenceBasis: "URL_STATIC_ANALYSIS", transitionStatus: "CANDIDATE", timestamps: { candidateBoundaryPresentationTimeMs: 4_000 },
    sourceRepresentation: { evidenceId: "representation:uhd", id: "uhd", periodIndex: 0, adaptationSetIndex: 0, width: 3840, height: 2160 },
    targetRepresentation: { evidenceId: "representation:fhd", id: "fhd", periodIndex: 0, adaptationSetIndex: 0, width: 1920, height: 1080 },
    direction: "DOWNSHIFT", switchKind: "RESOLUTION_CHANGING", switchingContract: { evidenceId: "contract:video", mode: "GENERAL_REINITIALIZATION", codecFamily: "HEVC", representations: ["uhd", "fhd"] },
    networkEvidence: { evidenceId: "network:candidate", requests: [] }, decodeTests: [], deterministicFindings: [], missingEvidence: ["player callback timeline"],
  };
}
