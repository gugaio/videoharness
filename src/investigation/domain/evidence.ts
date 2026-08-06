import type { ManifestKind, ManifestProtocol } from "../../stream-tools/manifest.js";

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
    source?: { url: string; sha256: string; observedHashes?: string[]; httpStatus: number; contentLength?: number };
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
    };
  }>;
  reportedContext?: {
    approximateTimeSeconds?: number;
    reportsVideoFreeze: boolean;
    reportsAudioContinues: boolean;
    reportsAbrSwitch: boolean;
    reportsFourKToFullHd: boolean;
    uncertainties: string[];
  };
  dash?: {
    type: "static" | "dynamic";
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
      timescale: number;
      segmentAlignment?: boolean;
      bitstreamSwitching?: boolean;
      segmentCount: number;
    }>;
    limitations: string[];
    analysis?: import("../application/analyze-dash-forensics.js").DashForensicAnalysis;
  };
  hls?: {
    variants: HlsVariantEvidence[];
    renditions: HlsRenditionEvidence[];
    selection?: {
      rule: "highest-bandwidth";
      variantIndex: number;
      variantLogicalKey?: string;
      audioRenditionIndex?: number;
      audioRenditionLogicalKey?: string;
    };
  };
  observations: EvidenceObservation[];
  limitations: string[];
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
