import { z } from "zod";

const EvidenceRefSchema = z.object({ evidenceId: z.string().min(1) });
const AbrSeveritySchema = z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const AbrRepresentationSchema = EvidenceRefSchema.extend({
  id: z.string().min(1),
  groupId: z.string().min(1),
  bandwidth: z.number().nonnegative().optional(),
  averageBandwidth: z.number().nonnegative().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  frameRate: z.number().nonnegative().optional(),
  codecs: z.string().optional(),
  audioGroupId: z.string().optional(),
  segmentCount: z.number().int().nonnegative().optional(),
});

const RepresentationSummarySchema = EvidenceRefSchema.extend({
  id: z.string().min(1),
  periodIndex: z.number().int().nonnegative(),
  adaptationSetIndex: z.number().int().nonnegative(),
  bandwidth: z.number().nonnegative().optional(),
  codecs: z.string().optional(),
  sampleEntry: z.string().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  frameRate: z.string().optional(),
  timescale: z.number().positive().optional(),
  presentationTimeOffset: z.string().optional(),
});

const DeterministicFindingSchema = EvidenceRefSchema.extend({
  ruleId: z.string().min(1),
  category: z.enum(["SPEC_VIOLATION", "AUTHORING_ERROR", "AUTHORING_RISK", "DECODER_RECONFIGURATION_RISK", "DEVICE_CAPABILITY_MISMATCH", "DEVICE_COMPATIBILITY_RISK", "DRM_TRANSITION", "NETWORK_OR_DELIVERY", "PLATFORM_SUSPECTED", "INCONCLUSIVE"]),
  severity: AbrSeveritySchema,
  confidence: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]),
  title: z.string().min(1),
  explanation: z.string(),
  evidenceIds: z.array(z.string()),
});

const HttpRequestEvidenceSchema = EvidenceRefSchema.extend({
  captureSource: z.enum(["INVESTIGATION_FETCH", "PLAYBACK_REQUEST"]),
  url: z.string(),
  resourceKind: z.enum(["mpd", "init", "video", "audio", "other"]),
  representationId: z.string().optional(),
  requestStartMs: z.number(),
  completed: z.boolean(),
}).passthrough();

const BoundarySchema = EvidenceRefSchema.extend({
  representationId: z.string(),
  segmentNumber: z.number().optional(),
  accessUnits: z.array(EvidenceRefSchema.passthrough()),
});

const AbrSwitchBaseSchema = EvidenceRefSchema.extend({
  switchId: z.string().min(1),
  timestamps: z.object({
    detectedAtMonotonicMs: z.number().optional(),
    detectedAtWallClock: z.string().optional(),
    candidateBoundaryPresentationTimeMs: z.number().optional(),
    sourceLastRequestMs: z.number().optional(),
    targetInitRequestMs: z.number().optional(),
    targetFirstMediaRequestMs: z.number().optional(),
  }),
  sourceRepresentation: RepresentationSummarySchema,
  targetRepresentation: RepresentationSummarySchema,
  direction: z.enum(["UPSHIFT", "DOWNSHIFT", "LATERAL"]),
  switchKind: z.enum(["SAME_RESOLUTION_BITRATE", "RESOLUTION_CHANGING", "UNKNOWN"]),
  switchingContract: EvidenceRefSchema.passthrough(),
  reportedPlayerContext: EvidenceRefSchema.passthrough().optional(),
  playerEvidence: EvidenceRefSchema.passthrough().optional(),
  // Kept so reports persisted before the protocol-neutral player evidence
  // rename remain readable without pretending that AVPlay is the core model.
  avplayEvidence: EvidenceRefSchema.passthrough().optional(),
  networkEvidence: EvidenceRefSchema.extend({ requests: z.array(HttpRequestEvidenceSchema) }).passthrough(),
  sourceInit: EvidenceRefSchema.passthrough().optional(),
  targetInit: EvidenceRefSchema.passthrough().optional(),
  initSemanticDiff: EvidenceRefSchema.passthrough().optional(),
  sourceBoundary: BoundarySchema.optional(),
  targetBoundary: BoundarySchema.optional(),
  sapEvidence: EvidenceRefSchema.passthrough().optional(),
  timelineEvidence: EvidenceRefSchema.passthrough().optional(),
  codecDiff: EvidenceRefSchema.passthrough().optional(),
  drmDiff: EvidenceRefSchema.passthrough().optional(),
  deviceCapabilityEvidence: EvidenceRefSchema.passthrough().optional(),
  decodeTests: z.array(EvidenceRefSchema.passthrough()),
  conformance: EvidenceRefSchema.passthrough().optional(),
  deterministicFindings: z.array(DeterministicFindingSchema),
  missingEvidence: z.array(z.string()),
});

export const AbrSwitchEvidenceSchema = z.discriminatedUnion("evidenceBasis", [
  AbrSwitchBaseSchema.extend({ evidenceBasis: z.literal("URL_STATIC_ANALYSIS"), transitionStatus: z.literal("CANDIDATE") }),
  AbrSwitchBaseSchema.extend({ evidenceBasis: z.literal("PLAYBACK_NETWORK_OBSERVED"), transitionStatus: z.literal("OBSERVED") }),
]);

const AbrAssessmentFindingSchema = EvidenceRefSchema.extend({
  ruleId: z.string().min(1),
  category: z.enum(["LADDER_TOPOLOGY", "LADDER_CONSISTENCY", "TRANSITION_SAFETY", "DELIVERY_BEHAVIOR", "COVERAGE"]),
  severity: AbrSeveritySchema,
  title: z.string().min(1),
  explanation: z.string(),
  evidenceIds: z.array(z.string()),
});

const AbrTransitionAssessmentSchema = EvidenceRefSchema.extend({
  transitionId: z.string().min(1),
  protocol: z.enum(["hls", "dash"]),
  evidenceBasis: z.enum(["URL_STATIC_ANALYSIS", "PLAYBACK_NETWORK_OBSERVED"]),
  transitionStatus: z.enum(["CANDIDATE", "OBSERVED"]),
  sourceRepresentation: AbrRepresentationSchema,
  targetRepresentation: AbrRepresentationSchema,
  direction: z.enum(["UPSHIFT", "DOWNSHIFT", "LATERAL"]),
  switchKind: z.enum(["SAME_RESOLUTION_BITRATE", "RESOLUTION_CHANGING", "UNKNOWN"]),
  outcome: z.enum(["PASS", "FAIL", "RISK", "NOT_TESTED"]),
  findingRuleIds: z.array(z.string()),
});

export const CapabilityRepresentationSchema = z.object({
  id: z.string(),
  codec: z.string().optional(),
  requiredProfile: z.string().optional(),
  requiredLevel: z.string().optional(),
  requiredLevelNumeric: z.number().nonnegative().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
});

export const CapabilityProjectionSchema = z.object({
  codecFamily: z.enum(["H264", "HEVC", "AV1", "VP9", "OTHER", "UNKNOWN"]),
  profiles: z.array(z.string()),
  maxRequiredLevelNumeric: z.number().nonnegative().optional(),
  maxRequiredLevel: z.string().optional(),
  maxResolution: z.object({ width: z.number().int().nonnegative(), height: z.number().int().nonnegative() }).optional(),
  representations: z.array(CapabilityRepresentationSchema),
});

export const AbrAssessmentSchema = EvidenceRefSchema.extend({
  schemaVersion: z.literal(1),
  protocol: z.enum(["hls", "dash"]),
  verdict: z.enum(["NO_ISSUE_DETECTED", "ISSUES_FOUND", "INCONCLUSIVE", "NOT_APPLICABLE"]),
  reportedPriority: z.object({
    abrProblemReported: z.boolean(),
    direction: z.enum(["UPSHIFT", "DOWNSHIFT", "LATERAL"]).optional(),
    sourceHeight: z.number().int().positive().optional(),
    targetHeight: z.number().int().positive().optional(),
    approximateTimeSeconds: z.number().nonnegative().optional(),
  }),
  coverage: z.object({
    level: z.enum(["MANIFEST_ONLY", "SAMPLED_MEDIA", "OBSERVED_PLAYBACK"]),
    manifestObserved: z.literal(true),
    mediaSampleCount: z.number().int().nonnegative(),
    representationCount: z.number().int().nonnegative(),
    transitionPairsAnalyzed: z.number().int().nonnegative(),
    playbackObserved: z.boolean(),
    limitations: z.array(z.string()),
  }),
  ladder: z.object({
    representations: z.array(AbrRepresentationSchema),
    videoRepresentationCount: z.number().int().nonnegative(),
    audioRenditionCount: z.number().int().nonnegative(),
  }),
  findings: z.array(AbrAssessmentFindingSchema),
  transitions: z.array(AbrTransitionAssessmentSchema),
  transitionMatrix: z.array(z.object({
    fromRepresentationId: z.string(),
    toRepresentationId: z.string(),
    switchKind: z.enum(["SAME_RESOLUTION_BITRATE", "RESOLUTION_CHANGING", "UNKNOWN"]),
    status: z.enum(["PASS", "FAIL", "RISK", "NOT_TESTED"]),
    findingRuleIds: z.array(z.string()),
  })),
  recommendedMeasurements: z.array(z.string()),
  capability: CapabilityProjectionSchema.optional(),
});
