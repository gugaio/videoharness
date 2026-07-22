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
  }>;
  observations: EvidenceObservation[];
  limitations: string[];
};

export type EvidenceBundle = EvidenceBundleV1 | EvidenceBundleV2;
