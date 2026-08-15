import { describe, expect, it } from "vitest";
import type { CloneExecutionPlan, CloneSpec, CloneVerificationReport } from "../domain/clone-spec.js";
import type { ExperimentClone, ExperimentDetail, Hypothesis, TestRequest, TestResult } from "../domain/experiment.js";
import { evaluateExperimentEvidence } from "./evaluate-experiment.js";

const experimentId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const investigationId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
const iterationId = "7d9d633e-3118-42e9-a4bb-2d917bbe3290";
const hypotheses = [
  hypothesis("b27d184e-b47a-4a5c-b8a6-b42152083ea9", "fMP4 packaging incompatibility"),
  hypothesis("4a30ea1e-1272-4f48-bbf0-7f24b84521ea", "highest representation causes failure"),
  hypothesis("019e36cb-c471-4205-86f7-3560ff51ebf9", "audio configuration causes failure"),
];

describe("deterministic experiment evaluation", () => {
  it("keeps a discriminating treatment narrower than the original causal hypothesis", () => {
    const entries = [
      entry("31d7cd14-b638-42ee-8df4-a7590b24653f", "CONTROL", true, [], "FAIL"),
      entry("40a78a3e-358f-448d-8806-c2b13f274c21", "TS", false, [hypotheses[0]!.id], "PASS"),
      entry("d59240e1-18fd-4529-8e10-05088c581849", "LOW-BR", false, [hypotheses[1]!.id], "FAIL"),
      entry("33313009-e742-4591-baf3-8b7747a820c5", "AAC", false, [hypotheses[2]!.id], "FAIL"),
    ];
    const experiment = detail(entries);
    const evaluation = evaluateExperimentEvidence({ experiment, originalEvidence: { reportId: "report-1", limitationCount: 0 }, now: "2026-08-11T12:00:00.000Z" });

    expect(evaluation.status).toBe("MORE_TESTS_REQUIRED");
    expect(evaluation.confidence).toBe("MEDIUM");
    expect(evaluation.hypothesisUpdates.map((item) => item.status)).toEqual(["PARTIALLY_SUPPORTED", "WEAKENED", "WEAKENED"]);
    expect(evaluation.analysis).toMatchObject({
      source: "DETERMINISTIC",
      outcome: "DISCRIMINATING_EFFECT",
    });
    expect(evaluation.summary).not.toContain("Competing tested hypotheses were weakened");
    expect(evaluation.evidenceBundle).toMatchObject({
      controls: [{ outcome: "FAIL" }],
      treatments: [
        { label: "TS", outcome: "PASS", hypothesisIds: [hypotheses[0]!.id] },
        { label: "LOW-BR", outcome: "FAIL", hypothesisIds: [hypotheses[1]!.id] },
        { label: "AAC", outcome: "FAIL", hypothesisIds: [hypotheses[2]!.id] },
      ],
    });
  });

  it("does not claim origin latency when LOW-BR only changes representation exposure", () => {
    const localHypothesis = hypothesis(hypotheses[0]!.id, "High origin latency causes the stall");
    const entries = [
      entry("31d7cd14-b638-42ee-8df4-a7590b24653f", "CONTROL", true, [], "FAIL"),
      entry("40a78a3e-358f-448d-8806-c2b13f274c21", "LOW-BR", false, [localHypothesis.id], "PASS"),
    ];
    entries[1]!.clone.executionPlan.transformations.push({ kind: "filter_video_representations", description: "Expose variant-1 only", representationIds: ["variant-1"] });
    const experiment = detail(entries);
    experiment.hypotheses = [localHypothesis];
    const evaluation = evaluateExperimentEvidence({ experiment, originalEvidence: { reportId: "report-1", limitationCount: 0 } });

    expect(evaluation.hypothesisUpdates[0]).toMatchObject({ status: "PARTIALLY_SUPPORTED" });
    expect(evaluation.analysis?.supportedClaim).toContain("representation selection, ladder exposure, or bitrate demand");
    expect(evaluation.analysis?.notEstablished).toContain("High latency at the original origin, because the recorded clone does not emulate origin latency.");
    expect(evaluation.analysis?.limitations).toContain("No playback artifact or telemetry was attached to the results.");
  });

  it("requests more evidence without inventing missing device outcomes", () => {
    const entries = [
      entry("31d7cd14-b638-42ee-8df4-a7590b24653f", "CONTROL", true, [], "FAIL"),
      entry("40a78a3e-358f-448d-8806-c2b13f274c21", "TS", false, [hypotheses[0]!.id]),
    ];
    const evaluation = evaluateExperimentEvidence({ experiment: detail(entries), originalEvidence: { reportId: "report-1", limitationCount: 0 } });
    expect(evaluation.status).toBe("MORE_TESTS_REQUIRED");
    expect((evaluation.evidenceBundle.treatments as Array<{ outcome: string }>)[0]!.outcome).toBe("NOT_REPORTED");
    expect(evaluation.proposedNextExperimentPlan).toBeDefined();
  });
});

type Entry = { clone: ExperimentClone; request: TestRequest };
function entry(cloneId: string, label: string, control: boolean, hypothesisIds: string[], outcome?: TestResult["outcome"]): Entry {
  const requestId = cloneId.replace(/^./, "a");
  const spec = cloneSpec(control, label, hypothesisIds);
  const result = outcome ? testResult(requestId, outcome, label === "CONTROL" || label === "LOW-BR" || label === "AAC" ? "STARTUP" : undefined) : undefined;
  return {
    clone: {
      id: cloneId, experimentId, iterationId, recordingId: cloneId.replace(/^./, "9"), shortLabel: label, isControl: control, state: "READY",
      spec, specHash: `hash-${label}`, executionPlan: plan(label), provenance: {}, verification: verification(),
      createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T10:00:00.000Z", completedAt: "2026-08-11T10:00:00.000Z",
    },
    request: {
      id: requestId, experimentId, iterationId, cloneId, shortLabel: label, testUrl: `/streams/experiments/${experimentId}/index.m3u8`, instructions: "Select, replay the same URL, then report.",
      hypothesisIds, status: result ? "COMPLETED" : "PENDING", ...(result ? { result } : {}), createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-11T10:00:00.000Z",
    },
  };
}
function detail(entries: Entry[]): ExperimentDetail {
  return {
    id: experimentId, investigationId, goal: "Determine the playback incompatibility", status: "EVALUATING", createdBy: "user",
    createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z", hypotheses,
    iterations: [{ id: iterationId, experimentId, iterationNumber: 1, rationale: "Small discriminating set", cloneSpecs: entries.map((item) => item.clone.spec), status: "EVALUATING", createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" }],
    clones: entries.map((item) => item.clone), testRequests: entries.map((item) => item.request), evaluations: [],
  };
}
function hypothesis(id: string, statement: string): Hypothesis { return { id, experimentId, statement, rationale: "Reported device failure", evidenceFor: [], evidenceAgainst: [], status: "OPEN", createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-11T09:00:00.000Z" }; }
function cloneSpec(control: boolean, label: string, hypothesisIds: string[]): CloneSpec { return { version: "1", source: { investigationId, mode: "recorded_snapshot" }, mode: "manifest_only", reason: { role: control ? "control" : "treatment", shortLabel: label, hypothesisIds, description: `${label} controlled change.`, expectedDiscriminatingSignal: "Compare with CONTROL." } }; }
function plan(label: string): CloneExecutionPlan { return { version: "1", specVersion: "1", protocol: "hls", sourceMode: "recorded_snapshot", transformations: [{ kind: "record_snapshot", description: label }], selection: { videoRepresentationIds: ["variant-0"], audioMode: "preserve", expectedAudioRenditionCount: 1 }, processes: [], whatChanged: label, expectedDiscriminatingSignal: "Compare.", sourceArtifactIds: [] }; }
function verification(): CloneVerificationReport { return { verifiedAt: "2026-08-11T10:00:00.000Z", status: "PASSED", manifest: { protocol: "hls", kind: "master", videoRepresentationCount: 1, audioRepresentationCount: 1 }, requested: { videoRepresentationIds: ["variant-0"], audioMode: "preserve" }, outputArtifactIds: [], warnings: [], errors: [] }; }
function testResult(testRequestId: string, outcome: TestResult["outcome"], failureStage?: TestResult["failureStage"]): TestResult { return { id: testRequestId.replace(/^./, "f"), testRequestId, outcome, ...(failureStage ? { failureStage } : {}), evidenceArtifactIds: [], reportedBy: "workspace-user", reportedVia: "USER", occurredAt: "2026-08-11T11:00:00.000Z", createdAt: "2026-08-11T11:00:00.000Z", updatedAt: "2026-08-11T11:00:00.000Z" }; }
