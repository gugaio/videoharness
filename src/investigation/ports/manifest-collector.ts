import type { HlsManifestSelection } from "../../stream-tools/hls-manifest.js";
import type { ManifestInspection } from "../../stream-tools/manifest.js";

export type Manifest = {
  logicalKey: string;
  role: "root" | "variant" | "rendition";
  source: {
    requestedUrl: string;
    finalUrl: string;
    statusCode: number;
    contentType?: string;
  };
  content: {
    bytes: Uint8Array;
  };
  inspection: ManifestInspection;
  artifact?: {
    id: string;
    storageKey: string;
    sizeBytes: number;
  };
};

export type ManifestCollection = {
  manifests: Manifest[];
  hlsSelection?: HlsManifestSelection;
};

export interface ManifestCollector {
  collect(sourceUrl: string): Promise<ManifestCollection>;
}
