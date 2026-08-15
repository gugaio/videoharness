import { StreamCollectionError } from "../../stream-tools/errors.js";
import { selectHlsManifestSample } from "../../stream-tools/hls-manifest.js";
import { inspectManifest } from "../../stream-tools/manifest.js";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type {
  CollectionProgress,
  Manifest,
  ManifestCollection,
  ManifestCollector,
} from "../ports/manifest-collector.js";

export class HttpManifestCollector implements ManifestCollector {
  private readonly maxVariants: number;

  constructor(
    private readonly http: SafeHttpClient,
    options: { maxVariants?: number } = {},
  ) {
    this.maxVariants = Math.max(1, Math.min(32, options.maxVariants ?? 32));
  }

  async collect(sourceUrl: string, onProgress?: (progress: CollectionProgress) => Promise<void>): Promise<ManifestCollection> {
    await onProgress?.({ stage: "root_manifest", message: "Fetching the root manifest through the safe network boundary…" });
    const response = await fetchManifest(this.http, sourceUrl, "The root manifest");
    const root = toManifest(response, "manifest/root", "root");
    const manifests: Manifest[] = [root];
    const limitations: string[] = [];
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
    const fetchableVariants = hls.variants
      .filter((variant): variant is typeof variant & { url: string } => Boolean(variant.url))
      .slice(0, this.maxVariants);
    for (const variant of fetchableVariants) {
      await onProgress?.({ stage: "variant_manifest", message: `Fetching variant ${variant.index} playlist…` });
      try {
        manifests.push(await this.fetchDerived(variant.url, `manifest/variant/${variant.index}`, "variant"));
      } catch (error) {
        await recordManifestFailure({
          error,
          subject: `Variant ${variant.index} playlist`,
          logicalKey: `manifest/variant/${variant.index}`,
          resourceKind: "variant_manifest",
          limitations,
          onProgress,
        });
      }
    }
    if (selection.audioRendition?.url) {
      await onProgress?.({ stage: "rendition_manifest", message: "Fetching the linked audio rendition playlist…" });
      try {
        manifests.push(await this.fetchDerived(selection.audioRendition.url, "manifest/rendition/audio/0", "rendition"));
      } catch (error) {
        await recordManifestFailure({
          error,
          subject: "The linked audio rendition playlist",
          logicalKey: "manifest/rendition/audio/0",
          resourceKind: "rendition_manifest",
          limitations,
          onProgress,
        });
      }
    }
    return { manifests, hlsSelection: selection, ...(limitations.length ? { mediaLimitations: limitations } : {}) };
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
      ...(response.http ? { http: response.http } : {}),
    },
    content: { bytes: response.bytes },
    inspection: inspectManifest(response.text, response.finalUrl),
  };
}

async function recordManifestFailure(input: {
  error: unknown;
  subject: string;
  logicalKey: string;
  resourceKind: "variant_manifest" | "rendition_manifest";
  limitations: string[];
  onProgress?: ((progress: CollectionProgress) => Promise<void>) | undefined;
}): Promise<void> {
  const errorCode = errorCodeOf(input.error);
  input.limitations.push(`${input.subject} could not be fetched (${errorCode}). Other variants remain available.`);
  await input.onProgress?.({
    stage: input.resourceKind === "variant_manifest" ? "variant_manifest" : "rendition_manifest",
    message: `${input.subject} could not be fetched. Remaining deterministic evidence will continue.`,
    limitation: {
      errorCode,
      resourceKind: input.resourceKind,
      logicalKey: input.logicalKey,
    },
  });
}

function errorCodeOf(error: unknown): string {
  return error instanceof StreamCollectionError
    ? error.code
    : error instanceof Error
      ? "STREAM_HTTP_ERROR"
      : "UNKNOWN";
}
