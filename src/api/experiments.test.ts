import { describe, expect, it, vi } from "vitest";
import type { ExperimentService } from "../experiment/application/experiments.js";
import type { ExperimentDetail } from "../experiment/domain/experiment.js";
import { buildApiServer } from "./server.js";

const investigationId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const experimentId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
const testRequestId = "7d9d633e-3118-42e9-a4bb-2d917bbe3290";
const cloneId = "b27d184e-b47a-4a5c-b8a6-b42152083ea9";
const iterationId = "4a30ea1e-1272-4f48-bbf0-7f24b84521ea";

describe("experiment REST routes", () => {
  it("creates and reads an experiment through the shared application service", async () => {
    const service = fakeService();
    const server = build(service);
    const created = await server.inject({ method: "POST", url: `/v1/investigations/${investigationId}/experiments`, payload: {
      goal: "Determine the startup failure", createdBy: "workspace-user",
      hypotheses: [{ statement: "Highest representation fails", rationale: "Reported on device", evidenceFor: [], evidenceAgainst: [] }],
    } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ experiment: { id: experimentId, status: "AWAITING_TESTS" } });
    expect(service.createExperiment).toHaveBeenCalledWith(investigationId, expect.objectContaining({ goal: "Determine the startup failure" }));

    const read = await server.inject({ method: "GET", url: `/v1/experiments/${experimentId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ experiment: { activeTestRequestId: testRequestId } });
    await server.close();
  });

  it("selects a treatment while returning the permanent experiment URL", async () => {
    const service = fakeService();
    const server = build(service);
    const response = await server.inject({ method: "POST", url: `/v1/test-requests/${testRequestId}/activate` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ playbackUrl: `/streams/experiments/${experimentId}/index.m3u8`, testRequest: { id: testRequestId } });
    await server.close();
  });

  it("queues recoverable agent evaluation instead of returning a template conclusion", async () => {
    const service = fakeService();
    const server = build(service);
    const response = await server.inject({ method: "POST", url: `/v1/experiments/${experimentId}/evaluate` });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ evaluationJob: { job: { status: "pending" }, replayed: false } });
    expect(service.evaluate).toHaveBeenCalledWith(experimentId);
    await server.close();
  });

  it("accepts an observed DASH representation ID when creating an iteration", async () => {
    const service = fakeService();
    const server = build(service);
    const response = await server.inject({ method: "POST", url: `/v1/experiments/${experimentId}/iterations`, payload: {
      rationale: "Control plus one source representation",
      cloneSpecs: [{
        version: "1", source: { investigationId, mode: "recorded_snapshot" }, mode: "manifest_only",
        abr: { mode: "single_representation", representationIds: ["video_por=7094000"] },
        manifest: { normalisation: "preserve", operations: [{ op: "filter_representations", representationIds: ["video_por=7094000"] }] },
        reason: { role: "treatment", shortLabel: "LOW-BR", hypothesisIds: [], description: "Select one source representation", expectedDiscriminatingSignal: "Compare with control" },
      }],
    } });
    expect(response.statusCode).toBe(201);
    expect(service.createIteration).toHaveBeenCalledWith(experimentId, expect.objectContaining({
      cloneSpecs: [expect.objectContaining({ abr: { mode: "single_representation", representationIds: ["video_por=7094000"] } })],
    }));
    await server.close();
  });

  it("rejects malformed TestResults before the application service", async () => {
    const service = fakeService();
    const server = build(service);
    const response = await server.inject({ method: "POST", url: `/v1/test-requests/${testRequestId}/results`, payload: {
      outcome: "PASS", failureStage: "STARTUP", reportedBy: "workspace-user", reportedVia: "USER",
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_TEST_RESULT" } });
    expect(service.submitTestResult).not.toHaveBeenCalled();
    await server.close();
  });

  it("rejects command-like CloneSpec input without exposing a command API", async () => {
    const service = fakeService();
    const server = build(service);
    const response = await server.inject({ method: "POST", url: "/v1/clone-specs/validate", payload: { spec: {
      version: "1", source: { investigationId, mode: "recorded_snapshot" }, mode: "transcode",
      video: { codec: "h264; sh -c id" }, reason: { role: "treatment", shortLabel: "BAD", hypothesisIds: [], description: "Bad input", expectedDiscriminatingSignal: "None" },
    } } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ valid: false });
    expect(service.validateSpec).not.toHaveBeenCalled();
    expect(server.hasRoute({ method: "POST", url: "/v1/run-shell" })).toBe(false);
    await server.close();
  });
});

function build(experimentService: ExperimentService) {
  return buildApiServer({
    storage: { check: async () => undefined },
    startInvestigation: async () => ({ created: true, investigation: { id: investigationId, sourceUrl: "https://example.test/master.m3u8", state: "completed", createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" } }),
    investigationQueries: { getInvestigation: async () => null, getReport: async () => null, listEventsAfter: async () => [], listInvestigations: async () => [] },
    experimentService,
  });
}

function fakeService(): ExperimentService {
  const detail = experimentDetail();
  return {
    policy: { maxClonesPerIteration: 4, maxIterations: 3, maxClonesPerExperiment: 12, requireFirstIterationControl: true },
    listCapabilities: vi.fn(() => ({ executionPlanVersion: "1", cloneSpecVersion: "1", sourceModes: [], modes: [], recipes: [], policy: {}, drm: {} })),
    validateSpec: vi.fn(async () => ({ valid: true as const, errors: [], warnings: [], plan: detail.clones[0]!.executionPlan })),
    previewSpec: vi.fn(), expandRecipe: vi.fn(),
    createExperiment: vi.fn(async () => detail), listExperiments: vi.fn(async () => [detail]), getExperiment: vi.fn(async () => detail), getClone: vi.fn(async () => detail.clones[0]!),
    listTestRequests: vi.fn(async () => detail.testRequests), activateTestRequest: vi.fn(async () => ({ testRequest: detail.testRequests[0]!, playbackUrl: detail.testRequests[0]!.testUrl })),
    createIteration: vi.fn(async () => detail.iterations[0]!), queueClones: vi.fn(async () => detail), submitTestResult: vi.fn(), evaluate: vi.fn(async () => ({ job: { id: "119cf9db-e502-4c50-950d-a88c8f3644d9", experimentId, iterationId, status: "pending", attempts: 0, maxAttempts: 3, createdAt: "2026-08-11T00:00:00.000Z" }, replayed: false })), createEnvironment: vi.fn(), listEnvironments: vi.fn(async () => []),
  } as unknown as ExperimentService;
}

function experimentDetail(): ExperimentDetail {
  const spec = { version: "1" as const, source: { investigationId, mode: "recorded_snapshot" as const }, mode: "manifest_only" as const, reason: { role: "control" as const, shortLabel: "CONTROL", hypothesisIds: [], description: "Control", expectedDiscriminatingSignal: "Compare" } };
  const plan = { version: "1" as const, specVersion: "1" as const, protocol: "hls" as const, sourceMode: "recorded_snapshot" as const, transformations: [{ kind: "record_snapshot" as const, description: "Record" }], selection: { videoRepresentationIds: ["variant-0"], audioMode: "preserve" as const, expectedAudioRenditionCount: 0 }, processes: [], whatChanged: "Control", expectedDiscriminatingSignal: "Compare", sourceArtifactIds: [] };
  return {
    id: experimentId, investigationId, goal: "Determine failure", status: "AWAITING_TESTS", createdBy: "workspace-user", activeTestRequestId: testRequestId,
    createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
    hypotheses: [{ id: "019e36cb-c471-4205-86f7-3560ff51ebf9", experimentId, statement: "Highest representation fails", rationale: "Device report", evidenceFor: [], evidenceAgainst: [], status: "OPEN", createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" }],
    iterations: [{ id: iterationId, experimentId, iterationNumber: 1, rationale: "Control", cloneSpecs: [spec], status: "AWAITING_TESTS", createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" }],
    clones: [{ id: cloneId, experimentId, iterationId, recordingId: "33313009-e742-4591-baf3-8b7747a820c5", shortLabel: "EXP-E1-CONTROL", isControl: true, state: "READY", spec, specHash: "hash", executionPlan: plan, provenance: {}, createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" }],
    testRequests: [{ id: testRequestId, experimentId, iterationId, cloneId, shortLabel: "EXP-E1-CONTROL", testUrl: `/streams/experiments/${experimentId}/index.m3u8`, instructions: "Select and replay", hypothesisIds: [], status: "PENDING", createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" }], evaluations: [],
  };
}
