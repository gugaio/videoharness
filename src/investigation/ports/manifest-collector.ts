import type { HlsManifestSelection } from "../../stream-tools/hls-manifest.js";
import type { ManifestInspection } from "../../stream-tools/manifest.js";
import type { MediaSample } from "./media-sample-collector.js";
import type { ReportedContext } from "../application/parse-reported-context.js";

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

/** Deterministic, counted progress for a collection step. Totals come from the parsed manifest, never from estimates. */
export type CollectionProgress = {
  stage: "root_manifest" | "variant_manifest" | "rendition_manifest" | "media_sample" | "media_probe";
  message: string;
  completed?: number;
  total?: number;
};

export interface ManifestCollector {
  collect(sourceUrl: string, onProgress?: (progress: CollectionProgress) => Promise<void>): Promise<ManifestCollection>;
}
