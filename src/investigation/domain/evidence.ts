import type { ManifestKind, ManifestProtocol } from "../../stream-tools/manifest.js";

export type EvidenceObservation = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

export type EvidenceBundle = {
  schemaVersion: 1;
  collectedAt: string;
  source: {
    requestedUrl: string;
    finalUrl: string;
    protocol: ManifestProtocol;
    httpStatus: number;
    contentType?: string;
  };
  manifest: {
    artifactId: string;
    kind: ManifestKind;
    sizeBytes: number;
    variantCount?: number;
    segmentCount?: number;
    representationCount?: number;
  };
  observations: EvidenceObservation[];
  limitations: string[];
};
