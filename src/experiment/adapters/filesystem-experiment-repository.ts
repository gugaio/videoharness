import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import { CloneSpecSchema } from "../../contracts/experiment.js";
import type { CloneSpec, CloneVerificationReport } from "../domain/clone-spec.js";
import type {
  Experiment,
  ExperimentClone,
  ExperimentDetail,
  ExperimentEvaluation,
  ExperimentIteration,
  Hypothesis,
  TestEnvironment,
  TestRequest,
  TestResult,
} from "../domain/experiment.js";
import type {
  CreateExperimentRecord,
  ExperimentRepository,
  PreparedExperimentClone,
  SubmitTestResultRecord,
} from "../ports/experiment-repository.js";

type StoredExperiment = {
  id: string;
  investigationId: string;
  goal: string;
  status: Experiment["status"];
  createdBy: string;
  targetEnvironmentId?: string;
  activeTestRequestId?: string;
  createdAt: string;
  updatedAt: string;
};

type StoredEnvironment = TestEnvironment;
type StoredHypothesis = Hypothesis;
type StoredIteration = ExperimentIteration;
type StoredClone = ExperimentClone;
type StoredRequest = TestRequest;
type StoredResult = TestResult;
type StoredEvaluation = ExperimentEvaluation;
type StoredEvaluationJob = {
  id: string;
  experimentId: string;
  iterationId: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  errorCode?: string;
  errorMessage?: string;
  lockedBy?: string;
  lockedUntil?: string;
  heartbeatAt?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export class FilesystemExperimentRepository implements ExperimentRepository {
  constructor(private readonly store: JsonStore) {}

  async createExperiment(input: CreateExperimentRecord): Promise<ExperimentDetail> {
    const release = await this.store.acquireLock(`locks/experiment-${input.id}`);
    try {
      const now = new Date().toISOString();
      const stored: StoredExperiment = {
        id: input.id,
        investigationId: input.investigationId,
        goal: input.goal,
        status: "DRAFT",
        createdBy: input.createdBy,
        ...(input.targetEnvironmentId ? { targetEnvironmentId: input.targetEnvironmentId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await this.store.writeJson(stored, "experiments", input.id, "experiment.json");
      for (const hypothesis of input.hypotheses) {
        const record: StoredHypothesis = {
          id: hypothesis.id,
          experimentId: input.id,
          statement: hypothesis.statement,
          rationale: hypothesis.rationale,
          evidenceFor: hypothesis.evidenceFor,
          evidenceAgainst: hypothesis.evidenceAgainst,
          status: "OPEN",
          createdAt: now,
          updatedAt: now,
        };
        await this.store.writeJson(record, "experiments", input.id, "hypotheses", `${hypothesis.id}.json`);
      }
    } finally {
      await release();
    }
    return (await this.findById(input.id))!;
  }

  async listByInvestigation(investigationId: string): Promise<Experiment[]> {
    const directories = await this.store.listSubdirectories("experiments");
    const experiments: Experiment[] = [];
    for (const id of directories) {
      const row = await this.store.readJson<StoredExperiment>("experiments", id, "experiment.json");
      if (row && row.investigationId === investigationId) experiments.push(toExperiment(row));
    }
    return experiments.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async findById(id: string): Promise<ExperimentDetail | null> {
    const row = await this.store.readJson<StoredExperiment>("experiments", id, "experiment.json");
    if (!row) return null;
    const [hypotheses, iterations, clones, requests, evaluations, environments, evaluationJob] = await Promise.all([
      this.listHypotheses(id),
      this.listIterations(id),
      this.listClones(id),
      this.listRequests(id),
      this.listEvaluations(id),
      row.targetEnvironmentId ? this.store.readJson<StoredEnvironment>("environments", `${row.targetEnvironmentId}.json`) : Promise.resolve(null),
      this.latestEvaluationJob(id),
    ]);
    const resultByRequest = await this.resultMap(requests);
    return {
      ...toExperiment(row),
      ...(environments ? { targetEnvironment: environments } : {}),
      hypotheses,
      iterations,
      clones,
      testRequests: requests.map((entry) => toTestRequest(entry, resultByRequest.get(entry.id))),
      evaluations,
      ...(evaluationJob ? { evaluationJob: toEvaluationJob(evaluationJob) } : {}),
    };
  }

  async createIteration(input: { id: string; experimentId: string; rationale: string; cloneSpecs: CloneSpec[] }): Promise<ExperimentIteration | "not_found" | "invalid_state"> {
    const release = await this.store.acquireLock(`locks/experiment-${input.experimentId}`);
    try {
      const experiment = await this.store.readJson<StoredExperiment>("experiments", input.experimentId, "experiment.json");
      if (!experiment) return "not_found";
      if (experiment.status !== "DRAFT" && experiment.status !== "FOLLOWUP_REQUIRED") return "invalid_state";
      const iterations = await this.listIterations(input.experimentId);
      const now = new Date().toISOString();
      const stored: StoredIteration = {
        id: input.id,
        experimentId: input.experimentId,
        iterationNumber: iterations.length + 1,
        rationale: input.rationale,
        cloneSpecs: input.cloneSpecs,
        status: "PLANNED",
        createdAt: now,
        updatedAt: now,
      };
      await this.store.writeJson(stored, "experiments", input.experimentId, "iterations", `${input.id}.json`);
      await this.store.writeJson(
        { ...experiment, status: "PLANNED", updatedAt: now },
        "experiments", input.experimentId, "experiment.json",
      );
      return stored;
    } finally {
      await release();
    }
  }

  async queueClones(input: { experimentId: string; iterationId: string; clones: PreparedExperimentClone[] }): Promise<"queued" | "not_found" | "invalid_state"> {
    const release = await this.store.acquireLock(`locks/experiment-${input.experimentId}`);
    try {
      const experiment = await this.store.readJson<StoredExperiment>("experiments", input.experimentId, "experiment.json");
      if (!experiment) return "not_found";
      const iteration = await this.store.readJson<StoredIteration>("experiments", input.experimentId, "iterations", `${input.iterationId}.json`);
      if (!iteration) return "not_found";
      if (experiment.status !== "PLANNED" || iteration.status !== "PLANNED") return "invalid_state";
      const now = new Date().toISOString();
      for (const clone of input.clones) {
        await this.writePreparedClone(input.experimentId, input.iterationId, clone, now);
      }
      await this.store.writeJson(
        { ...iteration, status: "BUILDING_CLONES", updatedAt: now },
        "experiments", input.experimentId, "iterations", `${input.iterationId}.json`,
      );
      await this.store.writeJson(
        { ...experiment, status: "BUILDING_CLONES", updatedAt: now },
        "experiments", input.experimentId, "experiment.json",
      );
      return "queued";
    } finally {
      await release();
    }
  }

  async findClone(id: string): Promise<ExperimentClone | null> {
    const directories = await this.store.listSubdirectories("experiments");
    for (const experimentId of directories) {
      const clone = await this.store.readJson<StoredClone>("experiments", experimentId, "clones", `${id}.json`);
      if (clone) return clone;
    }
    return null;
  }

  async findCloneByRecordingId(recordingId: string): Promise<ExperimentClone | null> {
    const directories = await this.store.listSubdirectories("experiments");
    for (const experimentId of directories) {
      const cloneFiles = await this.store.listFiles("experiments", experimentId, "clones");
      for (const file of cloneFiles) {
        const clone = await this.store.readJson<StoredClone>("experiments", experimentId, "clones", file);
        if (clone && clone.recordingId === recordingId) return clone;
      }
    }
    return null;
  }

  async markCloneStarted(recordingId: string, jobId: string): Promise<void> {
    await this.updateCloneByRecording(recordingId, (clone) => ({
      ...clone,
      state: "BUILDING",
      updatedAt: new Date().toISOString(),
      provenance: { ...clone.provenance, jobId, startedAt: new Date().toISOString() },
    }));
  }

  async markCloneVerifying(recordingId: string): Promise<void> {
    await this.updateCloneByRecording(recordingId, (clone) => ({ ...clone, state: "VERIFYING", updatedAt: new Date().toISOString() }));
  }

  async completeClone(input: { recordingId: string; verification: CloneVerificationReport; provenance: Record<string, unknown> }): Promise<void> {
    const release = await this.store.acquireLock("locks/experiments");
    try {
      const found = await this.findCloneByRecordingId(input.recordingId);
      if (!found) return;
      await this.updateCloneById(found.id, (clone) => {
        const passed = input.verification.status === "PASSED";
        return {
          ...clone,
          state: passed ? "READY" : "FAILED",
          verification: input.verification,
          provenance: { ...clone.provenance, ...input.provenance },
          ...(passed ? {} : { errorCode: "CLONE_VERIFICATION_FAILED", errorMessage: input.verification.errors.join(" ").slice(0, 500) }),
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      });
      await this.refreshIterationState(found.experimentId, found.iterationId);
    } finally {
      await release();
    }
  }

  async failClone(input: { recordingId: string; errorCode: string; errorMessage: string; provenance: Record<string, unknown> }): Promise<void> {
    const release = await this.store.acquireLock("locks/experiments");
    try {
      const found = await this.findCloneByRecordingId(input.recordingId);
      if (!found) return;
      await this.updateCloneById(found.id, (clone) => ({
        ...clone,
        state: "FAILED",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage.slice(0, 500),
        provenance: { ...clone.provenance, ...input.provenance },
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }));
      await this.refreshIterationState(found.experimentId, found.iterationId);
    } finally {
      await release();
    }
  }

  async findTestRequest(id: string): Promise<TestRequest | null> {
    const directories = await this.store.listSubdirectories("experiments");
    for (const experimentId of directories) {
      const request = await this.store.readJson<StoredRequest>("experiments", experimentId, "requests", `${id}.json`);
      if (request) {
        const result = await this.store.readJson<StoredResult>("experiments", experimentId, "results", `${id}.json`);
        return toTestRequest(request, result ?? undefined);
      }
    }
    return null;
  }

  async activateTestRequest(id: string): Promise<TestRequest | "not_found" | "not_ready"> {
    const found = await this.findTestRequest(id);
    if (!found) return "not_found";
    const clone = await this.findClone(found.cloneId);
    const recording = clone ? await this.store.readJson<{ state?: string }>("recordings", clone.recordingId, "recording.json") : null;
    if (!clone || clone.state !== "READY" || recording?.state !== "ready") return "not_ready";
    const release = await this.store.acquireLock(`locks/experiment-${found.experimentId}`);
    try {
      const experiment = await this.store.readJson<StoredExperiment>("experiments", found.experimentId, "experiment.json");
      if (!experiment) return "not_found";
      await this.store.writeJson(
        { ...experiment, activeTestRequestId: id, updatedAt: new Date().toISOString() },
        "experiments", found.experimentId, "experiment.json",
      );
    } finally {
      await release();
    }
    return (await this.findTestRequest(id))!;
  }

  async resolveActiveStream(experimentId: string): Promise<import("../ports/experiment-repository.js").ActiveExperimentStream | null> {
    const experiment = await this.store.readJson<StoredExperiment>("experiments", experimentId, "experiment.json");
    if (!experiment?.activeTestRequestId) return null;
    const request = await this.store.readJson<StoredRequest>("experiments", experimentId, "requests", `${experiment.activeTestRequestId}.json`);
    if (!request || request.experimentId !== experimentId) return null;
    const clone = await this.store.readJson<StoredClone>("experiments", experimentId, "clones", `${request.cloneId}.json`);
    if (!clone || clone.state !== "READY") return null;
    const recording = await this.store.readJson<{ state?: string; protocol?: "hls" | "dash" }>("recordings", clone.recordingId, "recording.json");
    if (!recording || recording.state !== "ready") return null;
    return {
      experimentId,
      testRequestId: request.id,
      cloneId: clone.id,
      recordingId: clone.recordingId,
      protocol: recording.protocol ?? clone.executionPlan.protocol,
    };
  }

  async listTestRequests(experimentId: string): Promise<TestRequest[]> {
    const requests = await this.listRequests(experimentId);
    const resultMap = await this.resultMap(requests);
    return requests.map((entry) => toTestRequest(entry, resultMap.get(entry.id)));
  }

  async submitTestResult(input: SubmitTestResultRecord): Promise<TestResult | "not_found"> {
    const found = await this.findTestRequest(input.testRequestId);
    if (!found) return "not_found";
    const release = await this.store.acquireLock(`locks/experiment-${found.experimentId}`);
    try {
      const now = new Date().toISOString();
      const result: StoredResult = {
        id: input.id,
        testRequestId: input.testRequestId,
        outcome: input.outcome,
        ...(input.failureStage ? { failureStage: input.failureStage } : {}),
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        ...(input.timeToFirstFrameMs === undefined ? {} : { timeToFirstFrameMs: input.timeToFirstFrameMs }),
        ...(input.stallObserved === undefined ? {} : { stallObserved: input.stallObserved }),
        ...(input.audioObserved === undefined ? {} : { audioObserved: input.audioObserved }),
        ...(input.videoObserved === undefined ? {} : { videoObserved: input.videoObserved }),
        ...(input.avSyncIssue === undefined ? {} : { avSyncIssue: input.avSyncIssue }),
        ...(input.seekIssue === undefined ? {} : { seekIssue: input.seekIssue }),
        ...(input.notes ? { notes: input.notes } : {}),
        evidenceArtifactIds: input.evidenceArtifactIds,
        reportedBy: input.reportedBy,
        reportedVia: input.reportedVia,
        ...(input.testEnvironmentId ? { testEnvironmentId: input.testEnvironmentId } : {}),
        occurredAt: input.occurredAt,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.writeJson(result, "experiments", found.experimentId, "results", `${input.testRequestId}.json`);
      await this.updateRequestById(found.experimentId, input.testRequestId, (request) => ({ ...request, status: "COMPLETED", updatedAt: now }));

      const remaining = await this.pendingRequestCount(found.iterationId);
      if (remaining === 0) {
        const experiment = await this.store.readJson<StoredExperiment>("experiments", found.experimentId, "experiment.json");
        const iteration = await this.store.readJson<StoredIteration>("experiments", found.experimentId, "iterations", `${found.iterationId}.json`);
        if (iteration) await this.store.writeJson({ ...iteration, status: "EVALUATING", updatedAt: now }, "experiments", found.experimentId, "iterations", `${found.iterationId}.json`);
        if (experiment) await this.store.writeJson(
          { ...experiment, status: experiment.status === "AWAITING_TESTS" ? "EVALUATING" : experiment.status, updatedAt: now },
          "experiments", found.experimentId, "experiment.json",
        );
      }
      return result;
    } finally {
      await release();
    }
  }

  async saveEvaluation(evaluation: Omit<ExperimentEvaluation, "createdAt">): Promise<ExperimentEvaluation | "invalid_state"> {
    const release = await this.store.acquireLock(`locks/experiment-${evaluation.experimentId}`);
    try {
      const experiment = await this.store.readJson<StoredExperiment>("experiments", evaluation.experimentId, "experiment.json");
      if (!experiment || (experiment.status !== "EVALUATING" && experiment.status !== "AWAITING_TESTS")) return "invalid_state";
      const now = new Date().toISOString();
      const stored: StoredEvaluation = { ...evaluation, createdAt: now };
      await this.store.writeJson(stored, "experiments", evaluation.experimentId, "evaluations", `${evaluation.id}.json`);
      for (const update of evaluation.hypothesisUpdates) {
        const hypothesis = await this.store.readJson<StoredHypothesis>("experiments", evaluation.experimentId, "hypotheses", `${update.hypothesisId}.json`);
        if (!hypothesis || hypothesis.experimentId !== evaluation.experimentId) continue;
        await this.store.writeJson(
          { ...hypothesis, status: update.status, evidenceFor: update.evidenceFor, evidenceAgainst: update.evidenceAgainst, updatedAt: now },
          "experiments", evaluation.experimentId, "hypotheses", `${update.hypothesisId}.json`,
        );
      }
      const pending = await this.pendingRequestCount(evaluation.iterationId);
      const iteration = await this.store.readJson<StoredIteration>("experiments", evaluation.experimentId, "iterations", `${evaluation.iterationId}.json`);
      if (evaluation.status === "MORE_TESTS_REQUIRED" && pending > 0) {
        if (iteration) await this.store.writeJson({ ...iteration, status: "AWAITING_TESTS", updatedAt: now }, "experiments", evaluation.experimentId, "iterations", `${evaluation.iterationId}.json`);
        await this.store.writeJson({ ...experiment, status: "AWAITING_TESTS", updatedAt: now }, "experiments", evaluation.experimentId, "experiment.json");
      } else {
        if (iteration) await this.store.writeJson({ ...iteration, status: "COMPLETED", updatedAt: now }, "experiments", evaluation.experimentId, "iterations", `${evaluation.iterationId}.json`);
        await this.store.writeJson(
          { ...experiment, status: evaluation.status === "CONCLUDED" ? "CONCLUDED" : "FOLLOWUP_REQUIRED", updatedAt: now },
          "experiments", evaluation.experimentId, "experiment.json",
        );
      }
      return stored;
    } finally {
      await release();
    }
  }

  async createEnvironment(input: Omit<TestEnvironment, "createdAt" | "updatedAt">): Promise<TestEnvironment> {
    const now = new Date().toISOString();
    const stored: StoredEnvironment = { ...input, createdAt: now, updatedAt: now };
    await this.store.writeJson(stored, "environments", `${input.id}.json`);
    return stored;
  }

  async listEnvironments(): Promise<TestEnvironment[]> {
    const files = await this.store.listFiles("environments");
    const environments: TestEnvironment[] = [];
    for (const file of files) {
      const row = await this.store.readJson<StoredEnvironment>("environments", file);
      if (row) environments.push(row);
    }
    return environments.sort((left, right) => left.name.localeCompare(right.name) || left.createdAt.localeCompare(right.createdAt));
  }

  private async writePreparedClone(experimentId: string, iterationId: string, clone: PreparedExperimentClone, now: string): Promise<void> {
    await this.store.writeJson(
      {
        id: clone.recordingId,
        sourceUrl: clone.sourceUrl,
        protocol: clone.protocol,
        state: "queued",
        requestedDurationSeconds: clone.durationSeconds,
        requestedStartSeconds: 0,
        idempotencyKey: `experiment-clone:${clone.id}`,
        requestSignature: clone.specHash,
        clonePlan: clone.plan,
        createdAt: now,
        updatedAt: now,
      },
      "recordings", clone.recordingId, "recording.json",
    );
    await this.store.writeJson(
      {
        id: clone.jobId,
        kind: "recording",
        recordingId: clone.recordingId,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        payload: { recordingId: clone.recordingId },
        createdAt: now,
      },
      "jobs", "recording", `${clone.jobId}.json`,
    );
    await this.store.appendEvent({
      aggregate: ["recordings", clone.recordingId],
      event: {
        type: "recording.created",
        actor: "experiment",
        message: "Experimental clone queued.",
        payload: { state: "queued", experimentId, iterationId, cloneId: clone.id },
      },
    });
    await this.store.writeJson(
      {
        id: clone.id,
        experimentId,
        iterationId,
        recordingId: clone.recordingId,
        shortLabel: clone.shortLabel,
        isControl: clone.isControl,
        state: "QUEUED",
        spec: clone.spec,
        specHash: clone.specHash,
        executionPlan: clone.plan,
        provenance: {
          cloneId: clone.id,
          sourceInvestigationId: clone.spec.source.investigationId,
          cloneSpecHash: clone.specHash,
          executionPlanVersion: clone.plan.version,
          sourceArtifactIds: clone.plan.sourceArtifactIds,
          mediaTools: { ffmpeg: "not-used", ffprobe: "not-used", materializer: `${clone.protocol}-vod-v1` },
          queuedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      },
      "experiments", experimentId, "clones", `${clone.id}.json`,
    );
  }

  private async refreshIterationState(experimentId: string, iterationId: string): Promise<void> {
    const release = await this.store.acquireLock(`locks/experiment-${experimentId}`);
    try {
      const cloneFiles = await this.store.listFiles("experiments", experimentId, "clones");
      const clones: StoredClone[] = [];
      for (const file of cloneFiles) {
        const clone = await this.store.readJson<StoredClone>("experiments", experimentId, "clones", file);
        if (clone && clone.iterationId === iterationId) clones.push(clone);
      }
      if (clones.length === 0) return;
      const terminal = clones.filter((clone) => clone.state === "READY" || clone.state === "FAILED");
      if (terminal.length !== clones.length) return;
      const ready = clones.filter((clone) => clone.state === "READY");
      if (ready.length === 0) {
        await this.store.writeJson(
          { ...(await this.store.readJson<StoredIteration>("experiments", experimentId, "iterations", `${iterationId}.json`))!, status: "FAILED", updatedAt: new Date().toISOString() },
          "experiments", experimentId, "iterations", `${iterationId}.json`,
        );
        const experiment = await this.store.readJson<StoredExperiment>("experiments", experimentId, "experiment.json");
        if (experiment) await this.store.writeJson({ ...experiment, status: "FAILED", updatedAt: new Date().toISOString() }, "experiments", experimentId, "experiment.json");
        return;
      }
      for (const clone of ready) {
        const request = await this.store.readJson<StoredRequest>("experiments", experimentId, "requests", `${clone.id}.json`);
        if (request) continue;
        const spec = CloneSpecSchema.parse(clone.spec) as unknown as CloneSpec;
        await this.store.writeJson(
          {
            id: randomUUID(),
            experimentId,
            iterationId,
            cloneId: clone.id,
            shortLabel: clone.shortLabel,
            testUrl: `/streams/experiments/${experimentId}/${clone.executionPlan.protocol === "dash" ? "index.mpd" : "index.m3u8"}`,
            instructions: `${spec.reason.description} ${spec.reason.expectedDiscriminatingSignal}`.slice(0, 2_000),
            hypothesisIds: spec.reason.hypothesisIds,
            status: "PENDING",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "experiments", experimentId, "requests", `${clone.id}.json`,
        );
      }
      const experiment = await this.store.readJson<StoredExperiment>("experiments", experimentId, "experiment.json");
      await this.store.writeJson(
        { ...(await this.store.readJson<StoredIteration>("experiments", experimentId, "iterations", `${iterationId}.json`))!, status: "AWAITING_TESTS", updatedAt: new Date().toISOString() },
        "experiments", experimentId, "iterations", `${iterationId}.json`,
      );
      if (experiment) await this.store.writeJson({ ...experiment, status: "AWAITING_TESTS", updatedAt: new Date().toISOString() }, "experiments", experimentId, "experiment.json");
    } finally {
      await release();
    }
  }

  private async listHypotheses(experimentId: string): Promise<Hypothesis[]> {
    const files = await this.store.listFiles("experiments", experimentId, "hypotheses");
    const rows: Hypothesis[] = [];
    for (const file of files) {
      const row = await this.store.readJson<StoredHypothesis>("experiments", experimentId, "hypotheses", file);
      if (row) rows.push(row);
    }
    return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async listIterations(experimentId: string): Promise<ExperimentIteration[]> {
    const files = await this.store.listFiles("experiments", experimentId, "iterations");
    const rows: ExperimentIteration[] = [];
    for (const file of files) {
      const row = await this.store.readJson<StoredIteration>("experiments", experimentId, "iterations", file);
      if (row) rows.push(row);
    }
    return rows.sort((left, right) => left.iterationNumber - right.iterationNumber);
  }

  private async listClones(experimentId: string): Promise<ExperimentClone[]> {
    const files = await this.store.listFiles("experiments", experimentId, "clones");
    const rows: ExperimentClone[] = [];
    for (const file of files) {
      const row = await this.store.readJson<StoredClone>("experiments", experimentId, "clones", file);
      if (row) rows.push(row);
    }
    return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async listRequests(experimentId: string): Promise<TestRequest[]> {
    const files = await this.store.listFiles("experiments", experimentId, "requests");
    const rows: TestRequest[] = [];
    for (const file of files) {
      const row = await this.store.readJson<StoredRequest>("experiments", experimentId, "requests", file);
      if (row) rows.push(row);
    }
    return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async resultMap(requests: TestRequest[]): Promise<Map<string, TestResult>> {
    const map = new Map<string, TestResult>();
    for (const request of requests) {
      const result = await this.store.readJson<StoredResult>("experiments", request.experimentId, "results", `${request.id}.json`);
      if (result) map.set(request.id, result);
    }
    return map;
  }

  private async listEvaluations(experimentId: string): Promise<ExperimentEvaluation[]> {
    const files = await this.store.listFiles("experiments", experimentId, "evaluations");
    const rows: ExperimentEvaluation[] = [];
    for (const file of files) {
      const row = await this.store.readJson<StoredEvaluation>("experiments", experimentId, "evaluations", file);
      if (row) rows.push(row);
    }
    return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async latestEvaluationJob(experimentId: string): Promise<StoredEvaluationJob | null> {
    const files = await this.store.listFiles("experiments", experimentId, "jobs");
    let latest: StoredEvaluationJob | null = null;
    for (const file of files) {
      const row = await this.store.readJson<StoredEvaluationJob>("experiments", experimentId, "jobs", file);
      if (row && (!latest || row.createdAt.localeCompare(latest.createdAt) > 0)) latest = row;
    }
    return latest;
  }

  private async pendingRequestCount(iterationId: string): Promise<number> {
    const directories = await this.store.listSubdirectories("experiments");
    let pending = 0;
    for (const experimentId of directories) {
      const files = await this.store.listFiles("experiments", experimentId, "requests");
      for (const file of files) {
        const request = await this.store.readJson<StoredRequest>("experiments", experimentId, "requests", file);
        if (request && request.iterationId === iterationId && request.status === "PENDING") pending += 1;
      }
    }
    return pending;
  }

  private async updateCloneByRecording(recordingId: string, fn: (clone: StoredClone) => StoredClone): Promise<void> {
    const release = await this.store.acquireLock("locks/experiments");
    try {
      const found = await this.findCloneByRecordingId(recordingId);
      if (!found) return;
      await this.updateCloneById(found.id, fn);
    } finally {
      await release();
    }
  }

  private async updateCloneById(cloneId: string, fn: (clone: StoredClone) => StoredClone): Promise<void> {
    const directories = await this.store.listSubdirectories("experiments");
    for (const experimentId of directories) {
      const clone = await this.store.readJson<StoredClone>("experiments", experimentId, "clones", `${cloneId}.json`);
      if (clone) {
        await this.store.writeJson(fn(clone), "experiments", experimentId, "clones", `${cloneId}.json`);
        return;
      }
    }
  }

  private async updateRequestById(experimentId: string, requestId: string, fn: (request: StoredRequest) => StoredRequest): Promise<void> {
    const request = await this.store.readJson<StoredRequest>("experiments", experimentId, "requests", `${requestId}.json`);
    if (request) await this.store.writeJson(fn(request), "experiments", experimentId, "requests", `${requestId}.json`);
  }
}

function toExperiment(row: StoredExperiment): Experiment {
  return {
    id: row.id,
    investigationId: row.investigationId,
    goal: row.goal,
    status: row.status,
    createdBy: row.createdBy,
    ...(row.targetEnvironmentId ? { targetEnvironmentId: row.targetEnvironmentId } : {}),
    ...(row.activeTestRequestId ? { activeTestRequestId: row.activeTestRequestId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTestRequest(row: StoredRequest, result?: TestResult): TestRequest {
  return { ...row, ...(result ? { result } : {}) };
}

function toEvaluationJob(row: StoredEvaluationJob): NonNullable<ExperimentDetail["evaluationJob"]> {
  return {
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    createdAt: row.createdAt,
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  };
}