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

  it("keeps a diagnosis-specific validation plan returned by the Lead", () => {
    const output = parseLeadOutput({
      summary: "Audio families are mixed.",
      likelyCause: "A switch between AAC and E-AC-3 may require decoder reconfiguration.",
      confidence: 0.7,
      findings: [], recommendations: [], limitations: [],
      validation_plan: {
        objective: "Test the cross-audio-family path",
        statement: "An AAC-only ladder changes the device result relative to CONTROL.",
        reason: "The treatment removes E-AC-3 representations.",
        proof_boundary: "A different result isolates the representation group, not the decoder internals.",
        treatment: { type: "representation_subset", label: "AAC-ONLY", representation_ids: ["variant-0", "variant-1"] },
      },
    });

    expect(output.validationPlan).toEqual({
      goal: "Test the cross-audio-family path",
      hypothesis: "An AAC-only ladder changes the device result relative to CONTROL.",
      rationale: "The treatment removes E-AC-3 representations.",
      proofBoundary: "A different result isolates the representation group, not the decoder internals.",
      treatment: { recipe: "representation_subset", shortLabel: "AAC-ONLY", representationIds: ["variant-0", "variant-1"] },
    });
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

  it("accepts a nested response with snake_case citations and a scalar limitation", () => {
    const output = parseSpecialistOutput({
      result: {
        analysis_summary: "The sampled timeline is continuous.",
        findings: [{
          title: "Continuous boundary",
          severity: "LOW",
          technical_explanation: "Adjacent samples preserve presentation order.",
          evidence_ids: ["observation:0"],
          confidence: 0.7,
        }],
        limitations: "Only the bounded window was measured.",
      },
    });

    expect(output).toMatchObject({
      summary: "The sampled timeline is continuous.",
      limitations: ["Only the bounded window was measured."],
      findings: [{
        severity: "info",
        explanation: "Adjacent samples preserve presentation order.",
        evidenceIds: ["observation:0"],
      }],
    });
  });

  it("accepts Lead aliases without weakening the required summary", () => {
    const output = parseLeadOutput({
      response: {
        overview: "The evidence does not confirm the reported failure.",
        likely_cause: "The current capture is inconclusive.",
        confidence: "0.25",
        findings: [],
        next_steps: "Capture an observed playback run.",
        missing_evidence: [{ description: "No player event timeline is available." }],
      },
    });

    expect(output.recommendations).toEqual(["Capture an observed playback run."]);
    expect(output.limitations).toEqual(["No player event timeline is available."]);
    expect(output.likelyCause).toBe("The current capture is inconclusive.");
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
    expect(progress).toContainEqual({ agent: "abr-switch-investigator", stage: "started", completed: 3, total: 5 });
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
      { agent: "timeline-playback", stage: "completed", completed: 1, total: 5 },
      { agent: "container-encoding", stage: "started", completed: 1, total: 5 },
      { agent: "container-encoding", stage: "completed", completed: 2, total: 5 },
      { agent: "manifest-delivery", stage: "started", completed: 2, total: 5 },
      { agent: "manifest-delivery", stage: "completed", completed: 3, total: 5 },
      { agent: "abr-switch-investigator", stage: "started", completed: 3, total: 5 },
      { agent: "abr-switch-investigator", stage: "completed", completed: 4, total: 5 },
      { agent: "lead-investigator", stage: "started", completed: 4, total: 5 },
      { agent: "lead-investigator", stage: "completed", completed: 5, total: 5 },
    ]);
  });

  it("serializes specialist provider calls on the shared credential", async () => {
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

    expect(maximum).toBe(1);
  });

  it("backs off on rate limiting before retrying the affected specialist", async () => {
    vi.useFakeTimers();
    let timelineAttempts = 0;
    const run = vi.fn<RunStructured>(async (investigationId, agentId) => {
      if (agentId === "timeline-playback" && timelineAttempts < 2) {
        timelineAttempts += 1;
        throw Object.assign(new Error("Pi provider unsuccessful: rate_limit"), { retryAfterMs: 1_000 });
      }
      return successfulRun(investigationId, agentId);
    });

    const pending = createAi(run).investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence,
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(timelineAttempts).toBe(2);
    expect(run.mock.calls.filter((call) => call[1] === "timeline-playback")).toHaveLength(3);
    expect(result.agents).toContainEqual(expect.objectContaining({ id: "timeline-playback", state: "completed" }));
    expect(result.promptAudits.filter((audit) => audit.agentId === "timeline-playback")).toHaveLength(3);
    vi.useRealTimers();
  });

  it("keeps full frame details and source URLs out of the repeated model packet", async () => {
    const run = vi.fn<RunStructured>(successfulRun);
    const evidenceWithSamples: EvidenceBundleV2 = {
      ...structuredClone(evidence),
      mediaSamples: [{
        artifactId: "22222222-2222-4222-8222-222222222222",
        logicalKey: "sample/variant/0/media/0",
        kind: "media-segment",
        sizeBytes: 2_048,
        source: {
          url: "https://origin.example.test/private/segment.m4s",
          sha256: "a".repeat(64),
          httpStatus: 200,
        },
        probe: {
          tracks: [],
          fmp4: {
            fragment: {
              trafs: [],
              samples: [fragmentSample("0", 19), fragmentSample("1", 777), fragmentSample("2", 1)],
              drmBoxTypes: [],
              structuralErrors: [],
            },
          },
        },
      }],
    };

    await createAi(run).investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence: evidenceWithSamples,
    });

    const containerPacket = run.mock.calls.find((call) => call[1] === "container-encoding")?.[3] ?? "";
    expect(containerPacket).not.toContain("origin.example.test/private");
    expect(containerPacket).not.toContain('"nalTypes":[777]');
    expect(containerPacket).toContain('"sampleCount":3');
    const timelinePacket = run.mock.calls.find((call) => call[1] === "timeline-playback")?.[3] ?? "";
    expect(timelinePacket).not.toContain("origin.example.test/private");
    expect(timelinePacket).not.toContain('"nalTypes":[777]');
  });

  it("gives only the manifest-delivery specialist the raw manifest content inline", async () => {
    const run = vi.fn<RunStructured>(successfulRun);
    const evidenceWithManifestContent: EvidenceBundleV2 = {
      ...structuredClone(evidence),
      manifests: [{
        ...evidence.manifests[0]!,
        content: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=246440,RESOLUTION=320x184\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=6221600,RESOLUTION=1920x1080\nhigh.m3u8",
      }],
    };

    await createAi(run).investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence: evidenceWithManifestContent,
    });

    const manifestPacket = run.mock.calls.find((call) => call[1] === "manifest-delivery")?.[3] ?? "";
    expect(manifestPacket).toContain("#EXT-X-STREAM-INF:BANDWIDTH=6221600");
    expect(manifestPacket).toContain("manifest/root");
    const timelinePacket = run.mock.calls.find((call) => call[1] === "timeline-playback")?.[3] ?? "";
    expect(timelinePacket).not.toContain("#EXT-X-STREAM-INF");
  });

  it("gives only the timeline-playback specialist the deterministic timeline windows inline", async () => {
    const run = vi.fn<RunStructured>(successfulRun);
    const evidenceWithTimeline: EvidenceBundleV2 = {
      ...structuredClone(evidence),
      timeline: [{
        key: "manifest/variant/0",
        kind: "video" as const,
        segmentCount: 2,
        gaps: [{ fromLogicalKey: "sample/variant/0/media/0", toLogicalKey: "sample/variant/0/media/1", presentationGapMs: 240 }],
        totalGapMs: 240,
        maxGapMs: 240,
        continuous: false,
      }],
    };

    await createAi(run).investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence: evidenceWithTimeline,
    });

    const timelinePacket = run.mock.calls.find((call) => call[1] === "timeline-playback")?.[3] ?? "";
    expect(timelinePacket).toContain("timeline:manifest/variant/0");
    expect(timelinePacket).toContain('"presentationGapMs":240');
    expect(timelinePacket).toContain('"continuous":false');
    const containerPacket = run.mock.calls.find((call) => call[1] === "container-encoding")?.[3] ?? "";
    expect(containerPacket).not.toContain('"presentationGapMs":240');
    const manifestPacket = run.mock.calls.find((call) => call[1] === "manifest-delivery")?.[3] ?? "";
    expect(manifestPacket).not.toContain('"presentationGapMs":240');
  });

  it("builds exclusive lane packets instead of one shared blob", async () => {
    const run = vi.fn<RunStructured>(successfulRun);
    const laneEvidence: EvidenceBundleV2 = {
      ...structuredClone(evidence),
      hls: { variants: [
        { index: 0, uri: "v0.m3u8", bandwidth: 500_000, codecs: "avc1.4D401E,mp4a.40.2" },
        { index: 1, uri: "v1.m3u8", bandwidth: 900_000, codecs: "avc1.4D401F,mp4a.40.2" },
      ], renditions: [] },
      mediaSamples: [{
        artifactId: "22222222-2222-4222-8222-222222222222",
        logicalKey: "sample/variant/0/media/0",
        kind: "media-segment",
        sizeBytes: 2_048,
        probe: { tracks: [{ kind: "video", codec: "h264", firstPts: 0, lastPts: 6.006 }] },
      }],
      timeline: [{
        key: "manifest/variant/0",
        kind: "video" as const,
        segmentCount: 1,
        gaps: [],
        totalGapMs: 0,
        maxGapMs: 0,
        continuous: true,
      }],
    };

    const result = await createAi(run).investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence: laneEvidence,
    });

    const systemPrompt = (agentId: string) => run.mock.calls.find((call) => call[1] === agentId)?.[2] ?? "";
    const packetFor = (agentId: string) => run.mock.calls.find((call) => call[1] === agentId)?.[3] ?? "";

    expect(systemPrompt("container-encoding")).toContain("exclusive lane");
    expect(systemPrompt("manifest-delivery")).toContain("ANTI-ECHO");
    expect(systemPrompt("timeline-playback")).toContain("exclusive lane");

    const timelinePacket = packetFor("timeline-playback");
    expect(timelinePacket).toContain('"timeline"');
    expect(timelinePacket).not.toContain("mediaSampleIndex");
    expect(timelinePacket).not.toContain('"boundary"');

    const containerPacket = packetFor("container-encoding");
    expect(containerPacket).toContain('"probe"');
    expect(containerPacket).not.toContain('"variants"');

    const manifestPacket = packetFor("manifest-delivery");
    expect(manifestPacket).toContain("mediaSampleIndex");
    expect(manifestPacket).not.toContain('"probe"');

    expect(timelinePacket).toContain("timeline:manifest/variant/0");
    expect(timelinePacket).not.toContain("manifest:manifest/root");
    expect(containerPacket).toContain("sample:sample/variant/0/media/0");
    expect(containerPacket).not.toContain("timeline:manifest/variant/0");
    expect(manifestPacket).toContain("manifest:manifest/root");
    expect(manifestPacket).not.toContain("sample:sample/variant/0/media/0");

    const leadPacket = packetFor("lead-investigator");
    expect(leadPacket).toContain('"abr"');
    expect(leadPacket).not.toContain('"mediaSamples"');
    expect(leadPacket).not.toContain('"probe"');

    for (const agentId of ["timeline-playback", "container-encoding", "manifest-delivery"]) {
      expect(packetFor(agentId)).toContain("deterministicAbrSummary");
      expect(result.promptAudits.find((audit) => audit.agentId === agentId)?.packetMetrics)
        .toEqual(expect.objectContaining({ packetBytes: expect.any(Number), evidenceIdCount: expect.any(Number) }));
    }
    expect(result.promptAudits.find((audit) => audit.agentId === "manifest-delivery")?.packetMetrics)
      .toMatchObject({ sharedEvidenceIdCount: 0, sharedEvidenceRatio: 0 });
  });

  it("drops specialist findings that leave their evidence lane before the Lead synthesis", async () => {
    const run = vi.fn<RunStructured>(async (investigationId, agentId) => {
      if (agentId === "timeline-playback") {
        return {
          summary: "Timeline summary.",
          findings: [
            { title: "In-lane presentation gap", severity: "warning", explanation: "Gap between adjacent chunks.", evidenceIds: ["timeline:manifest/variant/0"], confidence: 0.9 },
            { title: "Out-of-lane manifest echo", severity: "info", explanation: "The manifest declares an audio group.", evidenceIds: ["manifest:manifest/root"], confidence: 0.9 },
            { title: "Cites unknown evidence", severity: "info", explanation: "Fabricated reference.", evidenceIds: ["does-not-exist"], confidence: 0.9 },
          ],
          limitations: [],
        };
      }
      return successfulRun(investigationId, agentId);
    });
    const laneEvidence: EvidenceBundleV2 = {
      ...structuredClone(evidence),
      hls: { variants: [
        { index: 0, uri: "v0.m3u8", bandwidth: 500_000 },
        { index: 1, uri: "v1.m3u8", bandwidth: 900_000 },
      ], renditions: [] },
      timeline: [{
        key: "manifest/variant/0",
        kind: "video" as const,
        segmentCount: 1,
        gaps: [],
        totalGapMs: 0,
        maxGapMs: 0,
        continuous: true,
      }],
    };

    const result = await createAi(run).investigate({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      evidence: laneEvidence,
    });

    expect(result.available).toBe(true);
    const leadPrompt = run.mock.calls.find((call) => call[1] === "lead-investigator")?.[3] ?? "";
    expect(leadPrompt).toContain("In-lane presentation gap");
    expect(leadPrompt).toContain("manifest:manifest/root");
    expect(leadPrompt).not.toContain("Out-of-lane manifest echo");
    expect(leadPrompt).not.toContain("Cites unknown evidence");
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

function fragmentSample(dts: string, nalType: number) {
  return {
    dts,
    pts: dts,
    nalTypes: [nalType],
    accessUnit: {
      nalTypes: [String(nalType)],
      isIrap: nalType === 19,
      hasVpsBeforeFirstVcl: false,
      hasSpsBeforeFirstVcl: false,
      hasPpsBeforeFirstVcl: false,
      parameterSetIdsReferenced: { vps: [], sps: [], pps: [] },
      containsRasl: false,
      containsRadl: false,
    },
    firstFrameKind: nalType === 19 ? "idr" as const : "other" as const,
  };
}
