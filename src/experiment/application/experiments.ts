import { randomUUID } from "node:crypto";
import type { InvestigationQueries } from "../../investigation/application/investigation-queries.js";
import type { CloneRecipeName, CloneSpec } from "../domain/clone-spec.js";
import {
  defaultExperimentPolicy,
  assertExperimentTransition,
  validateIterationBudget,
  type ExperimentDetail,
  type ExperimentPolicy,
  type TestEnvironment,
  type TestResult,
} from "../domain/experiment.js";
import type { ExperimentRepository, SubmitTestResultRecord } from "../ports/experiment-repository.js";
import {
  cloneSourceEvidenceFromReport,
  cloneSpecHash,
  compileCloneSpec,
  expandCloneRecipe,
  listCloneCapabilities,
} from "./clone-compiler.js";
import { evaluateExperimentEvidence } from "./evaluate-experiment.js";

export class ExperimentApplicationError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) {
    super(message);
    this.name = "ExperimentApplicationError";
  }
}

export function createExperimentService(input: {
  repository: ExperimentRepository;
  investigations: InvestigationQueries;
  policy?: ExperimentPolicy;
  logger?: { info(event: string, details?: Record<string, unknown>): void };
}) {
  const policy = input.policy ?? defaultExperimentPolicy;
  const activity = input.logger ?? { info: (): void => undefined };

  async function sourceContext(investigationId: string) {
    const investigation = await input.investigations.getInvestigation(investigationId);
    if (!investigation) throw new ExperimentApplicationError("INVESTIGATION_NOT_FOUND", "Investigation not found", 404);
    if (investigation.state !== "completed") throw new ExperimentApplicationError("INVESTIGATION_NOT_READY", "Experiments require a completed deterministic investigation");
    const report = await input.investigations.getReport(investigationId);
    if (!report) throw new ExperimentApplicationError("REPORT_NOT_READY", "Experiments require a deterministic report");
    try {
      return { investigation, report, source: cloneSourceEvidenceFromReport(investigationId, report) };
    } catch (error) { throw cloneApplicationError(error); }
  }

  return {
    policy,
    listCapabilities: () => ({
      executionPlanVersion: "1" as const,
      cloneSpecVersion: "1" as const,
      sourceModes: [
        { mode: "recorded_snapshot" as const, supported: true },
        { mode: "live_proxy" as const, supported: false, limitation: "Live proxy transformation is intentionally deferred." },
      ],
      modes: [
        { mode: "manifest_only" as const, supported: true },
        { mode: "remux" as const, supported: false },
        { mode: "repackage" as const, supported: false },
        { mode: "transcode" as const, supported: false },
        { mode: "hybrid" as const, supported: false },
      ],
      recipes: listCloneCapabilities(),
      policy,
      drm: { analyzeSignalling: true, transformEncryptedMedia: false, stripOrBypass: false },
    }),

    async validateSpec(spec: CloneSpec) {
      try {
        const { source } = await sourceContext(spec.source.investigationId);
        const plan = compileCloneSpec(spec, source);
        activity.info("experiment.clone_spec_validated", { investigationId: spec.source.investigationId, cloneSpecHash: cloneSpecHash(spec), valid: true });
        return { valid: true as const, errors: [], warnings: source.live ? ["The source is live and cannot be cloned by the current worker."] : [], plan };
      } catch (error) {
        const reasons = error && typeof error === "object" && "reasons" in error && Array.isArray(error.reasons)
          ? error.reasons.map(String)
          : [error instanceof Error ? error.message : "CloneSpec validation failed"];
        activity.info("experiment.clone_spec_validated", { investigationId: spec.source.investigationId, cloneSpecHash: cloneSpecHash(spec), valid: false, errors: reasons });
        return { valid: false as const, errors: reasons, warnings: [] };
      }
    },

    async previewSpec(spec: CloneSpec) {
      const { source } = await sourceContext(spec.source.investigationId);
      try {
        return { spec, specHash: cloneSpecHash(spec), plan: compileCloneSpec(spec, source) };
      } catch (error) { throw cloneApplicationError(error); }
    },

    async expandRecipe(recipe: {
      recipe: CloneRecipeName;
      investigationId: string;
      shortLabel: string;
      hypothesisIds: string[];
      representationId?: string;
      targetBitrate?: number;
      width?: number;
      height?: number;
    }) {
      const { source } = await sourceContext(recipe.investigationId);
      try {
        const spec = expandCloneRecipe(recipe, source);
        return { spec, specHash: cloneSpecHash(spec), plan: compileCloneSpec(spec, source) };
      } catch (error) { throw cloneApplicationError(error); }
    },

    async createExperiment(investigationId: string, value: {
      goal: string;
      createdBy: string;
      targetEnvironmentId?: string;
      hypotheses: Array<{ statement: string; rationale: string; evidenceFor: string[]; evidenceAgainst: string[] }>;
    }): Promise<ExperimentDetail> {
      await sourceContext(investigationId);
      if (value.targetEnvironmentId) {
        const exists = (await input.repository.listEnvironments()).some((entry) => entry.id === value.targetEnvironmentId);
        if (!exists) throw new ExperimentApplicationError("TEST_ENVIRONMENT_NOT_FOUND", "Target test environment not found", 404);
      }
      const experimentId = randomUUID();
      const created = await input.repository.createExperiment({
        id: experimentId,
        investigationId,
        goal: value.goal,
        createdBy: value.createdBy,
        ...(value.targetEnvironmentId ? { targetEnvironmentId: value.targetEnvironmentId } : {}),
        hypotheses: value.hypotheses.map((hypothesis) => ({ id: randomUUID(), ...hypothesis })),
      });
      activity.info("experiment.created", { investigationId, experimentId: created.id, hypothesisCount: created.hypotheses.length });
      return created;
    },

    listExperiments: (investigationId: string) => input.repository.listByInvestigation(investigationId),
    getExperiment: (id: string) => input.repository.findById(id),
    getClone: (id: string) => input.repository.findClone(id),
    listTestRequests: (experimentId: string) => input.repository.listTestRequests(experimentId),

    async activateTestRequest(testRequestId: string) {
      const selected = await input.repository.activateTestRequest(testRequestId);
      if (selected === "not_found") throw new ExperimentApplicationError("TEST_REQUEST_NOT_FOUND", "Test request not found", 404);
      if (selected === "not_ready") throw new ExperimentApplicationError("TEST_REQUEST_NOT_READY", "The selected clone is not ready for playback");
      activity.info("experiment.test_request_activated", { experimentId: selected.experimentId, iterationId: selected.iterationId, cloneId: selected.cloneId, testRequestId: selected.id });
      return { testRequest: selected, playbackUrl: selected.testUrl };
    },

    async createIteration(experimentId: string, value: { rationale: string; cloneSpecs: CloneSpec[] }) {
      const experiment = await input.repository.findById(experimentId);
      if (!experiment) throw new ExperimentApplicationError("EXPERIMENT_NOT_FOUND", "Experiment not found", 404);
      const { source } = await sourceContext(experiment.investigationId);
      try { assertExperimentTransition(experiment.status, "PLANNED"); }
      catch { throw new ExperimentApplicationError("INVALID_EXPERIMENT_STATE", "The experiment cannot accept another iteration in its current state"); }
      const iterationNumber = experiment.iterations.length + 1;
      try {
        validateIterationBudget({ iterationNumber, existingCloneCount: experiment.clones.length, specs: value.cloneSpecs, policy });
      } catch (error) { throw cloneApplicationError(error); }
      const hypothesisIds = new Set(experiment.hypotheses.map((entry) => entry.id));
      for (const spec of value.cloneSpecs) {
        if (spec.source.investigationId !== experiment.investigationId) throw new ExperimentApplicationError("CLONE_SOURCE_MISMATCH", "Every CloneSpec must reference the experiment investigation");
        if (spec.reason.hypothesisIds.some((id) => !hypothesisIds.has(id))) throw new ExperimentApplicationError("HYPOTHESIS_NOT_FOUND", "CloneSpec references a hypothesis outside the experiment");
        try { compileCloneSpec(spec, source); } catch (error) { throw cloneApplicationError(error); }
      }
      const created = await input.repository.createIteration({ id: randomUUID(), experimentId, rationale: value.rationale, cloneSpecs: value.cloneSpecs });
      if (created === "not_found") throw new ExperimentApplicationError("EXPERIMENT_NOT_FOUND", "Experiment not found", 404);
      if (created === "invalid_state") throw new ExperimentApplicationError("INVALID_EXPERIMENT_STATE", "The experiment cannot accept another iteration in its current state");
      activity.info("experiment.iteration_created", { investigationId: experiment.investigationId, experimentId, iterationId: created.id, iterationNumber: created.iterationNumber, cloneCount: created.cloneSpecs.length });
      return created;
    },

    async queueClones(experimentId: string, iterationId: string) {
      const experiment = await input.repository.findById(experimentId);
      if (!experiment) throw new ExperimentApplicationError("EXPERIMENT_NOT_FOUND", "Experiment not found", 404);
      try { assertExperimentTransition(experiment.status, "BUILDING_CLONES"); }
      catch { throw new ExperimentApplicationError("INVALID_EXPERIMENT_STATE", "The experiment is not ready to build clones"); }
      const iteration = experiment.iterations.find((entry) => entry.id === iterationId);
      if (!iteration) throw new ExperimentApplicationError("ITERATION_NOT_FOUND", "Experiment iteration not found", 404);
      const { investigation, source } = await sourceContext(experiment.investigationId);
      const prefix = shortEnvironmentPrefix(experiment.targetEnvironment);
      const seenLabels = new Set<string>();
      const clones = iteration.cloneSpecs.map((spec) => {
        let plan;
        try { plan = compileCloneSpec(spec, source); } catch (error) { throw cloneApplicationError(error); }
        const shortLabel = `${prefix}-E${iteration.iterationNumber}-${spec.reason.shortLabel.toUpperCase()}`;
        if (seenLabels.has(shortLabel)) throw new ExperimentApplicationError("DUPLICATE_CLONE_LABEL", `Duplicate clone label ${shortLabel}`);
        seenLabels.add(shortLabel);
        return {
          id: randomUUID(),
          recordingId: randomUUID(),
          jobId: randomUUID(),
          shortLabel,
          isControl: spec.reason.role === "control",
          sourceUrl: investigation.sourceUrl,
          protocol: source.protocol,
          durationSeconds: spec.source.snapshotDurationSeconds ?? 120,
          spec,
          specHash: cloneSpecHash(spec),
          plan,
        };
      });
      const result = await input.repository.queueClones({ experimentId, iterationId, clones });
      if (result === "not_found") throw new ExperimentApplicationError("ITERATION_NOT_FOUND", "Experiment iteration not found", 404);
      if (result === "invalid_state") throw new ExperimentApplicationError("INVALID_ITERATION_STATE", "Clones have already been queued or the experiment is not planned");
      activity.info("experiment.clones_queued", { investigationId: experiment.investigationId, experimentId, iterationId, cloneIds: clones.map((entry) => entry.id), jobIds: clones.map((entry) => entry.jobId) });
      const updated = await input.repository.findById(experimentId);
      if (!updated) throw new ExperimentApplicationError("EXPERIMENT_NOT_FOUND", "Experiment not found", 404);
      return updated;
    },

    async submitTestResult(testRequestId: string, value: Omit<SubmitTestResultRecord, "id" | "testRequestId">): Promise<TestResult> {
      const request = await input.repository.findTestRequest(testRequestId);
      if (!request) throw new ExperimentApplicationError("TEST_REQUEST_NOT_FOUND", "Test request not found", 404);
      const experiment = await input.repository.findById(request.experimentId);
      if (!experiment) throw new ExperimentApplicationError("EXPERIMENT_NOT_FOUND", "Experiment not found", 404);
      if (value.testEnvironmentId) {
        const exists = (await input.repository.listEnvironments()).some((entry) => entry.id === value.testEnvironmentId);
        if (!exists) throw new ExperimentApplicationError("TEST_ENVIRONMENT_NOT_FOUND", "Test environment not found", 404);
      }
      if (value.evidenceArtifactIds.length > 0) {
        const available = new Set((await input.investigations.listArtifacts?.(experiment.investigationId) ?? []).map((entry) => entry.id));
        if (value.evidenceArtifactIds.some((id) => !available.has(id))) throw new ExperimentApplicationError("ARTIFACT_NOT_FOUND", "A referenced evidence artifact does not belong to this investigation", 404);
      }
      const result = await input.repository.submitTestResult({ id: randomUUID(), testRequestId, ...value });
      if (result === "not_found") throw new ExperimentApplicationError("TEST_REQUEST_NOT_FOUND", "Test request not found", 404);
      activity.info("experiment.test_result_submitted", { investigationId: experiment.investigationId, experimentId: experiment.id, iterationId: request.iterationId, cloneId: request.cloneId, testRequestId, outcome: result.outcome, reportedVia: result.reportedVia });
      return result;
    },

    async evaluate(experimentId: string) {
      const experiment = await input.repository.findById(experimentId);
      if (!experiment) throw new ExperimentApplicationError("EXPERIMENT_NOT_FOUND", "Experiment not found", 404);
      if (experiment.status === "AWAITING_TESTS") assertExperimentTransition(experiment.status, "EVALUATING");
      else if (experiment.status !== "EVALUATING") throw new ExperimentApplicationError("EXPERIMENT_NOT_READY_FOR_EVALUATION", "The experiment is not ready for evaluation");
      const report = await input.investigations.getReport(experiment.investigationId);
      if (!report) throw new ExperimentApplicationError("REPORT_NOT_READY", "Original deterministic evidence is unavailable");
      const evidence = report.content.placeholder ? undefined : report.content.evidence;
      const evaluation = evaluateExperimentEvidence({
        experiment,
        originalEvidence: {
          reportId: report.id,
          ...(evidence ? { schemaVersion: evidence.schemaVersion, sourceProtocol: evidence.source.protocol } : {}),
          ...(evidence && evidence.schemaVersion !== 1 ? { artifactIds: [...evidence.manifests.map((entry) => entry.artifactId), ...evidence.mediaSamples.map((entry) => entry.artifactId)] } : {}),
          ...(evidence && evidence.schemaVersion !== 1 && evidence.abr ? { abrVerdict: evidence.abr.verdict } : {}),
          limitationCount: evidence?.limitations.length ?? 0,
        },
      });
      const saved = await input.repository.saveEvaluation(evaluation);
      if (saved === "invalid_state") throw new ExperimentApplicationError("EXPERIMENT_NOT_READY_FOR_EVALUATION", "The experiment is not ready for evaluation");
      activity.info("experiment.evaluated", { investigationId: experiment.investigationId, experimentId, iterationId: saved.iterationId, evaluationId: saved.id, status: saved.status, confidence: saved.confidence });
      return saved;
    },

    async createEnvironment(value: Omit<TestEnvironment, "id" | "createdAt" | "updatedAt">) {
      return input.repository.createEnvironment({ id: randomUUID(), ...value });
    },
    listEnvironments: () => input.repository.listEnvironments(),
  };
}

export type ExperimentService = ReturnType<typeof createExperimentService>;

function shortEnvironmentPrefix(environment?: TestEnvironment): string {
  const raw = environment?.platform ?? environment?.name ?? "EXP";
  const safe = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3);
  return safe || "EXP";
}

function cloneApplicationError(error: unknown): ExperimentApplicationError {
  const message = error instanceof Error ? error.message : "CloneSpec cannot be executed";
  const code = /^EXPERIMENT_[A-Z_]+$/.test(message) ? message : "UNSUPPORTED_CLONE_SPEC";
  return new ExperimentApplicationError(code, message, 422);
}
