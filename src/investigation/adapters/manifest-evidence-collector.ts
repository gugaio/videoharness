import { StreamCollectionError } from "../../stream-tools/errors.js";
import { selectHlsManifestSample } from "../../stream-tools/hls-manifest.js";
import { inspectManifest } from "../../stream-tools/manifest.js";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type {
  CollectedManifest,
  StreamEvidenceCollector,
} from "../ports/stream-evidence-collector.js";

export class ManifestEvidenceCollector implements StreamEvidenceCollector {
  private readonly maxDerivedManifests: number;

  constructor(
    private readonly http: SafeHttpClient,
    options: { maxDerivedManifests?: number } = {},
  ) {
    this.maxDerivedManifests = Math.max(0, Math.min(2, options.maxDerivedManifests ?? 2));
  }

  async collectManifestEvidence(sourceUrl: string) {
    const response = await this.http.getText(sourceUrl);
    const root = toCollectedManifest(response, "manifest/root", "root");
    const manifests: CollectedManifest[] = [root];
    const hls = root.inspection.hls;
    if (root.inspection.protocol !== "hls" || root.inspection.kind !== "master" || !hls) {
      return { manifests };
    }

    const selection = selectHlsManifestSample(hls);
    if (!selection?.variant.url) {
      throw new StreamCollectionError(
        "UNSUPPORTED_MANIFEST",
        "The HLS master manifest has no fetchable variants",
        false,
      );
    }
    if (this.maxDerivedManifests > 0) {
      manifests.push(await this.fetchDerived(selection.variant.url, "manifest/variant/0", "variant"));
    }
    if (this.maxDerivedManifests > 1 && selection.audioRendition?.url) {
      manifests.push(await this.fetchDerived(
        selection.audioRendition.url,
        "manifest/rendition/audio/0",
        "rendition",
      ));
    }
    return { manifests, hlsSelection: selection };
  }

  private async fetchDerived(
    url: string,
    logicalKey: string,
    role: "variant" | "rendition",
  ): Promise<CollectedManifest> {
    const response = await this.http.getText(url);
    const manifest = toCollectedManifest(response, logicalKey, role);
    if (manifest.inspection.protocol !== "hls" || manifest.inspection.kind !== "media") {
      throw new StreamCollectionError(
        "UNSUPPORTED_MANIFEST",
        `The selected HLS ${role} does not resolve to a media playlist`,
        false,
      );
    }
    return manifest;
  }
}

function toCollectedManifest(
  response: Awaited<ReturnType<SafeHttpClient["getText"]>>,
  logicalKey: string,
  role: CollectedManifest["role"],
): CollectedManifest {
  return {
    logicalKey,
    role,
    requestedUrl: response.requestedUrl,
    finalUrl: response.finalUrl,
    statusCode: response.statusCode,
    ...(response.contentType ? { contentType: response.contentType } : {}),
    bytes: response.bytes,
    inspection: inspectManifest(response.text, response.finalUrl),
  };
}
