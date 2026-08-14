import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import { inspectManifest } from "../../stream-tools/manifest.js";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type { HlsManifestInspection, HlsRendition, HlsSegment, HlsVariant } from "../../stream-tools/hls-manifest.js";
import type { RecordedResource, RecordedResourceKind } from "../domain/recorded-resource.js";
import type { RecordingMaterializer, MaterializedRecording } from "../ports/recording-materializer.js";

type MediaTarget = { id: string; kind: "video" | "audio"; sourceUrl: string; source: HlsVariant | HlsRendition };
type SelectedSegment = { segment: HlsSegment; timelineStartSeconds: number; timelineEndSeconds: number };

/**
 * HLS VOD clear/MPEG-TS clone. Adapted from the VHS clone concepts; see
 * record/README.md for provenance. It intentionally rejects unsupported HLS
 * features instead of exposing a partial or origin-backed recording.
 */
export class HlsVodMaterializer implements RecordingMaterializer {
  private readonly maxVariants: number;
  private readonly maxTotalBytes: number;
  private readonly maxConcurrentDownloads: number;

  constructor(private readonly http: SafeHttpClient, options: { maxVariants?: number; maxTotalBytes?: number; maxConcurrentDownloads?: number } = {}) {
    this.maxVariants = options.maxVariants ?? 8;
    this.maxTotalBytes = options.maxTotalBytes ?? 1_073_741_824;
    this.maxConcurrentDownloads = options.maxConcurrentDownloads ?? 3;
  }

  async materialize(input: Parameters<RecordingMaterializer["materialize"]>[0]): Promise<MaterializedRecording> {
    if (input.job.recording.protocol !== "hls") throw unsupported("Only HLS recordings are supported in R1");
    const rootResponse = await this.http.getText(input.job.recording.sourceUrl);
    const root = inspectManifest(rootResponse.text, rootResponse.finalUrl);
    if (root.protocol !== "hls" || root.kind !== "master" || !root.hls) throw unsupported("Record R1 requires an HLS master playlist");
    const hls = root.hls;
    const sourceVariants = hls.variants
      .map((variant, sourceIndex) => ({ variant, sourceIndex }))
      .filter((entry): entry is { variant: HlsVariant & { url: string }; sourceIndex: number } => Boolean(entry.variant.url));
    if (sourceVariants.length < 2) throw unsupported("Record R1 requires at least two fetchable video variants for ABR");
    if (sourceVariants.length > this.maxVariants) throw unsupported(`The HLS master exceeds the ${this.maxVariants} variant limit`);
    const requestedIds = input.job.recording.clonePlan?.selection.videoRepresentationIds;
    const variants = requestedIds
      ? sourceVariants.filter((entry) => requestedIds.includes(`variant-${entry.sourceIndex}`))
      : sourceVariants;
    if (variants.length === 0) throw unsupported("The CloneSpec did not select a fetchable HLS video variant");

    const targets: MediaTarget[] = [
      ...variants.map(({ variant: source, sourceIndex }) => ({ id: `video-${sourceIndex}`, kind: "video" as const, sourceUrl: source.url, source })),
      ...selectAudio(linkedAudioRenditions(hls, variants.map((entry) => entry.variant)), input.job.recording.clonePlan?.selection.audioMode)
        .map(({ source, index }) => ({ id: `audio-${index}`, kind: "audio" as const, sourceUrl: source.url!, source })),
    ];
    const resources: RecordedResource[] = [];
    let totalBytes = 0;
    const coverage: number[] = [];
    const localPlaylists: Array<{ target: MediaTarget; localPath: string }> = [];

    for (const target of targets) {
      const response = await this.http.getText(target.sourceUrl);
      const inspection = inspectManifest(response.text, response.finalUrl);
      if (inspection.protocol !== "hls" || inspection.kind !== "media" || !inspection.hls) {
        throw unsupported(`The ${target.kind} playlist ${target.id} is not an HLS media playlist`);
      }
      const media = inspection.hls;
      assertSupportedMedia(media, target.id);
      const selected = selectWindow(media, input.job.recording.requestedStartSeconds, input.job.recording.requestedDurationSeconds);
      if (selected.length === 0) throw unsupported(`The ${target.kind} playlist ${target.id} has no segments in the requested window`);
      await input.onProgress?.({ type: "recording.variant_started", message: `Recording ${target.id}: ${selected.length} chunks in the requested window.`, payload: { targetId: target.id, targetKind: target.kind, segmentCount: selected.length } });
      const localPath = target.kind === "video" ? `variants/${target.id}/index.m3u8` : `renditions/${target.id}/index.m3u8`;
      const downloaded = await mapConcurrent(selected, this.maxConcurrentDownloads, async (selection, index) => {
        if (!selection.segment.url) throw unsupported(`The ${target.kind} playlist ${target.id} has an unresolved segment URL`);
        const bytes = await this.http.getBytes(selection.segment.url);
        const sequence = selection.segment.sequence ?? index;
        const segmentPath = `${path.dirname(localPath)}/segments/${sequence}.ts`;
        await writeWorkspaceFile(input.workspace.path, segmentPath, bytes.bytes);
        return { bytes: bytes.bytes, sequence, segmentPath, playlistPath: `segments/${sequence}.ts`, selection };
      });
      for (const item of downloaded) {
        totalBytes += item.bytes.byteLength;
        if (totalBytes > this.maxTotalBytes) throw new StreamCollectionError("STREAM_RESPONSE_TOO_LARGE", "The recording exceeds the aggregate byte limit", false);
        resources.push(resource(input.job.recording.id, item.segmentPath, target.kind === "video" ? "video-segment" : "audio-segment", item.bytes, "video/mp2t", {
          targetId: target.id, mediaSequence: item.sequence, durationSeconds: item.selection.segment.duration, timelineStartSeconds: item.selection.timelineStartSeconds, timelineEndSeconds: item.selection.timelineEndSeconds,
          ...(target.kind === "video" ? { sourceRepresentationId: `variant-${target.id.slice("video-".length)}`, bandwidth: (target.source as HlsVariant).bandwidth, resolution: (target.source as HlsVariant).resolution, codecs: (target.source as HlsVariant).codecs } : {}),
        }));
      }
      const playlist = buildMediaPlaylist(media, selected, downloaded.map((item) => item.playlistPath));
      const playlistBytes = new TextEncoder().encode(playlist);
      totalBytes += playlistBytes.byteLength;
      await writeWorkspaceFile(input.workspace.path, localPath, playlistBytes);
      resources.push(resource(input.job.recording.id, localPath, "media-playlist", playlistBytes, "application/vnd.apple.mpegurl", {
        targetId: target.id, kind: target.kind,
        ...(target.kind === "video" ? { sourceRepresentationId: `variant-${target.id.slice("video-".length)}`, bandwidth: (target.source as HlsVariant).bandwidth, resolution: (target.source as HlsVariant).resolution, codecs: (target.source as HlsVariant).codecs } : {}),
      }));
      localPlaylists.push({ target, localPath });
      coverage.push(selected[selected.length - 1]!.timelineEndSeconds - selected[0]!.timelineStartSeconds);
      await input.onProgress?.({ type: "recording.variant_completed", message: `Recorded ${target.id}: ${selected.length} chunks stored.`, payload: { targetId: target.id, targetKind: target.kind, segmentCount: selected.length } });
    }

    const master = buildMasterPlaylist(localPlaylists);
    const masterBytes = new TextEncoder().encode(master);
    totalBytes += masterBytes.byteLength;
    await writeWorkspaceFile(input.workspace.path, "index.m3u8", masterBytes);
    resources.push(resource(input.job.recording.id, "index.m3u8", "master", masterBytes, "application/vnd.apple.mpegurl", { variantCount: variants.length, audioRenditionCount: targets.length - variants.length }));
    return { coverageSeconds: Math.min(...coverage), totalBytes, resources };
  }
}

function selectAudio(entries: Array<{ source: HlsRendition; index: number }>, mode: "preserve" | "single" | undefined): Array<{ source: HlsRendition; index: number }> {
  return mode === "single" ? entries.slice(0, 1) : entries;
}

function linkedAudioRenditions(master: HlsManifestInspection, variants: HlsVariant[]): Array<{ source: HlsRendition; index: number }> {
  const groups = new Set(variants.map((variant) => variant.audioGroupId).filter((value): value is string => Boolean(value)));
  return master.renditions.filter((rendition): rendition is HlsRendition & { url: string; groupId: string } =>
    rendition.type.toUpperCase() === "AUDIO" && Boolean(rendition.url) && rendition.groupId !== undefined && groups.has(rendition.groupId))
    .map((source, index) => ({ source, index }));
}

function assertSupportedMedia(media: HlsManifestInspection, id: string): void {
  if (!media.hasEndList) throw unsupported(`${id} is not an HLS VOD playlist`);
  if (media.encryptionMethod) throw unsupported(`${id} uses ${media.encryptionMethod} encryption`);
  if (media.initSegment || media.segments?.some((segment) => segment.byteRange)) throw unsupported(`${id} uses fMP4 maps or byte ranges, which are outside Record R1`);
}

function selectWindow(media: HlsManifestInspection, startSeconds: number, durationSeconds: number): SelectedSegment[] {
  const selected: SelectedSegment[] = [];
  let cursor = 0;
  const end = startSeconds + durationSeconds;
  for (const segment of media.segments ?? []) {
    const start = cursor;
    cursor += segment.duration ?? media.targetDuration ?? 0;
    if (cursor <= startSeconds) continue;
    if (start >= end && selected.length > 0) break;
    selected.push({ segment, timelineStartSeconds: start, timelineEndSeconds: cursor });
    if (cursor >= end) break;
  }
  return selected;
}

function buildMediaPlaylist(media: HlsManifestInspection, selected: SelectedSegment[], paths: string[]): string {
  const first = selected[0]!.segment.sequence ?? 0;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(media.targetDuration ?? 1)}`, `#EXT-X-MEDIA-SEQUENCE:${first}`];
  for (let index = 0; index < selected.length; index += 1) {
    const selection = selected[index]!;
    if (selection.segment.discontinuity) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXTINF:${(selection.segment.duration ?? media.targetDuration ?? 1).toFixed(3)},`);
    lines.push(paths[index]!);
  }
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}

function buildMasterPlaylist(playlists: Array<{ target: MediaTarget; localPath: string }>): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  const audio = playlists.filter((entry) => entry.target.kind === "audio");
  for (const entry of audio) {
    const rendition = entry.target.source as HlsRendition;
    const attrs = [`TYPE=AUDIO`, `GROUP-ID=${quote(rendition.groupId ?? "audio")}`, `NAME=${quote(rendition.name ?? entry.target.id)}`, `URI=${quote(entry.localPath)}`];
    if (rendition.language) attrs.push(`LANGUAGE=${quote(rendition.language)}`);
    if (rendition.default !== undefined) attrs.push(`DEFAULT=${rendition.default ? "YES" : "NO"}`);
    if (rendition.autoselect !== undefined) attrs.push(`AUTOSELECT=${rendition.autoselect ? "YES" : "NO"}`);
    lines.push(`#EXT-X-MEDIA:${attrs.join(",")}`);
  }
  const audioGroups = new Set(audio.map((entry) => (entry.target.source as HlsRendition).groupId).filter((value): value is string => Boolean(value)));
  for (const entry of playlists.filter((candidate) => candidate.target.kind === "video")) {
    const variant = entry.target.source as HlsVariant;
    const attrs = [`BANDWIDTH=${variant.bandwidth ?? 1}`];
    if (variant.averageBandwidth) attrs.push(`AVERAGE-BANDWIDTH=${variant.averageBandwidth}`);
    if (variant.resolution) attrs.push(`RESOLUTION=${variant.resolution}`);
    if (variant.frameRate) attrs.push(`FRAME-RATE=${variant.frameRate}`);
    if (variant.codecs) attrs.push(`CODECS=${quote(variant.codecs)}`);
    if (variant.audioGroupId && audioGroups.has(variant.audioGroupId)) attrs.push(`AUDIO=${quote(variant.audioGroupId)}`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(",")}`);
    lines.push(entry.localPath);
  }
  return `${lines.join("\n")}\n`;
}

function resource(recordingId: string, logicalPath: string, kind: RecordedResourceKind, bytes: Uint8Array, contentType: string, metadata: Record<string, unknown>): RecordedResource {
  return { id: randomUUID(), logicalPath, kind, storageKey: path.posix.join("recordings", recordingId, logicalPath), contentType, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), metadata };
}

async function writeWorkspaceFile(workspace: string, logicalPath: string, bytes: Uint8Array): Promise<void> {
  const root = path.resolve(workspace);
  const destination = path.resolve(root, logicalPath);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Recording resource path is invalid");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes, { flag: "wx" });
}

function unsupported(message: string): StreamCollectionError { return new StreamCollectionError("UNSUPPORTED_MANIFEST", message, false); }
function quote(value: string): string { return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }

async function mapConcurrent<Input, Output>(values: Input[], limit: number, mapper: (value: Input, index: number) => Promise<Output>): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), values.length) }, worker));
  return results;
}
