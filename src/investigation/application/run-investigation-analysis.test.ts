import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvestigationJobRepository } from "../ports/investigation-job.js";
import type { InvestigationAI } from "../ports/investigation-ai.js";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";
import { createInvestigationAnalysisWorker } from "./run-investigation-analysis.js";

const claimedJob = {
  id: "16f42db1-2a1a-4bca-b6a0-d1fef18770c8",
  attempts: 1,
  maxAttempts: 3,
  investigation: {
    id: "c56a4180-65aa-42ec-a945-5fd21dec0538",
    sourceUrl: "https://example.test/master.m3u8",
    problemDescription: "Playback freezes.",
  },
};

const evidence = {
  schemaVersion: 2 as const,
  collectedAt: "2026-08-14T12:00:00.000Z",
  source: {
    requestedUrl: claimedJob.investigation.sourceUrl,
    finalUrl: claimedJob.investigation.sourceUrl,
    protocol: "hls" as const,
    httpStatus: 200,
  },
  manifests: [{
    artifactId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
    logicalKey: "manifest/root",
    role: "root" as const,
    requestedUrl: claimedJob.investigation.sourceUrl,
    finalUrl: claimedJob.investigation.sourceUrl,
    kind: "master" as const,
    sizeBytes: 100,
    variantCount: 1,
  }],
  mediaSamples: [],
  hls: { variants: [], renditions: [] },
  observations: [],
  limitations: ["Bounded deterministic sample."],
};

function createRepository(): InvestigationJobRepository {
  return {
    claimNext: vi.fn(async () => null),
    claimNextAnalysis: vi.fn(async () => claimedJob),
    heartbeat: vi.fn(async () => true),
    transition: vi.fn(async () => undefined),
    recordEvidenceBatch: vi.fn(async () => ({ snapshotId: "unused", supersededStorageKeys: [] })),
    loadLatestEvidence: vi.fn(async () => ({ id: "31cba26b-2200-42e2-b0ae-bafebae5856b", evidence: { ...evidence } })),
    recordAgentRuns: vi.fn(async () => undefined),
    completeCollection: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => "retrying" as const),
  };
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const ai: InvestigationAI = {
  investigate: async (input) => {
    await input.onProgress?.({ agent: "timeline-playback", stage: "started", completed: 0, total: 2 });
    await input.onProgress?.({ agent: "timeline-playback", stage: "completed", completed: 1, total: 2 });
    await input.onProgress?.({ agent: "lead-investigator", stage: "completed", completed: 2, total: 2 });
    return {
      available: true,
      likelyCause: "The bounded sample points to a timeline discontinuity.",
      findings: [],
      recommendations: [],
      limitations: [],
      agents: [
        { id: "timeline-playback", state: "completed" },
        { id: "lead-investigator", state: "completed" },
      ],
      promptAudits: [{
        agentId: "timeline-playback",
        attempt: 1,
        state: "completed",
        provider: "test",
        model: "test-model",
        systemPrompt: "system",
        prompt: "input",
        toolNames: [],
        toolCalls: [],
        output: { summary: "Measured timeline" },
      }],
    };
  },
};

describe("investigation analysis worker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("runs agents only after an analysis job exists", async () => {
    const repository = createRepository();
    const worker = createInvestigationAnalysisWorker({
      repository,
      ai,
      workerId: "worker-test",
      leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    const transitions = vi.mocked(repository.transition).mock.calls.map((call) => call[3]);
    expect(transitions.map((transition) => transition.state)).toEqual([
      "analyzing",
      "analyzing",
      "analyzing",
      "analyzing",
      "analyzing",
      "synthesizing",
    ]);
    expect(transitions.filter((transition) => transition.event.payload.stage === "ai_agent")).toHaveLength(3);
    expect(repository.recordAgentRuns).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      30_000,
      "31cba26b-2200-42e2-b0ae-bafebae5856b",
      [expect.objectContaining({ agentId: "timeline-playback" })],
    );
    expect(repository.complete).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      expect.any(String),
      expect.objectContaining({ placeholder: false, ai: expect.objectContaining({ available: true }) }),
      expect.objectContaining({ type: "investigation.report_ready" }),
    );
  });

  it("stays idle when analysis has not been requested", async () => {
    const repository = createRepository();
    vi.mocked(repository.claimNextAnalysis).mockResolvedValueOnce(null);
    const worker = createInvestigationAnalysisWorker({ repository, ai, workerId: "worker-test", leaseMs: 30_000 });

    await expect(worker.runNext()).resolves.toBe(false);
    expect(repository.loadLatestEvidence).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("attaches observed playback switches from related Record runs before running agents", async () => {
    const repository = createRepository();
    let receivedPlaybackSwitches: unknown;
    const capturingAi: InvestigationAI = {
      investigate: async (input) => {
        receivedPlaybackSwitches = input.evidence.playbackSwitches;
        return {
          available: true,
          findings: [],
          recommendations: [],
          limitations: [],
          agents: [{ id: "lead-investigator", state: "completed" }],
          promptAudits: [],
        };
      },
    };
    const worker = createInvestigationAnalysisWorker({
      repository,
      ai: capturingAi,
      workerId: "worker-test",
      leaseMs: 30_000,
      playbackCorrelation: {
        listObservedSwitches: vi.fn(async (): Promise<AbrSwitchEvidence[]> => [{
          evidenceId: "playback-switch:1",
          switchId: "switch:run:1",
          evidenceBasis: "PLAYBACK_NETWORK_OBSERVED",
          transitionStatus: "OBSERVED",
          timestamps: {},
          sourceRepresentation: { evidenceId: "representation:a", id: "a", periodIndex: 0, adaptationSetIndex: 0 },
          targetRepresentation: { evidenceId: "representation:b", id: "b", periodIndex: 0, adaptationSetIndex: 0 },
          direction: "DOWNSHIFT",
          switchKind: "RESOLUTION_CHANGING",
          switchingContract: { evidenceId: "contract:1", mode: "GENERAL_REINITIALIZATION", codecFamily: "HEVC", representations: ["a", "b"] },
          networkEvidence: { evidenceId: "network:1", requests: [] },
          decodeTests: [],
          deterministicFindings: [],
          missingEvidence: [],
        }]),
      },
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(receivedPlaybackSwitches).toHaveLength(1);
    const transitions = vi.mocked(repository.transition).mock.calls.map((call) => call[3]);
    expect(transitions).toContainEqual(expect.objectContaining({
      state: "analyzing",
      event: expect.objectContaining({ payload: expect.objectContaining({ stage: "playback_correlation", switchCount: 1 }) }),
    }));
  });

  it("leaves the evidence untouched when no playback switches exist", async () => {
    const repository = createRepository();
    let receivedPlaybackSwitches: unknown = "sentinel";
    const capturingAi: InvestigationAI = {
      investigate: async (input) => {
        receivedPlaybackSwitches = input.evidence.playbackSwitches;
        return {
          available: true,
          findings: [],
          recommendations: [],
          limitations: [],
          agents: [{ id: "lead-investigator", state: "completed" }],
          promptAudits: [],
        };
      },
    };
    const worker = createInvestigationAnalysisWorker({
      repository,
      ai: capturingAi,
      workerId: "worker-test",
      leaseMs: 30_000,
      playbackCorrelation: { listObservedSwitches: vi.fn(async () => []) },
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(receivedPlaybackSwitches).toBeUndefined();
    expect(vi.mocked(repository.transition).mock.calls.some((call) => call[3].event.payload.stage === "playback_correlation")).toBe(false);
  });

  it("logs claimed, stage changes and report_ready after a successful analysis", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const worker = createInvestigationAnalysisWorker({
      repository, ai, workerId: "worker-test", leaseMs: 30_000, logger,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(logger.info).toHaveBeenCalledWith("worker.job_claimed", expect.objectContaining({
      jobKind: "investigation-analysis",
      investigationId: claimedJob.investigation.id,
      attempt: 1,
    }));
    expect(logger.info).toHaveBeenCalledWith("investigation.state_changed", expect.objectContaining({ state: "analyzing" }));
    expect(logger.info).toHaveBeenCalledWith("investigation.state_changed", expect.objectContaining({ state: "synthesizing" }));
    expect(logger.info).toHaveBeenCalledWith("investigation.report_ready", expect.objectContaining({
      snapshotId: "31cba26b-2200-42e2-b0ae-bafebae5856b",
      available: true,
      agentCount: 2,
    }));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs an unavailable agent analysis as a warning, not a failure", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const unavailableAi: InvestigationAI = {
      investigate: async () => ({
        available: false,
        findings: [],
        recommendations: [],
        limitations: [],
        agents: [],
        promptAudits: [],
      }),
    };
    const worker = createInvestigationAnalysisWorker({
      repository, ai: unavailableAi, workerId: "worker-test", leaseMs: 30_000, logger,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(logger.warn).toHaveBeenCalledWith("investigation.analysis_unavailable", expect.objectContaining({ attempt: 1 }));
    expect(logger.error).not.toHaveBeenCalled();
  });
});
