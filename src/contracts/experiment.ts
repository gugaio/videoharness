import { z } from "zod";
import { cloneModes, cloneRecipeNames } from "../experiment/domain/clone-spec.js";
import { failureStages, testOutcomes } from "../experiment/domain/experiment.js";

const safeIdentifier = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._:-]+$/, "must be a safe identifier");
// DASH Representation@id values commonly contain `=` (for example,
// `video_por=7094000`). They remain opaque source identifiers: the compiler
// matches them against deterministic evidence and never treats them as command
// arguments or shell fragments.
const sourceRepresentationIdentifier = z.string().trim().min(1).max(120)
  .regex(/^[a-zA-Z0-9._:=-]+$/, "must be a safe source representation identifier");

export const CloneSpecSchema = z.object({
  version: z.literal("1"),
  source: z.object({
    investigationId: z.string().uuid(),
    mode: z.enum(["recorded_snapshot", "live_proxy"]).default("recorded_snapshot"),
    snapshotDurationSeconds: z.number().int().min(30).max(600).optional(),
  }),
  mode: z.enum(cloneModes),
  video: z.object({
    codec: z.enum(["h264", "hevc", "av1", "vp9"]).optional(),
    profile: safeIdentifier.optional(),
    level: safeIdentifier.optional(),
    pixelFormat: z.enum(["yuv420p", "yuv420p10le", "nv12", "p010le"]).optional(),
    width: z.number().int().min(160).max(7680).optional(),
    height: z.number().int().min(90).max(4320).optional(),
    frameRate: z.number().min(1).max(120).optional(),
    bitrate: z.number().int().min(64_000).max(100_000_000).optional(),
    maxBitrate: z.number().int().min(64_000).max(150_000_000).nullable().optional(),
    bufferSize: z.number().int().min(64_000).max(300_000_000).nullable().optional(),
    gopSeconds: z.number().min(0.25).max(10).optional(),
    closedGop: z.boolean().optional(),
    hdrMode: z.enum(["preserve", "sdr", "hdr10", "hlg"]).nullable().optional(),
  }).optional(),
  audio: z.object({
    codec: z.enum(["aac", "ac3", "eac3", "opus"]).optional(),
    channels: z.number().int().min(1).max(8).optional(),
    channelLayout: z.enum(["mono", "stereo", "5.1", "7.1"]).optional(),
    sampleRate: z.number().int().min(8_000).max(192_000).optional(),
    bitrate: z.number().int().min(16_000).max(1_536_000).optional(),
    language: safeIdentifier.nullable().optional(),
  }).optional(),
  packaging: z.object({
    protocol: z.enum(["hls", "dash"]),
    container: z.enum(["mpegts", "fmp4", "cmaf"]).optional(),
    segmentDurationSeconds: z.number().min(1).max(20).optional(),
  }).optional(),
  abr: z.object({
    mode: z.enum(["preserve", "single_representation", "subset", "custom"]),
    representationIds: z.array(sourceRepresentationIdentifier).max(8).optional(),
    targetBitrate: z.number().int().min(64_000).max(100_000_000).nullable().optional(),
  }).optional(),
  manifest: z.object({
    normalisation: z.enum(["preserve", "minimal", "custom"]),
    operations: z.array(z.object({
      op: z.enum(["filter_representations", "single_audio", "remove_subtitles", "sort_by_bandwidth"]),
      representationIds: z.array(sourceRepresentationIdentifier).max(8).optional(),
    })).max(12).optional(),
  }).optional(),
  reason: z.object({
    role: z.enum(["control", "treatment"]),
    shortLabel: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9-]+$/),
    hypothesisIds: z.array(z.string().uuid()).max(12),
    description: z.string().trim().min(1).max(1_000),
    expectedDiscriminatingSignal: z.string().trim().min(1).max(1_000),
  }),
}).strict().superRefine((spec, context) => {
  if (spec.reason.role === "control") {
    if (spec.reason.hypothesisIds.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason", "hypothesisIds"], message: "control cannot target a hypothesis" });
    if (spec.mode !== "manifest_only" || (spec.abr?.mode && spec.abr.mode !== "preserve")) context.addIssue({ code: z.ZodIssueCode.custom, message: "control must preserve media characteristics" });
  }
  if ((spec.abr?.mode === "single_representation" || spec.abr?.mode === "subset") && !(spec.abr.representationIds?.length || spec.abr.targetBitrate)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["abr"], message: "representation IDs or target bitrate are required" });
  }
  if (spec.mode === "manifest_only" && (spec.video || spec.audio?.codec || spec.audio?.channels || spec.audio?.sampleRate || spec.audio?.bitrate)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "manifest_only cannot request encoded media changes" });
  }
});

export const CloneRecipeRequestSchema = z.object({
  recipe: z.enum(cloneRecipeNames),
  investigationId: z.string().uuid(),
  shortLabel: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9-]+$/),
  hypothesisIds: z.array(z.string().uuid()).max(12).default([]),
  representationId: sourceRepresentationIdentifier.optional(),
  targetBitrate: z.number().int().min(64_000).max(100_000_000).optional(),
  width: z.number().int().min(160).max(7680).optional(),
  height: z.number().int().min(90).max(4320).optional(),
});

export const ValidateCloneSpecRequestSchema = z.object({ spec: CloneSpecSchema }).strict();
export const PreviewCloneSpecRequestSchema = z.union([
  z.object({ spec: CloneSpecSchema }).strict(),
  z.object({ recipe: CloneRecipeRequestSchema }).strict(),
]);

export const CloneExecutionPlanSchema = z.object({
  version: z.literal("1"),
  specVersion: z.literal("1"),
  protocol: z.enum(["hls", "dash"]),
  sourceMode: z.enum(["recorded_snapshot", "live_proxy"]),
  transformations: z.array(z.object({
    kind: z.enum(["record_snapshot", "filter_video_representations", "single_audio", "minimal_manifest"]),
    description: z.string(),
    representationIds: z.array(z.string()).optional(),
  })),
  selection: z.object({
    videoRepresentationIds: z.array(z.string()),
    audioMode: z.enum(["preserve", "single"]),
    expectedAudioRenditionCount: z.number().int().nonnegative(),
  }),
  processes: z.array(z.object({ binary: z.enum(["ffmpeg", "ffprobe", "shaka-packager"]), args: z.array(z.string()) })),
  whatChanged: z.string(),
  expectedDiscriminatingSignal: z.string(),
  sourceArtifactIds: z.array(z.string().uuid()),
});

export const CloneVerificationReportSchema = z.object({
  verifiedAt: z.string().datetime(),
  status: z.enum(["PASSED", "FAILED"]),
  manifest: z.object({
    protocol: z.enum(["hls", "dash"]).optional(),
    kind: z.enum(["master", "media", "mpd"]).optional(),
    videoRepresentationCount: z.number().int().nonnegative().optional(),
    audioRepresentationCount: z.number().int().nonnegative().optional(),
  }),
  requested: z.object({
    videoRepresentationIds: z.array(z.string()),
    audioMode: z.enum(["preserve", "single"]),
  }),
  outputArtifactIds: z.array(z.string().uuid()),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});

export const CreateExperimentRequestSchema = z.object({
  goal: z.string().trim().min(3).max(2_000),
  createdBy: z.string().trim().min(1).max(120).default("workspace-user"),
  targetEnvironmentId: z.string().uuid().optional(),
  hypotheses: z.array(z.object({
    statement: z.string().trim().min(3).max(1_000),
    rationale: z.string().trim().min(1).max(2_000),
    evidenceFor: z.array(z.string().trim().min(1).max(240)).max(30).default([]),
    evidenceAgainst: z.array(z.string().trim().min(1).max(240)).max(30).default([]),
  })).min(1).max(12),
});

export const CreateIterationRequestSchema = z.object({
  rationale: z.string().trim().min(3).max(2_000),
  cloneSpecs: z.array(CloneSpecSchema).min(1).max(4),
});

export const QueueClonesRequestSchema = z.object({ iterationId: z.string().uuid() });

export const CreateTestEnvironmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(120).optional(),
  platformVersion: z.string().trim().min(1).max(120).optional(),
  manufacturer: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(160).optional(),
  firmwareVersion: z.string().trim().min(1).max(160).optional(),
  applicationName: z.string().trim().min(1).max(120).optional(),
  applicationVersion: z.string().trim().min(1).max(120).optional(),
  playerEngine: z.string().trim().min(1).max(120).optional(),
  networkNotes: z.string().trim().min(1).max(1_000).optional(),
});

export const SubmitTestResultRequestSchema = z.object({
  outcome: z.enum(testOutcomes),
  failureStage: z.enum(failureStages).optional(),
  errorCode: z.string().trim().min(1).max(120).optional(),
  timeToFirstFrameMs: z.number().int().min(0).max(600_000).optional(),
  stallObserved: z.boolean().optional(),
  audioObserved: z.boolean().optional(),
  videoObserved: z.boolean().optional(),
  avSyncIssue: z.boolean().optional(),
  seekIssue: z.boolean().optional(),
  notes: z.string().trim().min(1).max(5_000).optional(),
  evidenceArtifactIds: z.array(z.string().uuid()).max(20).default([]),
  reportedBy: z.string().trim().min(1).max(120),
  reportedVia: z.enum(["USER", "AGENT", "DEVICE", "TRUSTED_TEST"]),
  testEnvironmentId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().default(() => new Date().toISOString()),
}).superRefine((result, context) => {
  if (result.outcome !== "FAIL" && result.failureStage) context.addIssue({ code: z.ZodIssueCode.custom, path: ["failureStage"], message: "failureStage is only valid for FAIL" });
});

export type ParsedCloneSpec = z.infer<typeof CloneSpecSchema>;
