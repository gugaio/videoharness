import type { ManifestKind, ManifestProtocol } from "../../stream-tools/manifest.js";
import type { HttpRequestFacts } from "../../stream-tools/safe-http-client.js";
import type { TimelineContinuityWindow } from "../application/analyze-timeline-continuity.js";

export type EvidenceObservation = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

type EvidenceSource = {
  requestedUrl: string;
  finalUrl: string;
  protocol: ManifestProtocol;
  httpStatus: number;
  contentType?: string;
};

type ManifestCounts = {
  variantCount?: number;
  segmentCount?: number;
  representationCount?: number;
};

export type EvidenceBundleV1 = {
  schemaVersion: 1;
  collectedAt: string;
  source: EvidenceSource;
  manifest: ManifestCounts & {
    artifactId: string;
    kind: ManifestKind;
    sizeBytes: number;
  };
  observations: EvidenceObservation[];
  limitations: string[];
};

export type ManifestEvidence = ManifestCounts & {
  artifactId: string;
  logicalKey: string;
  role: "root" | "variant" | "rendition";
  requestedUrl: string;
  finalUrl: string;
  kind: ManifestKind;
  sizeBytes: number;
  sha256?: string;
  targetDuration?: number;
  mediaSequence?: number;
  discontinuitySequence?: number;
  discontinuityCount?: number;
  hasEndList?: boolean;
  http?: HttpRequestFacts;
  /**
   * Raw manifest text preserved as evidence, bounded by
   * `MAX_MANIFEST_CONTENT_CHARS`. Present on snapshots created after the
   * manifest-content change; historical snapshots omit it.
   */
  content?: string;
};

export type HlsVariantEvidence = {
  index: number;
  uri: string;
  url?: string;
  bandwidth?: number;
  averageBandwidth?: number;
  resolution?: string;
  frameRate?: number;
  codecs?: string;
  audioGroupId?: string;
  subtitlesGroupId?: string;
  closedCaptions?: string;
};

export type HlsRenditionEvidence = {
  index: number;
  type: string;
  groupId?: string;
  name?: string;
  language?: string;
  default?: boolean;
  autoselect?: boolean;
  forced?: boolean;
  channels?: string;
  characteristics?: string;
  uri?: string;
  url?: string;
};

export type HlsVariantTopology = {
  index: number;
  logicalKey: string;
  segmentCount: number;
  targetDuration?: number;
  discontinuityCount?: number;
  hasEndList?: boolean;
};

export type EvidenceBundleV2 = {
  schemaVersion: 2;
  collectedAt: string;
  source: EvidenceSource;
  manifests: ManifestEvidence[];
  mediaSamples: Array<{
    artifactId: string;
    logicalKey: string;
    kind: "init-segment" | "media-segment";
    sizeBytes: number;
    sha256?: string;
    sourceManifestLogicalKey?: string;
    sampleIndex?: number;
    sequence?: number;
    declaredDuration?: number;
    representationId?: string;
    periodIndex?: number;
    adaptationSetIndex?: number;
    presentationStartSeconds?: number;
    presentationEndSeconds?: number;
    source?: { url: string; sha256: string; observedHashes?: string[]; httpStatus: number; contentLength?: number; http?: HttpRequestFacts };
    probe?: {
      format?: string;
      duration?: number;
      tracks: Array<{
        kind: "video" | "audio" | "other";
        codec?: string;
        duration?: number;
        firstPts?: number;
        lastPts?: number;
        width?: number;
        height?: number;
        frameRate?: string;
        sampleRate?: number;
        channels?: number;
      }>;
      fmp4?: import("../ports/media-sample-collector.js").MediaProbeResult["fmp4"];
      structural?: import("../../stream-tools/ts-sanity.js").TsSanity;
    };
  }>;
  reportedContext?: {
    approximateTimeSeconds?: number;
    reportsVideoFreeze: boolean;
    reportsAudioContinues: boolean;
    reportsAbrSwitch: boolean;
    reportedAbrDirection?: "UPSHIFT" | "DOWNSHIFT";
    reportedResolutionTransition?: { sourceHeight: number; targetHeight: number };
    reportedDevice?: { manufacturer?: string; modelCode?: string; firmwareVersion?: string; operatingSystem?: string; operatingSystemVersion?: string; applicationVersion?: string; playerName?: string; playerVersion?: string; drmSystem?: string; displayOrHdrMode?: string };
    mentionedPlayerEvents: string[];
    descriptionExcerpt?: string;
    uncertainties: string[];
  };
  abr?: import("../../abr/domain/assessment.js").AbrAssessment;
  dash?: {
    type: "static" | "dynamic";
    periods: import("../../stream-tools/dash-mpd.js").DashManifestInspection["periods"];
    adaptationSets: import("../../stream-tools/dash-mpd.js").DashManifestInspection["adaptationSets"];
    representations: Array<{
      id: string;
      periodIndex: number;
      adaptationSetIndex: number;
      contentType: "video" | "audio" | "unknown";
      codecs?: string;
      bandwidth?: number;
      width?: number;
      height?: number;
      frameRate?: string;
      sar?: string;
      baseUrl: string;
      timescale: number;
      presentationTimeOffset: string;
      initializationUrl?: string;
      mediaTemplate?: string;
      segmentAddressing: "template" | "list" | "base" | "unknown";
      segmentAlignment?: boolean;
      subsegmentAlignment?: boolean;
      startWithSap?: number;
      subsegmentStartsWithSap?: number;
      bitstreamSwitching?: boolean;
      contentProtection: import("../../stream-tools/dash-mpd.js").DashContentProtection[];
      segmentCount: number;
    }>;
    limitations: string[];
    /** Legacy report payload. New investigations use the protocol-neutral `abr` assessment. */
    analysis?: unknown;
    /** DASH/fMP4 specialization; `abr.transitions` carries protocol-neutral summaries. */
    switches?: import("../../abr/domain/evidence.js").AbrSwitchEvidence[];
    switchMatrix?: import("../../abr/domain/evidence.js").AbrSwitchMatrixEntry[];
    reconfigurationSensitivity?: string;
  };
  hls?: {
    variants: HlsVariantEvidence[];
    renditions: HlsRenditionEvidence[];
    topology?: HlsVariantTopology[];
    selection?: {
      rule: "highest-bandwidth";
      variantIndex: number;
      variantLogicalKey?: string;
      audioRenditionIndex?: number;
      audioRenditionLogicalKey?: string;
      sampledVariants?: Array<{ index: number; logicalKey: string }>;
    };
  };
  observations: EvidenceObservation[];
  limitations: string[];
  timeline?: TimelineContinuityWindow[];
  /** Observed quality transitions from related Record playback runs, attached only during agent analysis. */
  playbackSwitches?: import("../../abr/domain/evidence.js").AbrSwitchEvidence[];
};

export type PlaybackSessionEvidence = {
  id: string;
  engine: "hls.js" | "native-hls";
  startedAt: string;
  finishedAt: string;
  requestedDurationMs: number;
  playedMs: number;
  startupTimeMs?: number | undefined;
  stalls: number;
  stallDurationMs: number;
  fragmentsLoaded: number;
  qualitySwitches: number;
  droppedFrames?: number | undefined;
  errors: Array<{ type: string; detail: string; fatal: boolean; atMs: number }>;
  limitations: string[];
};

export type EvidenceBundleV3 = Omit<EvidenceBundleV2, "schemaVersion"> & {
  schemaVersion: 3;
  playbackSessions: PlaybackSessionEvidence[];
};

export type EvidenceBundle = EvidenceBundleV1 | EvidenceBundleV2 | EvidenceBundleV3;
