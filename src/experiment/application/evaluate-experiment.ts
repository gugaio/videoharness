import { randomUUID } from "node:crypto";
import type { ExperimentDetail, ExperimentEvaluation, HypothesisEvaluation, TestRequest } from "../domain/experiment.js";

export function evaluateExperimentEvidence(input: {
  experiment: ExperimentDetail;
  originalEvidence: { reportId: string; schemaVersion?: number; sourceProtocol?: "hls" | "dash"; artifactIds?: string[]; abrVerdict?: string; limitationCount: number };
  now?: string;
}): ExperimentEvaluation {
  const iteration = input.experiment.iterations.at(-1);
  if (!iteration) throw new Error("EXPERIMENT_HAS_NO_ITERATION");
  const requests = input.experiment.testRequests.filter((request) => request.iterationId === iteration.id);
  const completed = requests.filter((request) => request.result);
  const control = requests.find((request) => input.experiment.clones.find((clone) => clone.id === request.cloneId)?.isControl);
  const controlOutcome = control?.result?.outcome;
  const allCompleted = requests.length > 0 && completed.length === requests.length;

  const hypothesisUpdates = input.experiment.hypotheses.map((hypothesis): HypothesisEvaluation => {
    const relevant = requests.filter((request) => request.hypothesisIds.includes(hypothesis.id) && request.result);
    const passing = relevant.filter((request) => request.result?.outcome === "PASS");
    const failing = relevant.filter((request) => request.result?.outcome === "FAIL");
    const evidenceFor = [...new Set([...hypothesis.evidenceFor, ...passing.map(resultEvidenceId)])];
    const evidenceAgainst = [...new Set([...hypothesis.evidenceAgainst, ...failing.map(resultEvidenceId)])];
    if (controlOutcome !== "FAIL") {
      return { hypothesisId: hypothesis.id, status: "UNRESOLVED", evidenceFor, evidenceAgainst, explanation: "The control did not reproduce the reported failure, so treatment comparisons are not conclusive." };
    }
    if (passing.length > 0) {
      return { hypothesisId: hypothesis.id, status: "SUPPORTED", evidenceFor, evidenceAgainst, explanation: `${passing.map((entry) => entry.shortLabel).join(", ")} passed while CONTROL failed.` };
    }
    if (failing.length > 0) {
      return { hypothesisId: hypothesis.id, status: "WEAKENED", evidenceFor, evidenceAgainst, explanation: `${failing.map((entry) => entry.shortLabel).join(", ")} changed the targeted variable but retained the failure.` };
    }
    return { hypothesisId: hypothesis.id, status: allCompleted ? "UNRESOLVED" : "OPEN", evidenceFor, evidenceAgainst, explanation: "No completed treatment result directly discriminates this hypothesis." };
  });

  const supported = hypothesisUpdates.filter((entry) => entry.status === "SUPPORTED");
  const unresolved = hypothesisUpdates.filter((entry) => entry.status === "OPEN" || entry.status === "UNRESOLVED");
  let status: ExperimentEvaluation["status"];
  let confidence: ExperimentEvaluation["confidence"];
  let summary: string;
  if (!allCompleted) {
    status = "MORE_TESTS_REQUIRED";
    confidence = "LOW";
    summary = `${completed.length}/${requests.length} requested device results are available; evaluation remains pending.`;
  } else if (controlOutcome === "FAIL" && supported.length === 1 && unresolved.length === 0) {
    status = "CONCLUDED";
    confidence = hypothesisUpdates.some((entry) => entry.status === "WEAKENED") ? "HIGH" : "MEDIUM";
    const hypothesis = input.experiment.hypotheses.find((entry) => entry.id === supported[0]!.hypothesisId)!;
    summary = `The control reproduced the failure and only the treatment for “${hypothesis.statement}” passed. Competing tested hypotheses were weakened.`;
  } else if (supported.length > 0 || unresolved.length > 0) {
    status = "MORE_TESTS_REQUIRED";
    confidence = "MEDIUM";
    summary = "The available results narrow the hypotheses but do not isolate one sufficient conclusion.";
  } else {
    status = "INCONCLUSIVE";
    confidence = "LOW";
    summary = "None of the tested treatments produced a discriminating result.";
  }

  const evidenceBundle: Record<string, unknown> = {
    schemaVersion: 1,
    original: input.originalEvidence,
    iterationId: iteration.id,
    requestCount: requests.length,
    completedRequestCount: completed.length,
    hypotheses: input.experiment.hypotheses.map((entry) => ({ id: entry.id, statement: entry.statement, status: entry.status, evidenceFor: entry.evidenceFor, evidenceAgainst: entry.evidenceAgainst })),
    cloneVerification: input.experiment.clones.filter((clone) => clone.iterationId === iteration.id).map((clone) => ({
      cloneId: clone.id,
      label: clone.shortLabel,
      role: clone.isControl ? "CONTROL" : "TREATMENT",
      state: clone.state,
      spec: clone.spec,
      specHash: clone.specHash,
      executionPlan: clone.executionPlan,
      verification: clone.verification,
      errorCode: clone.errorCode,
      errorMessage: clone.errorMessage,
      provenance: clone.provenance,
    })),
    testResults: requests.map((request) => ({ testRequestId: request.id, cloneId: request.cloneId, label: request.shortLabel, hypothesisIds: request.hypothesisIds, result: request.result ?? null })),
    controls: control ? [{ testRequestId: control.id, outcome: control.result?.outcome ?? "NOT_REPORTED" }] : [],
    treatments: requests.filter((request) => request !== control).map((request) => {
      const clone = input.experiment.clones.find((entry) => entry.id === request.cloneId)!;
      return {
        testRequestId: request.id,
        cloneId: clone.id,
        label: request.shortLabel,
        specHash: clone.specHash,
        hypothesisIds: request.hypothesisIds,
        verificationStatus: clone.verification?.status,
        outcome: request.result?.outcome ?? "NOT_REPORTED",
        failureStage: request.result?.failureStage,
      };
    }),
  };
  return {
    id: randomUUID(),
    experimentId: input.experiment.id,
    iterationId: iteration.id,
    status,
    confidence,
    summary,
    hypothesisUpdates,
    evidenceBundle,
    ...(status === "MORE_TESTS_REQUIRED" ? {
      proposedNextExperimentPlan: {
        rationale: "Use another small iteration only for hypotheses not separated by the current results.",
        remainingHypothesisIds: hypothesisUpdates.filter((entry) => entry.status === "OPEN" || entry.status === "UNRESOLVED" || entry.status === "SUPPORTED").map((entry) => entry.hypothesisId),
        guidance: ["Keep a control only if the source or clone path changed.", "Change one primary variable per treatment.", "Do not exceed the configured clone budget."],
      },
    } : {}),
    createdAt: input.now ?? new Date().toISOString(),
  };
}

function resultEvidenceId(request: TestRequest): string {
  return `test-result:${request.result!.id}:${request.shortLabel}:${request.result!.outcome}`;
}
