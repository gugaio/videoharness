import { describe, expect, it, vi } from "vitest";
import { buildAbrAssessment } from "../../abr/application/assess-stream-abr.js";
import { ABRQualityInvestigatorAgent, buildAbrQualityAgentPacket, parseAbrQualityAgentOutput } from "./abr-quality-investigator-agent.js";

describe("ABRQualityInvestigatorAgent", () => {
  it("sends a protocol-neutral ladder assessment even without a switch candidate", () => {
    const packet = JSON.stringify(buildAbrQualityAgentPacket(assessment()));
    expect(packet).toContain('"protocol":"hls"');
    expect(packet).toContain('"priority_transition"');
    expect(packet).not.toContain("Samsung");
    expect(packet).not.toContain("AVPlay");
  });

  it("rejects unsupported root-cause citations instead of inventing facts", async () => {
    const run = vi.fn(async () => ({
      assessment_id: "abr-assessment:hls", summary: "Assessment complete.", abr_quality_explained: "Manifest-only coverage.",
      strongest_hypothesis: { category: "AUTHORING_RISK", confidence: "HIGH", statement: "Unsupported", evidence_ids: ["invented"] },
      findings: [{ rule_id: "AI_ABR_001", category: "AUTHORING_RISK", severity: "HIGH", confidence: "HIGH", title: "Unsupported", evidence_ids: ["invented"], technical_explanation: "", why_this_affects_abr: "", why_this_can_affect_player: "", spec_or_contract: "", confirmatory_test: "", recommended_remediation: "" }],
      ruled_out_or_weakened_hypotheses: [], missing_evidence: [], recommended_measurements: [], next_best_experiment: "Observe playback.",
    }));
    const output = await new ABRQualityInvestigatorAgent(run).investigate({ investigationId: "case-1", assessment: assessment() });
    expect(output.strongest_hypothesis.category).toBe("INCONCLUSIVE");
    expect(output.findings).toEqual([]);
  });

  it("normalizes common JSON variations while preserving evidence citations", () => {
    const output = parseAbrQualityAgentOutput({
      result: {
        assessmentId: "abr-assessment:hls",
        analysis_summary: "The declared ladder has bounded static coverage.",
        abrQualityExplained: "No playback request sequence was observed.",
        strongestHypothesis: {
          category: "inconclusive",
          confidence: 0.2,
          hypothesis: "Playback behavior remains unobserved.",
          evidenceIds: [],
        },
        findings: [{
          ruleId: "AI_ABR_001",
          category: "ladder topology",
          severity: "low",
          confidence: "medium",
          title: "Declared ladder inspected",
          evidenceIds: ["abr-assessment:hls"],
          explanation: "The manifest exposes two representations.",
        }],
        missingEvidence: "player request sequence",
        recommendedMeasurements: "Run a controlled playback.",
      },
    });

    expect(output.strongest_hypothesis).toMatchObject({ category: "INCONCLUSIVE", confidence: "LOW" });
    expect(output.findings[0]).toMatchObject({
      rule_id: "AI_ABR_001",
      category: "LADDER_TOPOLOGY",
      severity: "LOW",
      confidence: "MEDIUM",
      evidence_ids: ["abr-assessment:hls"],
      technical_explanation: "The manifest exposes two representations.",
    });
    expect(output.missing_evidence).toEqual(["player request sequence"]);
  });
});

function assessment() { return buildAbrAssessment({ protocol: "hls", representations: [{ evidenceId: "variant:0", id: "variant-0", groupId: "hls:video", bandwidth: 1_000_000, width: 1280, height: 720 }, { evidenceId: "variant:1", id: "variant-1", groupId: "hls:video", bandwidth: 2_000_000, width: 1920, height: 1080 }], audioRenditionCount: 1, mediaSampleCount: 1 }); }
