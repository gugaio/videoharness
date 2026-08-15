import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import { HlsVodMaterializer } from "./hls-vod-materializer.js";
import type { CloneExecutionPlan } from "../../experiment/domain/clone-spec.js";

const directories: string[] = [];
const recordingId = "c56a4180-65aa-42ec-a945-5fd21dec0538";

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("HlsVodMaterializer", () => {
  it("creates a self-contained multi-variant MPEG-TS VOD recording", async () => {
    const texts: Record<string, string> = {
      "https://origin.test/master.m3u8": `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Portuguese",DEFAULT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud"
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,AUDIO="aud"
high.m3u8`,
      "https://origin.test/low.m3u8": media("low"),
      "https://origin.test/high.m3u8": media("high"),
      "https://origin.test/audio.m3u8": media("audio"),
    };
    const http = fakeHttp(texts);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-hls-recording-"));
    directories.push(directory);
    const result = await new HlsVodMaterializer(http).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: "https://origin.test/master.m3u8", protocol: "hls", requestedDurationSeconds: 9, requestedStartSeconds: 3 } },
      workspace: { recordingId, path: directory },
    });

    expect(result.coverageSeconds).toBe(9);
    expect(result.resources).toHaveLength(13);
    await expect(fs.readFile(path.join(directory, "index.m3u8"), "utf8")).resolves.toContain("variants/video-1/index.m3u8");
    await expect(fs.readFile(path.join(directory, "variants/video-0/index.m3u8"), "utf8")).resolves.toContain("#EXT-X-MEDIA-SEQUENCE:1");
    await expect(fs.readFile(path.join(directory, "variants/video-0/segments/1.ts"), "utf8")).resolves.toBe("low-1");
    expect(result.resources.every((resource) => resource.storageKey.startsWith(`recordings/${recordingId}/`))).toBe(true);
    expect(http.getBytes).toHaveBeenCalledTimes(9);
  });

  it("rejects a live media playlist before it can be published", async () => {
    const http = fakeHttp({
      "https://origin.test/master.m3u8": `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1800000
high.m3u8`,
      "https://origin.test/low.m3u8": "#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\nlow-0.ts",
      "https://origin.test/high.m3u8": media("high"),
    });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-hls-recording-"));
    directories.push(directory);

    await expect(new HlsVodMaterializer(http).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: "https://origin.test/master.m3u8", protocol: "hls", requestedDurationSeconds: 9, requestedStartSeconds: 0 } },
      workspace: { recordingId, path: directory },
    })).rejects.toMatchObject({ code: "UNSUPPORTED_MANIFEST" });
  });

  it("materializes only the representation selected by an experiment plan", async () => {
    const texts: Record<string, string> = {
      "https://origin.test/master.m3u8": `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Portuguese",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="aud"
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1800000,AUDIO="aud"
high.m3u8`,
      "https://origin.test/low.m3u8": media("low"), "https://origin.test/high.m3u8": media("high"), "https://origin.test/audio.m3u8": media("audio"),
    };
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-hls-recording-")); directories.push(directory);
    const result = await new HlsVodMaterializer(fakeHttp(texts)).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: "https://origin.test/master.m3u8", protocol: "hls", requestedDurationSeconds: 9, requestedStartSeconds: 3, clonePlan: plan("hls", "variant-0") } },
      workspace: { recordingId, path: directory },
    });
    const master = await fs.readFile(path.join(directory, "index.m3u8"), "utf8");
    expect(master).toContain("variants/video-0/index.m3u8");
    expect(master).not.toContain("video-1");
    expect(result.resources.find((entry) => entry.logicalPath === "variants/video-0/index.m3u8")?.metadata).toMatchObject({ sourceRepresentationId: "variant-0" });
  });

  it("preserves a ten-variant CONTROL ladder instead of rejecting it at the former limit", async () => {
    const texts: Record<string, string> = {};
    const variants = Array.from({ length: 10 }, (_, index) => `#EXT-X-STREAM-INF:BANDWIDTH=${800_000 + index * 300_000},RESOLUTION=640x360\nvideo-${index}.m3u8`).join("\n");
    texts["https://origin.test/master.m3u8"] = `#EXTM3U\n${variants}`;
    for (let index = 0; index < 10; index += 1) texts[`https://origin.test/video-${index}.m3u8`] = media(`video-${index}`);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-hls-recording-")); directories.push(directory);

    const result = await new HlsVodMaterializer(fakeHttp(texts)).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: "https://origin.test/master.m3u8", protocol: "hls", requestedDurationSeconds: 3, requestedStartSeconds: 0 } },
      workspace: { recordingId, path: directory },
    });

    const master = await fs.readFile(path.join(directory, "index.m3u8"), "utf8");
    expect(master).toContain("variants/video-9/index.m3u8");
    expect(result.resources.find((entry) => entry.logicalPath === "index.m3u8")?.metadata).toMatchObject({ variantCount: 10 });
  });

  it("applies an experiment selection before enforcing the variant safety limit", async () => {
    const texts: Record<string, string> = {};
    const variants = Array.from({ length: 10 }, (_, index) => `#EXT-X-STREAM-INF:BANDWIDTH=${800_000 + index * 300_000}\nvideo-${index}.m3u8`).join("\n");
    texts["https://origin.test/master.m3u8"] = `#EXTM3U\n${variants}`;
    texts["https://origin.test/video-9.m3u8"] = media("video-9");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-hls-recording-")); directories.push(directory);

    const result = await new HlsVodMaterializer(fakeHttp(texts), { maxVariants: 2 }).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: "https://origin.test/master.m3u8", protocol: "hls", requestedDurationSeconds: 3, requestedStartSeconds: 0, clonePlan: plan("hls", "variant-9") } },
      workspace: { recordingId, path: directory },
    });

    expect(result.resources.find((entry) => entry.logicalPath === "index.m3u8")?.metadata).toMatchObject({ variantCount: 1 });
  });

  it("retries one transient HLS segment failure without restarting the recording", async () => {
    const texts: Record<string, string> = {
      "https://origin.test/master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1800000\nhigh.m3u8",
      "https://origin.test/low.m3u8": media("low"),
      "https://origin.test/high.m3u8": media("high"),
    };
    const http = fakeHttp(texts);
    http.getBytes.mockRejectedValueOnce(new StreamCollectionError("STREAM_DNS_FAILED", "Temporary DNS failure", true));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-hls-recording-")); directories.push(directory);
    const events: string[] = [];

    const result = await new HlsVodMaterializer(http, { retryDelayMs: 0 }).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: "https://origin.test/master.m3u8", protocol: "hls", requestedDurationSeconds: 3, requestedStartSeconds: 0 } },
      workspace: { recordingId, path: directory },
      onProgress: async (event) => { events.push(event.type); },
    });

    expect(result.resources.find((entry) => entry.logicalPath === "index.m3u8")?.metadata).toMatchObject({ variantCount: 2 });
    expect(events).toContain("recording.resource_retry");
  });
});

function media(prefix: string): string {
  return `#EXTM3U
#EXT-X-TARGETDURATION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:3,
${prefix}-0.ts
#EXTINF:3,
${prefix}-1.ts
#EXTINF:3,
${prefix}-2.ts
#EXTINF:3,
${prefix}-3.ts
#EXT-X-ENDLIST`;
}

function fakeHttp(texts: Record<string, string>): SafeHttpClient & { getBytes: ReturnType<typeof vi.fn> } {
  const getText = vi.fn(async (url: string) => {
    const text = texts[url];
    if (!text) throw new Error(`No text fixture for ${url}`);
    return { requestedUrl: url, finalUrl: url, statusCode: 200, bytes: new TextEncoder().encode(text), text };
  });
  const getBytes = vi.fn(async (url: string) => {
    const name = new URL(url).pathname.split("/").pop()!;
    return { requestedUrl: url, finalUrl: url, statusCode: 200, bytes: new TextEncoder().encode(name.replace(/\.ts$/, "")) };
  });
  return { getText, getBytes } as unknown as SafeHttpClient & { getBytes: ReturnType<typeof vi.fn> };
}

function plan(protocol: "hls" | "dash", representationId: string): CloneExecutionPlan {
  return { version: "1", specVersion: "1", protocol, sourceMode: "recorded_snapshot", transformations: [{ kind: "filter_video_representations", description: "Select one", representationIds: [representationId] }], selection: { videoRepresentationIds: [representationId], audioMode: "preserve", expectedAudioRenditionCount: 1 }, processes: [], whatChanged: "Select one", expectedDiscriminatingSignal: "Compare", sourceArtifactIds: [] };
}
