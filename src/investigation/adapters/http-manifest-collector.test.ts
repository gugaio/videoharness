import { Readable } from "node:stream";
import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import { SafeHttpClient, type PinnedRequester } from "../../stream-tools/safe-http-client.js";
import { HttpManifestCollector } from "./http-manifest-collector.js";

describe("HttpManifestCollector", () => {
  it("collects every video variant playlist and one linked default audio rendition", async () => {
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
      if (url.pathname.endsWith("low.m3u8")) {
        return response("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nvideo.ts");
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
      "/live/low.m3u8",
      "/live/high.m3u8",
      "/live/audio-default.m3u8",
    ]);
    expect(result.manifests.map((manifest) => manifest.logicalKey)).toEqual([
      "manifest/root",
      "manifest/variant/0",
      "manifest/variant/1",
      "manifest/rendition/audio/0",
    ]);
    expect(result.hlsSelection).toMatchObject({
      rule: "highest-bandwidth",
      variant: { index: 1, bandwidth: 2_000 },
      audioRendition: { index: 1, name: "Default" },
    });
  });

  it("collects all ten declared variant playlists under the bounded safety ceiling", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => {
      if (url.pathname.endsWith("master.m3u8")) {
        const variants = Array.from({ length: 10 }, (_, index) => `#EXT-X-STREAM-INF:BANDWIDTH=${1_000 + index}\nvariant-${index}.m3u8`).join("\n");
        return response(`#EXTM3U\n${variants}`);
      }
      if (/variant-\d+\.m3u8$/.test(url.pathname)) return response("#EXTM3U\n#EXTINF:4,\nvideo.ts");
      throw new Error(`unexpected request ${url.toString()}`);
    });

    const result = await new HttpManifestCollector(createHttpClient(requester)).collect("https://stream.example/live/master.m3u8");

    expect(result.manifests.filter((manifest) => manifest.role === "variant")).toHaveLength(10);
    expect(result.manifests).toContainEqual(expect.objectContaining({ logicalKey: "manifest/variant/9" }));
  });

  it("keeps the root and remaining variants when one variant playlist fails", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => {
      if (url.pathname.endsWith("master.m3u8")) {
        return response([
          "#EXTM3U",
          '#EXT-X-STREAM-INF:BANDWIDTH=1000',
          "low.m3u8",
          '#EXT-X-STREAM-INF:BANDWIDTH=2000',
          "high.m3u8",
        ].join("\n"));
      }
      if (url.pathname.endsWith("low.m3u8")) {
        throw new StreamCollectionError("STREAM_REQUEST_TIMEOUT", "The stream request timed out", true);
      }
      if (url.pathname.endsWith("high.m3u8")) {
        return response("#EXTM3U\n#EXTINF:4,\nvideo.ts");
      }
      throw new Error(`unexpected request ${url.toString()}`);
    });
    const collector = new HttpManifestCollector(createHttpClient(requester));

    const result = await collector.collect("https://stream.example/live/master.m3u8");

    expect(result.manifests.map((manifest) => manifest.logicalKey)).toEqual([
      "manifest/root",
      "manifest/variant/1",
    ]);
    expect(result.mediaLimitations?.[0]).toContain("Variant 0 playlist could not be fetched");
  });

  it("does not allow a master playlist to bypass SSRF policy through a child URI", async () => {
    const requester = vi.fn<PinnedRequester>(async () => response([
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=1000",
      "http://127.0.0.1/private.m3u8",
    ].join("\n")));
    const collector = new HttpManifestCollector(createHttpClient(requester));

    const result = await collector.collect("https://stream.example/master.m3u8");

    expect(requester).toHaveBeenCalledTimes(1);
    expect(result.manifests.map((manifest) => manifest.logicalKey)).toEqual(["manifest/root"]);
    expect(result.mediaLimitations?.[0]).toContain("STREAM_DESTINATION_BLOCKED");
  });

  it("keeps media-playlist input to a single root artifact", async () => {
    const requester = vi.fn<PinnedRequester>(async () => response("#EXTM3U\n#EXTINF:4,\nsegment.ts"));
    const collector = new HttpManifestCollector(createHttpClient(requester));

    const result = await collector.collect("https://stream.example/media.m3u8");

    expect(result.manifests).toHaveLength(1);
    expect(result.manifests[0]).toMatchObject({ logicalKey: "manifest/root", role: "root" });
  });

  it("reports real stages before each manifest fetch", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => {
      if (url.pathname.endsWith("master.m3u8")) {
        return response([
          "#EXTM3U",
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,URI="audio-default.m3u8"',
          '#EXT-X-STREAM-INF:BANDWIDTH=2000,AUDIO="audio"',
          "high.m3u8",
        ].join("\n"));
      }
      if (url.pathname.endsWith("high.m3u8")) return response("#EXTM3U\n#EXTINF:4,\nvideo.ts");
      if (url.pathname.endsWith("audio-default.m3u8")) return response("#EXTM3U\n#EXTINF:4,\naudio.aac");
      throw new Error(`unexpected request ${url.toString()}`);
    });
    const collector = new HttpManifestCollector(createHttpClient(requester));
    const stages: string[] = [];

    const result = await collector.collect("https://stream.example/live/master.m3u8", async (progress) => {
      stages.push(progress.stage);
    });

    expect(stages).toEqual(["root_manifest", "variant_manifest", "rendition_manifest"]);
    expect(result.manifests).toHaveLength(3);
  });

  it("identifies the root manifest when its request times out", async () => {
    const requester = vi.fn<PinnedRequester>(async () => {
      throw new StreamCollectionError("STREAM_REQUEST_TIMEOUT", "The stream request timed out", true);
    });
    const collector = new HttpManifestCollector(createHttpClient(requester));

    await expect(collector.collect("https://stream.example/manifest.mpd"))
      .rejects.toMatchObject({
        code: "STREAM_REQUEST_TIMEOUT",
        message: "The root manifest could not be fetched: The stream request timed out",
        retryable: true,
      });
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
