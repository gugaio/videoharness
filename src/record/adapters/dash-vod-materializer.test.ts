import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import { DashVodMaterializer } from "./dash-vod-materializer.js";

const directories: string[] = [];
const recordingId = "c56a4180-65aa-42ec-a945-5fd21dec0538";

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("DashVodMaterializer", () => {
  it("creates a self-contained static DASH fMP4 recording", async () => {
    const url = "https://origin.test/manifest.mpd";
    const http = fakeHttp({ [url]: mpd });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-dash-recording-"));
    directories.push(directory);

    const result = await new DashVodMaterializer(http).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: url, protocol: "dash", requestedDurationSeconds: 8, requestedStartSeconds: 4 } },
      workspace: { recordingId, path: directory },
    });

    expect(result.coverageSeconds).toBe(8);
    expect(result.resources.filter((resource) => resource.kind === "video-segment")).toHaveLength(4);
    expect(await fs.readFile(path.join(directory, "index.mpd"), "utf8")).toContain('media="video-0/segments/$Number$.m4s"');
    expect(await fs.readFile(path.join(directory, "video-0/segments/2.m4s"), "utf8")).toBe("low-2.m4s");
    expect(result.resources.find((resource) => resource.logicalPath === "video-0/segments/2.m4s")?.metadata).toMatchObject({ targetId: "video-0", mediaSequence: 2, bandwidth: 800000, resolution: "640x360", fragment: { boundarySamples: [], structuralErrors: expect.any(Array) } });
    expect(result.resources.find((resource) => resource.logicalPath === "video-0/init.mp4")?.metadata).toMatchObject({ init: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/), tracks: [] } });
    expect(result.resources.find((resource) => resource.logicalPath === "index.mpd")?.metadata).toMatchObject({ switchingContract: { mode: "UNKNOWN", representations: ["video-0", "video-1"] } });
  });

  it("rejects a dynamic MPD before storing media", async () => {
    const http = fakeHttp({ "https://origin.test/live.mpd": mpd.replace('type="static"', 'type="dynamic"') });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-dash-recording-"));
    directories.push(directory);
    await expect(new DashVodMaterializer(http).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: "https://origin.test/live.mpd", protocol: "dash", requestedDurationSeconds: 8, requestedStartSeconds: 0 } },
      workspace: { recordingId, path: directory },
    })).rejects.toMatchObject({ code: "UNSUPPORTED_MANIFEST" });
  });

  it("rejects an over-budget ladder before fetching init or media bytes", async () => {
    const http = fakeHttp({ "https://origin.test/manifest.mpd": mpd });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-dash-recording-"));
    directories.push(directory);
    await expect(new DashVodMaterializer(http, { maxTotalBytes: 1 }).materialize({
      job: { id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3, recording: { id: recordingId, sourceUrl: "https://origin.test/manifest.mpd", protocol: "dash", requestedDurationSeconds: 8, requestedStartSeconds: 0 } },
      workspace: { recordingId, path: directory },
    })).rejects.toMatchObject({ code: "STREAM_RESPONSE_TOO_LARGE" });
    expect(http.getBytes).not.toHaveBeenCalled();
  });
});

const mpd = `<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT12S"><BaseURL>https://origin.test/</BaseURL><Period duration="PT12S"><AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate timescale="1" media="$RepresentationID$-$Number$.m4s" initialization="$RepresentationID$.mp4" duration="4" startNumber="1"/><Representation id="low" bandwidth="800000" width="640" height="360" codecs="avc1.4d401f"/><Representation id="high" bandwidth="1800000" width="1280" height="720" codecs="avc1.4d401f"/></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4"><SegmentTemplate timescale="1" media="audio-$Number$.m4s" initialization="audio.mp4" duration="4" startNumber="1"/><Representation id="audio" bandwidth="128000" codecs="mp4a.40.2"/></AdaptationSet></Period></MPD>`;

function fakeHttp(texts: Record<string, string>): SafeHttpClient & { getBytes: ReturnType<typeof vi.fn> } {
  const getText = vi.fn(async (url: string) => ({ requestedUrl: url, finalUrl: url, statusCode: 200, bytes: new TextEncoder().encode(texts[url]!), text: texts[url]! }));
  const getBytes = vi.fn(async (url: string) => { const name = new URL(url).pathname.split("/").pop()!; return { requestedUrl: url, finalUrl: url, statusCode: 200, bytes: new TextEncoder().encode(name) }; });
  return { getText, getBytes } as unknown as SafeHttpClient & { getBytes: ReturnType<typeof vi.fn> };
}
