import { StreamCollectionError } from "../../stream-tools/errors.js";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type { MediaSample, MediaSampleCollector } from "../ports/media-sample-collector.js";
import type { ManifestCollection } from "../ports/manifest-collector.js";

export class HttpMediaSampleCollector implements MediaSampleCollector {
  private readonly maxTotalBytes: number;

  constructor(private readonly http: SafeHttpClient, options: { maxTotalBytes?: number } = {}) {
    this.maxTotalBytes = options.maxTotalBytes ?? 16_777_216;
  }

  async collect(collection: ManifestCollection): Promise<{ samples: MediaSample[]; limitations: string[] }> {
    const candidates = collection.manifests.filter((manifest) =>
      manifest.role !== "root" && manifest.inspection.protocol === "hls" && manifest.inspection.hls?.kind === "media");
    const samples: MediaSample[] = [];
    const limitations: string[] = [];
    let totalBytes = 0;
    for (const manifest of candidates) {
      const hls = manifest.inspection.hls!;
      if (hls.encryptionMethod) {
        limitations.push(`${manifest.logicalKey} declares ${hls.encryptionMethod} encryption; media bytes were not sampled.`);
        continue;
      }
      const segment = hls.segments?.[0];
      if (!segment?.url) {
        limitations.push(`${manifest.logicalKey} has no fetchable media segment.`);
        continue;
      }
      if (segment.byteRange || hls.initSegment?.byteRange) {
        limitations.push(`${manifest.logicalKey} uses byte ranges; media bytes were not sampled in this phase.`);
        continue;
      }
      if (hls.initSegment?.url) {
        const init = await this.fetch({
          logicalKey: sampleKey(manifest.logicalKey, "init"),
          kind: "init-segment",
          sourceManifestLogicalKey: manifest.logicalKey,
          url: hls.initSegment.url,
        });
        totalBytes = assertWithinTotal(totalBytes, init.content.bytes.byteLength, this.maxTotalBytes);
        samples.push(init);
      }
      const media = await this.fetch({
        logicalKey: sampleKey(manifest.logicalKey, "media/0"),
        kind: "media-segment",
        sourceManifestLogicalKey: manifest.logicalKey,
        url: segment.url,
        ...(segment.sequence === undefined ? {} : { sequence: segment.sequence }),
        ...(segment.duration === undefined ? {} : { declaredDuration: segment.duration }),
      });
      totalBytes = assertWithinTotal(totalBytes, media.content.bytes.byteLength, this.maxTotalBytes);
      samples.push(media);
    }
    return { samples, limitations };
  }

  private async fetch(input: Omit<MediaSample, "content"> & { url: string }): Promise<MediaSample> {
    const response = await this.http.getBytes(input.url);
    return {
      logicalKey: input.logicalKey,
      kind: input.kind,
      sourceManifestLogicalKey: input.sourceManifestLogicalKey,
      ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
      ...(input.declaredDuration === undefined ? {} : { declaredDuration: input.declaredDuration }),
      content: { bytes: response.bytes },
    };
  }
}

function assertWithinTotal(current: number, added: number, maximum: number): number {
  const total = current + added;
  if (total > maximum) {
    throw new StreamCollectionError("STREAM_RESPONSE_TOO_LARGE", "The sampled media exceeds the allowed total size", false);
  }
  return total;
}

function sampleKey(manifestKey: string, suffix: string): string {
  const role = manifestKey.replace(/^manifest\//, "");
  if (!role) throw new StreamCollectionError("UNSUPPORTED_MANIFEST", "The media manifest has no logical identity", false);
  return `sample/${role}/${suffix}`;
}
