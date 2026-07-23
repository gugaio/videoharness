import { Readable } from "node:stream";
import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { inspectManifest } from "../../stream-tools/manifest.js";
import { SafeHttpClient, type PinnedRequester } from "../../stream-tools/safe-http-client.js";
import { HttpMediaSampleCollector } from "./http-media-sample-collector.js";

describe("HttpMediaSampleCollector", () => {
  it("collects one init segment and one media segment from the selected playlist", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname.endsWith("init.mp4") ? "init" : "media"));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }));
    const text = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:4,\nchunk.m4s";
    const result = await collector.collect({
      manifests: [{
        logicalKey: "manifest/variant/0", role: "variant",
        source: { requestedUrl: "https://stream.example/live/video.m3u8", finalUrl: "https://stream.example/live/video.m3u8", statusCode: 200 },
        content: { bytes: new TextEncoder().encode(text) },
        inspection: inspectManifest(text, "https://stream.example/live/video.m3u8"),
      }],
    });

    expect(result.limitations).toEqual([]);
    expect(result.samples).toEqual([
      expect.objectContaining({ logicalKey: "sample/variant/0/init", kind: "init-segment" }),
      expect.objectContaining({ logicalKey: "sample/variant/0/media/0", kind: "media-segment", sequence: 7, declaredDuration: 4 }),
    ]);
    expect(requester).toHaveBeenCalledTimes(2);
  });

  it("samples a submitted root manifest when it is already a media playlist", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      requester,
    }));
    const text = [
      "#EXTM3U",
      "#EXT-X-MEDIA-SEQUENCE:10",
      "#EXTINF:4,",
      "segments/first.ts",
      "#EXTINF:4,",
      "segments/middle.ts",
      "#EXTINF:4,",
      "segments/last.ts",
      "#EXT-X-ENDLIST",
    ].join("\n");

    const result = await collector.collect({
      manifests: [{
        logicalKey: "manifest/root",
        role: "root",
        source: {
          requestedUrl: "https://stream.example/index.m3u8",
          finalUrl: "https://stream.example/index.m3u8",
          statusCode: 200,
        },
        content: { bytes: new TextEncoder().encode(text) },
        inspection: inspectManifest(text, "https://stream.example/index.m3u8"),
      }],
    });

    expect(result.limitations).toEqual([]);
    expect(result.samples.map((sample) => ({
      logicalKey: sample.logicalKey,
      sampleIndex: sample.sampleIndex,
      sequence: sample.sequence,
    }))).toEqual([
      { logicalKey: "sample/root/media/0", sampleIndex: 0, sequence: 10 },
      { logicalKey: "sample/root/media/1", sampleIndex: 1, sequence: 11 },
      { logicalKey: "sample/root/media/2", sampleIndex: 2, sequence: 12 },
    ]);
    expect(requester).toHaveBeenCalledTimes(3);
  });
});

function response(body: string): http.IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode: 200, headers: {} }) as http.IncomingMessage;
}
