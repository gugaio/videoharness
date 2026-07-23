import { describe, expect, it } from "vitest";
import { parseHlsManifest, selectHlsManifestSample } from "./hls-manifest.js";

describe("HLS manifest parsing and bounded selection", () => {
  it("extracts variants and renditions while resolving relative URLs", () => {
    const result = parseHlsManifest([
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English, stereo",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Portuguese",LANGUAGE="pt",DEFAULT=NO,URI="audio/pt.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,AVERAGE-BANDWIDTH=700000,RESOLUTION=640x360,FRAME-RATE=29.97,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="audio"',
      "video/360.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio"',
      "video/720.m3u8",
    ].join("\n"), "https://cdn.example.test/live/master.m3u8");

    expect(result.kind).toBe("master");
    expect(result.variants).toHaveLength(2);
    expect(result.variants[1]).toMatchObject({
      index: 1,
      bandwidth: 2_400_000,
      resolution: "1280x720",
      codecs: "avc1.64001f,mp4a.40.2",
      audioGroupId: "audio",
      url: "https://cdn.example.test/live/video/720.m3u8",
    });
    expect(result.renditions[0]).toMatchObject({
      name: "English, stereo",
      language: "en",
      default: true,
      autoselect: true,
      url: "https://cdn.example.test/live/audio/en.m3u8",
    });
  });

  it("selects the highest-bandwidth variant and the default linked audio rendition", () => {
    const manifest = parseHlsManifest([
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="First",DEFAULT=NO,URI="first.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,URI="default.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="audio"',
      "low.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=2000,AUDIO="audio"',
      "high.m3u8",
    ].join("\n"), "https://example.test/master.m3u8");

    expect(selectHlsManifestSample(manifest)).toMatchObject({
      rule: "highest-bandwidth",
      variant: { index: 1, uri: "high.m3u8" },
      audioRendition: { index: 1, name: "Default" },
    });
  });

  it("keeps source order as the stable tie-breaker", () => {
    const manifest = parseHlsManifest([
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=1000",
      "first.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=1000",
      "second.m3u8",
    ].join("\n"), "https://example.test/master.m3u8");

    expect(selectHlsManifestSample(manifest)?.variant.index).toBe(0);
  });

  it("extracts bounded media-playlist structure without segment downloads", () => {
    const result = parseHlsManifest([
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:6",
      "#EXT-X-MEDIA-SEQUENCE:42",
      "#EXT-X-DISCONTINUITY-SEQUENCE:3",
      "#EXTINF:6,",
      "42.ts",
      "#EXT-X-DISCONTINUITY",
      "#EXTINF:5.5,",
      "43.ts",
      "#EXT-X-ENDLIST",
    ].join("\n"), "https://example.test/media.m3u8");

    expect(result).toMatchObject({
      kind: "media",
      segmentCount: 2,
      targetDuration: 6,
      mediaSequence: 42,
      discontinuitySequence: 3,
      discontinuityCount: 1,
      hasEndList: true,
    });
    expect(result.segments).toEqual([
      expect.objectContaining({ index: 0, sequence: 42, uri: "42.ts", duration: 6, discontinuity: false }),
      expect.objectContaining({ index: 1, sequence: 43, uri: "43.ts", duration: 5.5, discontinuity: true }),
    ]);
  });

  it("extracts a CMAF init segment and declared encryption", () => {
    const result = parseHlsManifest([
      "#EXTM3U",
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      "#EXTINF:4,",
      "part.m4s",
    ].join("\n"), "https://example.test/live/media.m3u8");

    expect(result.initSegment).toMatchObject({ uri: "init.mp4", url: "https://example.test/live/init.mp4" });
    expect(result.encryptionMethod).toBe("AES-128");
  });
});
