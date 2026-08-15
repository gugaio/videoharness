import { StreamCollectionError } from "../../stream-tools/errors.js";
import { createHash } from "node:crypto";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type { MediaSample, MediaSampleCollector } from "../ports/media-sample-collector.js";
import type { CollectionProgress, Manifest, ManifestCollection } from "../ports/manifest-collector.js";
import type { ReportedContext } from "../application/parse-reported-context.js";

export class HttpMediaSampleCollector implements MediaSampleCollector {
  private readonly maxTotalBytes: number;
  private readonly maxSeconds: number;
  private readonly mode: "sample" | "full";

  constructor(private readonly http: SafeHttpClient, options: { maxTotalBytes?: number; maxSeconds?: number; mode?: "sample" | "full" } = {}) {
    this.maxTotalBytes = options.maxTotalBytes ?? 16_777_216;
    this.maxSeconds = options.maxSeconds ?? 60;
    this.mode = options.mode ?? "sample";
  }

  async collect(collection: ManifestCollection, onProgress?: (progress: CollectionProgress) => Promise<void>): Promise<{ samples: MediaSample[]; limitations: string[] }> {
    const targetSeconds = collection.reportedContext?.approximateTimeSeconds;
    const dashRoot = collection.manifests.find((manifest) => manifest.inspection.protocol === "dash");
    if (dashRoot?.inspection.dash) return this.collectDash(dashRoot.logicalKey, dashRoot.inspection.dash.representations, collection.reportedContext, onProgress);
    const hlsMediaCandidates = collection.manifests.filter((manifest) =>
      manifest.inspection.protocol === "hls" && manifest.inspection.hls?.kind === "media");
    const samples: MediaSample[] = [];
    const limitations: string[] = [];
    let totalBytes = 0;
    const rootMedia = hlsMediaCandidates.find((manifest) => manifest.role === "root");
    const candidates = rootMedia
      ? [rootMedia]
      : pickHlsVideoSamplingOrder(hlsMediaCandidates, collection);
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
        await onProgress?.({ stage: "media_sample", message: `Fetching the initialization segment of ${manifest.logicalKey}…` });
        let init: MediaSample;
        try {
          init = await this.fetch({
            logicalKey: sampleKey(manifest.logicalKey, "init"),
            kind: "init-segment",
            sourceManifestLogicalKey: manifest.logicalKey,
            url: hls.initSegment.url,
          });
        } catch (error) {
          await recordSampleFailure({
            error,
            subject: `The initialization segment of ${manifest.logicalKey}`,
            limitations,
            onProgress,
            resourceKind: "init_segment",
            logicalKey: manifest.logicalKey,
          });
          continue;
        }
        if (totalBytes + init.content.bytes.byteLength > this.maxTotalBytes) {
          limitations.push(`${manifest.logicalKey} init segment exceeds the investigation byte budget.`);
          continue;
        }
        totalBytes += init.content.bytes.byteLength;
        samples.push(init);
      }
      const window = this.mode === "full" ? this.hlsWindow(segments, hls, targetSeconds) : { indexes: sampleIndices(segments.length), timelineMapped: true };
      if (!window.timelineMapped) {
        limitations.push(`${manifest.logicalKey} declares no segment durations; the reported incident time could not be mapped, so the full playlist window was sampled.`);
      }
      const indexes = window.indexes;
      for (const [position, index] of indexes.entries()) {
        const segment = segments[index]!;
        if (!segment.url) continue;
        const sourceSegment = segment.sequence ?? index;
        await onProgress?.({ stage: "media_sample", message: `Sampling media sample ${position + 1} of ${indexes.length} from ${manifest.logicalKey} (source segment ${sourceSegment})…`, completed: position, total: indexes.length });
        let media: MediaSample;
        try {
          media = await this.fetch({
            logicalKey: sampleKey(manifest.logicalKey, `media/${index}`),
            kind: "media-segment",
            sourceManifestLogicalKey: manifest.logicalKey,
            sampleIndex: index,
            url: segment.url,
            ...(segment.sequence === undefined ? {} : { sequence: segment.sequence }),
            ...(segment.duration === undefined ? {} : { declaredDuration: segment.duration }),
          });
        } catch (error) {
          await recordSampleFailure({
            error,
            subject: `${manifest.logicalKey} source segment ${sourceSegment}`,
            limitations,
            onProgress,
            resourceKind: "media_segment",
            logicalKey: manifest.logicalKey,
            sourceSegment,
          });
          break;
        }
        if (totalBytes + media.content.bytes.byteLength > this.maxTotalBytes) {
          limitations.push(`${manifest.logicalKey} media sample collection stopped at segment ${index}; the investigation byte budget was reached.`);
          break;
        }
        totalBytes += media.content.bytes.byteLength;
        samples.push(media);
      }
    }
    return { samples, limitations };
  }

  private hlsWindow(
    segments: import("../../stream-tools/hls-manifest.js").HlsSegment[],
    manifest: import("../../stream-tools/hls-manifest.js").HlsManifestInspection,
    targetSeconds: number | undefined,
  ): { indexes: number[]; timelineMapped: boolean } {
    if (segments.length === 0) return { indexes: [], timelineMapped: true };
    const durationOf = (index: number): number => segments[index]!.duration ?? manifest.targetDuration ?? 0;
    const starts: number[] = [];
    const ends: number[] = [];
    let cursor = 0;
    for (let index = 0; index < segments.length; index += 1) {
      starts.push(cursor);
      cursor += durationOf(index);
      ends.push(cursor);
    }
    const total = cursor;
    if (total <= 0) return { indexes: segments.map((_, index) => index), timelineMapped: targetSeconds === undefined };
    const pivot = targetSeconds === undefined ? 0 : findPivotIndex(starts, targetSeconds);
    return { indexes: contiguousWindow(segments.length, starts, ends, pivot, this.maxSeconds), timelineMapped: true };
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
        ...(response.http ? { http: response.http } : {}),
      },
      content: { bytes: response.bytes },
    };
  }

  private async collectDash(
    sourceManifestLogicalKey: string,
    representations: import("../../stream-tools/dash-mpd.js").DashRepresentation[],
    reportedContext: ReportedContext | undefined,
    onProgress?: (progress: CollectionProgress) => Promise<void>,
  ): Promise<{ samples: MediaSample[]; limitations: string[] }> {
    const limitations: string[] = [];
    const samples: MediaSample[] = [];
    const targetSeconds = reportedContext?.approximateTimeSeconds;
    const video = representations.filter((entry) => entry.contentType === "video" && entry.segments.length > 0);
    const audio = representations.filter((entry) => entry.contentType === "audio" && entry.segments.length > 0);
    const selected = selectDashRepresentations(video, audio, reportedContext?.reportedResolutionTransition);
    if (selected.length === 0) return { samples, limitations: ["The DASH MPD has no expandable audio or video segment references."] };
    if (targetSeconds === undefined) limitations.push("No precise incident time was found in the user report; DASH samples use start, middle and end reference windows and cannot identify a specific switch boundary.");
    let totalBytes = 0;
    for (const representation of selected) {
      if (!representation.initializationUrl) limitations.push(`Representation ${representation.id} has no initialization URL in its SegmentTemplate.`);
      else {
        await onProgress?.({ stage: "media_sample", message: `Fetching the initialization segment of DASH representation ${representation.id}…` });
        let init: MediaSample;
        try {
          init = await this.fetch({ logicalKey: `sample/dash/${safeKey(representation.id)}/init`, kind: "init-segment", sourceManifestLogicalKey, representationId: representation.id, periodIndex: representation.periodIndex, adaptationSetIndex: representation.adaptationSetIndex, url: representation.initializationUrl });
        } catch (error) {
          await recordSampleFailure({
            error,
            subject: `The initialization segment of DASH representation ${representation.id}`,
            limitations,
            onProgress,
            resourceKind: "init_segment",
            representationId: representation.id,
          });
          continue;
        }
        if (totalBytes + init.content.bytes.byteLength <= this.maxTotalBytes) { totalBytes += init.content.bytes.byteLength; samples.push(init); }
        else { limitations.push(`The initialization segment for ${representation.id} exceeds the investigation byte budget.`); continue; }
      }
      const segmentIndexes = dashWindowIndexes(representation.segments, targetSeconds, this.maxSeconds);
      for (const [position, index] of segmentIndexes.entries()) {
        const segment = representation.segments[index];
        if (!segment?.url) continue;
        await onProgress?.({ stage: "media_sample", message: `Sampling media sample ${position + 1} of ${segmentIndexes.length} from DASH representation ${representation.id} (source segment ${segment.number})…`, completed: position, total: segmentIndexes.length });
        let media: MediaSample;
        try {
          media = await this.fetch({
            logicalKey: `sample/dash/${safeKey(representation.id)}/media/${segment.number}`,
            kind: "media-segment", sourceManifestLogicalKey, sampleIndex: index, sequence: segment.number,
            declaredDuration: segment.presentationEndSeconds - segment.presentationStartSeconds,
            representationId: representation.id, periodIndex: representation.periodIndex, adaptationSetIndex: representation.adaptationSetIndex,
            presentationStartSeconds: segment.presentationStartSeconds, presentationEndSeconds: segment.presentationEndSeconds, url: segment.url,
          });
        } catch (error) {
          await recordSampleFailure({
            error,
            subject: `DASH representation ${representation.id} source segment ${segment.number}`,
            limitations,
            onProgress,
            resourceKind: "media_segment",
            representationId: representation.id,
            sourceSegment: segment.number,
          });
          break;
        }
        if (targetSeconds !== undefined && segment.presentationStartSeconds <= targetSeconds && segment.presentationEndSeconds >= targetSeconds) {
          try {
            const observedHashes = await this.repeatHashes(segment.url, media.source!.sha256);
            media.source = { ...media.source!, observedHashes };
            if (new Set(observedHashes).size > 1) limitations.push(`Critical delivery evidence: ${representation.id} segment ${segment.number} returned different SHA-256 values across repeated requests.`);
          } catch (error) {
            await recordSampleFailure({
              error,
              subject: `Repeated hash observation for DASH representation ${representation.id} source segment ${segment.number}`,
              limitations,
              onProgress,
              resourceKind: "repeat_hash",
              representationId: representation.id,
              sourceSegment: segment.number,
            });
          }
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

function pickHlsVideoSamplingOrder(mediaCandidates: Manifest[], collection: ManifestCollection): Manifest[] {
  const videoVariants = mediaCandidates.filter((manifest) => manifest.role === "variant");
  const audioRenditions = mediaCandidates.filter((manifest) => manifest.role === "rendition");
  const root = collection.manifests.find((manifest) => manifest.role === "root");
  const declaredVariants = root?.inspection.hls?.variants ?? [];
  const selectedIndex = collection.hlsSelection?.variant.index;
  const selectedManifest = videoVariants.find((manifest) => manifest.logicalKey === `manifest/variant/${selectedIndex}`)
    ?? videoVariants.find((manifest) => manifest.logicalKey === "manifest/variant/0")
    ?? videoVariants[0];
  const orderedByBandwidth = [...declaredVariants]
    .filter((variant): variant is typeof variant & { url: string } => Boolean(variant.url))
    .sort((left, right) => (left.bandwidth ?? 0) - (right.bandwidth ?? 0));
  const position = selectedIndex === undefined ? -1 : orderedByBandwidth.findIndex((variant) => variant.index === selectedIndex);
  const neighbor = position === -1
    ? undefined
    : position > 0
      ? orderedByBandwidth[position - 1]
      : position + 1 < orderedByBandwidth.length
        ? orderedByBandwidth[position + 1]
        : undefined;
  const neighborManifest = neighbor
    ? videoVariants.find((manifest) => manifest.logicalKey === `manifest/variant/${neighbor.index}`)
    : undefined;
  const ordered = [selectedManifest, neighborManifest].filter((manifest): manifest is Manifest => manifest !== undefined);
  return [...new Map(ordered.map((manifest) => [manifest.logicalKey, manifest])).values()]
    .concat(audioRenditions);
}

function sampleKey(manifestKey: string, suffix: string): string {
  const role = manifestKey.replace(/^manifest\//, "");
  if (!role) throw new StreamCollectionError("UNSUPPORTED_MANIFEST", "The media manifest has no logical identity", false);
  return `sample/${role}/${suffix}`;
}

function selectDashRepresentations(
  video: import("../../stream-tools/dash-mpd.js").DashRepresentation[],
  audio: import("../../stream-tools/dash-mpd.js").DashRepresentation[],
  reportedResolutionTransition?: { sourceHeight: number; targetHeight: number },
): import("../../stream-tools/dash-mpd.js").DashRepresentation[] {
  const videoGroups = new Map<string, typeof video>();
  for (const entry of video) { const key = `${entry.periodIndex}:${entry.adaptationSetIndex}`; videoGroups.set(key, [...(videoGroups.get(key) ?? []), entry]); }
  const primaryGroup = [...videoGroups.values()].sort((left, right) => right.length - left.length || maxBandwidth(right) - maxBandwidth(left))[0] ?? [];
  const ordered = [...primaryGroup].sort((left, right) => (left.bandwidth ?? area(left)) - (right.bandwidth ?? area(right)) || area(left) - area(right));
  const reported = reportedResolutionTransition
    ? [reportedResolutionTransition.sourceHeight, reportedResolutionTransition.targetHeight].flatMap((height) => closestByHeight(ordered, height))
    : [];
  const spreadIndexes = evenlySpreadIndexes(ordered.length, Math.min(4, ordered.length));
  const spread = spreadIndexes.flatMap((index) => ordered[index] ? [ordered[index]!] : []);
  const primary = [...reported, ...spread].filter((entry, index, values) => values.findIndex((value) => value.id === entry.id) === index);
  const sameResolutionSibling = primary.flatMap((selected) => ordered.filter((entry) => entry.id !== selected.id && entry.width === selected.width && entry.height === selected.height)).sort((left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
  const selectedVideo = [...primary, ...(sameResolutionSibling ? [sameResolutionSibling] : [])].filter((entry, index, values) => values.findIndex((value) => value.id === entry.id) === index).slice(0, 5);
  const audioRepresentative = [...audio].sort((left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
  return [...selectedVideo, audioRepresentative].filter((entry): entry is import("../../stream-tools/dash-mpd.js").DashRepresentation => entry !== undefined);
}
function area(entry: import("../../stream-tools/dash-mpd.js").DashRepresentation): number { return (entry.width ?? 0) * (entry.height ?? 0); }
function maxBandwidth(entries: import("../../stream-tools/dash-mpd.js").DashRepresentation[]): number { return Math.max(0, ...entries.map((entry) => entry.bandwidth ?? 0)); }
function closestByHeight(entries: import("../../stream-tools/dash-mpd.js").DashRepresentation[], height: number): import("../../stream-tools/dash-mpd.js").DashRepresentation[] { const candidate = [...entries].sort((left, right) => Math.abs((left.height ?? 0) - height) - Math.abs((right.height ?? 0) - height) || (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0]; return candidate ? [candidate] : []; }
function evenlySpreadIndexes(length: number, count: number): number[] { if (length === 0 || count === 0) return []; if (count === 1) return [Math.floor((length - 1) / 2)]; return [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / (count - 1))))]; }
function dashWindowIndexes(segments: import("../../stream-tools/dash-mpd.js").DashSegmentReference[], targetSeconds: number | undefined, maxSeconds: number): number[] {
  if (segments.length === 0) return [];
  if (targetSeconds === undefined) {
    const middle = Math.floor((segments.length - 1) / 2);
    // Adjacent fragments are more useful for an ABR boundary than unrelated
    // start/middle/end fragments, while keeping the same bounded sample count.
    return [...new Set([Math.max(0, middle - 1), middle, Math.min(segments.length - 1, middle + 1)])];
  }
  const center = segments.findIndex((segment) => segment.presentationStartSeconds <= targetSeconds && segment.presentationEndSeconds >= targetSeconds);
  const pivot = center === -1 ? segments.reduce((best, segment, index) => Math.abs(segment.presentationStartSeconds - targetSeconds) < Math.abs(segments[best]!.presentationStartSeconds - targetSeconds) ? index : best, 0) : center;
  return contiguousWindow(
    segments.length,
    segments.map((segment) => segment.presentationStartSeconds),
    segments.map((segment) => segment.presentationEndSeconds),
    pivot,
    maxSeconds,
  );
}
function findPivotIndex(starts: number[], target: number): number {
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    if (starts[index]! <= target) return index;
  }
  return 0;
}
function contiguousWindow(length: number, starts: number[], ends: number[], pivot: number, maxSeconds: number): number[] {
  const selected = new Set<number>([pivot]);
  let left = pivot;
  let right = pivot;
  let accumulated = Math.max(0, ends[pivot]! - starts[pivot]!);
  const pivotCenter = (starts[pivot]! + ends[pivot]!) / 2;
  const centerDistance = (l: number, r: number): number => Math.abs((starts[l]! + ends[r]!) / 2 - pivotCenter);
  while (accumulated < maxSeconds) {
    const canLeft = left > 0;
    const canRight = right < length - 1;
    if (!canLeft && !canRight) break;
    const leftDistance = canLeft ? centerDistance(left - 1, right) : Infinity;
    const rightDistance = canRight ? centerDistance(left, right + 1) : Infinity;
    if (leftDistance <= rightDistance) { left -= 1; selected.add(left); accumulated += Math.max(0, ends[left]! - starts[left]!); }
    else { right += 1; selected.add(right); accumulated += Math.max(0, ends[right]! - starts[right]!); }
  }
  return [...selected].sort((leftIndex, rightIndex) => leftIndex - rightIndex);
}
function safeKey(value: string): string { return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || "representation"; }
function sampleFailure(error: unknown, subject: string): { errorCode: string; message: string } {
  if (!(error instanceof StreamCollectionError)) throw error;
  return { errorCode: error.code, message: `${subject} could not be sampled (${error.code}): ${error.message}` };
}
async function recordSampleFailure(input: {
  error: unknown;
  subject: string;
  limitations: string[];
  onProgress: ((progress: CollectionProgress) => Promise<void>) | undefined;
  resourceKind: NonNullable<CollectionProgress["limitation"]>["resourceKind"];
  logicalKey?: string;
  representationId?: string;
  sourceSegment?: number;
}): Promise<void> {
  const failure = sampleFailure(input.error, input.subject);
  input.limitations.push(`${failure.message}.`);
  await input.onProgress?.({
    stage: "media_sample",
    message: `${failure.message}. Remaining deterministic evidence will continue.`,
    limitation: {
      errorCode: failure.errorCode,
      resourceKind: input.resourceKind,
      ...(input.logicalKey ? { logicalKey: input.logicalKey } : {}),
      ...(input.representationId ? { representationId: input.representationId } : {}),
      ...(input.sourceSegment === undefined ? {} : { sourceSegment: input.sourceSegment }),
    },
  });
}
