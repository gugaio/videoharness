import type { CloneExecutionPlan, CloneSpec, CloneVerificationReport } from "./clone-spec.js";

export const experimentStatuses = [
  "DRAFT", "PLANNED", "BUILDING_CLONES", "AWAITING_TESTS", "EVALUATING",
  "FOLLOWUP_REQUIRED", "CONCLUDED", "FAILED", "CANCELLED",
] as const;
export type ExperimentStatus = (typeof experimentStatuses)[number];

export const hypothesisStatuses = ["OPEN", "PARTIALLY_SUPPORTED", "SUPPORTED", "WEAKENED", "REJECTED", "UNRESOLVED"] as const;
export type HypothesisStatus = (typeof hypothesisStatuses)[number];

export const iterationStatuses = ["PLANNED", "BUILDING_CLONES", "AWAITING_TESTS", "EVALUATING", "COMPLETED", "FAILED"] as const;
export type IterationStatus = (typeof iterationStatuses)[number];

export type TestEnvironment = {
  id: string;
  name: string;
  platform?: string;
  platformVersion?: string;
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  applicationName?: string;
  applicationVersion?: string;
  playerEngine?: string;
  networkNotes?: string;
  createdAt: string;
  updatedAt: string;
};

export type Hypothesis = {
  id: string;
  experimentId: string;
  statement: string;
  rationale: string;
  evidenceFor: string[];
  evidenceAgainst: string[];
  status: HypothesisStatus;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentIteration = {
  id: string;
  experimentId: string;
  iterationNumber: number;
  rationale: string;
  cloneSpecs: CloneSpec[];
  status: IterationStatus;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentClone = {
  id: string;
  experimentId: string;
  iterationId: string;
  recordingId: string;
  shortLabel: string;
  isControl: boolean;
  state: "QUEUED" | "BUILDING" | "VERIFYING" | "READY" | "FAILED";
  spec: CloneSpec;
  specHash: string;
  executionPlan: CloneExecutionPlan;
  provenance: Record<string, unknown>;
  verification?: CloneVerificationReport;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export const testOutcomes = ["PASS", "FAIL", "INCONCLUSIVE", "NOT_TESTED"] as const;
export type TestOutcome = (typeof testOutcomes)[number];

export const failureStages = [
  "LOAD_MANIFEST", "STARTUP", "VIDEO_DECODE", "AUDIO_DECODE", "DRM", "STALL",
  "ABR_SWITCH", "SEEK", "AV_SYNC", "SUBTITLES", "UNKNOWN",
] as const;
export type FailureStage = (typeof failureStages)[number];

export type TestResult = {
  id: string;
  testRequestId: string;
  outcome: TestOutcome;
  failureStage?: FailureStage;
  errorCode?: string;
  timeToFirstFrameMs?: number;
  stallObserved?: boolean;
  audioObserved?: boolean;
  videoObserved?: boolean;
  avSyncIssue?: boolean;
  seekIssue?: boolean;
  notes?: string;
  evidenceArtifactIds: string[];
  reportedBy: string;
  reportedVia: "USER" | "AGENT" | "DEVICE" | "TRUSTED_TEST";
  testEnvironmentId?: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TestRequest = {
  id: string;
  experimentId: string;
  iterationId: string;
  cloneId: string;
  shortLabel: string;
  testUrl: string;
  instructions: string;
  hypothesisIds: string[];
  environmentId?: string;
  status: "PENDING" | "COMPLETED" | "EXPIRED" | "CANCELLED";
  expiresAt?: string;
  result?: TestResult;
  createdAt: string;
  updatedAt: string;
};

export type HypothesisEvaluation = {
  hypothesisId: string;
  status: HypothesisStatus;
  evidenceFor: string[];
  evidenceAgainst: string[];
  explanation: string;
};

export type ExperimentCausalAnalysis = {
  schemaVersion: 1;
  source: "DETERMINISTIC" | "AI_ASSISTED";
  outcome: "DISCRIMINATING_EFFECT" | "NO_DISCRIMINATING_EFFECT" | "INCONCLUSIVE";
  title: string;
  observation: string;
  interpretation: string;
  supportedClaim: string;
  notEstablished: string[];
  alternativeExplanations: string[];
  limitations: string[];
  confidenceRationale: string;
  nextTest: {
    title: string;
    rationale: string;
    change: string;
    expectedSignal: string;
  };
  evidenceIds: string[];
  agents: Array<{
    id: "experiment-evidence-auditor" | "experiment-causal-analyst" | "experiment-lead-investigator";
    label: string;
    state: "COMPLETED" | "FAILED" | "UNAVAILABLE";
    summary?: string;
    limitation?: string;
  }>;
};

export type ExperimentEvaluation = {
  id: string;
  experimentId: string;
  iterationId: string;
  status: "CONCLUDED" | "MORE_TESTS_REQUIRED" | "INCONCLUSIVE";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  hypothesisUpdates: HypothesisEvaluation[];
  evidenceBundle: Record<string, unknown>;
  analysis?: ExperimentCausalAnalysis;
  proposedNextExperimentPlan?: {
    rationale: string;
    remainingHypothesisIds: string[];
    guidance: string[];
  };
  createdAt: string;
};

export type Experiment = {
  id: string;
  investigationId: string;
  goal: string;
  status: ExperimentStatus;
  createdBy: string;
  targetEnvironmentId?: string;
  activeTestRequestId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentDetail = Experiment & {
  targetEnvironment?: TestEnvironment;
  hypotheses: Hypothesis[];
  iterations: ExperimentIteration[];
  clones: ExperimentClone[];
  testRequests: TestRequest[];
  evaluations: ExperimentEvaluation[];
  evaluationJob?: {
    id: string;
    status: "pending" | "running" | "completed" | "failed";
    attempts: number;
    maxAttempts: number;
    errorCode?: string;
    errorMessage?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  };
};

const transitions: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  DRAFT: ["PLANNED", "CANCELLED"],
  PLANNED: ["BUILDING_CLONES", "CANCELLED"],
  BUILDING_CLONES: ["AWAITING_TESTS", "FAILED", "CANCELLED"],
  AWAITING_TESTS: ["EVALUATING", "CANCELLED"],
  EVALUATING: ["CONCLUDED", "FOLLOWUP_REQUIRED", "FAILED"],
  FOLLOWUP_REQUIRED: ["PLANNED", "EVALUATING", "CANCELLED"],
  CONCLUDED: ["EVALUATING"],
  FAILED: [],
  CANCELLED: [],
};

export function assertExperimentTransition(from: ExperimentStatus, to: ExperimentStatus): void {
  if (!transitions[from].includes(to)) {
    throw new Error(`Experiment cannot transition from ${from} to ${to}`);
  }
}

export type ExperimentPolicy = {
  maxClonesPerIteration: number;
  maxIterations: number;
  maxClonesPerExperiment: number;
  requireFirstIterationControl: boolean;
};

export const defaultExperimentPolicy: ExperimentPolicy = {
  maxClonesPerIteration: 4,
  maxIterations: 3,
  maxClonesPerExperiment: 12,
  requireFirstIterationControl: true,
};

export function validateIterationBudget(input: {
  iterationNumber: number;
  existingCloneCount: number;
  specs: CloneSpec[];
  policy: ExperimentPolicy;
}): void {
  if (input.iterationNumber > input.policy.maxIterations) throw new Error("EXPERIMENT_ITERATION_LIMIT");
  if (input.specs.length < 1 || input.specs.length > input.policy.maxClonesPerIteration) throw new Error("EXPERIMENT_CLONE_LIMIT");
  if (input.existingCloneCount + input.specs.length > input.policy.maxClonesPerExperiment) throw new Error("EXPERIMENT_TOTAL_CLONE_LIMIT");
  if (input.iterationNumber === 1 && input.policy.requireFirstIterationControl && !input.specs.some((spec) => spec.reason.role === "control")) {
    throw new Error("EXPERIMENT_CONTROL_REQUIRED");
  }
  if (input.specs.filter((spec) => spec.reason.role === "control").length > 1) throw new Error("EXPERIMENT_MULTIPLE_CONTROLS");
}
