import type { CloneExecutionPlan, CloneSpec, CloneVerificationReport } from "../domain/clone-spec.js";
import type {
  Experiment,
  ExperimentDetail,
  ExperimentEvaluation,
  ExperimentIteration,
  Hypothesis,
  TestEnvironment,
  TestRequest,
  TestResult,
} from "../domain/experiment.js";

export type CreateExperimentRecord = Omit<Experiment, "createdAt" | "updatedAt" | "status"> & {
  hypotheses: Array<Omit<Hypothesis, "experimentId" | "status" | "createdAt" | "updatedAt">>;
};

export type PreparedExperimentClone = {
  id: string;
  recordingId: string;
  jobId: string;
  shortLabel: string;
  isControl: boolean;
  sourceUrl: string;
  protocol: "hls" | "dash";
  durationSeconds: number;
  spec: CloneSpec;
  specHash: string;
  plan: CloneExecutionPlan;
};

export type SubmitTestResultRecord = Omit<TestResult, "testRequestId" | "createdAt" | "updatedAt"> & {
  testRequestId: string;
};

export interface ExperimentRepository {
  createExperiment(input: CreateExperimentRecord): Promise<ExperimentDetail>;
  listByInvestigation(investigationId: string): Promise<Experiment[]>;
  findById(id: string): Promise<ExperimentDetail | null>;
  createIteration(input: { id: string; experimentId: string; rationale: string; cloneSpecs: CloneSpec[] }): Promise<ExperimentIteration | "not_found" | "invalid_state">;
  queueClones(input: { experimentId: string; iterationId: string; clones: PreparedExperimentClone[] }): Promise<"queued" | "not_found" | "invalid_state">;
  findClone(id: string): Promise<ExperimentDetail["clones"][number] | null>;
  findCloneByRecordingId(recordingId: string): Promise<ExperimentDetail["clones"][number] | null>;
  markCloneStarted(recordingId: string, jobId: string): Promise<void>;
  markCloneVerifying(recordingId: string): Promise<void>;
  completeClone(input: { recordingId: string; verification: CloneVerificationReport; provenance: Record<string, unknown> }): Promise<void>;
  failClone(input: { recordingId: string; errorCode: string; errorMessage: string; provenance: Record<string, unknown> }): Promise<void>;
  findTestRequest(id: string): Promise<TestRequest | null>;
  activateTestRequest(id: string): Promise<TestRequest | "not_found" | "not_ready">;
  listTestRequests(experimentId: string): Promise<TestRequest[]>;
  submitTestResult(input: SubmitTestResultRecord): Promise<TestResult | "not_found">;
  saveEvaluation(evaluation: Omit<ExperimentEvaluation, "createdAt">): Promise<ExperimentEvaluation | "invalid_state">;
  createEnvironment(input: Omit<TestEnvironment, "createdAt" | "updatedAt">): Promise<TestEnvironment>;
  listEnvironments(): Promise<TestEnvironment[]>;
}

export type ActiveExperimentStream = {
  experimentId: string;
  testRequestId: string;
  cloneId: string;
  recordingId: string;
  protocol: "hls" | "dash";
};

/** Read-only data-plane lookup; paths are still resolved only from published recordings. */
export interface ExperimentStreamResolver {
  resolveActiveStream(experimentId: string): Promise<ActiveExperimentStream | null>;
}
