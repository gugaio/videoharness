import type { HlsManifestSelection } from "../../stream-tools/hls-manifest.js";
import type { ManifestInspection } from "../../stream-tools/manifest.js";

export type CollectedManifest = {
  logicalKey: string;
  role: "root" | "variant" | "rendition";
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType?: string;
  bytes: Uint8Array;
  inspection: ManifestInspection;
};

export type CollectedManifestEvidence = {
  manifests: CollectedManifest[];
  hlsSelection?: HlsManifestSelection;
};

export interface StreamEvidenceCollector {
  collectManifestEvidence(sourceUrl: string): Promise<CollectedManifestEvidence>;
}
