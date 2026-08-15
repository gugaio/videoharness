import { describe, expect, it, vi } from "vitest";
import type { AgentModelRunner } from "../../agents/ports/agent-model-runner.js";
import type { CloneExecutionPlan, CloneSpec } from "../domain/clone-spec.js";
import type { ExperimentDetail, ExperimentEvaluation, TestResult } from "../domain/experiment.js";
import { PiExperimentAnalysisTeam } from "./pi-experiment-analysis.js";

const investigationId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
const experimentId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const iterationId = "7d9d633e-3118-42e9-a4bb-2d917bbe3290";
const hypothesisId = "b27d184e-b47a-4a5c-b8a6-b42152083ea9";

describe("post-experiment agent team", () => {
  it("runs auditor, causal analyst and lead while preserving the deterministic guardrail", async () => {
    const calls: Array<{ agentId: string; prompt: string }> = [];
    const runner = vi.fn<AgentModelRunner>(async (input) => {
      calls.push({ agentId: input.agentId, prompt: input.prompt });
      if (input.agentId === "experiment-evidence-auditor") return {
        summary: "CONTROL stalled and LOW-BR passed.", observedComparison: "One user-reported replay each.", evidenceQuality: "MEDIUM", contradictions: [], missingEvidence: ["request journal"],
      };
      if (input.agentId === "experiment-causal-analyst") return {
        summary: "The result narrows the issue to representation exposure.", interpretation: "The test supports bitrate or ABR sensitivity, not origin latency.",
        alternativeExplanations: ["A representation-specific incompatibility."], claimsNotEstablished: ["Origin latency."], nextMeasurements: ["Test one higher representation."],
      };
      return {
        causalScope: "TREATMENT_EFFECT_ONLY",
        title: "LOW-BR changed the observed result without proving origin latency",
        interpretation: "Restricting the ladder removed the reported stall in this run; the mechanism remains open.",
        alternativeExplanations: ["ABR selection behavior.", "Representation-specific compatibility."], additionalLimitations: ["No repeated replay."],
        confidenceRationale: "The split is discriminating but based on sparse user-reported outcomes.",
        nextTest: { title: "Test a higher representation alone", rationale: "Separate bitrate from ABR choice.", change: "Expose one higher representation.", expectedSignal: "A higher-only failure supports representation pressure or compatibility." },
      };
    });
    const team = new PiExperimentAnalysisTeam({ provider: "openai", apiUrl: "https://example.test/v1", model: "test", timeoutMs: 1_000, runner });
    const result = await team.analyze({ experiment: detail(), evaluation: evaluation() });

    expect(calls.map((entry) => entry.agentId)).toEqual(["experiment-evidence-auditor", "experiment-causal-analyst", "experiment-lead-investigator"]);
    expect(calls[1]!.prompt).toContain("High latency at the original origin");
    expect(calls[2]!.prompt).toContain("The result supports bitrate or ABR sensitivity, not origin latency.");
    expect(result.agents.map((entry) => entry.state)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED"]);
    expect(result.narrative?.interpretation).toContain("mechanism remains open");
  });

  it("returns explicit unavailable agents without pretending that AI ran", async () => {
    const team = new PiExperimentAnalysisTeam({ provider: "openai", apiUrl: "https://example.test/v1", model: "test", timeoutMs: 1_000 });
    const result = await team.analyze({ experiment: detail(), evaluation: evaluation() });
    expect(result.narrative).toBeUndefined();
    expect(result.agents.every((entry) => entry.state === "UNAVAILABLE")).toBe(true);
  });
});

function detail(): ExperimentDetail {
  const controlSpec = spec("control");
  const treatmentSpec = spec("treatment");
  return {
    id: experimentId, investigationId, goal: "Determine whether bitrate pressure causes the stall", status: "EVALUATING", createdBy: "workspace-user",
    createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z",
    hypotheses: [{ id: hypothesisId, experimentId, statement: "High origin latency causes the stall", rationale: "Original report, but clone cannot emulate origin latency.", evidenceFor: [], evidenceAgainst: [], status: "OPEN", createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T09:00:00.000Z" }],
    iterations: [{ id: iterationId, experimentId, iterationNumber: 1, rationale: "CONTROL plus LOW-BR", cloneSpecs: [controlSpec, treatmentSpec], status: "EVALUATING", createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" }],
    clones: [
      { id: "31d7cd14-b638-42ee-8df4-a7590b24653f", experimentId, iterationId, recordingId: "91d7cd14-b638-42ee-8df4-a7590b24653f", shortLabel: "CONTROL", isControl: true, state: "READY", spec: controlSpec, specHash: "control-hash", executionPlan: plan(false), provenance: {}, createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T10:00:00.000Z" },
      { id: "40a78a3e-358f-448d-8806-c2b13f274c21", experimentId, iterationId, recordingId: "90a78a3e-358f-448d-8806-c2b13f274c21", shortLabel: "LOW-BR", isControl: false, state: "READY", spec: treatmentSpec, specHash: "low-hash", executionPlan: plan(true), provenance: {}, createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T10:00:00.000Z" },
    ],
    testRequests: [
      request("a1d7cd14-b638-42ee-8df4-a7590b24653f", "31d7cd14-b638-42ee-8df4-a7590b24653f", "CONTROL", [], result("f1d7cd14-b638-42ee-8df4-a7590b24653f", "a1d7cd14-b638-42ee-8df4-a7590b24653f", "FAIL")),
      request("a0a78a3e-358f-448d-8806-c2b13f274c21", "40a78a3e-358f-448d-8806-c2b13f274c21", "LOW-BR", [hypothesisId], result("f0a78a3e-358f-448d-8806-c2b13f274c21", "a0a78a3e-358f-448d-8806-c2b13f274c21", "PASS")),
    ],
    evaluations: [],
  };
}

function evaluation(): ExperimentEvaluation {
  return {
    id: "019e36cb-c471-4205-86f7-3560ff51ebf9", experimentId, iterationId, status: "MORE_TESTS_REQUIRED", confidence: "MEDIUM",
    summary: "LOW-BR changed the result.", hypothesisUpdates: [], evidenceBundle: { original: { reportId: "report-1" } },
    analysis: {
      schemaVersion: 1, source: "DETERMINISTIC", outcome: "DISCRIMINATING_EFFECT", title: "Treatment changed the result",
      observation: "CONTROL failed at STALL; LOW-BR passed.", interpretation: "Representation exposure changed the outcome.",
      supportedClaim: "The result supports bitrate or ABR sensitivity, not origin latency.",
      notEstablished: ["High latency at the original origin"], alternativeExplanations: ["ABR selection"], limitations: ["User reported"],
      confidenceRationale: "Single comparison", nextTest: { title: "Repeat", rationale: "Reproduce", change: "Repeat both", expectedSignal: "Same split" }, evidenceIds: [], agents: [],
    },
    createdAt: "2026-08-11T12:00:00.000Z",
  };
}

function spec(role: "control" | "treatment"): CloneSpec {
  return { version: "1", source: { investigationId, mode: "recorded_snapshot" }, mode: "manifest_only", abr: { mode: role === "control" ? "preserve" : "single_representation", representationIds: role === "control" ? [] : ["variant-1"] }, reason: { role, shortLabel: role === "control" ? "CONTROL" : "LOW-BR", hypothesisIds: role === "control" ? [] : [hypothesisId], description: "Controlled comparison", expectedDiscriminatingSignal: "Compare results" } };
}

function plan(filtered: boolean): CloneExecutionPlan {
  return { version: "1", specVersion: "1", protocol: "hls", sourceMode: "recorded_snapshot", transformations: [{ kind: "record_snapshot", description: "Record" }, ...(filtered ? [{ kind: "filter_video_representations" as const, description: "Expose variant-1", representationIds: ["variant-1"] }] : [])], selection: { videoRepresentationIds: filtered ? ["variant-1"] : ["variant-0", "variant-1"], audioMode: "preserve", expectedAudioRenditionCount: 0 }, processes: [], whatChanged: filtered ? "Expose variant-1 only" : "Preserve ladder", expectedDiscriminatingSignal: "Compare", sourceArtifactIds: [] };
}

function request(id: string, cloneId: string, shortLabel: string, hypothesisIds: string[], testResult: TestResult) {
  return { id, experimentId, iterationId, cloneId, shortLabel, testUrl: `/streams/experiments/${experimentId}/index.m3u8`, instructions: "Replay", hypothesisIds, status: "COMPLETED" as const, result: testResult, createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" };
}

function result(id: string, testRequestId: string, outcome: "PASS" | "FAIL"): TestResult {
  return { id, testRequestId, outcome, ...(outcome === "FAIL" ? { failureStage: "STALL" as const } : {}), evidenceArtifactIds: [], reportedBy: "workspace-user", reportedVia: "USER", occurredAt: "2026-08-11T11:00:00.000Z", createdAt: "2026-08-11T11:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" };
}
