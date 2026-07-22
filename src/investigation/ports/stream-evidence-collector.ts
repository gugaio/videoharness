import type { ManifestInspection } from "../../stream-tools/manifest.js";

export type CollectedManifest = {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType?: string;
  bytes: Uint8Array;
  inspection: ManifestInspection;
};

export interface StreamEvidenceCollector {
  collectManifest(sourceUrl: string): Promise<CollectedManifest>;
}
