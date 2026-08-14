import { describe, expect, it } from "vitest";
import type { CloneExecutionPlan, CloneSpec } from "../domain/clone-spec.js";
import type { RecordedResource } from "../../record/domain/recorded-resource.js";
import { verifyCloneOutput } from "./verify-clone.js";

const spec: CloneSpec = {
  version: "1",
  source: { investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538", mode: "recorded_snapshot" },
  mode: "manifest_only",
  reason: { role: "treatment", shortLabel: "LOW", hypothesisIds: ["8dc67e09-4b25-4fe5-a69a-58f896fb5197"], description: "Low representation.", expectedDiscriminatingSignal: "Passes while control fails." },
};
const plan: CloneExecutionPlan = {
  version: "1", specVersion: "1", protocol: "hls", sourceMode: "recorded_snapshot",
  transformations: [{ kind: "record_snapshot", description: "Record." }, { kind: "filter_video_representations", description: "One representation.", representationIds: ["variant-0"] }],
  selection: { videoRepresentationIds: ["variant-0"], audioMode: "single", expectedAudioRenditionCount: 1 },
  processes: [], whatChanged: "One representation and one audio rendition.", expectedDiscriminatingSignal: "Passes while control fails.", sourceArtifactIds: [],
};
const manifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="main",URI="renditions/audio-0/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio"
variants/video-0/index.m3u8
`;
const resources: RecordedResource[] = [
  { id: "7d9d633e-3118-42e9-a4bb-2d917bbe3290", logicalPath: "index.m3u8", kind: "master", storageKey: "recordings/x/index.m3u8", sizeBytes: 10, sha256: "a", metadata: {} },
  { id: "b27d184e-b47a-4a5c-b8a6-b42152083ea9", logicalPath: "variants/video-0/index.m3u8", kind: "media-playlist", storageKey: "recordings/x/v.m3u8", sizeBytes: 10, sha256: "b", metadata: { sourceRepresentationId: "variant-0" } },
];

describe("post-clone verification", () => {
  it("accepts a valid generated manifest and preserves output artifact provenance", () => {
    const result = verifyCloneOutput({ spec, plan, manifestText: manifest, resources, verifiedAt: "2026-08-11T12:00:00.000Z" });
    expect(result.status).toBe("PASSED");
    expect(result.manifest).toMatchObject({ protocol: "hls", videoRepresentationCount: 1, audioRepresentationCount: 1 });
    expect(result.outputArtifactIds).toEqual(resources.map((entry) => entry.id));
    expect(result.warnings[0]).toContain("recorded snapshot");
  });

  it("fails when the generated ladder violates the requested selection", () => {
    const twoVariants = `${manifest}#EXT-X-STREAM-INF:BANDWIDTH=4000000\nvariants/video-1/index.m3u8\n`;
    expect(verifyCloneOutput({ spec, plan, manifestText: twoVariants, resources }).errors).toContain("Expected 1 video representations but found 2.");
  });

  it("fails invalid output and missing representation provenance", () => {
    const result = verifyCloneOutput({ spec, plan, manifestText: "not a manifest", resources: [] });
    expect(result.status).toBe("FAILED");
    expect(result.errors.join(" ")).toContain("Generated manifest is invalid");
    expect(result.errors.join(" ")).toContain("variant-0");
  });
});
