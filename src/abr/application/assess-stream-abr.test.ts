import { describe, expect, it } from "vitest";
import type { AbrAssessment } from "../domain/assessment.js";
import type { AbrSwitchEvidence } from "../domain/evidence.js";
import { buildAbrAssessment, selectPriorityAbrTransition } from "./assess-stream-abr.js";

describe("buildAbrAssessment", () => {
  it("always returns an explicit assessment when video ABR is not applicable", () => {
    const assessment = buildAbrAssessment({ protocol: "hls", representations: [representation("only", 2_000_000, 1080)], audioRenditionCount: 1, mediaSampleCount: 1 });
    expect(assessment).toMatchObject({ protocol: "hls", verdict: "NOT_APPLICABLE", coverage: { representationCount: 1 }, findings: [{ ruleId: "ABR_LADDER_001" }] });
  });

  it("detects ladder ordering and spacing risks without platform assumptions", () => {
    const assessment = buildAbrAssessment({
      protocol: "hls",
      representations: [representation("low", 1_000_000, 1080), representation("high", 4_000_000, 720)],
      audioRenditionCount: 0,
      mediaSampleCount: 2,
    });
    expect(assessment.verdict).toBe("ISSUES_FOUND");
    expect(assessment.findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining(["ABR_LADDER_003", "ABR_LADDER_004"]));
  });

  it("prioritizes deterministic risk and user-reported direction instead of a fixed resolution pair", () => {
    const lowToMid = transition("low-mid", "low", 480, "mid", 720, "UPSHIFT");
    const midToHigh = transition("mid-high", "mid", 720, "high", 1080, "UPSHIFT");
    midToHigh.deterministicFindings = [{ evidenceId: "finding:risk", ruleId: "ABR_TIME_001", category: "AUTHORING_ERROR", severity: "HIGH", confidence: "VERY_HIGH", title: "gap", explanation: "gap", evidenceIds: ["timeline:risk"] }];
    const assessment: AbrAssessment = buildAbrAssessment({
      protocol: "dash",
      representations: [representation("low", 500_000, 480), representation("mid", 1_500_000, 720), representation("high", 4_000_000, 1080)],
      audioRenditionCount: 1,
      mediaSampleCount: 6,
      transitions: [lowToMid, midToHigh],
      reportedPriority: { abrProblemReported: true, direction: "UPSHIFT" },
    });
    expect(assessment.transitions[1]).toMatchObject({ transitionId: "mid-high", protocol: "dash", outcome: "FAIL", findingRuleIds: ["ABR_TIME_001"] });
    expect(assessment.transitions[1]).not.toHaveProperty("switchingContract");
    expect(selectPriorityAbrTransition(assessment, [lowToMid, midToHigh])?.switchId).toBe("mid-high");
  });
});

function representation(id: string, bandwidth: number, height: number) { return { evidenceId: `representation:${id}`, id, groupId: "video:0", bandwidth, width: Math.round(height * 16 / 9), height }; }
function transition(switchId: string, sourceId: string, sourceHeight: number, targetId: string, targetHeight: number, direction: AbrSwitchEvidence["direction"]): AbrSwitchEvidence { return { evidenceId: `switch:${switchId}`, switchId, evidenceBasis: "URL_STATIC_ANALYSIS", transitionStatus: "CANDIDATE", timestamps: {}, sourceRepresentation: { evidenceId: `representation:${sourceId}`, id: sourceId, periodIndex: 0, adaptationSetIndex: 0, height: sourceHeight }, targetRepresentation: { evidenceId: `representation:${targetId}`, id: targetId, periodIndex: 0, adaptationSetIndex: 0, height: targetHeight }, direction, switchKind: "RESOLUTION_CHANGING", switchingContract: { evidenceId: "contract", mode: "UNKNOWN", codecFamily: "UNKNOWN", representations: [sourceId, targetId] }, networkEvidence: { evidenceId: `network:${switchId}`, requests: [] }, decodeTests: [], deterministicFindings: [], missingEvidence: [] }; }
