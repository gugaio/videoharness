import { StreamCollectionError } from "../../stream-tools/errors.js";
import { createHash } from "node:crypto";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type { MediaSample, MediaSampleCollector } from "../ports/media-sample-collector.js";
import type { ManifestCollection } from "../ports/manifest-collector.js";

export class HttpMediaSampleCollector implements MediaSampleCollector {
  private readonly maxTotalBytes: number;
  private readonly mode: "sample" | "full";

  constructor(private readonly http: SafeHttpClient, options: { maxTotalBytes?: number; mode?: "sample" | "full" } = {}) {
    this.maxTotalBytes = options.maxTotalBytes ?? 16_777_216;
    this.mode = options.mode ?? "sample";
  }

  async collect(collection: ManifestCollection): Promise<{ samples: MediaSample[]; limitations: string[] }> {
    const dashRoot = collection.manifests.find((manifest) => manifest.inspection.protocol === "dash");
    if (dashRoot?.inspection.dash) return this.collectDash(dashRoot.logicalKey, dashRoot.inspection.dash.representations, collection.reportedContext?.approximateTimeSeconds);
    const candidates = collection.manifests.filter((manifest) =>
      manifest.inspection.protocol === "hls" && manifest.inspection.hls?.kind === "media");
    const samples: MediaSample[] = [];
    const limitations: string[] = [];
    let totalBytes = 0;
    for (const manifest of candidates) {
      const hls = manifest.inspection.hls!;
      if (hls.encryptionMethod) {
        limitations.push(`${manifest.logicalKey} declares ${hls.encryptionMethod} encryption; media bytes were not sampled.`);
        continue;
      }
      const segments = hls.segments ?? [];
      if (segments.length === 0 || !segments.some((segment) => segment.url)) {
        limitations.push(`${manifest.logicalKey} has no fetchable media segment.`);
        continue;
      }
      if (segments.some((segment) => segment.byteRange) || hls.initSegment?.byteRange) {
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
        if (totalBytes + init.content.bytes.byteLength > this.maxTotalBytes) {
          limitations.push(`${manifest.logicalKey} init segment exceeds the investigation byte budget.`);
          continue;
        }
        totalBytes += init.content.bytes.byteLength;
        samples.push(init);
      }
      for (const index of this.mode === "full" ? segments.map((_, index) => index) : sampleIndices(segments.length)) {
        const segment = segments[index]!;
        if (!segment.url) continue;
        const media = await this.fetch({
          logicalKey: sampleKey(manifest.logicalKey, `media/${index}`),
          kind: "media-segment",
          sourceManifestLogicalKey: manifest.logicalKey,
          sampleIndex: index,
          url: segment.url,
          ...(segment.sequence === undefined ? {} : { sequence: segment.sequence }),
          ...(segment.duration === undefined ? {} : { declaredDuration: segment.duration }),
        });
        if (totalBytes + media.content.bytes.byteLength > this.maxTotalBytes) {
          limitations.push(`${manifest.logicalKey} full media collection stopped at segment ${index}; the investigation byte budget was reached.`);
          break;
        }
        totalBytes += media.content.bytes.byteLength;
        samples.push(media);
      }
    }
    return { samples, limitations };
  }

  private async fetch(input: Omit<MediaSample, "content"> & { url: string }): Promise<MediaSample> {
    const response = await this.http.getBytes(input.url);
    return {
      logicalKey: input.logicalKey,
      kind: input.kind,
      sourceManifestLogicalKey: input.sourceManifestLogicalKey,
      ...(input.sampleIndex === undefined ? {} : { sampleIndex: input.sampleIndex }),
      ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
      ...(input.declaredDuration === undefined ? {} : { declaredDuration: input.declaredDuration }),
      ...(input.representationId === undefined ? {} : { representationId: input.representationId }),
      ...(input.periodIndex === undefined ? {} : { periodIndex: input.periodIndex }),
      ...(input.adaptationSetIndex === undefined ? {} : { adaptationSetIndex: input.adaptationSetIndex }),
      ...(input.presentationStartSeconds === undefined ? {} : { presentationStartSeconds: input.presentationStartSeconds }),
      ...(input.presentationEndSeconds === undefined ? {} : { presentationEndSeconds: input.presentationEndSeconds }),
      source: {
        url: response.finalUrl,
        sha256: createHash("sha256").update(response.bytes).digest("hex"),
        httpStatus: response.statusCode,
        ...(response.contentLength === undefined ? {} : { contentLength: response.contentLength }),
      },
      content: { bytes: response.bytes },
    };
  }

  private async collectDash(
    sourceManifestLogicalKey: string,
    representations: import("../../stream-tools/dash-mpd.js").DashRepresentation[],
    targetSeconds: number | undefined,
  ): Promise<{ samples: MediaSample[]; limitations: string[] }> {
    const limitations: string[] = [];
    const samples: MediaSample[] = [];
    const video = representations.filter((entry) => entry.contentType === "video" && entry.segments.length > 0);
    const audio = representations.filter((entry) => entry.contentType === "audio" && entry.segments.length > 0);
    const selected = selectDashRepresentations(video, audio);
    if (selected.length === 0) return { samples, limitations: ["The DASH MPD has no expandable audio or video segment references."] };
    if (targetSeconds === undefined) limitations.push("No precise incident time was found in the user report; DASH samples use start, middle and end reference windows and cannot identify a specific switch boundary.");
    let totalBytes = 0;
    for (const representation of selected) {
      if (!representation.initializationUrl) limitations.push(`Representation ${representation.id} has no initialization URL in its SegmentTemplate.`);
      else {
        const init = await this.fetch({ logicalKey: `sample/dash/${safeKey(representation.id)}/init`, kind: "init-segment", sourceManifestLogicalKey, representationId: representation.id, periodIndex: representation.periodIndex, adaptationSetIndex: representation.adaptationSetIndex, url: representation.initializationUrl });
        if (totalBytes + init.content.bytes.byteLength <= this.maxTotalBytes) { totalBytes += init.content.bytes.byteLength; samples.push(init); }
        else { limitations.push(`The initialization segment for ${representation.id} exceeds the investigation byte budget.`); continue; }
      }
      const segmentIndexes = dashWindowIndexes(representation.segments, targetSeconds);
      for (const index of segmentIndexes) {
        const segment = representation.segments[index];
        if (!segment?.url) continue;
        const media = await this.fetch({
          logicalKey: `sample/dash/${safeKey(representation.id)}/media/${segment.number}`,
          kind: "media-segment", sourceManifestLogicalKey, sampleIndex: index, sequence: segment.number,
          declaredDuration: segment.presentationEndSeconds - segment.presentationStartSeconds,
          representationId: representation.id, periodIndex: representation.periodIndex, adaptationSetIndex: representation.adaptationSetIndex,
          presentationStartSeconds: segment.presentationStartSeconds, presentationEndSeconds: segment.presentationEndSeconds, url: segment.url,
        });
        if (targetSeconds !== undefined && segment.presentationStartSeconds <= targetSeconds && segment.presentationEndSeconds >= targetSeconds) {
          const observedHashes = await this.repeatHashes(segment.url, media.source!.sha256);
          media.source = { ...media.source!, observedHashes };
          if (new Set(observedHashes).size > 1) limitations.push(`Critical delivery evidence: ${representation.id} segment ${segment.number} returned different SHA-256 values across repeated requests.`);
        }
        if (totalBytes + media.content.bytes.byteLength > this.maxTotalBytes) { limitations.push(`DASH collection stopped before ${representation.id} segment ${segment.number}; the investigation byte budget was reached.`); break; }
        totalBytes += media.content.bytes.byteLength;
        samples.push(media);
      }
    }
    return { samples, limitations };
  }

  private async repeatHashes(url: string, firstHash: string): Promise<string[]> {
    const hashes = [firstHash];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.http.getBytes(url);
      hashes.push(createHash("sha256").update(response.bytes).digest("hex"));
    }
    return hashes;
  }
}

function sampleIndices(length: number): number[] {
  return [...new Set([0, Math.floor((length - 1) / 2), length - 1])];
}

function sampleKey(manifestKey: string, suffix: string): string {
  const role = manifestKey.replace(/^manifest\//, "");
  if (!role) throw new StreamCollectionError("UNSUPPORTED_MANIFEST", "The media manifest has no logical identity", false);
  return `sample/${role}/${suffix}`;
}

function selectDashRepresentations(
  video: import("../../stream-tools/dash-mpd.js").DashRepresentation[],
  audio: import("../../stream-tools/dash-mpd.js").DashRepresentation[],
): import("../../stream-tools/dash-mpd.js").DashRepresentation[] {
  const ordered = [...video].sort((left, right) => area(right) - area(left) || (right.bandwidth ?? 0) - (left.bandwidth ?? 0));
  const fourK = ordered.find((entry) => (entry.width ?? 0) >= 3000 || (entry.height ?? 0) >= 2000);
  const fullHd = ordered.find((entry) => (entry.width ?? 0) >= 1800 && (entry.width ?? 0) <= 2200 || (entry.height ?? 0) >= 1000 && (entry.height ?? 0) <= 1200);
  const intermediate = ordered.find((entry) => entry.id !== fourK?.id && entry.id !== fullHd?.id);
  const audioRepresentative = [...audio].sort((left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
  return [fourK, fullHd, intermediate, audioRepresentative].filter((entry): entry is import("../../stream-tools/dash-mpd.js").DashRepresentation => entry !== undefined);
}
function area(entry: import("../../stream-tools/dash-mpd.js").DashRepresentation): number { return (entry.width ?? 0) * (entry.height ?? 0); }
function dashWindowIndexes(segments: import("../../stream-tools/dash-mpd.js").DashSegmentReference[], targetSeconds: number | undefined): number[] {
  if (segments.length === 0) return [];
  if (targetSeconds === undefined) return [...new Set([0, Math.floor((segments.length - 1) / 2), segments.length - 1])];
  const center = segments.findIndex((segment) => segment.presentationStartSeconds <= targetSeconds && segment.presentationEndSeconds >= targetSeconds);
  const pivot = center === -1 ? segments.reduce((best, segment, index) => Math.abs(segment.presentationStartSeconds - targetSeconds) < Math.abs(segments[best]!.presentationStartSeconds - targetSeconds) ? index : best, 0) : center;
  const selected = new Set<number>();
  for (let index = Math.max(0, pivot - 5); index <= Math.min(segments.length - 1, pivot + 5); index += 1) selected.add(index);
  for (let index = pivot - 1; index >= 0 && targetSeconds - segments[index]!.presentationStartSeconds <= 30; index -= 1) selected.add(index);
  for (let index = pivot + 1; index < segments.length && segments[index]!.presentationEndSeconds - targetSeconds <= 30; index += 1) selected.add(index);
  return [...selected].sort((left, right) => left - right);
}
function safeKey(value: string): string { return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || "representation"; }
