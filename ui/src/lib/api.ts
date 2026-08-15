import { z } from "zod";

// crypto.randomUUID only exists in secure contexts (HTTPS or localhost), so it
// falls back to a v4 UUID built from crypto.getRandomValues when unavailable.
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

const HealthSchema = z.object({
  ok: z.boolean(),
  service: z.literal("video-harness-api"),
  version: z.string(),
  now: z.string(),
  database: z.object({ status: z.enum(["up", "down"]) }),
});

const InvestigationSchema = z.object({
  id: z.string().uuid(),
  sourceUrl: z.string().url(),
  problemDescription: z.string().optional(),
  state: z.enum(["queued", "validating", "collecting", "evidence_ready", "analysis_queued", "analyzing", "synthesizing", "completed", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});

export const InvestigationEventSchema = z.object({
  id: z.string().regex(/^\d+$/),
  investigationId: z.string().uuid(),
  type: z.string(),
  actor: z.string(),
  message: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const PhaseOneReportContentSchema = z.object({
    placeholder: z.literal(true),
    title: z.string(),
    summary: z.string(),
    problemReported: z.string().optional(),
    findings: z.array(z.object({
      title: z.string(),
      status: z.literal("not_run"),
      explanation: z.string(),
    })),
    confidence: z.object({
      level: z.literal("not_assessed"),
      explanation: z.string(),
    }),
    generatedBy: z.literal("phase-1-lifecycle-fixture"),
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
  collectedAt: z.string(),
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

const EvidenceRefSchema = z.object({ evidenceId: z.string().min(1) });
const AbrSeveritySchema = z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const AbrRepresentationSchema = EvidenceRefSchema.extend({
  id: z.string(), groupId: z.string(), bandwidth: z.number().nonnegative().optional(), averageBandwidth: z.number().nonnegative().optional(),
  width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), frameRate: z.number().nonnegative().optional(),
  codecs: z.string().optional(), audioGroupId: z.string().optional(), segmentCount: z.number().int().nonnegative().optional(),
});
const AbrRepresentationSummarySchema = EvidenceRefSchema.extend({
  id: z.string(), periodIndex: z.number().int().nonnegative(), adaptationSetIndex: z.number().int().nonnegative(), bandwidth: z.number().nonnegative().optional(),
  codecs: z.string().optional(), sampleEntry: z.string().optional(), width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(),
  frameRate: z.string().optional(), timescale: z.number().positive().optional(), presentationTimeOffset: z.string().optional(),
});
const AbrDeterministicFindingSchema = EvidenceRefSchema.extend({
  ruleId: z.string(), category: z.string(), severity: AbrSeveritySchema, confidence: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]),
  title: z.string(), explanation: z.string(), evidenceIds: z.array(z.string()),
});
const AbrSwitchBaseSchema = EvidenceRefSchema.extend({
  switchId: z.string(), timestamps: z.object({ candidateBoundaryPresentationTimeMs: z.number().optional() }).passthrough(),
  sourceRepresentation: AbrRepresentationSummarySchema, targetRepresentation: AbrRepresentationSummarySchema,
  direction: z.enum(["UPSHIFT", "DOWNSHIFT", "LATERAL"]), switchKind: z.enum(["SAME_RESOLUTION_BITRATE", "RESOLUTION_CHANGING", "UNKNOWN"]),
  switchingContract: EvidenceRefSchema.passthrough(), reportedPlayerContext: EvidenceRefSchema.passthrough().optional(),
  playerEvidence: EvidenceRefSchema.passthrough().optional(), avplayEvidence: EvidenceRefSchema.passthrough().optional(),
  networkEvidence: EvidenceRefSchema.extend({ requests: z.array(EvidenceRefSchema.passthrough()) }).passthrough(),
  sourceInit: EvidenceRefSchema.passthrough().optional(), targetInit: EvidenceRefSchema.passthrough().optional(), initSemanticDiff: EvidenceRefSchema.passthrough().optional(),
  sourceBoundary: EvidenceRefSchema.passthrough().optional(), targetBoundary: EvidenceRefSchema.passthrough().optional(), sapEvidence: EvidenceRefSchema.passthrough().optional(),
  timelineEvidence: EvidenceRefSchema.passthrough().optional(), codecDiff: EvidenceRefSchema.passthrough().optional(), drmDiff: EvidenceRefSchema.passthrough().optional(),
  deviceCapabilityEvidence: EvidenceRefSchema.passthrough().optional(), decodeTests: z.array(EvidenceRefSchema.passthrough()), conformance: EvidenceRefSchema.passthrough().optional(),
  deterministicFindings: z.array(AbrDeterministicFindingSchema), missingEvidence: z.array(z.string()),
});
const AbrSwitchEvidenceSchema = z.discriminatedUnion("evidenceBasis", [
  AbrSwitchBaseSchema.extend({ evidenceBasis: z.literal("URL_STATIC_ANALYSIS"), transitionStatus: z.literal("CANDIDATE") }),
  AbrSwitchBaseSchema.extend({ evidenceBasis: z.literal("PLAYBACK_NETWORK_OBSERVED"), transitionStatus: z.literal("OBSERVED") }),
]);
const AbrSwitchMatrixSchema = z.object({
  fromRepresentationId: z.string(), toRepresentationId: z.string(), switchKind: z.enum(["SAME_RESOLUTION_BITRATE", "RESOLUTION_CHANGING", "UNKNOWN"]),
  status: z.enum(["PASS", "FAIL", "RISK", "NOT_TESTED"]), findingRuleIds: z.array(z.string()),
});
const AbrTransitionAssessmentSchema = EvidenceRefSchema.extend({
  transitionId: z.string(), protocol: z.enum(["hls", "dash"]), evidenceBasis: z.enum(["URL_STATIC_ANALYSIS", "PLAYBACK_NETWORK_OBSERVED"]),
  transitionStatus: z.enum(["CANDIDATE", "OBSERVED"]), sourceRepresentation: AbrRepresentationSchema, targetRepresentation: AbrRepresentationSchema,
  direction: z.enum(["UPSHIFT", "DOWNSHIFT", "LATERAL"]), switchKind: z.enum(["SAME_RESOLUTION_BITRATE", "RESOLUTION_CHANGING", "UNKNOWN"]),
  outcome: z.enum(["PASS", "FAIL", "RISK", "NOT_TESTED"]), findingRuleIds: z.array(z.string()),
});
const AbrAssessmentSchema = EvidenceRefSchema.extend({
  schemaVersion: z.literal(1), protocol: z.enum(["hls", "dash"]), verdict: z.enum(["NO_ISSUE_DETECTED", "ISSUES_FOUND", "INCONCLUSIVE", "NOT_APPLICABLE"]),
  reportedPriority: z.object({ abrProblemReported: z.boolean(), direction: z.enum(["UPSHIFT", "DOWNSHIFT", "LATERAL"]).optional(), sourceHeight: z.number().int().positive().optional(), targetHeight: z.number().int().positive().optional(), approximateTimeSeconds: z.number().nonnegative().optional() }),
  coverage: z.object({ level: z.enum(["MANIFEST_ONLY", "SAMPLED_MEDIA", "OBSERVED_PLAYBACK"]), manifestObserved: z.literal(true), mediaSampleCount: z.number().int().nonnegative(), representationCount: z.number().int().nonnegative(), transitionPairsAnalyzed: z.number().int().nonnegative(), playbackObserved: z.boolean(), limitations: z.array(z.string()) }),
  ladder: z.object({ representations: z.array(AbrRepresentationSchema), videoRepresentationCount: z.number().int().nonnegative(), audioRenditionCount: z.number().int().nonnegative() }),
  findings: z.array(EvidenceRefSchema.extend({ ruleId: z.string(), category: z.enum(["LADDER_TOPOLOGY", "LADDER_CONSISTENCY", "TRANSITION_SAFETY", "DELIVERY_BEHAVIOR", "COVERAGE"]), severity: AbrSeveritySchema, title: z.string(), explanation: z.string(), evidenceIds: z.array(z.string()) })),
  transitions: z.array(AbrTransitionAssessmentSchema), transitionMatrix: z.array(AbrSwitchMatrixSchema), recommendedMeasurements: z.array(z.string()),
  capability: z.object({
    codecFamily: z.enum(["H264", "HEVC", "AV1", "VP9", "OTHER", "UNKNOWN"]),
    profiles: z.array(z.string()),
    maxRequiredLevelNumeric: z.number().nonnegative().optional(),
    maxRequiredLevel: z.string().optional(),
    maxResolution: z.object({ width: z.number().int().nonnegative(), height: z.number().int().nonnegative() }).optional(),
    representations: z.array(z.object({ id: z.string(), codec: z.string().optional(), requiredProfile: z.string().optional(), requiredLevel: z.string().optional(), requiredLevelNumeric: z.number().nonnegative().optional(), width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional() })),
  }).optional(),
});
const ReportedContextSchema = z.union([
  z.object({ approximateTimeSeconds: z.number().nonnegative().optional(), reportsVideoFreeze: z.boolean(), reportsAudioContinues: z.boolean(), reportsAbrSwitch: z.boolean(), reportedAbrDirection: z.enum(["UPSHIFT", "DOWNSHIFT"]).optional(), reportedResolutionTransition: z.object({ sourceHeight: z.number().int().positive(), targetHeight: z.number().int().positive() }).optional(), reportedDevice: z.object({ manufacturer: z.string().optional(), modelCode: z.string().optional(), firmwareVersion: z.string().optional(), operatingSystem: z.string().optional(), operatingSystemVersion: z.string().optional(), applicationVersion: z.string().optional(), playerName: z.string().optional(), playerVersion: z.string().optional(), drmSystem: z.string().optional(), displayOrHdrMode: z.string().optional() }).optional(), mentionedPlayerEvents: z.array(z.string()), descriptionExcerpt: z.string().optional(), uncertainties: z.array(z.string()) }),
  z.object({ approximateTimeSeconds: z.number().nonnegative().optional(), reportsVideoFreeze: z.boolean(), reportsAudioContinues: z.boolean(), reportsAbrSwitch: z.boolean(), reportsFourKToFullHd: z.boolean(), reportedDevice: z.object({ exactModelCode: z.string().optional(), firmwareVersion: z.string().optional(), tizenVersion: z.string().optional(), applicationVersion: z.string().optional(), avplayVersion: z.string().optional(), drmSystem: z.string().optional(), displayOrHdrMode: z.string().optional() }).optional(), mentionedAvplayEvents: z.array(z.string()).optional(), descriptionExcerpt: z.string().optional(), uncertainties: z.array(z.string()) }),
]);

const FfprobeFrameSummarySchema = z.object({
  keyFrame: z.boolean().optional(), pictureType: z.string().optional(), pts: z.string().optional(), ptsTime: z.number().optional(),
  packetDts: z.string().optional(), packetDtsTime: z.number().optional(), bestEffortTimestamp: z.string().optional(), duration: z.string().optional(),
  width: z.number().optional(), height: z.number().optional(), pixelFormat: z.string().optional(), colorRange: z.string().optional(),
  colorSpace: z.string().optional(), colorTransfer: z.string().optional(), colorPrimaries: z.string().optional(), sideDataTypes: z.array(z.string()),
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

export const EvidenceBundleV2Schema = z.object({
  schemaVersion: z.literal(2),
  collectedAt: z.string(),
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
      format: z.string().optional(), duration: z.number().nonnegative().optional(),
      tracks: z.array(z.object({
        kind: z.enum(["video", "audio", "other"]), codec: z.string().optional(), duration: z.number().nonnegative().optional(),
        firstPts: z.number().optional(), lastPts: z.number().optional(), width: z.number().int().nonnegative().optional(),
        height: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), sampleRate: z.number().int().nonnegative().optional(), channels: z.number().int().nonnegative().optional(),
        codecTagString: z.string().optional(), profile: z.string().optional(), level: z.number().int().optional(), codedWidth: z.number().int().nonnegative().optional(),
        codedHeight: z.number().int().nonnegative().optional(), pixelFormat: z.string().optional(), refs: z.number().int().nonnegative().optional(), timeBase: z.string().optional(),
        averageFrameRate: z.string().optional(), colorRange: z.string().optional(), colorSpace: z.string().optional(), colorTransfer: z.string().optional(),
        colorPrimaries: z.string().optional(), chromaLocation: z.string().optional(),
      })),
      boundary: z.object({
        totalPacketCount: z.number().int().nonnegative(), totalFrameCount: z.number().int().nonnegative(), totalGopCount: z.number().int().nonnegative().optional(),
        packets: z.array(z.object({ pts: z.string().optional(), ptsTime: z.number().optional(), dts: z.string().optional(), dtsTime: z.number().optional(), duration: z.string().optional(), durationTime: z.number().optional(), size: z.number().optional(), pos: z.string().optional(), flags: z.string().optional() })),
        frames: z.array(FfprobeFrameSummarySchema),
        gops: z.array(z.object({
          index: z.number().int().nonnegative(), startFrameIndex: z.number().int().nonnegative(), frameCount: z.number().int().nonnegative(), startsWithKeyFrame: z.boolean(),
          firstPtsTime: z.number().optional(), lastPtsTime: z.number().optional(), truncated: z.boolean(),
          frames: z.array(FfprobeFrameSummarySchema),
        })).optional(),
      }).optional(),
      fmp4: z.object({
        init: z.unknown().optional(),
        fragment: z.object({
          baseMediaDecodeTime: z.string().optional(),
          samples: z.array(z.object({ dts: z.string(), pts: z.string(), duration: z.string().optional(), size: z.number().optional(), flags: z.number().optional(), sync: z.boolean().optional(), compositionOffset: z.string().optional(), nalTypes: z.array(z.number()), accessUnit: z.unknown(), firstFrameKind: z.enum(["idr", "cra", "bla", "rasl", "radl", "other", "unknown"]) })),
        }),
      }).optional(),
      structural: z.object({
        isTs: z.boolean(),
        packetCount: z.number().int().nonnegative(),
        syncErrors: z.number().int().nonnegative(),
        hasPat: z.boolean(),
        hasPmt: z.boolean(),
        hasPcr: z.boolean(),
        pcrDiscontinuities: z.number().int().nonnegative(),
        continuityDiscontinuities: z.number().int().nonnegative(),
        truncatedTail: z.boolean(),
      }).optional(),
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
  dash: z.object({ type: z.enum(["static", "dynamic"]), periods: z.array(z.unknown()).optional(), adaptationSets: z.array(z.unknown()).optional(), representations: z.array(z.object({ id: z.string(), periodIndex: z.number().int().nonnegative(), adaptationSetIndex: z.number().int().nonnegative(), contentType: z.enum(["video", "audio", "unknown"]), codecs: z.string().optional(), bandwidth: z.number().nonnegative().optional(), width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), sar: z.string().optional(), baseUrl: z.string().url().optional(), timescale: z.number().positive(), presentationTimeOffset: z.string().optional(), initializationUrl: z.string().url().optional(), mediaTemplate: z.string().optional(), segmentAddressing: z.enum(["template", "list", "base", "unknown"]).optional(), segmentAlignment: z.boolean().optional(), subsegmentAlignment: z.boolean().optional(), startWithSap: z.number().int().optional(), subsegmentStartsWithSap: z.number().int().optional(), bitstreamSwitching: z.boolean().optional(), contentProtection: z.array(z.unknown()).optional(), segmentCount: z.number().int().nonnegative() })), limitations: z.array(z.string()), analysis: z.unknown().optional(), switches: z.array(AbrSwitchEvidenceSchema).optional(), switchMatrix: z.array(AbrSwitchMatrixSchema).optional(), reconfigurationSensitivity: z.string().optional() }).optional(),
  observations: z.array(EvidenceObservationSchema),
  limitations: z.array(z.string()),
  timeline: z.array(z.object({
    key: z.string().min(1),
    kind: z.enum(["video", "audio", "other"]),
    segmentCount: z.number().int().nonnegative(),
    gaps: z.array(z.object({
      fromLogicalKey: z.string().min(1), toLogicalKey: z.string().min(1),
      fromSequence: z.number().int().nonnegative().optional(), toSequence: z.number().int().nonnegative().optional(),
      presentationGapMs: z.number().nonnegative().optional(), presentationOverlapMs: z.number().nonnegative().optional(),
    })),
    totalGapMs: z.number().nonnegative(),
    maxGapMs: z.number().nonnegative(),
    continuous: z.boolean(),
  })).optional(),
  playbackSwitches: z.array(AbrSwitchEvidenceSchema).optional(),
});

const ManifestReportContentBaseSchema = z.object({
  placeholder: z.literal(false),
  title: z.string(),
  summary: z.string(),
  problemReported: z.string().optional(),
  findings: z.array(z.object({
    title: z.string(),
    status: z.enum(["observed", "limitation"]),
    explanation: z.string(),
  })),
  confidence: z.object({
    level: z.literal("limited"),
    explanation: z.string(),
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
    promptAudits: z.array(z.object({ agentId: z.enum(["timeline-playback", "container-encoding", "manifest-delivery", "abr-switch-investigator", "lead-investigator"]), attempt: z.number().int().positive(), state: z.enum(["completed", "failed"]), provider: z.string(), model: z.string(), systemPrompt: z.string(), prompt: z.string(), toolNames: z.array(z.string()), toolCalls: z.array(z.object({ name: z.string(), input: z.string(), output: z.string() })), output: z.unknown().optional() })).optional(),
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

const PlaybackSessionSchema = z.object({
  id: z.string().uuid(), investigationId: z.string().uuid(), status: z.enum(["running", "completed", "failed", "expired"]),
  requestedDurationMs: z.number().int(), engine: z.enum(["hls.js", "native-hls"]).optional(), artifactId: z.string().uuid().optional(),
  createdAt: z.string(), finishedAt: z.string().optional(), errorCode: z.string().optional(), errorMessage: z.string().optional(),
});

const PlaybackReportContentSchema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV2Schema.extend({ schemaVersion: z.literal(3), playbackSessions: z.array(z.object({
    id: z.string().uuid(), engine: z.enum(["hls.js", "native-hls"]), startedAt: z.string(), finishedAt: z.string(), requestedDurationMs: z.number().int(), playedMs: z.number().int(), startupTimeMs: z.number().int().optional(), stalls: z.number().int(), stallDurationMs: z.number().int(), fragmentsLoaded: z.number().int(), qualitySwitches: z.number().int(), droppedFrames: z.number().int().optional(), errors: z.array(z.object({ type: z.string(), detail: z.string(), fatal: z.boolean(), atMs: z.number().int() })), limitations: z.array(z.string()),
  })).min(1) }),
  generatedBy: z.literal("deterministic-playback-v1"),
});

const InvestigationEvidenceSchema = z.union([
  EvidenceBundleV2Schema,
  EvidenceBundleV2Schema.extend({ schemaVersion: z.literal(3), playbackSessions: z.array(z.unknown()) }),
]);

const InvestigationReportSchema = z.object({
  id: z.string().uuid(),
  investigationId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  content: z.union([PhaseOneReportContentSchema, ManifestReportContentV1Schema, ManifestReportContentV2Schema, MediaReportContentSchema, PlaybackReportContentSchema]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Health = z.infer<typeof HealthSchema>;
export type Investigation = z.infer<typeof InvestigationSchema>;
export type InvestigationEvent = z.infer<typeof InvestigationEventSchema>;
export type AbrAssessment = z.infer<typeof AbrAssessmentSchema>;

const RecordingSchema = z.object({
  id: z.string().uuid(), sourceUrl: z.string().url(), protocol: z.enum(["hls", "dash"]),
  state: z.enum(["queued", "validating", "collecting", "ready", "failed"]),
  requestedDurationSeconds: z.number().int(), requestedStartSeconds: z.number().int(),
  coverageSeconds: z.number().optional(), totalBytes: z.number().optional(), errorCode: z.string().optional(), errorMessage: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().optional(),
});
export const RecordingEventSchema = z.object({ id: z.string().regex(/^\d+$/), recordingId: z.string().uuid(), type: z.string(), actor: z.string(), message: z.string(), payload: z.record(z.string(), z.unknown()), createdAt: z.string() });
const NetworkProfileSchema = z.object({ schemaVersion: z.literal(1), name: z.string(), stages: z.array(z.object({ afterVideoRequests: z.number(), bandwidthKbps: z.number(), latencyMs: z.number() })) });
export const ABR_PRESET_PROFILE: z.infer<typeof NetworkProfileSchema> = {
  schemaVersion: 1,
  name: "Good → constrained → recovery",
  stages: [
    { afterVideoRequests: 0, bandwidthKbps: 12000, latencyMs: 30 },
    { afterVideoRequests: 3, bandwidthKbps: 1200, latencyMs: 200 },
    { afterVideoRequests: 8, bandwidthKbps: 12000, latencyMs: 30 },
  ],
};
export const NORMAL_PLAYBACK_PROFILE: z.infer<typeof NetworkProfileSchema> = {
  schemaVersion: 1,
  name: "Normal playback",
  stages: [{ afterVideoRequests: 0, bandwidthKbps: 100000, latencyMs: 0 }],
};
export const CONTROL_1080P_PROFILE: z.infer<typeof NetworkProfileSchema> = {
  schemaVersion: 1,
  name: "1080p control (no ABR)",
  stages: [{ afterVideoRequests: 0, bandwidthKbps: 100000, latencyMs: 0 }],
};
const PlaybackRunSchema = z.object({ id: z.string().uuid(), recordingId: z.string().uuid(), state: z.enum(["created", "active", "completed", "expired", "failed"]), maxDurationSeconds: z.number(), profile: NetworkProfileSchema, createdAt: z.string(), expiresAt: z.string() });
export type NetworkProfile = z.infer<typeof NetworkProfileSchema>;
export type NetworkProfileStage = NetworkProfile["stages"][number];
export type PlaybackRun = z.infer<typeof PlaybackRunSchema>;
export type Recording = z.infer<typeof RecordingSchema>;
export type RecordingEvent = z.infer<typeof RecordingEventSchema>;
const DeliveryRequestSchema = z.object({ id: z.string(), logicalPath: z.string(), resourceKind: z.string(), targetId: z.string().optional(), mediaSequence: z.number().optional(), variantBandwidth: z.number().optional(), variantResolution: z.string().optional(), stageIndex: z.number(), bandwidthKbps: z.number(), latencyMs: z.number(), bytesSent: z.number(), statusCode: z.number(), startedAt: z.string(), completedAt: z.string() });
export type DeliveryRequest = z.infer<typeof DeliveryRequestSchema>;
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;
export type InvestigationEvidence = z.infer<typeof InvestigationEvidenceSchema>;

export async function getHealth(): Promise<Health> {
  const response = await fetch("/v1/health");
  const payload: unknown = await response.json();
  return HealthSchema.parse(payload);
}

async function parseResponse<T>(response: Response, schema: z.ZodSchema<T>): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
    throw new Error(error.success ? error.data.error.message : `Request failed with status ${response.status}`);
  }
  return schema.parse(payload);
}

export async function startInvestigation(input: {
  url: string;
  problemDescription?: string;
}): Promise<{ investigation: Investigation; replayed: boolean }> {
  const response = await fetch("/v1/investigations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": newIdempotencyKey(),
    },
    body: JSON.stringify(input),
  });
  return parseResponse(response, z.object({ investigation: InvestigationSchema, replayed: z.boolean() }));
}

export async function startRecording(input: { url: string; protocol: "hls" | "dash"; durationSeconds: number; startSeconds: number }): Promise<{ recording: Recording; replayed: boolean }> {
  const response = await fetch("/v1/recordings", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey() }, body: JSON.stringify(input) });
  return parseResponse(response, z.object({ recording: RecordingSchema, replayed: z.boolean() }));
}
export async function getRecording(id: string): Promise<Recording> {
  const response = await fetch(`/v1/recordings/${encodeURIComponent(id)}`);
  return (await parseResponse(response, z.object({ recording: RecordingSchema }))).recording;
}
export async function createRecordingPlaybackRun(id: string, profile: NetworkProfile = ABR_PRESET_PROFILE): Promise<{ run: PlaybackRun; playbackUrl: string }> {
  const response = await fetch(`/v1/recordings/${encodeURIComponent(id)}/playback-runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile }) });
  return parseResponse(response, z.object({ run: PlaybackRunSchema, playbackUrl: z.string() }));
}
export async function getLatestRecordingPlaybackRun(id: string): Promise<{ run: PlaybackRun; playbackUrl: string } | null> {
  const response = await fetch(`/v1/recordings/${encodeURIComponent(id)}/playback-runs/latest`);
  return (await parseResponse(response, z.object({ playback: z.object({ run: PlaybackRunSchema, playbackUrl: z.string() }).nullable() }))).playback;
}
export async function finishRecordingPlaybackRun(recordingId: string, runId: string): Promise<PlaybackRun> {
  const response = await fetch(`/v1/recordings/${encodeURIComponent(recordingId)}/playback-runs/${encodeURIComponent(runId)}/finish`, { method: "POST" });
  return (await parseResponse(response, z.object({ run: PlaybackRunSchema }))).run;
}
export async function getRecordingRequests(recordingId: string, runId: string): Promise<DeliveryRequest[]> {
  const response = await fetch(`/v1/recordings/${encodeURIComponent(recordingId)}/playback-runs/${encodeURIComponent(runId)}/requests?limit=10`);
  return (await parseResponse(response, z.object({ requests: z.array(DeliveryRequestSchema) }))).requests;
}

export async function getInvestigation(id: string): Promise<Investigation> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}`);
  const result = await parseResponse(response, z.object({ investigation: InvestigationSchema }));
  return result.investigation;
}

export async function listInvestigations(): Promise<Investigation[]> {
  const response = await fetch("/v1/investigations");
  const result = await parseResponse(response, z.object({ investigations: z.array(InvestigationSchema) }));
  return result.investigations;
}

export async function deleteInvestigation(id: string): Promise<void> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}`, { method: "DELETE" });
  await parseResponse(response, z.object({ deleted: z.literal(true) }));
}

export async function getInvestigationReport(id: string): Promise<InvestigationReport> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/report`);
  const result = await parseResponse(response, z.object({ report: InvestigationReportSchema }));
  return result.report;
}

export async function getInvestigationEvidence(id: string): Promise<InvestigationEvidence> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/evidence`);
  return (await parseResponse(response, z.object({ evidence: InvestigationEvidenceSchema }))).evidence;
}

export async function startInvestigationAnalysis(id: string): Promise<{ started: boolean }> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/analysis`, { method: "POST" });
  return parseResponse(response, z.object({ accepted: z.literal(true), started: z.boolean() }));
}

export type AiPromptAudit = NonNullable<NonNullable<Extract<InvestigationReport["content"], { placeholder: false }>["ai"]>["promptAudits"]>[number];

export async function getInvestigationAiRuns(id: string): Promise<AiPromptAudit[]> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/ai-runs`);
  return (await parseResponse(response, z.object({ runs: z.array(z.object({ agentId: z.enum(["timeline-playback", "container-encoding", "manifest-delivery", "abr-switch-investigator", "lead-investigator"]), attempt: z.number().int().positive(), state: z.enum(["completed", "failed"]), provider: z.string(), model: z.string(), systemPrompt: z.string(), prompt: z.string(), toolNames: z.array(z.string()), toolCalls: z.array(z.object({ name: z.string(), input: z.string(), output: z.string() })), output: z.unknown().optional() })) }))).runs;
}

export async function askInvestigationQuestion(id: string, question: string): Promise<void> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  await parseResponse(response, z.object({ ok: z.literal(true) }));
}

export type PlaybackTelemetry = {
  engine: "hls.js" | "native-hls"; startedAt: string; finishedAt: string; requestedDurationMs: number; playedMs: number; startupTimeMs?: number; stalls: number; stallDurationMs: number; fragmentsLoaded: number; qualitySwitches: number; droppedFrames?: number; errors: Array<{ type: string; detail: string; fatal: boolean; atMs: number }>; limitations: string[];
};
export async function startPlaybackSession(id: string, requestedDurationMs = 30_000): Promise<{ session: z.infer<typeof PlaybackSessionSchema>; sourceUrl: string }> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/playback-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedDurationMs }) });
  return parseResponse(response, z.object({ session: PlaybackSessionSchema, sourceUrl: z.string().url() }));
}
export async function completePlaybackSession(id: string, sessionId: string, telemetry: PlaybackTelemetry): Promise<void> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/playback-sessions/${encodeURIComponent(sessionId)}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(telemetry) });
  await parseResponse(response, z.object({ session: PlaybackSessionSchema }));
}
export async function failPlaybackSession(id: string, sessionId: string, code: string, message: string): Promise<void> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/playback-sessions/${encodeURIComponent(sessionId)}/fail`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, message }) });
  await parseResponse(response, z.object({ session: PlaybackSessionSchema }));
}

const ExperimentStatusSchema = z.enum(["DRAFT", "PLANNED", "BUILDING_CLONES", "AWAITING_TESTS", "EVALUATING", "FOLLOWUP_REQUIRED", "CONCLUDED", "FAILED", "CANCELLED"]);
const HypothesisSchema = z.object({
  id: z.string().uuid(), experimentId: z.string().uuid(), statement: z.string(), rationale: z.string(),
  evidenceFor: z.array(z.string()), evidenceAgainst: z.array(z.string()), status: z.enum(["OPEN", "PARTIALLY_SUPPORTED", "SUPPORTED", "WEAKENED", "REJECTED", "UNRESOLVED"]),
  createdAt: z.string(), updatedAt: z.string(),
});
const ClonePlanSchema = z.object({
  version: z.literal("1"), protocol: z.enum(["hls", "dash"]), sourceMode: z.enum(["recorded_snapshot", "live_proxy"]),
  transformations: z.array(z.object({ kind: z.string(), description: z.string(), representationIds: z.array(z.string()).optional() })),
  selection: z.object({ videoRepresentationIds: z.array(z.string()), audioMode: z.enum(["preserve", "single"]), expectedAudioRenditionCount: z.number().int().nonnegative() }),
  processes: z.array(z.object({ binary: z.string(), args: z.array(z.string()) })), whatChanged: z.string(), expectedDiscriminatingSignal: z.string(),
}).passthrough();
const TestResultSchema = z.object({
  id: z.string().uuid(), testRequestId: z.string().uuid(), outcome: z.enum(["PASS", "FAIL", "INCONCLUSIVE", "NOT_TESTED"]),
  failureStage: z.enum(["LOAD_MANIFEST", "STARTUP", "VIDEO_DECODE", "AUDIO_DECODE", "DRM", "STALL", "ABR_SWITCH", "SEEK", "AV_SYNC", "SUBTITLES", "UNKNOWN"]).optional(),
  errorCode: z.string().optional(), timeToFirstFrameMs: z.number().optional(), stallObserved: z.boolean().optional(), audioObserved: z.boolean().optional(), videoObserved: z.boolean().optional(),
  avSyncIssue: z.boolean().optional(), seekIssue: z.boolean().optional(), notes: z.string().optional(), evidenceArtifactIds: z.array(z.string().uuid()), reportedBy: z.string(),
  reportedVia: z.enum(["USER", "AGENT", "DEVICE", "TRUSTED_TEST"]), testEnvironmentId: z.string().uuid().optional(), occurredAt: z.string(), createdAt: z.string(), updatedAt: z.string(),
});
const TestRequestSchema = z.object({
  id: z.string().uuid(), experimentId: z.string().uuid(), iterationId: z.string().uuid(), cloneId: z.string().uuid(), shortLabel: z.string(), testUrl: z.string(),
  instructions: z.string(), hypothesisIds: z.array(z.string().uuid()), environmentId: z.string().uuid().optional(), status: z.enum(["PENDING", "COMPLETED", "EXPIRED", "CANCELLED"]),
  expiresAt: z.string().optional(), result: TestResultSchema.optional(), createdAt: z.string(), updatedAt: z.string(),
});
const ExperimentSummarySchema = z.object({
  id: z.string().uuid(), investigationId: z.string().uuid(), goal: z.string(), status: ExperimentStatusSchema, createdBy: z.string(),
  targetEnvironmentId: z.string().uuid().optional(), activeTestRequestId: z.string().uuid().optional(), createdAt: z.string(), updatedAt: z.string(),
});
const TestEnvironmentSchema = z.object({
  id: z.string().uuid(), name: z.string(), platform: z.string().optional(), platformVersion: z.string().optional(), manufacturer: z.string().optional(), model: z.string().optional(),
  firmwareVersion: z.string().optional(), applicationName: z.string().optional(), applicationVersion: z.string().optional(), playerEngine: z.string().optional(), networkNotes: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(),
});
const ExperimentCausalAnalysisSchema = z.object({
  schemaVersion: z.literal(1), source: z.enum(["DETERMINISTIC", "AI_ASSISTED"]),
  outcome: z.enum(["DISCRIMINATING_EFFECT", "NO_DISCRIMINATING_EFFECT", "INCONCLUSIVE"]),
  title: z.string(), observation: z.string(), interpretation: z.string(), supportedClaim: z.string(),
  notEstablished: z.array(z.string()), alternativeExplanations: z.array(z.string()), limitations: z.array(z.string()),
  confidenceRationale: z.string(), evidenceIds: z.array(z.string()),
  nextTest: z.object({ title: z.string(), rationale: z.string(), change: z.string(), expectedSignal: z.string() }),
  agents: z.array(z.object({
    id: z.enum(["experiment-evidence-auditor", "experiment-causal-analyst", "experiment-lead-investigator"]),
    label: z.string(), state: z.enum(["COMPLETED", "FAILED", "UNAVAILABLE"]), summary: z.string().optional(), limitation: z.string().optional(),
  })),
});
const ExperimentDetailSchema = ExperimentSummarySchema.extend({
  targetEnvironment: TestEnvironmentSchema.optional(), hypotheses: z.array(HypothesisSchema),
  iterations: z.array(z.object({ id: z.string().uuid(), experimentId: z.string().uuid(), iterationNumber: z.number().int(), rationale: z.string(), cloneSpecs: z.array(z.unknown()), status: z.enum(["PLANNED", "BUILDING_CLONES", "AWAITING_TESTS", "EVALUATING", "COMPLETED", "FAILED"]), createdAt: z.string(), updatedAt: z.string() })),
  clones: z.array(z.object({
    id: z.string().uuid(), experimentId: z.string().uuid(), iterationId: z.string().uuid(), recordingId: z.string().uuid(), shortLabel: z.string(), isControl: z.boolean(),
    state: z.enum(["QUEUED", "BUILDING", "VERIFYING", "READY", "FAILED"]), spec: z.unknown(), specHash: z.string(), executionPlan: ClonePlanSchema,
    provenance: z.record(z.string(), z.unknown()), verification: z.object({ verifiedAt: z.string(), status: z.enum(["PASSED", "FAILED"]), warnings: z.array(z.string()), errors: z.array(z.string()), outputArtifactIds: z.array(z.string().uuid()) }).passthrough().optional(),
    errorCode: z.string().optional(), errorMessage: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().optional(),
  })),
  testRequests: z.array(TestRequestSchema),
  evaluations: z.array(z.object({
    id: z.string().uuid(), experimentId: z.string().uuid(), iterationId: z.string().uuid(), status: z.enum(["CONCLUDED", "MORE_TESTS_REQUIRED", "INCONCLUSIVE"]),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]), summary: z.string(), hypothesisUpdates: z.array(z.object({ hypothesisId: z.string().uuid(), status: z.string(), evidenceFor: z.array(z.string()), evidenceAgainst: z.array(z.string()), explanation: z.string() })),
    evidenceBundle: z.record(z.string(), z.unknown()), analysis: ExperimentCausalAnalysisSchema.optional(), proposedNextExperimentPlan: z.object({ rationale: z.string(), remainingHypothesisIds: z.array(z.string().uuid()), guidance: z.array(z.string()) }).optional(), createdAt: z.string(),
  })),
  evaluationJob: z.object({ id: z.string().uuid(), status: z.enum(["pending", "running", "completed", "failed"]), attempts: z.number().int(), maxAttempts: z.number().int(), errorCode: z.string().optional(), errorMessage: z.string().optional(), createdAt: z.string(), startedAt: z.string().optional(), completedAt: z.string().optional() }).optional(),
});

export type ExperimentSummary = z.infer<typeof ExperimentSummarySchema>;
export type ExperimentDetail = z.infer<typeof ExperimentDetailSchema>;
export type ExperimentTestRequest = z.infer<typeof TestRequestSchema>;
export type TestEnvironment = z.infer<typeof TestEnvironmentSchema>;

export async function listInvestigationExperiments(investigationId: string): Promise<ExperimentSummary[]> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(investigationId)}/experiments`);
  return (await parseResponse(response, z.object({ experiments: z.array(ExperimentSummarySchema) }))).experiments;
}
export async function getExperiment(id: string): Promise<ExperimentDetail> {
  const response = await fetch(`/v1/experiments/${encodeURIComponent(id)}`);
  return (await parseResponse(response, z.object({ experiment: ExperimentDetailSchema }))).experiment;
}
export async function createExperiment(investigationId: string, input: { goal: string; hypothesis: string; rationale: string; targetEnvironmentId?: string }): Promise<ExperimentDetail> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(investigationId)}/experiments`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      goal: input.goal, createdBy: "workspace-user", ...(input.targetEnvironmentId ? { targetEnvironmentId: input.targetEnvironmentId } : {}),
      hypotheses: [{ statement: input.hypothesis, rationale: input.rationale, evidenceFor: [], evidenceAgainst: [] }],
    }),
  });
  return (await parseResponse(response, z.object({ experiment: ExperimentDetailSchema }))).experiment;
}
export async function previewCloneRecipe(input: { recipe: "control" | "single_video_representation" | "force_representation" | "single_audio" | "representation_subset"; investigationId: string; shortLabel: string; hypothesisIds: string[]; representationId?: string; representationIds?: string[] }): Promise<{ spec: Record<string, unknown>; plan: z.infer<typeof ClonePlanSchema> }> {
  const response = await fetch("/v1/clone-specs/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe: input }) });
  return parseResponse(response, z.object({ spec: z.record(z.string(), z.unknown()), plan: ClonePlanSchema }));
}
export async function createExperimentIteration(experimentId: string, rationale: string, cloneSpecs: unknown[]): Promise<{ id: string }> {
  const response = await fetch(`/v1/experiments/${encodeURIComponent(experimentId)}/iterations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rationale, cloneSpecs }) });
  return (await parseResponse(response, z.object({ iteration: z.object({ id: z.string().uuid() }).passthrough() }))).iteration;
}
export async function queueExperimentClones(experimentId: string, iterationId: string): Promise<void> {
  const response = await fetch(`/v1/experiments/${encodeURIComponent(experimentId)}/clones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ iterationId }) });
  await parseResponse(response, z.object({ experiment: ExperimentDetailSchema.nullable() }));
}
export async function activateExperimentTest(testRequestId: string): Promise<{ testRequest: ExperimentTestRequest; playbackUrl: string }> {
  const response = await fetch(`/v1/test-requests/${encodeURIComponent(testRequestId)}/activate`, { method: "POST" });
  return parseResponse(response, z.object({ testRequest: TestRequestSchema, playbackUrl: z.string() }));
}
export async function submitExperimentTestResult(testRequestId: string, input: { outcome: "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_TESTED"; failureStage?: z.infer<typeof TestResultSchema>["failureStage"]; notes?: string; testEnvironmentId?: string }): Promise<void> {
  const response = await fetch(`/v1/test-requests/${encodeURIComponent(testRequestId)}/results`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, evidenceArtifactIds: [], reportedBy: "workspace-user", reportedVia: "USER", occurredAt: new Date().toISOString() }),
  });
  await parseResponse(response, z.object({ result: TestResultSchema }));
}
export async function evaluateExperiment(id: string): Promise<void> {
  const response = await fetch(`/v1/experiments/${encodeURIComponent(id)}/evaluate`, { method: "POST" });
  await parseResponse(response, z.object({ evaluationJob: z.object({ job: z.object({ id: z.string().uuid(), status: z.enum(["pending", "running", "completed", "failed"]) }).passthrough(), replayed: z.boolean() }) }));
}
export async function listTestEnvironments(): Promise<TestEnvironment[]> {
  const response = await fetch("/v1/test-environments");
  return (await parseResponse(response, z.object({ environments: z.array(TestEnvironmentSchema) }))).environments;
}
export async function createTestEnvironment(input: { name: string; platform?: string; model?: string; firmwareVersion?: string }): Promise<TestEnvironment> {
  const response = await fetch("/v1/test-environments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return (await parseResponse(response, z.object({ environment: TestEnvironmentSchema }))).environment;
}
