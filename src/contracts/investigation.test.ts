import { describe, expect, it } from "vitest";
import { InvestigationReportContentSchema } from "./investigation.js";

const commonReport = {
  placeholder: false as const,
  title: "HLS manifest collected",
  summary: "Manifest evidence collected.",
  findings: [{ title: "Manifest detected", status: "observed" as const, explanation: "HLS master." }],
  confidence: { level: "limited" as const, explanation: "Media was not probed." },
};

const commonEvidence = {
  collectedAt: "2026-07-21T12:00:00.000Z",
  source: {
    requestedUrl: "https://example.test/master.m3u8",
    finalUrl: "https://example.test/master.m3u8",
    protocol: "hls" as const,
    httpStatus: 200,
  },
  observations: [{ code: "MANIFEST_DETECTED", severity: "info" as const, message: "HLS detected." }],
  limitations: ["Media was not probed."],
};

function v2Evidence() {
  return {
    ...commonEvidence,
    schemaVersion: 2 as const,
    manifests: [{
      artifactId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", logicalKey: "manifest/root", role: "root" as const,
      requestedUrl: commonEvidence.source.requestedUrl, finalUrl: commonEvidence.source.finalUrl, kind: "master" as const, sizeBytes: 100, variantCount: 2,
    }],
    mediaSamples: [],
    hls: { variants: [{ index: 0, uri: "low.m3u8", bandwidth: 1_000 }, { index: 1, uri: "high.m3u8", bandwidth: 2_000 }], renditions: [] },
  };
}

describe("investigation report contracts", () => {
  it("keeps Phase 2 evidence bundle v1 reports readable", () => {
    expect(InvestigationReportContentSchema.safeParse({
      ...commonReport,
      generatedBy: "deterministic-manifest-v1",
      evidence: {
        ...commonEvidence,
        schemaVersion: 1,
        manifest: {
          artifactId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
          kind: "master",
          sizeBytes: 100,
          variantCount: 1,
        },
      },
    }).success).toBe(true);
  });

  it("accepts the artifact-oriented evidence bundle v2", () => {
    expect(InvestigationReportContentSchema.safeParse({
      ...commonReport,
      generatedBy: "deterministic-manifest-v2",
      evidence: v2Evidence(),
    }).success).toBe(true);
  });

  it("accepts the protocol-neutral ABR assessment", () => {
    expect(InvestigationReportContentSchema.safeParse({
      ...commonReport,
      generatedBy: "deterministic-manifest-v2",
      evidence: {
        ...v2Evidence(),
        abr: {
          evidenceId: "abr-assessment:hls", schemaVersion: 1, protocol: "hls", verdict: "INCONCLUSIVE",
          reportedPriority: { abrProblemReported: false },
          coverage: { level: "MANIFEST_ONLY", manifestObserved: true, mediaSampleCount: 0, representationCount: 2, transitionPairsAnalyzed: 0, playbackObserved: false, limitations: ["No playback."] },
          ladder: { representations: [{ evidenceId: "variant:0", id: "low", groupId: "hls:video", bandwidth: 1_000 }, { evidenceId: "variant:1", id: "high", groupId: "hls:video", bandwidth: 2_000 }], videoRepresentationCount: 2, audioRenditionCount: 0 },
          findings: [], transitions: [], transitionMatrix: [], recommendedMeasurements: ["Observe playback."],
        },
      },
    }).success).toBe(true);
  });

  it("keeps the historical Tizen-shaped reported context readable", () => {
    expect(InvestigationReportContentSchema.safeParse({
      ...commonReport,
      generatedBy: "deterministic-manifest-v2",
      evidence: {
        ...v2Evidence(),
        reportedContext: { reportsVideoFreeze: true, reportsAudioContinues: true, reportsAbrSwitch: true, reportsFourKToFullHd: true, reportedDevice: { exactModelCode: "legacy-model", tizenVersion: "7.0", avplayVersion: "7.0" }, mentionedAvplayEvents: ["onbufferingstart"], uncertainties: [] },
      },
    }).success).toBe(true);
  });

  it("rejects a report generator version that does not match its evidence bundle", () => {
    expect(InvestigationReportContentSchema.safeParse({
      ...commonReport,
      generatedBy: "deterministic-manifest-v2",
      evidence: {
        ...commonEvidence,
        schemaVersion: 1,
        manifest: {
          artifactId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
          kind: "master",
          sizeBytes: 100,
        },
      },
    }).success).toBe(false);
  });
});
