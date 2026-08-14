import { createHash } from "node:crypto";
import type { InvestigationReport } from "../../investigation/domain/investigation-report.js";
import type {
  CloneExecutionPlan,
  CloneRecipeName,
  CloneSourceEvidence,
  CloneSpec,
} from "../domain/clone-spec.js";

export class UnsupportedCloneTransformationError extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(" "));
    this.name = "UnsupportedCloneTransformationError";
  }
}

export type CloneCapability = {
  recipe: CloneRecipeName;
  supported: boolean;
  mode: CloneSpec["mode"];
  description: string;
  limitation?: string;
};

export function listCloneCapabilities(): CloneCapability[] {
  return [
    { recipe: "control", supported: true, mode: "manifest_only", description: "Preserve the source ladder while passing through the existing Record path." },
    { recipe: "force_representation", supported: true, mode: "manifest_only", description: "Expose one explicit source video representation." },
    { recipe: "single_video_representation", supported: true, mode: "manifest_only", description: "Expose one source video representation and remove video ABR." },
    { recipe: "single_audio", supported: true, mode: "manifest_only", description: "Keep one linked audio rendition while preserving video." },
    { recipe: "minimal_hls", supported: false, mode: "manifest_only", description: "Generate a minimal HLS manifest.", limitation: "Record already normalises every local HLS manifest, so this would not differ from CONTROL." },
    { recipe: "fixed_bitrate", supported: true, mode: "manifest_only", description: "Expose the source representation closest to an explicit bitrate." },
    { recipe: "fixed_resolution", supported: true, mode: "manifest_only", description: "Expose a source representation at an explicit resolution." },
    { recipe: "hls_mpegts", supported: false, mode: "repackage", description: "Repackage HLS as MPEG-TS.", limitation: "The current Record materializer copies MPEG-TS but does not safely repackage fMP4." },
    { recipe: "hls_fmp4", supported: false, mode: "repackage", description: "Repackage HLS as fMP4.", limitation: "No HLS fMP4 packager is composed into the worker." },
    { recipe: "aac_stereo", supported: false, mode: "transcode", description: "Transcode audio to AAC stereo.", limitation: "The current worker has bounded decode probes, not a production transcode pipeline." },
    { recipe: "fixed_frame_rate", supported: false, mode: "transcode", description: "Transcode to a fixed frame rate.", limitation: "Frame-rate conversion is not supported by the current Record materializer." },
    { recipe: "short_gop", supported: false, mode: "transcode", description: "Transcode with a shorter closed GOP.", limitation: "GOP rewriting is not supported by the current Record materializer." },
    { recipe: "dash_demuxed", supported: false, mode: "repackage", description: "Repackage DASH into explicit demuxed adaptation sets.", limitation: "Record preserves supported DASH representations but does not repackage arbitrary input layouts." },
  ];
}

export function cloneSpecHash(spec: CloneSpec): string {
  return createHash("sha256").update(JSON.stringify(canonical(spec))).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function compileCloneSpec(spec: CloneSpec, source: CloneSourceEvidence): CloneExecutionPlan {
  const errors = validateCloneSpecAgainstSource(spec, source);
  if (errors.length > 0) throw new UnsupportedCloneTransformationError(errors);

  const selected = selectRepresentations(spec, source);
  const singleAudio = spec.manifest?.operations?.some((operation) => operation.op === "single_audio") ?? false;
  const minimal = spec.manifest?.normalisation === "minimal";
  const transformations: CloneExecutionPlan["transformations"] = [{
    kind: "record_snapshot",
    description: "Materialize a bounded, self-contained VOD snapshot through the existing Record pipeline.",
  }];
  if (selected.length !== source.representations.length) {
    transformations.push({
      kind: "filter_video_representations",
      description: `Expose only ${selected.join(", ")} from the source video ladder.`,
      representationIds: selected,
    });
  }
  if (singleAudio) transformations.push({ kind: "single_audio", description: "Keep one linked audio rendition." });
  if (minimal) transformations.push({ kind: "minimal_manifest", description: "Write only the manifest fields required by the local self-contained stream." });

  const changed = transformations.filter((entry) => entry.kind !== "record_snapshot");
  if (spec.reason.role === "treatment" && changed.length === 0) {
    throw new UnsupportedCloneTransformationError(["The treatment does not change a discriminating variable relative to CONTROL."]);
  }
  return {
    version: "1",
    specVersion: spec.version,
    protocol: source.protocol,
    sourceMode: spec.source.mode,
    transformations,
    selection: {
      videoRepresentationIds: selected,
      audioMode: singleAudio ? "single" : "preserve",
      expectedAudioRenditionCount: singleAudio ? Math.min(1, source.audioRenditionCount) : source.audioRenditionCount,
    },
    processes: [],
    whatChanged: changed.length === 0
      ? "Control: media characteristics are preserved while the stream passes through the Video Harness recording path."
      : changed.map((entry) => entry.description).join(" "),
    expectedDiscriminatingSignal: spec.reason.expectedDiscriminatingSignal,
    sourceArtifactIds: source.artifactIds,
  };
}

export function validateCloneSpecAgainstSource(spec: CloneSpec, source: CloneSourceEvidence): string[] {
  const errors: string[] = [];
  if (spec.source.investigationId !== source.investigationId) errors.push("CloneSpec source does not match the requested investigation.");
  if (spec.source.mode === "live_proxy") errors.push("live_proxy is modelled but not implemented; use a recorded_snapshot when the source is reproducibly bounded.");
  if (source.live) errors.push("The current experiment pipeline does not silently convert a live source into VOD; live snapshot capture is not implemented.");
  if (source.representations.length < 2) errors.push("The existing Record materializer requires at least two source video representations.");
  if (spec.mode !== "manifest_only") errors.push(`${spec.mode} is not supported by the current Record materializer.`);
  if (spec.packaging?.protocol && spec.packaging.protocol !== source.protocol) errors.push("Protocol conversion requires a repackage pipeline that is not currently composed.");
  if (spec.packaging?.container || spec.packaging?.segmentDurationSeconds) errors.push("Packaging or segment-duration changes are not supported by manifest-only cloning.");
  if (spec.video) errors.push("Encoded video changes require the deferred transcode pipeline.");
  if (spec.audio && Object.keys(spec.audio).length > 0) errors.push("Encoded audio changes require the deferred transcode pipeline.");
  if (spec.manifest?.operations?.some((operation) => operation.op === "single_audio") && source.audioRenditionCount <= 1) {
    errors.push("single_audio requires more than one linked source audio rendition to differ from CONTROL.");
  }
  if (spec.manifest?.normalisation === "minimal") errors.push("minimal_hls would not differ from CONTROL because the current Record path already normalises local manifests.");
  const requested = spec.abr?.representationIds ?? spec.manifest?.operations?.flatMap((operation) => operation.representationIds ?? []) ?? [];
  const known = new Set(source.representations.map((entry) => entry.id));
  for (const id of requested) if (!known.has(id)) errors.push(`Representation ${id} is not present in deterministic source evidence.`);
  if (spec.reason.role === "treatment" && spec.reason.hypothesisIds.length === 0) errors.push("A treatment must identify at least one hypothesis.");
  return [...new Set(errors)];
}

function selectRepresentations(spec: CloneSpec, source: CloneSourceEvidence): string[] {
  if (!spec.abr || spec.abr.mode === "preserve") return source.representations.map((entry) => entry.id);
  if (spec.abr.representationIds?.length) return spec.abr.representationIds;
  if (spec.abr.targetBitrate) {
    const candidate = [...source.representations]
      .filter((entry) => entry.bandwidth !== undefined)
      .sort((left, right) => Math.abs(left.bandwidth! - spec.abr!.targetBitrate!) - Math.abs(right.bandwidth! - spec.abr!.targetBitrate!))[0];
    if (candidate) return [candidate.id];
  }
  throw new UnsupportedCloneTransformationError(["The requested ABR selection could not be resolved from deterministic evidence."]);
}

export function expandCloneRecipe(input: {
  recipe: CloneRecipeName;
  investigationId: string;
  shortLabel: string;
  hypothesisIds: string[];
  representationId?: string;
  targetBitrate?: number;
  width?: number;
  height?: number;
}, source: CloneSourceEvidence): CloneSpec {
  const base = (description: string, expected: string): CloneSpec => ({
    version: "1",
    source: { investigationId: input.investigationId, mode: "recorded_snapshot", snapshotDurationSeconds: 120 },
    mode: "manifest_only",
    abr: { mode: "preserve", representationIds: [] },
    manifest: { normalisation: "preserve", operations: [] },
    reason: {
      role: input.recipe === "control" ? "control" : "treatment",
      shortLabel: input.shortLabel,
      hypothesisIds: input.recipe === "control" ? [] : input.hypothesisIds,
      description,
      expectedDiscriminatingSignal: expected,
    },
  });

  if (input.recipe === "control") return base("Preserve the source through the Video Harness clone path.", "If original playback fails but CONTROL passes, the cloning path changed a relevant variable.");
  if (input.recipe === "single_audio") {
    const spec = base("Keep one linked audio rendition while preserving video.", "A different result from CONTROL isolates audio-rendition selection as a discriminating variable.");
    spec.manifest = { normalisation: "preserve", operations: [{ op: "single_audio" }] };
    return spec;
  }
  if (input.recipe === "minimal_hls") {
    throw new UnsupportedCloneTransformationError([source.protocol !== "hls"
      ? "minimal_hls requires an HLS source."
      : "minimal_hls would not differ from CONTROL because Record already writes a minimal local manifest."]);
  }

  let representationId = input.representationId;
  if (input.recipe === "fixed_bitrate") {
    const target = input.targetBitrate;
    if (!target) throw new UnsupportedCloneTransformationError(["fixed_bitrate requires targetBitrate."]);
    representationId = [...source.representations].filter((entry) => entry.bandwidth !== undefined)
      .sort((left, right) => Math.abs(left.bandwidth! - target) - Math.abs(right.bandwidth! - target))[0]?.id;
  }
  if (input.recipe === "fixed_resolution") {
    if (!input.width || !input.height) throw new UnsupportedCloneTransformationError(["fixed_resolution requires width and height."]);
    representationId = source.representations.find((entry) => entry.width === input.width && entry.height === input.height)?.id;
  }
  if (input.recipe === "single_video_representation" && !representationId) {
    representationId = [...source.representations].sort((left, right) => (left.bandwidth ?? Number.MAX_SAFE_INTEGER) - (right.bandwidth ?? Number.MAX_SAFE_INTEGER))[0]?.id;
  }
  if (["force_representation", "single_video_representation", "fixed_bitrate", "fixed_resolution"].includes(input.recipe)) {
    if (!representationId) throw new UnsupportedCloneTransformationError([`${input.recipe} could not resolve a source representation.`]);
    const spec = base(`Expose only source representation ${representationId}.`, "A different result from CONTROL isolates representation selection from packaging and audio changes.");
    spec.abr = { mode: "single_representation", representationIds: [representationId] };
    spec.manifest = { normalisation: "preserve", operations: [{ op: "filter_representations", representationIds: [representationId] }] };
    return spec;
  }

  const capability = listCloneCapabilities().find((entry) => entry.recipe === input.recipe);
  throw new UnsupportedCloneTransformationError([capability?.limitation ?? `${input.recipe} is not supported.`]);
}

export function cloneSourceEvidenceFromReport(investigationId: string, report: InvestigationReport): CloneSourceEvidence {
  if (report.content.placeholder) throw new UnsupportedCloneTransformationError(["Experiments require deterministic investigation evidence."]);
  const evidence = report.content.evidence;
  if (evidence.schemaVersion === 1) throw new UnsupportedCloneTransformationError(["Experiments require EvidenceBundle v2 or newer."]);
  const protocol = evidence.source.protocol;
  const abrRepresentations = evidence.abr?.ladder.representations ?? [];
  const representations = abrRepresentations.length > 0
    ? abrRepresentations.map((entry) => ({
      id: entry.id,
      ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }),
      ...(entry.width === undefined ? {} : { width: entry.width }),
      ...(entry.height === undefined ? {} : { height: entry.height }),
      ...(entry.frameRate === undefined ? {} : { frameRate: entry.frameRate }),
      ...(entry.codecs ? { codecs: entry.codecs } : {}),
    }))
    : protocol === "hls"
      ? (evidence.hls?.variants ?? []).map((entry) => {
        const resolution = /^(\d+)x(\d+)$/i.exec(entry.resolution ?? "");
        return {
          id: `variant-${entry.index}`,
          ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }),
          ...(resolution ? { width: Number(resolution[1]), height: Number(resolution[2]) } : {}),
          ...(entry.frameRate === undefined ? {} : { frameRate: entry.frameRate }),
          ...(entry.codecs ? { codecs: entry.codecs } : {}),
        };
      })
      : (evidence.dash?.representations ?? []).filter((entry) => entry.contentType === "video").map((entry) => ({
        id: entry.id,
        ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }),
        ...(entry.width === undefined ? {} : { width: entry.width }),
        ...(entry.height === undefined ? {} : { height: entry.height }),
        ...(entry.codecs ? { codecs: entry.codecs } : {}),
      }));
  if (representations.length === 0) throw new UnsupportedCloneTransformationError(["No video representation is available in deterministic evidence."]);
  const hlsMediaManifests = evidence.manifests.filter((entry) => entry.kind === "media");
  const live = protocol === "dash"
    ? evidence.dash?.type === "dynamic"
    : hlsMediaManifests.length === 0 || hlsMediaManifests.some((entry) => entry.hasEndList !== true);
  return {
    investigationId,
    protocol,
    live,
    artifactIds: [...evidence.manifests.map((entry) => entry.artifactId), ...evidence.mediaSamples.map((entry) => entry.artifactId)],
    representations,
    audioRenditionCount: protocol === "hls"
      ? linkedHlsAudioCount(evidence.hls?.variants ?? [], evidence.hls?.renditions ?? [])
      : largestDashAudioGroupCount(evidence.dash?.representations ?? []),
  };
}

function linkedHlsAudioCount(
  variants: Array<{ audioGroupId?: string }>,
  renditions: Array<{ type: string; groupId?: string; url?: string }>,
): number {
  const groups = new Set(variants.map((entry) => entry.audioGroupId).filter((entry): entry is string => Boolean(entry)));
  return renditions.filter((entry) => entry.type.toUpperCase() === "AUDIO" && Boolean(entry.url) && Boolean(entry.groupId && groups.has(entry.groupId))).length;
}

function largestDashAudioGroupCount(representations: Array<{ contentType: string; periodIndex: number; adaptationSetIndex: number }>): number {
  const counts = new Map<string, number>();
  for (const entry of representations.filter((candidate) => candidate.contentType === "audio")) {
    const key = `${entry.periodIndex}:${entry.adaptationSetIndex}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}
