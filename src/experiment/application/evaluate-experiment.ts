import { randomUUID } from "node:crypto";
import type { ExperimentCausalAnalysis, ExperimentDetail, ExperimentEvaluation, HypothesisEvaluation, TestRequest } from "../domain/experiment.js";

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
  const passingTreatments = requests.filter((request) => request !== control && request.result?.outcome === "PASS");
  const failingTreatments = requests.filter((request) => request !== control && request.result?.outcome === "FAIL");

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
      return {
        hypothesisId: hypothesis.id,
        status: "PARTIALLY_SUPPORTED",
        evidenceFor,
        evidenceAgainst,
        explanation: `${passing.map((entry) => entry.shortLabel).join(", ")} passed while CONTROL failed. This supports the narrower treatment effect, not the full causal statement.`,
      };
    }
    if (failing.length > 0) {
      return { hypothesisId: hypothesis.id, status: "WEAKENED", evidenceFor, evidenceAgainst, explanation: `${failing.map((entry) => entry.shortLabel).join(", ")} changed the targeted variable but retained the failure.` };
    }
    return { hypothesisId: hypothesis.id, status: allCompleted ? "UNRESOLVED" : "OPEN", evidenceFor, evidenceAgainst, explanation: "No completed treatment result directly discriminates this hypothesis." };
  });

  const partiallySupported = hypothesisUpdates.filter((entry) => entry.status === "PARTIALLY_SUPPORTED");
  const unresolved = hypothesisUpdates.filter((entry) => entry.status === "OPEN" || entry.status === "UNRESOLVED");
  let status: ExperimentEvaluation["status"];
  let confidence: ExperimentEvaluation["confidence"];
  let summary: string;
  if (!allCompleted) {
    status = "MORE_TESTS_REQUIRED";
    confidence = "LOW";
    summary = `${completed.length}/${requests.length} requested device results are available; evaluation remains pending.`;
  } else if (controlOutcome === "FAIL" && partiallySupported.length > 0) {
    status = "MORE_TESTS_REQUIRED";
    confidence = "MEDIUM";
    summary = `${passingTreatments.map((entry) => entry.shortLabel).join(", ")} changed the observed outcome relative to CONTROL. The tested treatment effect is discriminating, but the original causal hypothesis remains only partially supported.`;
  } else if (unresolved.length > 0) {
    status = "MORE_TESTS_REQUIRED";
    confidence = "LOW";
    summary = "The available results do not yet isolate a causal mechanism.";
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
  const analysis = buildCausalAnalysis({
    experiment: input.experiment,
    control,
    controlOutcome,
    passingTreatments,
    failingTreatments,
    allCompleted,
  });
  return {
    id: randomUUID(),
    experimentId: input.experiment.id,
    iterationId: iteration.id,
    status,
    confidence,
    summary,
    hypothesisUpdates,
    evidenceBundle,
    analysis,
    ...(status === "MORE_TESTS_REQUIRED" ? {
      proposedNextExperimentPlan: {
        rationale: "Use another small iteration only for hypotheses not separated by the current results.",
        remainingHypothesisIds: hypothesisUpdates.filter((entry) => entry.status === "OPEN" || entry.status === "UNRESOLVED" || entry.status === "PARTIALLY_SUPPORTED" || entry.status === "SUPPORTED").map((entry) => entry.hypothesisId),
        guidance: ["Keep a control only if the source or clone path changed.", "Change one primary variable per treatment.", "Do not exceed the configured clone budget."],
      },
    } : {}),
    createdAt: input.now ?? new Date().toISOString(),
  };
}

function buildCausalAnalysis(input: {
  experiment: ExperimentDetail;
  control: TestRequest | undefined;
  controlOutcome: NonNullable<TestRequest["result"]>["outcome"] | undefined;
  passingTreatments: TestRequest[];
  failingTreatments: TestRequest[];
  allCompleted: boolean;
}): ExperimentCausalAnalysis {
  const evidenceIds = [input.control, ...input.passingTreatments, ...input.failingTreatments]
    .filter((request): request is TestRequest => Boolean(request?.result))
    .map(resultEvidenceId);
  const treatment = input.passingTreatments[0];
  const clone = treatment ? input.experiment.clones.find((entry) => entry.id === treatment.cloneId) : undefined;
  const changed = clone ? changedScope(clone.executionPlan.transformations.map((entry) => entry.kind)) : genericScope;
  const outcome = input.controlOutcome === "FAIL" && input.passingTreatments.length > 0
    ? "DISCRIMINATING_EFFECT"
    : input.controlOutcome === "FAIL" && input.failingTreatments.length > 0
      ? "NO_DISCRIMINATING_EFFECT"
      : "INCONCLUSIVE";
  const observation = outcome === "DISCRIMINATING_EFFECT"
    ? `CONTROL reproduced the reported failure${failureSuffix(input.control)}; ${input.passingTreatments.map((entry) => entry.shortLabel).join(", ")} passed after ${changed.change}.`
    : outcome === "NO_DISCRIMINATING_EFFECT"
      ? `CONTROL and ${input.failingTreatments.map((entry) => entry.shortLabel).join(", ")} reproduced the reported failure.`
      : input.allCompleted
        ? "The completed results did not produce a valid failing control and passing treatment comparison."
        : "Not every requested device observation is available.";
  const limitations = resultLimitations(input.experiment, [input.control, ...input.passingTreatments, ...input.failingTreatments]);
  return {
    schemaVersion: 1,
    source: "DETERMINISTIC",
    outcome,
    title: outcome === "DISCRIMINATING_EFFECT" ? "The treatment changed the observed playback result" : outcome === "NO_DISCRIMINATING_EFFECT" ? "The treatment did not remove the observed failure" : "The experiment remains inconclusive",
    observation,
    interpretation: outcome === "DISCRIMINATING_EFFECT"
      ? `The result isolates sensitivity to ${changed.variable}. It does not by itself identify which mechanism inside that scope caused the difference.`
      : outcome === "NO_DISCRIMINATING_EFFECT"
        ? `Changing ${changed.variable} was not sufficient to remove the reported failure in this run.`
        : "The observations are insufficient for a bounded treatment comparison.",
    supportedClaim: outcome === "DISCRIMINATING_EFFECT"
      ? `Under the reported test conditions, changing ${changed.variable} changed the playback outcome relative to CONTROL.`
      : outcome === "NO_DISCRIMINATING_EFFECT"
        ? `Under the reported test conditions, changing ${changed.variable} did not change the playback outcome relative to CONTROL.`
        : "No causal claim is supported by the current comparison.",
    notEstablished: outcome === "DISCRIMINATING_EFFECT"
      ? [input.experiment.hypotheses[0]?.statement ?? "The original causal hypothesis", ...changed.notEstablished]
      : [input.experiment.hypotheses[0]?.statement ?? "The original causal hypothesis"],
    alternativeExplanations: outcome === "DISCRIMINATING_EFFECT" ? changed.alternatives : [],
    limitations,
    confidenceRationale: outcome === "DISCRIMINATING_EFFECT"
      ? "The comparison is discriminating, but it is a single user-reported replay per treatment without attributed playback telemetry."
      : "The available observations do not isolate a sufficient causal mechanism.",
    nextTest: changed.nextTest,
    evidenceIds,
    agents: [],
  };
}

const genericScope = {
  change: "one controlled treatment",
  variable: "the treatment's declared variable",
  notEstablished: ["The specific underlying playback or delivery mechanism."],
  alternatives: ["A treatment-side change not represented by the original causal statement."],
  nextTest: {
    title: "Repeat the discriminating comparison",
    rationale: "Confirm that the observed difference is reproducible before narrowing the mechanism.",
    change: "Repeat CONTROL and the treatment under the same attributed environment.",
    expectedSignal: "The same failure/pass split occurs in repeated runs.",
  },
};

function changedScope(kinds: string[]): typeof genericScope {
  if (kinds.includes("filter_video_representations")) {
    return {
      change: "the exposed video representations were restricted",
      variable: "representation selection, ladder exposure, or bitrate demand",
      notEstablished: [
        "High latency at the original origin, because the recorded clone does not emulate origin latency.",
        "A target-duration mismatch as the direct cause.",
        "A decoder or rendered-frame failure without attributed device telemetry.",
      ],
      alternatives: [
        "The selected representation has lower media demand than another representation chosen by CONTROL.",
        "Removing ABR choices avoided a player decision or switch path involved in the stall.",
        "A representation excluded by the treatment has a representation-specific compatibility issue.",
        "The single observed pass or failure may not reproduce consistently.",
      ],
      nextTest: {
        title: "Separate bitrate pressure from ABR and representation compatibility",
        rationale: "LOW-BR changed both the exposed ladder and the selected media. One more bounded comparison is needed to identify which dimension matters.",
        change: "Repeat CONTROL and LOW-BR, then test one higher representation as a single-representation treatment under the same device and network.",
        expectedSignal: "If only higher representations fail, bitrate or representation compatibility gains support; if every single representation passes, the multi-representation ABR path gains support.",
      },
    };
  }
  if (kinds.includes("single_audio")) {
    return {
      change: "the exposed audio rendition was restricted",
      variable: "audio rendition selection",
      notEstablished: ["A video bitrate or origin-delivery cause.", "Decoded audio output without attributed device telemetry."],
      alternatives: ["The excluded audio rendition is incompatible.", "The player behaves differently when alternate audio selection is removed."],
      nextTest: {
        title: "Test the alternate audio rendition directly",
        rationale: "A single-audio pass narrows the scope but does not identify whether codec properties or selection behavior caused the difference.",
        change: "Expose each audio rendition separately under the same device environment.",
        expectedSignal: "Only one rendition reproduces the failure, or all single-rendition treatments pass while the multi-rendition control fails.",
      },
    };
  }
  return genericScope;
}

function resultLimitations(experiment: ExperimentDetail, requests: Array<TestRequest | undefined>): string[] {
  const results = requests.flatMap((request) => request?.result ? [request.result] : []);
  const limitations = new Set<string>();
  if (!experiment.targetEnvironment && results.every((entry) => !entry.testEnvironmentId)) limitations.add("No device/test environment was attributed to the observations.");
  if (results.some((entry) => entry.reportedVia === "USER")) limitations.add("At least one outcome is user-reported rather than captured by a trusted device integration.");
  if (results.every((entry) => entry.evidenceArtifactIds.length === 0)) limitations.add("No playback artifact or telemetry was attached to the results.");
  if (results.every((entry) => entry.timeToFirstFrameMs === undefined && entry.stallObserved === undefined)) limitations.add("Startup timing and stall telemetry were not recorded.");
  limitations.add("Only one observation per treatment is available in the current iteration.");
  return [...limitations];
}

function failureSuffix(request: TestRequest | undefined): string {
  return request?.result?.failureStage ? ` at ${request.result.failureStage}` : "";
}

function resultEvidenceId(request: TestRequest): string {
  return `test-result:${request.result!.id}:${request.shortLabel}:${request.result!.outcome}`;
}
