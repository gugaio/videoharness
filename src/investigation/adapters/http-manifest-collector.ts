import { StreamCollectionError } from "../../stream-tools/errors.js";
import { selectHlsManifestSample } from "../../stream-tools/hls-manifest.js";
import { inspectManifest } from "../../stream-tools/manifest.js";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type {
  CollectionProgress,
  Manifest,
  ManifestCollector,
} from "../ports/manifest-collector.js";

export class HttpManifestCollector implements ManifestCollector {
  private readonly maxDerivedManifests: number;

  constructor(
    private readonly http: SafeHttpClient,
    options: { maxDerivedManifests?: number } = {},
  ) {
    this.maxDerivedManifests = Math.max(0, Math.min(2, options.maxDerivedManifests ?? 2));
  }

  async collect(sourceUrl: string, onProgress?: (progress: CollectionProgress) => Promise<void>) {
    await onProgress?.({ stage: "root_manifest", message: "Fetching the root manifest through the safe network boundary…" });
    const response = await fetchManifest(this.http, sourceUrl, "The root manifest");
    const root = toManifest(response, "manifest/root", "root");
    const manifests: Manifest[] = [root];
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
      await onProgress?.({ stage: "variant_manifest", message: "Fetching the selected video variant playlist…" });
      manifests.push(await this.fetchDerived(selection.variant.url, "manifest/variant/0", "variant"));
    }
    if (this.maxDerivedManifests > 1 && selection.audioRendition?.url) {
      await onProgress?.({ stage: "rendition_manifest", message: "Fetching the linked audio rendition playlist…" });
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
  ): Promise<Manifest> {
    const subject = role === "variant" ? "The selected HLS video variant manifest" : "The selected HLS audio rendition manifest";
    const response = await fetchManifest(this.http, url, subject);
    const manifest = toManifest(response, logicalKey, role);
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

async function fetchManifest(http: SafeHttpClient, url: string, subject: string): Promise<Awaited<ReturnType<SafeHttpClient["getText"]>>> {
  try {
    return await http.getText(url);
  } catch (error) {
    if (!(error instanceof StreamCollectionError)) throw error;
    throw new StreamCollectionError(error.code, `${subject} could not be fetched: ${error.message}`, error.retryable, { cause: error });
  }
}

function toManifest(
  response: Awaited<ReturnType<SafeHttpClient["getText"]>>,
  logicalKey: string,
  role: Manifest["role"],
): Manifest {
  return {
    logicalKey,
    role,
    source: {
      requestedUrl: response.requestedUrl,
      finalUrl: response.finalUrl,
      statusCode: response.statusCode,
      ...(response.contentType ? { contentType: response.contentType } : {}),
    },
    content: { bytes: response.bytes },
    inspection: inspectManifest(response.text, response.finalUrl),
  };
}
