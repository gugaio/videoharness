import { z } from "zod";
import { investigationStates } from "../investigation/domain/investigation.js";
import { AbrAssessmentSchema, AbrSwitchEvidenceSchema } from "./abr.js";

export const StartInvestigationRequestSchema = z.object({
  url: z.string().trim().url().max(4_096).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "url must use http or https"),
  problemDescription: z.string().trim().min(1).max(20_000).optional(),
});

export const AskInvestigationQuestionRequestSchema = z.object({
  question: z.string().trim().min(1).max(4_000),
});

export const InvestigationSchema = z.object({
  id: z.string().uuid(),
  sourceUrl: z.string().url(),
  problemDescription: z.string().optional(),
  state: z.enum(investigationStates),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export const StartInvestigationResponseSchema = z.object({
  investigation: InvestigationSchema,
  replayed: z.boolean(),
});

export const InvestigationDetailResponseSchema = z.object({
  investigation: InvestigationSchema,
});

export const InvestigationEventSchema = z.object({
  id: z.string().regex(/^\d+$/),
  investigationId: z.string().uuid(),
  type: z.string().min(1),
  actor: z.string().min(1),
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

const EvidenceSourceSchema = z.object({
  requestedUrl: z.string().url(),
  finalUrl: z.string().url(),
  protocol: z.enum(["hls", "dash"]),
  httpStatus: z.number().int(),
  contentType: z.string().optional(),
});

const EvidenceObservationSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

const EvidenceBundleV1Schema = z.object({
  schemaVersion: z.literal(1),
  collectedAt: z.string().datetime(),
  source: EvidenceSourceSchema,
  manifest: z.object({
    artifactId: z.string().uuid(),
    kind: z.enum(["master", "media", "mpd"]),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    variantCount: z.number().int().nonnegative().optional(),
    segmentCount: z.number().int().nonnegative().optional(),
    representationCount: z.number().int().nonnegative().optional(),
  }),
  observations: z.array(EvidenceObservationSchema),
  limitations: z.array(z.string()),
});

const DashContentProtectionSchema = z.object({ schemeIdUri: z.string().optional(), value: z.string().optional(), defaultKid: z.string().optional(), pssh: z.array(z.string()) });
const SwitchingContractSchema = z.object({
  mode: z.enum(["GENERAL_REINITIALIZATION", "BITSTREAM_SWITCHING", "CMAF_SWITCHING_SET", "UNKNOWN"]),
  bitstreamSwitching: z.boolean().optional(), segmentAlignment: z.boolean().optional(), subsegmentAlignment: z.boolean().optional(),
  startWithSap: z.number().int().min(0).max(6).optional(), subsegmentStartsWithSap: z.number().int().min(0).max(6).optional(),
  effectiveTimescale: z.number().positive().optional(), presentationTimeOffset: z.string().optional(), codecFamily: z.string(), sampleEntryExpectation: z.string().optional(), representations: z.array(z.string()),
});

const ReportedContextSchema = z.union([
  z.object({ approximateTimeSeconds: z.number().nonnegative().optional(), reportsVideoFreeze: z.boolean(), reportsAudioContinues: z.boolean(), reportsAbrSwitch: z.boolean(), reportedAbrDirection: z.enum(["UPSHIFT", "DOWNSHIFT"]).optional(), reportedResolutionTransition: z.object({ sourceHeight: z.number().int().positive(), targetHeight: z.number().int().positive() }).optional(), reportedDevice: z.object({ manufacturer: z.string().optional(), modelCode: z.string().optional(), firmwareVersion: z.string().optional(), operatingSystem: z.string().optional(), operatingSystemVersion: z.string().optional(), applicationVersion: z.string().optional(), playerName: z.string().optional(), playerVersion: z.string().optional(), drmSystem: z.string().optional(), displayOrHdrMode: z.string().optional() }).optional(), mentionedPlayerEvents: z.array(z.string()).default([]), descriptionExcerpt: z.string().optional(), uncertainties: z.array(z.string()) }),
  // Historical Tizen-shaped context remains accepted at the report boundary.
  z.object({ approximateTimeSeconds: z.number().nonnegative().optional(), reportsVideoFreeze: z.boolean(), reportsAudioContinues: z.boolean(), reportsAbrSwitch: z.boolean(), reportsFourKToFullHd: z.boolean(), reportedDevice: z.object({ exactModelCode: z.string().optional(), firmwareVersion: z.string().optional(), tizenVersion: z.string().optional(), applicationVersion: z.string().optional(), avplayVersion: z.string().optional(), drmSystem: z.string().optional(), displayOrHdrMode: z.string().optional() }).optional(), mentionedAvplayEvents: z.array(z.string()).optional(), descriptionExcerpt: z.string().optional(), uncertainties: z.array(z.string()) }),
]);

const FfprobeFrameSummarySchema = z.object({
  keyFrame: z.boolean().optional(), pictureType: z.string().optional(), pts: z.string().optional(), ptsTime: z.number().optional(),
  packetDts: z.string().optional(), packetDtsTime: z.number().optional(), bestEffortTimestamp: z.string().optional(), duration: z.string().optional(),
  width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), pixelFormat: z.string().optional(),
  colorRange: z.string().optional(), colorSpace: z.string().optional(), colorTransfer: z.string().optional(), colorPrimaries: z.string().optional(),
  sideDataTypes: z.array(z.string()),
});

const FfprobeBoundarySchema = z.object({
  totalPacketCount: z.number().int().nonnegative(), totalFrameCount: z.number().int().nonnegative(), totalGopCount: z.number().int().nonnegative().default(0),
  packets: z.array(z.object({ pts: z.string().optional(), ptsTime: z.number().optional(), dts: z.string().optional(), dtsTime: z.number().optional(), duration: z.string().optional(), durationTime: z.number().optional(), size: z.number().optional(), pos: z.string().optional(), flags: z.string().optional() })),
  frames: z.array(FfprobeFrameSummarySchema),
  gops: z.array(z.object({
    index: z.number().int().nonnegative(), startFrameIndex: z.number().int().nonnegative(), frameCount: z.number().int().nonnegative(), startsWithKeyFrame: z.boolean(),
    firstPtsTime: z.number().optional(), lastPtsTime: z.number().optional(), frames: z.array(FfprobeFrameSummarySchema), truncated: z.boolean(),
  })).default([]),
});

const HttpRequestFactsSchema = z.object({
  latencyMs: z.number().nonnegative().optional(),
  firstByteMs: z.number().nonnegative().optional(),
  redirectCount: z.number().int().nonnegative(),
  redirectChain: z.array(z.string().url()).optional(),
  server: z.string().optional(),
  cacheControl: z.string().optional(),
  etag: z.string().optional(),
  via: z.string().optional(),
});

const TsSanitySchema = z.object({
  isTs: z.boolean(),
  packetCount: z.number().int().nonnegative(),
  syncErrors: z.number().int().nonnegative(),
  hasPat: z.boolean(),
  hasPmt: z.boolean(),
  hasPcr: z.boolean(),
  pcrDiscontinuities: z.number().int().nonnegative(),
  continuityDiscontinuities: z.number().int().nonnegative(),
  truncatedTail: z.boolean(),
});

const SegmentBoundaryGapSchema = z.object({
  fromLogicalKey: z.string().min(1),
  toLogicalKey: z.string().min(1),
  fromSequence: z.number().int().nonnegative().optional(),
  toSequence: z.number().int().nonnegative().optional(),
  presentationGapMs: z.number().nonnegative().optional(),
  presentationOverlapMs: z.number().nonnegative().optional(),
});

const TimelineContinuityWindowSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(["video", "audio", "other"]),
  segmentCount: z.number().int().nonnegative(),
  gaps: z.array(SegmentBoundaryGapSchema),
  totalGapMs: z.number().nonnegative(),
  maxGapMs: z.number().nonnegative(),
  continuous: z.boolean(),
});

export const EvidenceBundleV2Schema = z.object({
  schemaVersion: z.literal(2),
  collectedAt: z.string().datetime(),
  source: EvidenceSourceSchema,
  manifests: z.array(z.object({
    artifactId: z.string().uuid(),
    logicalKey: z.string().min(1),
    role: z.enum(["root", "variant", "rendition"]),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    kind: z.enum(["master", "media", "mpd"]),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    variantCount: z.number().int().nonnegative().optional(),
    segmentCount: z.number().int().nonnegative().optional(),
    representationCount: z.number().int().nonnegative().optional(),
    targetDuration: z.number().nonnegative().optional(),
    mediaSequence: z.number().nonnegative().optional(),
    discontinuitySequence: z.number().nonnegative().optional(),
    discontinuityCount: z.number().int().nonnegative().optional(),
    hasEndList: z.boolean().optional(),
    http: HttpRequestFactsSchema.optional(),
    content: z.string().optional(),
  })).min(1),
  mediaSamples: z.array(z.object({
    artifactId: z.string().uuid(),
    logicalKey: z.string().min(1),
    kind: z.enum(["init-segment", "media-segment"]),
    sizeBytes: z.number().int().nonnegative(),
    sourceManifestLogicalKey: z.string().min(1).optional(),
    sampleIndex: z.number().int().nonnegative().optional(),
    sequence: z.number().int().nonnegative().optional(),
    declaredDuration: z.number().nonnegative().optional(),
    representationId: z.string().optional(), periodIndex: z.number().int().nonnegative().optional(), adaptationSetIndex: z.number().int().nonnegative().optional(),
    presentationStartSeconds: z.number().optional(), presentationEndSeconds: z.number().optional(),
    source: z.object({ url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/), observedHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(3).optional(), httpStatus: z.number().int(), contentLength: z.number().int().nonnegative().optional(), http: HttpRequestFactsSchema.optional() }).optional(),
    probe: z.object({
      format: z.string().optional(),
      duration: z.number().nonnegative().optional(),
      tracks: z.array(z.object({
        kind: z.enum(["video", "audio", "other"]), codec: z.string().optional(), duration: z.number().nonnegative().optional(),
        firstPts: z.number().optional(), lastPts: z.number().optional(), width: z.number().int().nonnegative().optional(),
        height: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), sampleRate: z.number().int().nonnegative().optional(),
        channels: z.number().int().nonnegative().optional(), codecTagString: z.string().optional(), profile: z.string().optional(), level: z.number().int().optional(),
        codedWidth: z.number().int().nonnegative().optional(), codedHeight: z.number().int().nonnegative().optional(), pixelFormat: z.string().optional(), refs: z.number().int().nonnegative().optional(),
        timeBase: z.string().optional(), averageFrameRate: z.string().optional(), colorRange: z.string().optional(), colorSpace: z.string().optional(),
        colorTransfer: z.string().optional(), colorPrimaries: z.string().optional(), chromaLocation: z.string().optional(),
      })),
      boundary: FfprobeBoundarySchema.optional(),
      fmp4: z.unknown().optional(),
      structural: TsSanitySchema.optional(),
    }).optional(),
  })),
  hls: z.object({
    variants: z.array(z.object({
      index: z.number().int().nonnegative(),
      uri: z.string(),
      url: z.string().url().optional(),
      bandwidth: z.number().nonnegative().optional(),
      averageBandwidth: z.number().nonnegative().optional(),
      resolution: z.string().optional(),
      frameRate: z.number().nonnegative().optional(),
      codecs: z.string().optional(),
      audioGroupId: z.string().optional(),
      subtitlesGroupId: z.string().optional(),
      closedCaptions: z.string().optional(),
    })),
    renditions: z.array(z.object({
      index: z.number().int().nonnegative(),
      type: z.string(),
      groupId: z.string().optional(),
      name: z.string().optional(),
      language: z.string().optional(),
      default: z.boolean().optional(),
      autoselect: z.boolean().optional(),
      forced: z.boolean().optional(),
      channels: z.string().optional(),
      characteristics: z.string().optional(),
      uri: z.string().optional(),
      url: z.string().url().optional(),
    })),
    selection: z.object({
      rule: z.literal("highest-bandwidth"),
      variantIndex: z.number().int().nonnegative(),
      variantLogicalKey: z.string().optional(),
      audioRenditionIndex: z.number().int().nonnegative().optional(),
      audioRenditionLogicalKey: z.string().optional(),
      sampledVariants: z.array(z.object({ index: z.number().int().nonnegative(), logicalKey: z.string().min(1) })).optional(),
    }).optional(),
    topology: z.array(z.object({
      index: z.number().int(),
      logicalKey: z.string().min(1),
      segmentCount: z.number().int().nonnegative(),
      targetDuration: z.number().nonnegative().optional(),
      discontinuityCount: z.number().int().nonnegative().optional(),
      hasEndList: z.boolean().optional(),
    })).optional(),
  }).optional(),
  reportedContext: ReportedContextSchema.optional(),
  abr: AbrAssessmentSchema.optional(),
  dash: z.object({
    type: z.enum(["static", "dynamic"]),
    periods: z.array(z.object({ index: z.number().int().nonnegative(), id: z.string().optional(), startSeconds: z.number(), durationSeconds: z.number().nonnegative().optional() })).default([]),
    adaptationSets: z.array(z.object({
      periodIndex: z.number().int().nonnegative(), index: z.number().int().nonnegative(), id: z.string().optional(), contentType: z.enum(["video", "audio", "unknown"]), mimeType: z.string().optional(), codecs: z.string().optional(), width: z.number().int().nonnegative().optional(), maxWidth: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), maxHeight: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), maxFrameRate: z.string().optional(), sar: z.string().optional(), par: z.string().optional(), segmentAlignment: z.boolean().optional(), subsegmentAlignment: z.boolean().optional(), startWithSap: z.number().int().optional(), subsegmentStartsWithSap: z.number().int().optional(), bitstreamSwitching: z.boolean().optional(), initialization: z.string().optional(), timescale: z.number().positive(), duration: z.string().optional(), presentationTimeOffset: z.string(), segmentTimeline: z.array(z.object({ time: z.string().optional(), duration: z.string(), repeat: z.number().int() })), contentProtection: z.array(DashContentProtectionSchema), representationIds: z.array(z.string()), switchingContract: SwitchingContractSchema,
    })).default([]),
    representations: z.array(z.object({ id: z.string(), periodIndex: z.number().int().nonnegative(), adaptationSetIndex: z.number().int().nonnegative(), contentType: z.enum(["video", "audio", "unknown"]), codecs: z.string().optional(), bandwidth: z.number().nonnegative().optional(), width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), sar: z.string().optional(), baseUrl: z.string().url().optional(), timescale: z.number().positive(), presentationTimeOffset: z.string().optional(), initializationUrl: z.string().url().optional(), mediaTemplate: z.string().optional(), segmentAddressing: z.enum(["template", "list", "base", "unknown"]).optional(), segmentAlignment: z.boolean().optional(), subsegmentAlignment: z.boolean().optional(), startWithSap: z.number().int().optional(), subsegmentStartsWithSap: z.number().int().optional(), bitstreamSwitching: z.boolean().optional(), contentProtection: z.array(DashContentProtectionSchema).optional(), segmentCount: z.number().int().nonnegative() })),
    limitations: z.array(z.string()), analysis: z.unknown().optional(), switches: z.array(AbrSwitchEvidenceSchema).optional(), switchMatrix: z.array(z.object({ fromRepresentationId: z.string(), toRepresentationId: z.string(), switchKind: z.enum(["SAME_RESOLUTION_BITRATE", "RESOLUTION_CHANGING", "UNKNOWN"]), status: z.enum(["PASS", "FAIL", "RISK", "NOT_TESTED"]), findingRuleIds: z.array(z.string()) })).optional(), reconfigurationSensitivity: z.string().optional(),
  }).optional(),
  observations: z.array(EvidenceObservationSchema),
  limitations: z.array(z.string()),
  timeline: z.array(TimelineContinuityWindowSchema).optional(),
  playbackSwitches: z.array(AbrSwitchEvidenceSchema).optional(),
});

const PlaybackTelemetrySchema = z.object({
  engine: z.enum(["hls.js", "native-hls"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  requestedDurationMs: z.number().int().min(5_000).max(60_000),
  playedMs: z.number().int().min(0).max(120_000),
  startupTimeMs: z.number().int().min(0).max(60_000).optional(),
  stalls: z.number().int().min(0).max(100),
  stallDurationMs: z.number().int().min(0).max(120_000),
  fragmentsLoaded: z.number().int().min(0).max(1_000),
  qualitySwitches: z.number().int().min(0).max(200),
  droppedFrames: z.number().int().min(0).max(1_000_000).optional(),
  errors: z.array(z.object({
    type: z.string().trim().min(1).max(80), detail: z.string().trim().min(1).max(160), fatal: z.boolean(), atMs: z.number().int().min(0).max(120_000),
  })).max(30),
  limitations: z.array(z.string().trim().min(1).max(240)).max(12),
});

const PlaybackSessionEvidenceSchema = PlaybackTelemetrySchema.extend({ id: z.string().uuid() });
export const EvidenceBundleV3Schema = EvidenceBundleV2Schema.extend({
  schemaVersion: z.literal(3),
  playbackSessions: z.array(PlaybackSessionEvidenceSchema).min(1).max(5),
});

export const CreatePlaybackSessionRequestSchema = z.object({
  requestedDurationMs: z.number().int().min(5_000).max(60_000).default(30_000),
});
export const CompletePlaybackSessionRequestSchema = PlaybackTelemetrySchema;

export const PlaybackSessionSchema = z.object({
  id: z.string().uuid(), investigationId: z.string().uuid(), status: z.enum(["running", "completed", "failed", "expired"]),
  requestedDurationMs: z.number().int(), engine: z.enum(["hls.js", "native-hls"]).optional(), artifactId: z.string().uuid().optional(),
  createdAt: z.string().datetime(), finishedAt: z.string().datetime().optional(), errorCode: z.string().optional(), errorMessage: z.string().optional(),
});

const PhaseOneReportContentSchema = z.object({
  placeholder: z.literal(true),
  title: z.string().min(1),
  summary: z.string().min(1),
  problemReported: z.string().optional(),
  findings: z.array(z.object({
    title: z.string().min(1),
    status: z.literal("not_run"),
    explanation: z.string().min(1),
  })),
  confidence: z.object({
    level: z.literal("not_assessed"),
    explanation: z.string().min(1),
  }),
  generatedBy: z.literal("phase-1-lifecycle-fixture"),
});

const ManifestReportContentBaseSchema = z.object({
  placeholder: z.literal(false),
  title: z.string().min(1),
  summary: z.string().min(1),
  problemReported: z.string().optional(),
  findings: z.array(z.object({
    title: z.string().min(1),
    status: z.enum(["observed", "limitation"]),
    explanation: z.string().min(1),
  })),
  confidence: z.object({
    level: z.literal("limited"),
    explanation: z.string().min(1),
  }),
  ai: z.object({
    available: z.boolean(), summary: z.string().optional(), likelyCause: z.string().optional(), confidence: z.number().min(0).max(1).optional(),
    validationPlan: z.object({
      goal: z.string(), hypothesis: z.string(), rationale: z.string(), proofBoundary: z.string(),
      treatment: z.object({ recipe: z.enum(["single_video_representation", "representation_subset", "single_audio"]), shortLabel: z.string(), representationIds: z.array(z.string()) }),
    }).optional(),
    findings: z.array(z.object({ title: z.string(), severity: z.enum(["info", "warning", "error"]), explanation: z.string(), evidenceIds: z.array(z.string()), confidence: z.number().min(0).max(1) })),
    recommendations: z.array(z.string()), limitations: z.array(z.string()),
    agents: z.array(z.object({ id: z.enum(["timeline-playback", "container-encoding", "manifest-delivery", "abr-switch-investigator", "lead-investigator"]), state: z.enum(["completed", "failed", "unavailable"]), summary: z.string().optional(), limitation: z.string().optional(), prompts: z.object({ system: z.string(), user: z.string() }).optional() })),
    promptAudits: z.array(z.object({
      agentId: z.enum(["timeline-playback", "container-encoding", "manifest-delivery", "abr-switch-investigator", "lead-investigator"]),
      attempt: z.number().int().positive(),
      state: z.enum(["completed", "failed"]),
      provider: z.string().min(1), model: z.string().min(1),
      systemPrompt: z.string(), prompt: z.string(), toolNames: z.array(z.string()),
      toolCalls: z.array(z.object({ name: z.string(), input: z.string(), output: z.string() })),
      packetMetrics: z.object({ packetBytes: z.number().int().nonnegative(), evidenceIdCount: z.number().int().nonnegative(), sharedEvidenceIdCount: z.number().int().nonnegative(), sharedEvidenceRatio: z.number().min(0).max(1) }).optional(),
      output: z.unknown().optional(),
    })).optional(),
  }).optional(),
});

const ManifestReportContentV1Schema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV1Schema,
  generatedBy: z.literal("deterministic-manifest-v1"),
});

const ManifestReportContentV2Schema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV2Schema,
  generatedBy: z.literal("deterministic-manifest-v2"),
});

const MediaReportContentSchema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV2Schema,
  generatedBy: z.literal("deterministic-media-v1"),
});
const PlaybackReportContentSchema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV3Schema,
  generatedBy: z.literal("deterministic-playback-v1"),
});

export const InvestigationReportContentSchema: z.ZodType<unknown, z.ZodTypeDef, unknown> = z.union([
  PhaseOneReportContentSchema,
  ManifestReportContentV1Schema,
  ManifestReportContentV2Schema,
  MediaReportContentSchema,
  PlaybackReportContentSchema,
]);

export const InvestigationReportSchema = z.object({
  id: z.string().uuid(),
  investigationId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  content: InvestigationReportContentSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const InvestigationReportResponseSchema: z.ZodType<{ report: unknown }> = z.object({
  report: InvestigationReportSchema,
});
