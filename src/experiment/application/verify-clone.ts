import type { CloneExecutionPlan, CloneSpec, CloneVerificationReport } from "../domain/clone-spec.js";
import type { RecordedResource } from "../../record/domain/recorded-resource.js";
import { inspectManifest } from "../../stream-tools/manifest.js";

export function verifyCloneOutput(input: {
  spec: CloneSpec;
  plan: CloneExecutionPlan;
  manifestText: string;
  resources: RecordedResource[];
  verifiedAt?: string;
}): CloneVerificationReport {
  const warnings: string[] = [];
  const errors: string[] = [];
  const manifest: CloneVerificationReport["manifest"] = {};

  try {
    const inspection = inspectManifest(input.manifestText, `https://verification.invalid/${input.plan.protocol === "hls" ? "index.m3u8" : "index.mpd"}`);
    manifest.protocol = inspection.protocol;
    manifest.kind = inspection.kind;
    manifest.videoRepresentationCount = inspection.protocol === "hls"
      ? inspection.hls?.variants.length ?? 0
      : inspection.dash?.representations.filter((entry) => entry.contentType === "video").length ?? 0;
    manifest.audioRepresentationCount = inspection.protocol === "hls"
      ? inspection.hls?.renditions.filter((entry) => entry.type.toUpperCase() === "AUDIO").length ?? 0
      : inspection.dash?.representations.filter((entry) => entry.contentType === "audio").length ?? 0;
    if (inspection.protocol !== input.plan.protocol) errors.push(`Expected ${input.plan.protocol.toUpperCase()} output but found ${inspection.protocol.toUpperCase()}.`);
    if (manifest.videoRepresentationCount !== input.plan.selection.videoRepresentationIds.length) {
      errors.push(`Expected ${input.plan.selection.videoRepresentationIds.length} video representations but found ${manifest.videoRepresentationCount}.`);
    }
    if ((input.spec.reason.role === "control" || input.plan.selection.audioMode === "single") && manifest.audioRepresentationCount !== input.plan.selection.expectedAudioRenditionCount) {
      errors.push(`Expected ${input.plan.selection.expectedAudioRenditionCount} audio renditions but found ${manifest.audioRepresentationCount}.`);
    } else if (input.plan.selection.audioMode === "preserve" && manifest.audioRepresentationCount < input.plan.selection.expectedAudioRenditionCount) {
      warnings.push("Video selection made some unreferenced source audio groups inapplicable; linked audio for the selected variants was preserved.");
    }
    if (inspection.protocol === "hls" && inspection.kind !== "master") errors.push("The generated HLS entry point is not a master playlist.");
    if (inspection.protocol === "dash" && inspection.dash?.type !== "static") errors.push("The generated DASH entry point is not a static VOD MPD.");
  } catch (error) {
    errors.push(error instanceof Error ? `Generated manifest is invalid: ${error.message}` : "Generated manifest is invalid.");
  }

  const actualSourceIds = new Set(input.resources.flatMap((resource) => {
    const value = resource.metadata.sourceRepresentationId ?? resource.metadata.representationId;
    return typeof value === "string" && (resource.kind === "media-playlist" || resource.kind === "init-segment") ? [value] : [];
  }));
  const missing = input.plan.selection.videoRepresentationIds.filter((id) => !actualSourceIds.has(id));
  if (missing.length > 0) errors.push(`Output resources do not prove requested source representations: ${missing.join(", ")}.`);
  if (input.spec.source.mode === "recorded_snapshot") {
    warnings.push("This is a bounded recorded snapshot; it does not test live-window refresh, media-sequence progression, live discontinuities, or live latency.");
  }

  return {
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
    status: errors.length === 0 ? "PASSED" : "FAILED",
    manifest,
    requested: {
      videoRepresentationIds: input.plan.selection.videoRepresentationIds,
      audioMode: input.plan.selection.audioMode,
    },
    outputArtifactIds: input.resources.map((entry) => entry.id),
    warnings,
    errors,
  };
}
