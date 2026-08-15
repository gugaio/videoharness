import { describe, expect, it, vi } from "vitest";
import type { InvestigationQueries } from "../../investigation/application/investigation-queries.js";
import type { ExperimentDetail, ExperimentEvaluation } from "../domain/experiment.js";
import type { ExperimentAnalysisTeam } from "../ports/experiment-analysis.js";
import type { ExperimentEvaluationJobRepository } from "../ports/experiment-evaluation-job.js";
import type { ExperimentRepository } from "../ports/experiment-repository.js";
import { createExperimentEvaluationWorker } from "./run-experiment-evaluation.js";

const experimentId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const investigationId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
const iterationId = "7d9d633e-3118-42e9-a4bb-2d917bbe3290";

describe("experiment evaluation worker", () => {
  it("persists an agent synthesis on top of the deterministic comparison", async () => {
    const saved: ExperimentEvaluation[] = [];
    const complete = vi.fn(async () => true);
    const jobs = {
      claimNext: vi.fn(async () => ({ id: "019e36cb-c471-4205-86f7-3560ff51ebf9", experimentId, iterationId, status: "running" as const, attempts: 1, maxAttempts: 3, createdAt: "2026-08-11T12:00:00.000Z" })),
      heartbeat: vi.fn(async () => true), complete, fail: vi.fn(async () => "retrying" as const), request: vi.fn(),
    } satisfies ExperimentEvaluationJobRepository;
    const experiment = detail();
    const experiments = {
      findById: vi.fn(async () => experiment),
      saveEvaluation: vi.fn(async (evaluation: Omit<ExperimentEvaluation, "createdAt">) => {
        const value = { ...evaluation, createdAt: "2026-08-11T12:01:00.000Z" };
        saved.push(value);
        return value;
      }),
    } as unknown as ExperimentRepository;
    const investigations = {
      getInvestigation: vi.fn(), listEventsAfter: vi.fn(async () => []),
      listInvestigations: vi.fn(async () => []),
      getReport: vi.fn(async () => ({ id: "report-1", investigationId, schemaVersion: 1, content: { placeholder: true as const, title: "Legacy", summary: "Legacy", findings: [], confidence: { level: "not_assessed" as const, explanation: "Pending" }, generatedBy: "phase-1-lifecycle-fixture" as const }, createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T09:00:00.000Z" })),
    } satisfies InvestigationQueries;
    const analysisTeam = {
      analyze: vi.fn(async () => ({
        narrative: {
          title: "LOW-BR changed the result without proving the original cause",
          interpretation: "The observed effect is bounded to representation exposure.",
          alternativeExplanations: ["ABR choice"], additionalLimitations: ["No request journal"], confidenceRationale: "One attributed comparison.",
          nextTest: { title: "Test high-only", rationale: "Separate variables", change: "Expose one high representation", expectedSignal: "High-only reproduces the stall" },
        },
        agents: [
          { id: "experiment-evidence-auditor" as const, label: "Evidence Auditor", state: "COMPLETED" as const, summary: "Facts audited" },
          { id: "experiment-causal-analyst" as const, label: "Causal Analyst", state: "COMPLETED" as const, summary: "Scope bounded" },
          { id: "experiment-lead-investigator" as const, label: "Lead Experiment Investigator", state: "COMPLETED" as const, summary: "Synthesis ready" },
        ],
      })),
    } satisfies ExperimentAnalysisTeam;
    const worker = createExperimentEvaluationWorker({ jobs, experiments, investigations, analysisTeam, workerId: "test-worker", leaseMs: 30_000 });

    expect(await worker.runNext()).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.hypothesisUpdates[0]?.status).toBe("PARTIALLY_SUPPORTED");
    expect(saved[0]?.analysis).toMatchObject({ source: "AI_ASSISTED", title: "LOW-BR changed the result without proving the original cause" });
    expect(saved[0]?.analysis?.agents).toHaveLength(3);
    expect(complete).toHaveBeenCalled();
  });
});

function detail(): ExperimentDetail {
  const hypothesisId = "b27d184e-b47a-4a5c-b8a6-b42152083ea9";
  const controlCloneId = "31d7cd14-b638-42ee-8df4-a7590b24653f";
  const treatmentCloneId = "40a78a3e-358f-448d-8806-c2b13f274c21";
  const base = { version: "1" as const, source: { investigationId, mode: "recorded_snapshot" as const }, mode: "manifest_only" as const };
  const controlSpec = { ...base, abr: { mode: "preserve" as const, representationIds: [] }, reason: { role: "control" as const, shortLabel: "CONTROL", hypothesisIds: [], description: "Preserve ladder", expectedDiscriminatingSignal: "Compare" } };
  const treatmentSpec = { ...base, abr: { mode: "single_representation" as const, representationIds: ["variant-1"] }, reason: { role: "treatment" as const, shortLabel: "LOW-BR", hypothesisIds: [hypothesisId], description: "Expose variant-1", expectedDiscriminatingSignal: "Compare" } };
  const plan = (treatment: boolean) => ({ version: "1" as const, specVersion: "1" as const, protocol: "hls" as const, sourceMode: "recorded_snapshot" as const, transformations: [{ kind: "record_snapshot" as const, description: "Record" }, ...(treatment ? [{ kind: "filter_video_representations" as const, description: "Filter", representationIds: ["variant-1"] }] : [])], selection: { videoRepresentationIds: treatment ? ["variant-1"] : ["variant-0", "variant-1"], audioMode: "preserve" as const, expectedAudioRenditionCount: 0 }, processes: [], whatChanged: treatment ? "Expose variant-1" : "Preserve ladder", expectedDiscriminatingSignal: "Compare", sourceArtifactIds: [] });
  const result = (id: string, requestId: string, outcome: "PASS" | "FAIL") => ({ id, testRequestId: requestId, outcome, ...(outcome === "FAIL" ? { failureStage: "STALL" as const } : {}), evidenceArtifactIds: [], reportedBy: "workspace-user", reportedVia: "USER" as const, occurredAt: "2026-08-11T11:00:00.000Z", createdAt: "2026-08-11T11:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" });
  return {
    id: experimentId, investigationId, goal: "Determine failure", status: "EVALUATING", createdBy: "workspace-user", createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z",
    hypotheses: [{ id: hypothesisId, experimentId, statement: "High origin latency causes the stall", rationale: "Original report", evidenceFor: [], evidenceAgainst: [], status: "OPEN", createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T09:00:00.000Z" }],
    iterations: [{ id: iterationId, experimentId, iterationNumber: 1, rationale: "CONTROL + LOW-BR", cloneSpecs: [controlSpec, treatmentSpec], status: "EVALUATING", createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" }],
    clones: [
      { id: controlCloneId, experimentId, iterationId, recordingId: "91d7cd14-b638-42ee-8df4-a7590b24653f", shortLabel: "CONTROL", isControl: true, state: "READY", spec: controlSpec, specHash: "control", executionPlan: plan(false), provenance: {}, createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T10:00:00.000Z" },
      { id: treatmentCloneId, experimentId, iterationId, recordingId: "90a78a3e-358f-448d-8806-c2b13f274c21", shortLabel: "LOW-BR", isControl: false, state: "READY", spec: treatmentSpec, specHash: "treatment", executionPlan: plan(true), provenance: {}, createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T10:00:00.000Z" },
    ],
    testRequests: [
      { id: "a1d7cd14-b638-42ee-8df4-a7590b24653f", experimentId, iterationId, cloneId: controlCloneId, shortLabel: "CONTROL", testUrl: "url", instructions: "Replay", hypothesisIds: [], status: "COMPLETED", result: result("f1d7cd14-b638-42ee-8df4-a7590b24653f", "a1d7cd14-b638-42ee-8df4-a7590b24653f", "FAIL"), createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" },
      { id: "a0a78a3e-358f-448d-8806-c2b13f274c21", experimentId, iterationId, cloneId: treatmentCloneId, shortLabel: "LOW-BR", testUrl: "url", instructions: "Replay", hypothesisIds: [hypothesisId], status: "COMPLETED", result: result("f0a78a3e-358f-448d-8806-c2b13f274c21", "a0a78a3e-358f-448d-8806-c2b13f274c21", "PASS"), createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" },
    ], evaluations: [],
  };
}
