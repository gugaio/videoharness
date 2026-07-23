import { describe, expect, it } from "vitest";
import { parseLeadOutput, parseSpecialistOutput } from "./pi-investigation-ai.js";

describe("Pi investigation output parsing", () => {
  it("accepts confidence numbers serialized as strings", () => {
    const output = parseSpecialistOutput({
      summary: "Timeline is continuous.",
      findings: [{
        title: "A/V offset", severity: "info", explanation: "Offset remains stable.",
        evidenceIds: ["sample:sample/variant/0/media/0"], confidence: "0.8",
      }],
      limitations: [],
    });

    expect(output.findings[0]?.confidence).toBe(0.8);
  });

  it("keeps the Lead confidence numeric after coercion", () => {
    const output = parseLeadOutput({
      summary: "No defect observed.", likelyCause: "Evidence is insufficient for a root cause.", confidence: "0.4",
      findings: [], recommendations: ["Collect a longer session."], limitations: [],
    });

    expect(output.confidence).toBe(0.4);
  });

  it("uses limited confidence when the model returns a non-finite value", () => {
    const output = parseSpecialistOutput({
      summary: "The available sample is not enough to establish causality.",
      findings: [{
        title: "Inconclusive timing",
        severity: "warning",
        explanation: "The bounded samples do not reproduce the reported failure.",
        evidenceIds: ["observation:0"],
        confidence: "NaN",
      }],
      limitations: ["A longer playback capture is required."],
    });

    expect(output.findings[0]?.confidence).toBe(0.2);
  });

  it("normalizes nullable and out-of-range confidence without overstating certainty", () => {
    const output = parseLeadOutput({
      summary: "Evidence is limited.",
      likelyCause: "No root cause can be confirmed.",
      confidence: null,
      findings: [
        {
          title: "Missing playback evidence",
          severity: "medium",
          explanation: "Only bounded samples were inspected.",
          evidenceIds: "observation:0",
          confidence: 80,
        },
      ],
      recommendations: ["Capture a longer playback session."],
      limitations: [],
    });

    expect(output.confidence).toBe(0.2);
    expect(output.findings[0]).toMatchObject({
      severity: "warning",
      evidenceIds: ["observation:0"],
      confidence: 0.2,
    });
  });

  it("keeps a specialist response when only one finding is malformed", () => {
    const output = parseSpecialistOutput({
      summary: "One supported observation remains.",
      findings: [
        {
          title: "",
          severity: "info",
          explanation: "This malformed item is ignored.",
          evidenceIds: ["observation:0"],
          confidence: 0.5,
        },
        {
          title: "Observed continuity",
          severity: "info",
          explanation: "The sampled manifest has no declared discontinuity.",
          evidenceIds: ["manifest:manifest/root"],
          confidence: 0.7,
        },
      ],
      limitations: [],
    });

    expect(output.summary).toBe("One supported observation remains.");
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.title).toBe("Observed continuity");
  });
});
