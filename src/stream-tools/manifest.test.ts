import { describe, expect, it } from "vitest";
import { StreamCollectionError } from "./errors.js";
import { inspectManifest } from "./manifest.js";

describe("inspectManifest", () => {
  it("detects an HLS master and counts variants", () => {
    const result = inspectManifest([
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=1000",
      "low.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=2000",
      "high.m3u8",
    ].join("\n"));

    expect(result).toEqual({ protocol: "hls", kind: "master", variantCount: 2 });
  });

  it("detects HLS media and DASH MPD manifests", () => {
    expect(inspectManifest("#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts")).toEqual({
      protocol: "hls",
      kind: "media",
      segmentCount: 2,
    });
    expect(inspectManifest("<?xml version=\"1.0\"?><MPD><Period><Representation/><Representation /></Period></MPD>"))
      .toEqual({ protocol: "dash", kind: "mpd", representationCount: 2 });
  });

  it("rejects content that is not a supported manifest", () => {
    expect(() => inspectManifest("<html>not a manifest</html>"))
      .toThrowError(expect.objectContaining<Partial<StreamCollectionError>>({ code: "UNSUPPORTED_MANIFEST" }));
  });
});
