import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import { inspectManifest } from "../../stream-tools/manifest.js";
import type { DashRepresentation, DashSegmentReference } from "../../stream-tools/dash-mpd.js";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type { RecordedResource, RecordedResourceKind } from "../domain/recorded-resource.js";
import type { MaterializedRecording, RecordingMaterializer } from "../ports/recording-materializer.js";

type Target = { id: string; kind: "video" | "audio"; source: DashRepresentation };
type Selection = { segment: DashSegmentReference; start: number; end: number };

/** Clones the explicitly supported static DASH SegmentTemplate subset into a local MPD. */
export class DashVodMaterializer implements RecordingMaterializer {
  constructor(private readonly http: SafeHttpClient, private readonly options: { maxVariants?: number; maxTotalBytes?: number; maxConcurrentDownloads?: number } = {}) {}

  async materialize(input: Parameters<RecordingMaterializer["materialize"]>[0]): Promise<MaterializedRecording> {
    if (input.job.recording.protocol !== "dash") throw unsupported("Only DASH recordings are supported by this collector");
    const response = await this.http.getText(input.job.recording.sourceUrl);
    const root = inspectManifest(response.text, response.finalUrl);
    if (root.protocol !== "dash" || root.kind !== "mpd" || !root.dash) throw unsupported("Record DASH requires an MPD");
    if (root.dash.type !== "static") throw unsupported("Record DASH supports static MPDs only");
    if (/<(?:[A-Za-z_][\w.-]*:)?ContentProtection\b/i.test(response.text)) throw unsupported("Record DASH does not support protected content");
    if (/<(?:[A-Za-z_][\w.-]*:)?SegmentBase\b/i.test(response.text)) throw unsupported("Record DASH requires SegmentTemplate, not SegmentBase");

    const targets = selectTargets(root.dash.representations, this.options.maxVariants ?? 8);
    const selected = targets.map((target) => ({ target, segments: selectWindow(target.source.segments, input.job.recording.requestedStartSeconds, input.job.recording.requestedDurationSeconds) }));
    if (selected.some((entry) => !entry.target.source.initializationUrl || entry.segments.length === 0)) throw unsupported("Every DASH representation needs an init segment and media in the requested window");
    const coverageSeconds = Math.min(...selected.map((entry) => entry.segments.at(-1)!.end - entry.segments[0]!.start));
    assertEstimatedSize(selected, this.options.maxTotalBytes ?? 1_073_741_824);
    const resources: RecordedResource[] = [];
    let totalBytes = 0;

    for (const entry of selected) {
      const { target, segments } = entry;
      await input.onProgress?.({ type: "recording.variant_started", message: `Recording ${target.id}: ${segments.length} chunks in the requested window.`, payload: { targetId: target.id, targetKind: target.kind, segmentCount: segments.length } });
      const init = await this.http.getBytes(target.source.initializationUrl!);
      const initPath = `${target.id}/init.mp4`;
      await writeWorkspaceFile(input.workspace.path, initPath, init.bytes);
      totalBytes = addBytes(totalBytes, init.bytes.byteLength, this.options.maxTotalBytes ?? 1_073_741_824);
      resources.push(resource(input.job.recording.id, initPath, "init-segment", init.bytes, contentType(target.kind), metadata(target, undefined)));

      const downloaded = await mapConcurrent(segments, this.options.maxConcurrentDownloads ?? 3, async (selection) => {
        if (!selection.segment.url || selection.segment.range) throw unsupported(`DASH ${target.id} uses an unresolved URL or byte range`);
        const bytes = await this.http.getBytes(selection.segment.url);
        const logicalPath = `${target.id}/segments/${selection.segment.number}.m4s`;
        await writeWorkspaceFile(input.workspace.path, logicalPath, bytes.bytes);
        return { bytes: bytes.bytes, logicalPath, selection };
      });
      for (const item of downloaded) {
        totalBytes = addBytes(totalBytes, item.bytes.byteLength, this.options.maxTotalBytes ?? 1_073_741_824);
        resources.push(resource(input.job.recording.id, item.logicalPath, target.kind === "video" ? "video-segment" : "audio-segment", item.bytes, contentType(target.kind), metadata(target, item.selection)));
      }
      await input.onProgress?.({ type: "recording.variant_completed", message: `Recorded ${target.id}: ${segments.length} chunks stored.`, payload: { targetId: target.id, targetKind: target.kind, segmentCount: segments.length } });
    }

    const mpdBytes = new TextEncoder().encode(buildMpd(selected, coverageSeconds));
    totalBytes = addBytes(totalBytes, mpdBytes.byteLength, this.options.maxTotalBytes ?? 1_073_741_824);
    await writeWorkspaceFile(input.workspace.path, "index.mpd", mpdBytes);
    resources.push(resource(input.job.recording.id, "index.mpd", "master", mpdBytes, "application/dash+xml", { variantCount: selected.filter((entry) => entry.target.kind === "video").length, audioRenditionCount: selected.filter((entry) => entry.target.kind === "audio").length }));
    return { coverageSeconds, totalBytes, resources };
  }
}

function selectTargets(representations: DashRepresentation[], maxVariants: number): Target[] {
  const videoGroups = groupBy(representations.filter((item) => item.contentType === "video"), (item) => `${item.periodIndex}:${item.adaptationSetIndex}`);
  const video = [...videoGroups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  if (video.length < 2) throw unsupported("Record DASH requires two video representations in one adaptation set for ABR");
  if (video.length > maxVariants) throw unsupported(`The DASH adaptation set exceeds the ${maxVariants} representation limit`);
  const audioGroups = groupBy(representations.filter((item) => item.contentType === "audio"), (item) => `${item.periodIndex}:${item.adaptationSetIndex}`);
  const audio = [...audioGroups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return [...video.map((source, index) => ({ id: `video-${index}`, kind: "video" as const, source })), ...audio.map((source, index) => ({ id: `audio-${index}`, kind: "audio" as const, source }))];
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

function metadata(target: Target, selection: Selection | undefined): Record<string, unknown> {
  return { targetId: target.id, representationId: target.source.id, kind: target.kind, ...(selection ? { mediaSequence: selection.segment.number, durationSeconds: Number(selection.segment.duration) / target.source.timescale, timelineStartSeconds: selection.start, timelineEndSeconds: selection.end } : {}), ...(target.kind === "video" ? { bandwidth: target.source.bandwidth, resolution: target.source.width && target.source.height ? `${target.source.width}x${target.source.height}` : undefined, codecs: target.source.codecs } : {}) };
}
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
async function mapConcurrent<Input, Output>(values: Input[], limit: number, mapper: (value: Input) => Promise<Output>): Promise<Output[]> { const results = new Array<Output>(values.length); let next = 0; await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => { for (;;) { const index = next++; if (index >= values.length) return; results[index] = await mapper(values[index]!); } })); return results; }
