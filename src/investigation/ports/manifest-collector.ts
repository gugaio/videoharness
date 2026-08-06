import type { HlsManifestSelection } from "../../stream-tools/hls-manifest.js";
import type { ManifestInspection } from "../../stream-tools/manifest.js";
import type { MediaSample } from "./media-sample-collector.js";
import type { ReportedContext } from "../../stream-tools/reported-context.js";

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
    sha256?: string;
  };
};

export type ManifestCollection = {
  manifests: Manifest[];
  hlsSelection?: HlsManifestSelection;
  mediaSamples?: MediaSample[];
  mediaLimitations?: string[];
  reportedContext?: ReportedContext;
};

export interface ManifestCollector {
  collect(sourceUrl: string): Promise<ManifestCollection>;
}
