import type { Fmp4InitInspection } from "../../stream-tools/isobmff.js";
import type { SwitchingContract } from "../../stream-tools/dash-mpd.js";

export type AbrSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AbrConfidence = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
export type AbrFindingCategory =
  | "SPEC_VIOLATION"
  | "AUTHORING_ERROR"
  | "AUTHORING_RISK"
  | "DECODER_RECONFIGURATION_RISK"
  | "DEVICE_CAPABILITY_MISMATCH"
  | "DEVICE_COMPATIBILITY_RISK"
  | "DRM_TRANSITION"
  | "NETWORK_OR_DELIVERY"
  | "PLATFORM_SUSPECTED"
  | "INCONCLUSIVE";

export type EvidenceRef = { evidenceId: string };

export type RepresentationSummary = EvidenceRef & {
  id: string;
  periodIndex: number;
  adaptationSetIndex: number;
  bandwidth?: number;
  codecs?: string;
  sampleEntry?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  timescale?: number;
  presentationTimeOffset?: string;
};

export type SemanticDiffImpact =
  | "NONE"
  | "DECODER_CONFIGURATION"
  | "DECODER_RECONFIGURATION"
  | "RISKY_DECODER_RECONFIGURATION"
  | "TIMELINE"
  | "DRM"
  | "SWITCHING_CONTRACT";

export type SemanticParameterSetChange = {
  path: string;
  from?: string | number | boolean | null;
  to?: string | number | boolean | null;
  impact: SemanticDiffImpact;
};

export type SemanticParameterSetDiff = EvidenceRef & {
  changed: boolean;
  changes: SemanticParameterSetChange[];
};

export type InitDiffClassification =
  | "NONE"
  | "EXPECTED_RESOLUTION_SWITCH"
  | "EXPECTED_DECODER_RECONFIGURATION"
  | "RISKY_DECODER_RECONFIGURATION"
  | "MANIFEST_MISMATCH"
  | "SWITCHING_CONTRACT_VIOLATION"
  | "DRM_REINITIALIZATION"
  | "UNKNOWN";

export type InitSemanticDifference = {
  path: string;
  from?: string | number | boolean | null;
  to?: string | number | boolean | null;
  classification: InitDiffClassification;
};

export type InitSemanticDiff = EvidenceRef & {
  binaryEqual: boolean;
  changed: boolean;
  classifications: InitDiffClassification[];
  differences: InitSemanticDifference[];
  parameterSets: SemanticParameterSetDiff;
};

export type AccessUnitEvidence = EvidenceRef & {
  index: number;
  pts?: string;
  dts?: string;
  duration?: string;
  keyFrameAccordingToFfprobe?: boolean;
  nalTypes: string[];
  firstVclNalType?: string;
  isIrap: boolean;
  irapType?: "BLA" | "IDR_W_RADL" | "IDR_N_LP" | "CRA";
  hasVpsBeforeFirstVcl: boolean;
  hasSpsBeforeFirstVcl: boolean;
  hasPpsBeforeFirstVcl: boolean;
  parameterSetIdsReferenced: { vps?: number[]; sps?: number[]; pps?: number[] };
  containsRasl: boolean;
  containsRadl: boolean;
};

export type BoundaryEvidence = EvidenceRef & {
  representationId: string;
  segmentNumber?: number;
  accessUnits: AccessUnitEvidence[];
};

export type SapEvidence = EvidenceRef & {
  manifestClaim?: number;
  observedSapType?: 1 | 2 | 3 | 4 | 5 | 6;
  compatible: boolean | "unknown";
  reason: string;
};

export type TimelineEvidence = EvidenceRef & {
  toleranceMs: number;
  expectedNextVideoDecodeTime?: number;
  actualTargetVideoDecodeTime?: number;
  videoDecodeGapMs?: number;
  videoDecodeOverlapMs?: number;
  expectedNextVideoPresentationTime?: number;
  actualTargetVideoPresentationTime?: number;
  videoPresentationGapMs?: number;
  videoPresentationOverlapMs?: number;
  audioGapMs?: number;
  audioOverlapMs?: number;
  avSkewBeforeMs?: number;
  avSkewAfterMs?: number;
  avSkewDeltaMs?: number;
  sourceSegmentDurationMs?: number;
  targetSegmentDurationMs?: number;
};

export type PlayerEventEvidence = EvidenceRef & {
  type: string;
  monotonicMs: number;
  wallClockAt: string;
  playbackTimeMs?: number;
  representationId?: string;
  bandwidth?: number;
  currentRequestEvidenceId?: string;
  currentLogicalPath?: string;
  detail?: string;
};

export type PlayerEvidence = EvidenceRef & {
  playerName?: string;
  events: PlayerEventEvidence[];
  audioOrPlaytimeContinuedAfterVideoFreeze?: boolean;
};

export type HttpRequestEvidence = EvidenceRef & {
  captureSource: "INVESTIGATION_FETCH" | "PLAYBACK_REQUEST";
  url: string;
  resourceKind: "mpd" | "init" | "video" | "audio" | "other";
  representationId?: string;
  requestStartMs: number;
  wallClockAt?: string;
  firstByteMs?: number;
  requestEndMs?: number;
  status?: number;
  contentLength?: number;
  downloadedBytes?: number;
  byteRange?: string;
  responseHeaders?: Record<string, string>;
  serverIdentifier?: string;
  retry?: number;
  cancelled?: boolean;
  throughputKbps?: number;
  latencyMs?: number;
  completed: boolean;
  mediaSequence?: number;
};

export type NetworkEvidence = EvidenceRef & {
  requests: HttpRequestEvidence[];
  targetInitCompletedBeforeSymptom?: boolean;
  targetMediaCompletedBeforeSymptom?: boolean;
};

export type DeviceCapabilityEvidence = EvidenceRef & {
  manufacturer?: string;
  modelCode?: string;
  modelYearOrFamily?: string;
  firmwareVersion?: string;
  operatingSystem?: string;
  operatingSystemVersion?: string;
  applicationVersion?: string;
  playerName?: string;
  playerVersion?: string;
  drmSystem?: string;
  displayOrHdrMode?: string;
  codecSupported?: boolean;
  profileSupported?: boolean;
  levelSupported?: boolean;
  resolutionSupported?: boolean;
  frameRateSupported?: boolean;
  source: "observed" | "reported" | "capability-database" | "unknown";
};

export type ReportedPlayerContextEvidence = EvidenceRef & {
  source: "problem_description";
  manufacturer?: string;
  modelCode?: string;
  firmwareVersion?: string;
  operatingSystem?: string;
  operatingSystemVersion?: string;
  applicationVersion?: string;
  playerName?: string;
  playerVersion?: string;
  drmSystem?: string;
  displayOrHdrMode?: string;
  mentionedPlayerEvents: string[];
  reportsVideoFreeze: boolean;
  reportsAudioContinues: boolean;
  reportsAbrSwitch: boolean;
  reportedAbrDirection?: "UPSHIFT" | "DOWNSHIFT";
  reportedResolutionTransition?: { sourceHeight: number; targetHeight: number };
  /** A bounded excerpt preserves useful pasted log lines without treating them as observed telemetry. */
  descriptionExcerpt?: string;
};

export type DecodeTestResult = EvidenceRef & {
  test: "SOURCE_STANDALONE" | "TARGET_STANDALONE" | "TARGET_BOUNDARY" | "SWITCHING_COMPATIBILITY";
  status: "PASS" | "FAIL" | "NOT_RUN";
  exitCode?: number;
  firstDecoderError?: string;
  firstErrorTimestampMs?: number;
  decodedFrameCount?: number;
  lastDecodedPts?: number;
  warnings: string[];
  corruptFrames?: number;
};

export type ConformanceSummary = EvidenceRef & {
  status: "PASS" | "FAIL" | "NOT_RUN";
  validator?: string;
  findingEvidenceIds: string[];
};

export type DeterministicFinding = EvidenceRef & {
  ruleId: string;
  category: AbrFindingCategory;
  severity: AbrSeverity;
  confidence: AbrConfidence;
  title: string;
  explanation: string;
  evidenceIds: string[];
};

export type AbrSwitchEvidence = EvidenceRef & {
  switchId: string;
  evidenceBasis: "URL_STATIC_ANALYSIS" | "PLAYBACK_NETWORK_OBSERVED";
  transitionStatus: "CANDIDATE" | "OBSERVED";
  timestamps: {
    detectedAtMonotonicMs?: number;
    detectedAtWallClock?: string;
    candidateBoundaryPresentationTimeMs?: number;
    sourceLastRequestMs?: number;
    targetInitRequestMs?: number;
    targetFirstMediaRequestMs?: number;
  };
  sourceRepresentation: RepresentationSummary;
  targetRepresentation: RepresentationSummary;
  direction: "UPSHIFT" | "DOWNSHIFT" | "LATERAL";
  switchKind: "SAME_RESOLUTION_BITRATE" | "RESOLUTION_CHANGING" | "UNKNOWN";
  switchingContract: SwitchingContract & EvidenceRef;
  reportedPlayerContext?: ReportedPlayerContextEvidence;
  playerEvidence?: PlayerEvidence;
  networkEvidence: NetworkEvidence;
  sourceInit?: Fmp4InitInspection & EvidenceRef;
  targetInit?: Fmp4InitInspection & EvidenceRef;
  initSemanticDiff?: InitSemanticDiff;
  sourceBoundary?: BoundaryEvidence;
  targetBoundary?: BoundaryEvidence;
  sapEvidence?: SapEvidence;
  timelineEvidence?: TimelineEvidence;
  codecDiff?: SemanticParameterSetDiff;
  drmDiff?: InitSemanticDiff;
  deviceCapabilityEvidence?: DeviceCapabilityEvidence;
  decodeTests: DecodeTestResult[];
  conformance?: ConformanceSummary;
  deterministicFindings: DeterministicFinding[];
  missingEvidence: string[];
};

export type AbrSwitchMatrixEntry = {
  fromRepresentationId: string;
  toRepresentationId: string;
  switchKind: AbrSwitchEvidence["switchKind"];
  status: "PASS" | "FAIL" | "RISK" | "NOT_TESTED";
  findingRuleIds: string[];
};
