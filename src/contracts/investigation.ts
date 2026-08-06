import { z } from "zod";
import { investigationStates } from "../investigation/domain/investigation.js";

export const StartInvestigationRequestSchema = z.object({
  url: z.string().trim().url().max(4_096).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "url must use http or https"),
  problemDescription: z.string().trim().min(1).max(2_000).optional(),
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

const EvidenceBundleV2Schema = z.object({
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
    source: z.object({ url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/), observedHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(3).optional(), httpStatus: z.number().int(), contentLength: z.number().int().nonnegative().optional() }).optional(),
    probe: z.object({
      format: z.string().optional(),
      duration: z.number().nonnegative().optional(),
      tracks: z.array(z.object({
        kind: z.enum(["video", "audio", "other"]), codec: z.string().optional(), duration: z.number().nonnegative().optional(),
        firstPts: z.number().optional(), lastPts: z.number().optional(), width: z.number().int().nonnegative().optional(),
        height: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), sampleRate: z.number().int().nonnegative().optional(),
        channels: z.number().int().nonnegative().optional(),
      })),
      fmp4: z.unknown().optional(),
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
    }).optional(),
  }).optional(),
  reportedContext: z.object({ approximateTimeSeconds: z.number().nonnegative().optional(), reportsVideoFreeze: z.boolean(), reportsAudioContinues: z.boolean(), reportsAbrSwitch: z.boolean(), reportsFourKToFullHd: z.boolean(), uncertainties: z.array(z.string()) }).optional(),
  dash: z.object({ type: z.enum(["static", "dynamic"]), representations: z.array(z.object({ id: z.string(), periodIndex: z.number().int().nonnegative(), adaptationSetIndex: z.number().int().nonnegative(), contentType: z.enum(["video", "audio", "unknown"]), codecs: z.string().optional(), bandwidth: z.number().nonnegative().optional(), width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), timescale: z.number().positive(), segmentAlignment: z.boolean().optional(), bitstreamSwitching: z.boolean().optional(), segmentCount: z.number().int().nonnegative() })), limitations: z.array(z.string()), analysis: z.unknown().optional() }).optional(),
  observations: z.array(EvidenceObservationSchema),
  limitations: z.array(z.string()),
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
const EvidenceBundleV3Schema = EvidenceBundleV2Schema.extend({
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
    findings: z.array(z.object({ title: z.string(), severity: z.enum(["info", "warning", "error"]), explanation: z.string(), evidenceIds: z.array(z.string()), confidence: z.number().min(0).max(1) })),
    recommendations: z.array(z.string()), limitations: z.array(z.string()),
    agents: z.array(z.object({ id: z.enum(["timeline-playback", "container-encoding", "manifest-delivery", "lead-investigator"]), state: z.enum(["completed", "failed", "unavailable"]), summary: z.string().optional(), limitation: z.string().optional() })),
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

export const InvestigationReportContentSchema = z.union([
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

export const InvestigationReportResponseSchema = z.object({
  report: InvestigationReportSchema,
});
