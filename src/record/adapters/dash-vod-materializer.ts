import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import { inspectManifest } from "../../stream-tools/manifest.js";
import type { DashRepresentation, DashSegmentReference } from "../../stream-tools/dash-mpd.js";
import { inspectFmp4Fragment, inspectFmp4Init, type Fmp4FragmentInspection, type Fmp4InitInspection } from "../../stream-tools/isobmff.js";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type { RecordedResource, RecordedResourceKind } from "../domain/recorded-resource.js";
import type { MaterializedRecording, RecordingMaterializer } from "../ports/recording-materializer.js";

type Target = { id: string; kind: "video" | "audio"; source: DashRepresentation };
type Selection = { segment: DashSegmentReference; start: number; end: number };

/** Clones the explicitly supported static DASH SegmentTemplate subset into a local MPD. */
export class DashVodMaterializer implements RecordingMaterializer {
  constructor(private readonly http: SafeHttpClient, private readonly options: { maxVariants?: number; maxTotalBytes?: number; maxConcurrentDownloads?: number; maxRequestAttempts?: number; retryDelayMs?: number } = {}) {}

  async materialize(input: Parameters<RecordingMaterializer["materialize"]>[0]): Promise<MaterializedRecording> {
    if (input.job.recording.protocol !== "dash") throw unsupported("Only DASH recordings are supported by this collector");
    const response = await this.http.getText(input.job.recording.sourceUrl);
    const root = inspectManifest(response.text, response.finalUrl);
    if (root.protocol !== "dash" || root.kind !== "mpd" || !root.dash) throw unsupported("Record DASH requires an MPD");
    if (root.dash.type !== "static") throw unsupported("Record DASH supports static MPDs only");
    if (/<(?:[A-Za-z_][\w.-]*:)?ContentProtection\b/i.test(response.text)) throw unsupported("Record DASH does not support protected content");
    if (/<(?:[A-Za-z_][\w.-]*:)?SegmentBase\b/i.test(response.text)) throw unsupported("Record DASH requires SegmentTemplate, not SegmentBase");

    const targets = selectTargets(root.dash.representations, this.options.maxVariants ?? 32, input.job.recording.clonePlan);
    const selected = targets.map((target) => ({ target, segments: selectWindow(target.source.segments, input.job.recording.requestedStartSeconds, input.job.recording.requestedDurationSeconds) }));
    if (selected.some((entry) => !entry.target.source.initializationUrl || entry.segments.length === 0)) throw unsupported("Every DASH representation needs an init segment and media in the requested window");
    const coverageSeconds = Math.min(...selected.map((entry) => entry.segments.at(-1)!.end - entry.segments[0]!.start));
    assertEstimatedSize(selected, this.options.maxTotalBytes ?? 1_073_741_824);
    const resources: RecordedResource[] = [];
    let totalBytes = 0;

    for (const entry of selected) {
      const { target, segments } = entry;
      await input.onProgress?.({ type: "recording.variant_started", message: `Recording ${target.id}: ${segments.length} chunks in the requested window.`, payload: { targetId: target.id, targetKind: target.kind, segmentCount: segments.length } });
      const init = await this.getBytesWithRetry(target.source.initializationUrl!, input.onProgress, { targetId: target.id, targetKind: target.kind, resourceKind: "init_segment" });
      const initPath = `${target.id}/init.mp4`;
      await writeWorkspaceFile(input.workspace.path, initPath, init.bytes);
      totalBytes = addBytes(totalBytes, init.bytes.byteLength, this.options.maxTotalBytes ?? 1_073_741_824);
      const initInspection = inspectFmp4Init(init.bytes);
      resources.push(resource(input.job.recording.id, initPath, "init-segment", init.bytes, contentType(target.kind), metadata(target, undefined, { init: initInspection })));

      const downloaded = await mapConcurrent(segments, this.options.maxConcurrentDownloads ?? 3, async (selection) => {
        if (!selection.segment.url || selection.segment.range) throw unsupported(`DASH ${target.id} uses an unresolved URL or byte range`);
        const bytes = await this.getBytesWithRetry(selection.segment.url, input.onProgress, { targetId: target.id, targetKind: target.kind, resourceKind: "media_segment", sourceSegment: selection.segment.number });
        const logicalPath = `${target.id}/segments/${selection.segment.number}.m4s`;
        await writeWorkspaceFile(input.workspace.path, logicalPath, bytes.bytes);
        return { bytes: bytes.bytes, logicalPath, selection, fragment: inspectFmp4Fragment(bytes.bytes, initInspection.nalLengthSize ?? 4) };
      });
      for (const item of downloaded) {
        totalBytes = addBytes(totalBytes, item.bytes.byteLength, this.options.maxTotalBytes ?? 1_073_741_824);
        resources.push(resource(input.job.recording.id, item.logicalPath, target.kind === "video" ? "video-segment" : "audio-segment", item.bytes, contentType(target.kind), metadata(target, item.selection, { fragment: projectFragment(item.fragment) })));
      }
      await input.onProgress?.({ type: "recording.variant_completed", message: `Recorded ${target.id}: ${segments.length} chunks stored.`, payload: { targetId: target.id, targetKind: target.kind, segmentCount: segments.length } });
    }

    const mpdBytes = new TextEncoder().encode(buildMpd(selected, coverageSeconds));
    totalBytes = addBytes(totalBytes, mpdBytes.byteLength, this.options.maxTotalBytes ?? 1_073_741_824);
    await writeWorkspaceFile(input.workspace.path, "index.mpd", mpdBytes);
    const selectedVideo = selected.filter((entry) => entry.target.kind === "video");
    const sourceAdaptation = root.dash.adaptationSets.find((adaptation) => adaptation.periodIndex === selectedVideo[0]?.target.source.periodIndex && adaptation.index === selectedVideo[0]?.target.source.adaptationSetIndex);
    resources.push(resource(input.job.recording.id, "index.mpd", "master", mpdBytes, "application/dash+xml", { variantCount: selectedVideo.length, audioRenditionCount: selected.filter((entry) => entry.target.kind === "audio").length, ...(sourceAdaptation ? { switchingContract: { ...sourceAdaptation.switchingContract, representations: selectedVideo.map((entry) => entry.target.id) } } : {}), representations: selectedVideo.map((entry) => representationMetadata(entry.target)) }));
    return { coverageSeconds, totalBytes, resources };
  }

  private async getBytesWithRetry(
    url: string,
    onProgress: Parameters<RecordingMaterializer["materialize"]>[0]["onProgress"],
    context: { targetId: string; targetKind: "video" | "audio"; resourceKind: "init_segment" | "media_segment"; sourceSegment?: number },
  ) {
    const maxAttempts = Math.max(1, Math.min(4, this.options.maxRequestAttempts ?? 3));
    const retryDelayMs = Math.max(0, Math.min(2_000, this.options.retryDelayMs ?? 250));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.http.getBytes(url);
      } catch (error) {
        if (!(error instanceof StreamCollectionError) || !error.retryable || attempt === maxAttempts) throw error;
        await onProgress?.({
          type: "recording.resource_retry",
          message: `Retrying ${context.resourceKind === "init_segment" ? "init" : `segment ${context.sourceSegment}`} for ${context.targetId} after ${error.code}.`,
          payload: { ...context, errorCode: error.code, nextAttempt: attempt + 1, maxAttempts },
        });
        if (retryDelayMs > 0) await delay(retryDelayMs * attempt);
      }
    }
    throw new Error("DASH resource retry loop ended unexpectedly");
  }
}

function selectTargets(representations: DashRepresentation[], maxVariants: number, plan?: import("../../experiment/domain/clone-spec.js").CloneExecutionPlan): Target[] {
  const videoGroups = groupBy(representations.filter((item) => item.contentType === "video"), (item) => `${item.periodIndex}:${item.adaptationSetIndex}`);
  const sourceVideo = [...videoGroups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  if (sourceVideo.length < 2) throw unsupported("Record DASH requires two video representations in one adaptation set for ABR");
  const video = plan ? sourceVideo.filter((item) => plan.selection.videoRepresentationIds.includes(item.id)) : sourceVideo;
  if (video.length === 0) throw unsupported("The CloneSpec did not select a DASH video representation");
  if (video.length > maxVariants) throw unsupported(`The selected DASH ladder exceeds the ${maxVariants} representation safety limit`);
  const audioGroups = groupBy(representations.filter((item) => item.contentType === "audio"), (item) => `${item.periodIndex}:${item.adaptationSetIndex}`);
  const sourceAudio = [...audioGroups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const audio = plan?.selection.audioMode === "single" ? sourceAudio.slice(0, 1) : sourceAudio;
  return [
    ...video.map((source) => ({ id: `video-${sourceVideo.indexOf(source)}`, kind: "video" as const, source })),
    ...audio.map((source) => ({ id: `audio-${sourceAudio.indexOf(source)}`, kind: "audio" as const, source })),
  ];
}

function selectWindow(segments: DashSegmentReference[], startSeconds: number, durationSeconds: number): Selection[] {
  const end = startSeconds + durationSeconds;
  return segments.filter((segment) => segment.presentationEndSeconds > startSeconds && segment.presentationStartSeconds < end)
    .map((segment) => ({ segment, start: segment.presentationStartSeconds, end: segment.presentationEndSeconds }));
}

function buildMpd(entries: Array<{ target: Target; segments: Selection[] }>, coverageSeconds: number): string {
  const video = entries.filter((entry) => entry.target.kind === "video");
  const audio = entries.filter((entry) => entry.target.kind === "audio");
  const adaptation = (kind: "video" | "audio", group: typeof video): string => {
    if (group.length === 0) return "";
    return `<AdaptationSet contentType="${kind}" mimeType="${kind}/mp4" segmentAlignment="true">${group.map(({ target, segments }) => representationXml(target, segments)).join("")}</AdaptationSet>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${coverageSeconds.toFixed(3)}S" minBufferTime="PT1.5S"><Period duration="PT${coverageSeconds.toFixed(3)}S">${adaptation("video", video)}${adaptation("audio", audio)}</Period></MPD>`;
}

function representationXml(target: Target, segments: Selection[]): string {
  const source = target.source;
  const first = segments[0]!.segment;
  const timeline = segments.map(({ segment }) => `<S t="${segment.time}" d="${segment.duration}"/>`).join("");
  const attrs = [`id="${escapeXml(target.id)}"`, `bandwidth="${source.bandwidth ?? 1}"`];
  if (target.kind === "video" && source.width) attrs.push(`width="${source.width}"`);
  if (target.kind === "video" && source.height) attrs.push(`height="${source.height}"`);
  if (source.codecs) attrs.push(`codecs="${escapeXml(source.codecs)}"`);
  // The copied window starts at presentation time zero even when its source
  // timeline starts later. Keeping source S@t preserves media timestamps while
  // rebasing the presentation-time offset for the local Period.
  return `<Representation ${attrs.join(" ")}><SegmentTemplate timescale="${source.timescale}" presentationTimeOffset="${first.time}" startNumber="${first.number}" initialization="${target.id}/init.mp4" media="${target.id}/segments/$Number$.m4s"><SegmentTimeline>${timeline}</SegmentTimeline></SegmentTemplate></Representation>`;
}

function metadata(target: Target, selection: Selection | undefined, diagnostic: { init?: Fmp4InitInspection; fragment?: Record<string, unknown> }): Record<string, unknown> {
  return { ...representationMetadata(target), ...(selection ? { mediaSequence: selection.segment.number, durationSeconds: Number(selection.segment.duration) / target.source.timescale, timelineStartSeconds: selection.start, timelineEndSeconds: selection.end } : {}), ...diagnostic };
}
function representationMetadata(target: Target): Record<string, unknown> { return { targetId: target.id, representationId: target.source.id, kind: target.kind, periodIndex: target.source.periodIndex, adaptationSetIndex: target.source.adaptationSetIndex, timescale: target.source.timescale, presentationTimeOffset: String(target.source.presentationTimeOffset), ...(target.kind === "video" ? { bandwidth: target.source.bandwidth, width: target.source.width, height: target.source.height, resolution: target.source.width && target.source.height ? `${target.source.width}x${target.source.height}` : undefined, frameRate: target.source.frameRate, codecs: target.source.codecs } : {}) }; }
function projectFragment(fragment: Fmp4FragmentInspection): Record<string, unknown> { return { ...(fragment.styp ? { styp: fragment.styp } : {}), ...(fragment.sidx ? { sidx: fragment.sidx } : {}), ...(fragment.sequenceNumber === undefined ? {} : { sequenceNumber: fragment.sequenceNumber }), ...(fragment.baseMediaDecodeTime === undefined ? {} : { baseMediaDecodeTime: String(fragment.baseMediaDecodeTime) }), trafs: fragment.trafs, sampleCount: fragment.samples.length, boundarySamples: boundaryItems(fragment.samples).map((sample) => ({ dts: String(sample.dts), pts: String(sample.pts), ...(sample.duration === undefined ? {} : { duration: String(sample.duration) }), ...(sample.size === undefined ? {} : { size: sample.size }), ...(sample.flags === undefined ? {} : { flags: sample.flags }), ...(sample.sync === undefined ? {} : { sync: sample.sync }), ...(sample.compositionOffset === undefined ? {} : { compositionOffset: String(sample.compositionOffset) }), nalTypes: sample.nalTypes, accessUnit: sample.accessUnit })), drmBoxTypes: fragment.drmBoxTypes, structuralErrors: fragment.structuralErrors }; }
function boundaryItems<T>(values: T[]): T[] { return values.length <= 6 ? values : [...values.slice(0, 3), ...values.slice(-3)]; }
function contentType(kind: "video" | "audio"): string { return kind === "video" ? "video/mp4" : "audio/mp4"; }
function resource(recordingId: string, logicalPath: string, kind: RecordedResourceKind, bytes: Uint8Array, contentTypeValue: string, metadataValue: Record<string, unknown>): RecordedResource { return { id: randomUUID(), logicalPath, kind, storageKey: path.posix.join("recordings", recordingId, logicalPath), contentType: contentTypeValue, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), metadata: metadataValue }; }
function addBytes(current: number, next: number, max: number): number { const total = current + next; if (total > max) throw new StreamCollectionError("STREAM_RESPONSE_TOO_LARGE", "The recording exceeds the aggregate byte limit", false); return total; }
function assertEstimatedSize(entries: Array<{ target: Target; segments: Selection[] }>, maxBytes: number): void {
  const estimateBytes = entries.reduce((total, { target, segments }) => total + (target.source.bandwidth ?? 0) * segments.reduce((duration, segment) => duration + (segment.end - segment.start), 0) / 8, 0);
  if (estimateBytes > maxBytes) {
    throw new StreamCollectionError("STREAM_RESPONSE_TOO_LARGE", `The requested DASH ladder is estimated at ${formatGiB(estimateBytes)}, above the ${formatGiB(maxBytes)} recording limit. Choose a shorter window.`, false);
  }
}
function formatGiB(bytes: number): string { return `${(bytes / 1_073_741_824).toFixed(2)} GiB`; }
async function writeWorkspaceFile(workspace: string, logicalPath: string, bytes: Uint8Array): Promise<void> { const root = path.resolve(workspace); const destination = path.resolve(root, logicalPath); if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Recording resource path is invalid"); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes, { flag: "wx" }); }
function unsupported(message: string): StreamCollectionError { return new StreamCollectionError("UNSUPPORTED_MANIFEST", message, false); }
function escapeXml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!); }
function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> { const result = new Map<string, T[]>(); for (const value of values) result.set(key(value), [...(result.get(key(value)) ?? []), value]); return result; }
async function mapConcurrent<Input, Output>(values: Input[], limit: number, mapper: (value: Input) => Promise<Output>): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!);
    }
  });
  // Promise.all rejects as soon as one download fails, leaving sibling workers
  // writing into a workspace that the recording worker may already be cleaning
  // and recreating for a retry. Settle every in-flight worker before exposing
  // the failure so no previous attempt can write into the next attempt.
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  if (failure) throw failure.reason;
  return results;
}
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
