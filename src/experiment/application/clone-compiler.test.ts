import { describe, expect, it } from "vitest";
import { CloneSpecSchema } from "../../contracts/experiment.js";
import type { CloneSourceEvidence, CloneSpec } from "../domain/clone-spec.js";
import { cloneSpecHash, compileCloneSpec, expandCloneRecipe, UnsupportedCloneTransformationError } from "./clone-compiler.js";

const investigationId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const hypothesisId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
const source: CloneSourceEvidence = {
  investigationId,
  protocol: "hls",
  live: false,
  artifactIds: ["7d9d633e-3118-42e9-a4bb-2d917bbe3290"],
  representations: [
    { id: "variant-0", bandwidth: 800_000, width: 640, height: 360 },
    { id: "variant-1", bandwidth: 4_000_000, width: 1920, height: 1080 },
  ],
  audioRenditionCount: 2,
};

describe("CloneCompiler", () => {
  it("compiles a control into a declarative plan with no command execution", () => {
    const plan = compileCloneSpec(control(), source);
    expect(plan.selection).toEqual({
      videoRepresentationIds: ["variant-0", "variant-1"],
      audioMode: "preserve",
      expectedAudioRenditionCount: 2,
    });
    expect(plan.processes).toEqual([]);
    expect(plan.whatChanged).toContain("Control");
  });

  it("expands force_representation into the persisted explicit CloneSpec", () => {
    const spec = expandCloneRecipe({
      recipe: "force_representation",
      investigationId,
      shortLabel: "LOW-BR",
      hypothesisIds: [hypothesisId],
      representationId: "variant-0",
    }, source);
    const plan = compileCloneSpec(spec, source);
    expect(spec.abr).toEqual({ mode: "single_representation", representationIds: ["variant-0"] });
    expect(plan.selection.videoRepresentationIds).toEqual(["variant-0"]);
    expect(plan.transformations).toContainEqual(expect.objectContaining({ kind: "filter_video_representations" }));
  });

  it("supports the same selection plan for deterministic DASH evidence", () => {
    const dash = { ...source, protocol: "dash" as const, representations: [{ id: "video_por=1483000" }, { id: "video_por=7094000" }], audioRenditionCount: 1 };
    const spec = { ...control(), packaging: { protocol: "dash" as const } };
    expect(compileCloneSpec(spec, dash)).toMatchObject({ protocol: "dash", selection: { videoRepresentationIds: ["video_por=1483000", "video_por=7094000"] } });

    const treatment = expandCloneRecipe({ recipe: "single_video_representation", investigationId, shortLabel: "LOW-BR", hypothesisIds: [hypothesisId] }, dash);
    expect(CloneSpecSchema.safeParse(treatment).success).toBe(true);
  });

  it("fails unsupported media transformations explicitly", () => {
    const spec: CloneSpec = { ...control(), mode: "transcode", reason: treatmentReason(), video: { codec: "h264", bitrate: 2_000_000 } };
    expect(() => compileCloneSpec(spec, source)).toThrow(UnsupportedCloneTransformationError);
  });

  it("fails during preview when the existing Record materializer cannot build the source", () => {
    expect(() => compileCloneSpec(control(), { ...source, representations: [{ id: "variant-0" }] }))
      .toThrow(/at least two source video representations/);
  });

  it("rejects codecs and command-like option values at the schema boundary", () => {
    expect(CloneSpecSchema.safeParse({ ...control(), video: { codec: "copy; rm -rf /" } }).success).toBe(false);
    expect(CloneSpecSchema.safeParse({ ...control(), video: { profile: "main$(id)" } }).success).toBe(false);
    expect(CloneSpecSchema.safeParse({ ...control(), video: { bitrate: -1 } }).success).toBe(false);
    expect(CloneSpecSchema.safeParse({ ...control(), video: { width: 99, height: 20 } }).success).toBe(false);
  });

  it("does not advertise a treatment identical to the existing control path", () => {
    expect(() => expandCloneRecipe({ recipe: "minimal_hls", investigationId, shortLabel: "MIN", hypothesisIds: [hypothesisId] }, source))
      .toThrow(/would not differ from CONTROL/);
  });

  it("hashes semantically identical specs independently of object key order", () => {
    const first = control();
    const second = { reason: first.reason, mode: first.mode, source: first.source, version: first.version, manifest: first.manifest, abr: first.abr, packaging: first.packaging } as CloneSpec;
    expect(cloneSpecHash(first)).toBe(cloneSpecHash(second));
  });
});

function control(): CloneSpec {
  return {
    version: "1",
    source: { investigationId, mode: "recorded_snapshot", snapshotDurationSeconds: 120 },
    mode: "manifest_only",
    packaging: { protocol: "hls" },
    abr: { mode: "preserve", representationIds: [] },
    manifest: { normalisation: "preserve", operations: [] },
    reason: {
      role: "control",
      shortLabel: "CONTROL",
      hypothesisIds: [],
      description: "Preserve media through Record.",
      expectedDiscriminatingSignal: "Control reproduces the original result.",
    },
  };
}
function treatmentReason(): CloneSpec["reason"] {
  return { role: "treatment", shortLabel: "TREAT", hypothesisIds: [hypothesisId], description: "Change one variable.", expectedDiscriminatingSignal: "Result differs from control." };
}
