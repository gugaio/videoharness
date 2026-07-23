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
    sourceManifestLogicalKey?: string;
    sequence?: number;
    declaredDuration?: number;
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
    };
  }>;
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

export type EvidenceBundle = EvidenceBundleV1 | EvidenceBundleV2;
