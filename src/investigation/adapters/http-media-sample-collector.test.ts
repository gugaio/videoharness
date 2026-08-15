import { Readable } from "node:stream";
import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import { inspectManifest } from "../../stream-tools/manifest.js";
import { SafeHttpClient, type PinnedRequester } from "../../stream-tools/safe-http-client.js";
import type { CollectionProgress } from "../ports/manifest-collector.js";
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
      { stage: "media_sample", message: "Sampling media sample 1 of 3 from manifest/root (source segment 0)…", completed: 0, total: 3 },
      { stage: "media_sample", message: "Sampling media sample 2 of 3 from manifest/root (source segment 1)…", completed: 1, total: 3 },
      { stage: "media_sample", message: "Sampling media sample 3 of 3 from manifest/root (source segment 2)…", completed: 2, total: 3 },
    ]);
  });

  it("keeps deterministic DASH evidence when one media sample times out", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => {
      if (url.pathname.endsWith("uhd-2.m4s")) {
        throw new StreamCollectionError("STREAM_REQUEST_TIMEOUT", "The stream request timed out", true);
      }
      return response(url.pathname);
    });
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }), { maxTotalBytes: 100_000 });
    const text = `<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT12S"><Period duration="PT12S"><AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate timescale="1" media="$RepresentationID$-$Number$.m4s" initialization="$RepresentationID$.mp4" duration="4"/><Representation id="uhd" width="3840" height="2160"/><Representation id="fhd" width="1920" height="1080"/></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4"><SegmentTemplate timescale="1" media="audio-$Number$.m4s" initialization="audio.mp4" duration="4"/><Representation id="audio"/></AdaptationSet></Period></MPD>`;
    const progress: CollectionProgress[] = [];

    const result = await collector.collect({
      manifests: [{ logicalKey: "manifest/root", role: "root", source: { requestedUrl: "https://stream.example/manifest.mpd", finalUrl: "https://stream.example/manifest.mpd", statusCode: 200 }, content: { bytes: new TextEncoder().encode(text) }, inspection: inspectManifest(text, "https://stream.example/manifest.mpd") }],
    }, async (entry) => { progress.push(entry); });

    expect(result.limitations).toContainEqual(expect.stringContaining("DASH representation uhd source segment 2 could not be sampled (STREAM_REQUEST_TIMEOUT)"));
    expect(progress).toContainEqual(expect.objectContaining({
      limitation: { errorCode: "STREAM_REQUEST_TIMEOUT", resourceKind: "media_segment", representationId: "uhd", sourceSegment: 2 },
    }));
    expect(result.samples.some((sample) => sample.representationId === "fhd" && sample.kind === "media-segment")).toBe(true);
    expect(result.samples.some((sample) => sample.representationId === "audio" && sample.kind === "media-segment")).toBe(true);
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

  it("samples the selected variant and its adjacent lower-bandwidth sibling", async () => {
    const requester = vi.fn<PinnedRequester>(async (url) => response(url.pathname));
    const collector = new HttpMediaSampleCollector(new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }], requester,
    }), { maxTotalBytes: 100_000 });
    const mediaText = (name: string) => ["#EXTM3U", "#EXTINF:4,", `${name}.ts`, "#EXT-X-ENDLIST"].join("\n");
    const source = {
      requestedUrl: "https://stream.example/live/master.m3u8",
      finalUrl: "https://stream.example/live/master.m3u8",
      statusCode: 200,
    };

    const result = await collector.collect({
      manifests: [
        {
          logicalKey: "manifest/root", role: "root",
          source,
          content: { bytes: new TextEncoder().encode("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000\nhigh.m3u8") },
          inspection: {
            protocol: "hls", kind: "master", variantCount: 2,
            hls: {
              kind: "master",
              variants: [
                { index: 0, uri: "low.m3u8", url: "https://stream.example/live/low.m3u8", bandwidth: 1_000 },
                { index: 1, uri: "high.m3u8", url: "https://stream.example/live/high.m3u8", bandwidth: 2_000 },
              ],
              renditions: [], segmentCount: 0, discontinuityCount: 0, hasEndList: false,
            },
          },
        },
        {
          logicalKey: "manifest/variant/0", role: "variant",
          source: { ...source, requestedUrl: "https://stream.example/live/low.m3u8", finalUrl: "https://stream.example/live/low.m3u8" },
          content: { bytes: new TextEncoder().encode(mediaText("low")) },
          inspection: inspectManifest(mediaText("low"), "https://stream.example/live/low.m3u8"),
        },
        {
          logicalKey: "manifest/variant/1", role: "variant",
          source: { ...source, requestedUrl: "https://stream.example/live/high.m3u8", finalUrl: "https://stream.example/live/high.m3u8" },
          content: { bytes: new TextEncoder().encode(mediaText("high")) },
          inspection: inspectManifest(mediaText("high"), "https://stream.example/live/high.m3u8"),
        },
      ],
      hlsSelection: {
        rule: "highest-bandwidth",
        variant: { index: 1, uri: "high.m3u8", url: "https://stream.example/live/high.m3u8", bandwidth: 2_000 },
      },
    });

    expect(result.limitations).toEqual([]);
    expect(result.samples.map((sample) => sample.logicalKey).sort()).toEqual([
      "sample/variant/0/media/0",
      "sample/variant/1/media/0",
    ]);
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
