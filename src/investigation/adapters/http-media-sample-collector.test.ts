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

  it("materializes every segment of a short VOD in full mode", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }), { mode: "full", maxTotalBytes: 10_000 });
    const text = ["#EXTM3U", ...Array.from({ length: 5 }, (_, index) => `#EXTINF:4,\nsegment-${index}.ts`), "#EXT-X-ENDLIST"].join("\n");

    const result = await collector.collect({
      manifests: [{
        logicalKey: "manifest/root", role: "root",
        source: { requestedUrl: "https://stream.example/index.m3u8", finalUrl: "https://stream.example/index.m3u8", statusCode: 200 },
        content: { bytes: new TextEncoder().encode(text) },
        inspection: inspectManifest(text, "https://stream.example/index.m3u8"),
      }],
    });

    expect(result.limitations).toEqual([]);
    expect(result.samples.map((sample) => sample.sampleIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(requester).toHaveBeenCalledTimes(5);
  });

  it("collects a DASH candidate window and repeats the incident segment for hash evidence", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }), { maxTotalBytes: 100_000 });
    const text = `<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT12S"><Period duration="PT12S"><AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate timescale="1" media="$RepresentationID$-$Number$.m4s" initialization="$RepresentationID$.mp4" duration="4"/><Representation id="uhd" width="3840" height="2160"/><Representation id="fhd" width="1920" height="1080"/></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4"><SegmentTemplate timescale="1" media="audio-$Number$.m4s" initialization="audio.mp4" duration="4"/><Representation id="audio"/></AdaptationSet></Period></MPD>`;
    const result = await collector.collect({
      manifests: [{ logicalKey: "manifest/root", role: "root", source: { requestedUrl: "https://stream.example/manifest.mpd", finalUrl: "https://stream.example/manifest.mpd", statusCode: 200 }, content: { bytes: new TextEncoder().encode(text) }, inspection: inspectManifest(text, "https://stream.example/manifest.mpd") }],
      reportedContext: { approximateTimeSeconds: 4, reportsVideoFreeze: true, reportsAudioContinues: true, reportsAbrSwitch: true, reportedAbrDirection: "DOWNSHIFT", reportedResolutionTransition: { sourceHeight: 2160, targetHeight: 1080 }, mentionedPlayerEvents: [], uncertainties: [] },
    });
    expect(result.samples.filter((sample) => sample.kind === "init-segment")).toHaveLength(3);
    const incident = result.samples.filter((sample) => sample.presentationStartSeconds === 4);
    expect(incident).toHaveLength(3);
    expect(incident.every((sample) => sample.source?.observedHashes?.length === 3)).toBe(true);
  });

  it("reports counted media_sample progress per segment in full mode", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }), { mode: "full", maxTotalBytes: 10_000 });
    const text = ["#EXTM3U", ...Array.from({ length: 3 }, (_, index) => `#EXTINF:4,\nsegment-${index}.ts`), "#EXT-X-ENDLIST"].join("\n");
    const steps: Array<{ stage: string; message: string; completed?: number; total?: number }> = [];

    const result = await collector.collect({
      manifests: [{
        logicalKey: "manifest/root", role: "root",
        source: { requestedUrl: "https://stream.example/index.m3u8", finalUrl: "https://stream.example/index.m3u8", statusCode: 200 },
        content: { bytes: new TextEncoder().encode(text) },
        inspection: inspectManifest(text, "https://stream.example/index.m3u8"),
      }],
    }, async (progress) => { steps.push(progress); });

    expect(result.samples).toHaveLength(3);
    expect(steps).toEqual([
      { stage: "media_sample", message: "Sampling media segment 1 of 3 from manifest/root…", completed: 0, total: 3 },
      { stage: "media_sample", message: "Sampling media segment 2 of 3 from manifest/root…", completed: 1, total: 3 },
      { stage: "media_sample", message: "Sampling media segment 3 of 3 from manifest/root…", completed: 2, total: 3 },
    ]);
  });

  it("centers the full-mode window around the reported incident time up to the time budget", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }), { mode: "full", maxTotalBytes: 1_000_000, maxSeconds: 40 });
    const text = ["#EXTM3U", ...Array.from({ length: 20 }, (_, index) => `#EXTINF:10,\nsegment-${index}.ts`), "#EXT-X-ENDLIST"].join("\n");

    const result = await collector.collect({
      manifests: [{
        logicalKey: "manifest/root", role: "root",
        source: { requestedUrl: "https://stream.example/index.m3u8", finalUrl: "https://stream.example/index.m3u8", statusCode: 200 },
        content: { bytes: new TextEncoder().encode(text) },
        inspection: inspectManifest(text, "https://stream.example/index.m3u8"),
      }],
      reportedContext: { approximateTimeSeconds: 100, reportsVideoFreeze: true, reportsAudioContinues: true, reportsAbrSwitch: true, reportedAbrDirection: "DOWNSHIFT", reportedResolutionTransition: { sourceHeight: 2160, targetHeight: 1080 }, mentionedPlayerEvents: [], uncertainties: [] },
    });

    expect(result.limitations).toEqual([]);
    // Target 100s sits in segment 10 (100..110s); the 40s budget keeps the centered window 80..120s.
    expect(result.samples.map((sample) => sample.sampleIndex)).toEqual([8, 9, 10, 11]);
  });

  it("caps the full-mode window at the playlist start when no incident time is given", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }), { mode: "full", maxTotalBytes: 1_000_000, maxSeconds: 20 });
    const text = ["#EXTM3U", ...Array.from({ length: 8 }, (_, index) => `#EXTINF:10,\nsegment-${index}.ts`), "#EXT-X-ENDLIST"].join("\n");

    const result = await collector.collect({
      manifests: [{
        logicalKey: "manifest/root", role: "root",
        source: { requestedUrl: "https://stream.example/index.m3u8", finalUrl: "https://stream.example/index.m3u8", statusCode: 200 },
        content: { bytes: new TextEncoder().encode(text) },
        inspection: inspectManifest(text, "https://stream.example/index.m3u8"),
      }],
    });

    expect(result.samples.map((sample) => sample.sampleIndex)).toEqual([0, 1]);
  });

  it("notes when the reported incident time cannot be mapped to the HLS timeline", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }), { mode: "full", maxTotalBytes: 1_000_000, maxSeconds: 20 });
    const text = ["#EXTM3U", ...Array.from({ length: 4 }, (_, index) => `segment-${index}.ts`), "#EXT-X-ENDLIST"].join("\n");

    const result = await collector.collect({
      manifests: [{
        logicalKey: "manifest/root", role: "root",
        source: { requestedUrl: "https://stream.example/index.m3u8", finalUrl: "https://stream.example/index.m3u8", statusCode: 200 },
        content: { bytes: new TextEncoder().encode(text) },
        inspection: inspectManifest(text, "https://stream.example/index.m3u8"),
      }],
      reportedContext: { approximateTimeSeconds: 30, reportsVideoFreeze: true, reportsAudioContinues: true, reportsAbrSwitch: true, reportedAbrDirection: "DOWNSHIFT", reportedResolutionTransition: { sourceHeight: 2160, targetHeight: 1080 }, mentionedPlayerEvents: [], uncertainties: [] },
    });

    expect(result.limitations[0]).toContain("reported incident time could not be mapped");
    expect(result.samples).toHaveLength(4);
  });
});

function response(body: string): http.IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode: 200, headers: {} }) as http.IncomingMessage;
}
