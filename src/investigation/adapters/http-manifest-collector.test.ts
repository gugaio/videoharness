import { Readable } from "node:stream";
import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { SafeHttpClient, type PinnedRequester } from "../../stream-tools/safe-http-client.js";
import { HttpManifestCollector } from "./http-manifest-collector.js";

describe("HttpManifestCollector", () => {
  it("collects one selected variant and one linked default audio rendition", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => {
      if (url.pathname.endsWith("master.m3u8")) {
        return response([
          "#EXTM3U",
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Fallback",DEFAULT=NO,URI="audio-fallback.m3u8"',
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,URI="audio-default.m3u8"',
          '#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="audio"',
          "low.m3u8",
          '#EXT-X-STREAM-INF:BANDWIDTH=2000,AUDIO="audio"',
          "high.m3u8",
        ].join("\n"));
      }
      if (url.pathname.endsWith("high.m3u8")) {
        return response("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nvideo.ts");
      }
      if (url.pathname.endsWith("audio-default.m3u8")) {
        return response("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\naudio.aac");
      }
      throw new Error(`unexpected request ${url.toString()}`);
    });
    const collector = new HttpManifestCollector(createHttpClient(requester));

    const result = await collector.collect("https://stream.example/live/master.m3u8");

    expect(requester.mock.calls.map((call) => call[0].pathname)).toEqual([
      "/live/master.m3u8",
      "/live/high.m3u8",
      "/live/audio-default.m3u8",
    ]);
    expect(result.manifests.map((manifest) => manifest.logicalKey)).toEqual([
      "manifest/root",
      "manifest/variant/0",
      "manifest/rendition/audio/0",
    ]);
    expect(result.hlsSelection).toMatchObject({
      rule: "highest-bandwidth",
      variant: { index: 1, bandwidth: 2_000 },
      audioRendition: { index: 1, name: "Default" },
    });
  });

  it("does not allow a master playlist to bypass SSRF policy through a child URI", async () => {
    const requester = vi.fn<PinnedRequester>(async () => response([
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=1000",
      "http://127.0.0.1/private.m3u8",
    ].join("\n")));
    const collector = new HttpManifestCollector(createHttpClient(requester));

    await expect(collector.collect("https://stream.example/master.m3u8"))
      .rejects.toMatchObject({ code: "STREAM_DESTINATION_BLOCKED", retryable: false });
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it("keeps media-playlist input to a single root artifact", async () => {
    const requester = vi.fn<PinnedRequester>(async () => response("#EXTM3U\n#EXTINF:4,\nsegment.ts"));
    const collector = new HttpManifestCollector(createHttpClient(requester));

    const result = await collector.collect("https://stream.example/media.m3u8");

    expect(result.manifests).toHaveLength(1);
    expect(result.manifests[0]).toMatchObject({ logicalKey: "manifest/root", role: "root" });
  });
});

function createHttpClient(requester: PinnedRequester): SafeHttpClient {
  return new SafeHttpClient({
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    requester,
  });
}

function response(body: string): http.IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(body)]), {
    statusCode: 200,
    headers: { "content-type": "application/vnd.apple.mpegurl" },
  }) as http.IncomingMessage;
}
