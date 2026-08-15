import { describe, expect, it } from "vitest";
import { EvidenceBundleV2Schema, InvestigationReportContentSchema } from "./investigation.js";

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

  it("preserves the compact GOP map at the evidence boundary", () => {
    const evidence = { ...v2Evidence(), mediaSamples: [{
      artifactId: "8dc67e09-4b25-4fe5-a69a-58f896fb5198",
      logicalKey: "sample/root/media/0",
      kind: "media-segment",
      sizeBytes: 1_024,
      sourceManifestLogicalKey: "manifest/root",
      probe: {
        tracks: [{ kind: "video", codec: "h264", profile: "High", pixelFormat: "yuv420p" }],
        boundary: {
          totalPacketCount: 2, totalFrameCount: 3, totalGopCount: 1, packets: [], frames: [],
          gops: [{ index: 0, startFrameIndex: 0, frameCount: 3, startsWithKeyFrame: true, firstPtsTime: 0, lastPtsTime: 0.08, truncated: false, frames: [
            { keyFrame: true, pictureType: "I", pts: "0", ptsTime: 0, sideDataTypes: [] },
            { keyFrame: false, pictureType: "P", pts: "1", ptsTime: 0.04, sideDataTypes: [] },
            { keyFrame: false, pictureType: "B", pts: "2", ptsTime: 0.08, sideDataTypes: [] },
          ] }],
        },
      },
    }] };

    const parsed = EvidenceBundleV2Schema.parse(evidence);
    expect(parsed.mediaSamples[0]?.probe?.boundary?.gops[0]?.frames.map((frame) => frame.pictureType)).toEqual(["I", "P", "B"]);
    expect(parsed.mediaSamples[0]?.probe?.tracks[0]).toMatchObject({ profile: "High", pixelFormat: "yuv420p" });
  });

  it("preserves bounded raw manifest content at the evidence boundary", () => {
    const evidence = {
      ...v2Evidence(),
      manifests: [{
        ...v2Evidence().manifests[0],
        content: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=246440,RESOLUTION=320x184\nlow.m3u8",
      }],
    };

    const parsed = EvidenceBundleV2Schema.parse(evidence);
    expect(parsed.manifests[0]?.content).toContain("#EXT-X-STREAM-INF:BANDWIDTH=246440");
  });

  it("accepts HTTP facts on manifests and media samples", () => {
    const evidence = {
      ...v2Evidence(),
      manifests: [{
        ...v2Evidence().manifests[0],
        http: { latencyMs: 42, firstByteMs: 12, redirectCount: 1, redirectChain: ["https://cdn.example/master.m3u8"], server: "nginx", cacheControl: "no-store", etag: "\"x\"", via: "1.1 varnish" },
      }],
      mediaSamples: [{
        artifactId: "8dc67e09-4b25-4fe5-a69a-58f896fb5199",
        logicalKey: "sample/root/media/0",
        kind: "media-segment",
        sizeBytes: 100,
        source: { url: "https://cdn.example/seg0.ts", sha256: "a".repeat(64), httpStatus: 200, http: { redirectCount: 0, latencyMs: 30 } },
      }],
    };

    const parsed = EvidenceBundleV2Schema.parse(evidence);
    expect(parsed.manifests[0]?.http?.server).toBe("nginx");
    expect(parsed.manifests[0]?.http?.redirectChain).toEqual(["https://cdn.example/master.m3u8"]);
    expect(parsed.mediaSamples[0]?.source?.http?.redirectCount).toBe(0);
    expect(parsed.mediaSamples[0]?.source?.http?.latencyMs).toBe(30);
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
