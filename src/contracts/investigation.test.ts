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
      evidence: {
        ...commonEvidence,
        schemaVersion: 2,
        manifests: [{
          artifactId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
          logicalKey: "manifest/root",
          role: "root",
          requestedUrl: commonEvidence.source.requestedUrl,
          finalUrl: commonEvidence.source.finalUrl,
          kind: "master",
          sizeBytes: 100,
          variantCount: 1,
        }],
        mediaSamples: [],
        hls: {
          variants: [{
            index: 0,
            uri: "variant.m3u8",
            url: "https://example.test/variant.m3u8",
            bandwidth: 1_000,
          }],
          renditions: [],
          selection: {
            rule: "highest-bandwidth",
            variantIndex: 0,
            variantLogicalKey: "manifest/variant/0",
          },
        },
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
