import { StreamCollectionError } from "./errors.js";
import { parseDashMpd, type DashManifestInspection } from "./dash-mpd.js";
import { parseHlsManifest, type HlsManifestInspection } from "./hls-manifest.js";

export type ManifestProtocol = "hls" | "dash";
export type ManifestKind = "master" | "media" | "mpd";

export type ManifestInspection = {
  protocol: ManifestProtocol;
  kind: ManifestKind;
  variantCount?: number;
  segmentCount?: number;
  representationCount?: number;
  hls?: HlsManifestInspection;
  dash?: DashManifestInspection;
};

export function inspectManifest(text: string, finalUrl?: string): ManifestInspection {
  const normalized = text.replace(/^\uFEFF/, "").trimStart();
  if (normalized.startsWith("#EXTM3U")) {
    const hls = parseHlsManifest(normalized, finalUrl);
    return {
      protocol: "hls",
      kind: hls.kind,
      ...(hls.variants.length > 0 ? { variantCount: hls.variants.length } : {}),
      ...(hls.segmentCount > 0 ? { segmentCount: hls.segmentCount } : {}),
      hls,
    };
  }

  if (/<(?:[A-Za-z_][\w.-]*:)?MPD(?=\s|\/?>)/i.test(normalized)) {
    const dash = parseDashMpd(normalized, finalUrl ?? "https://invalid.local/manifest.mpd");
    return {
      protocol: "dash",
      kind: "mpd",
      representationCount: Math.max(dash.representations.length, countMatches(normalized, /<(?:[A-Za-z_][\w.-]*:)?Representation(?=\s|\/?>)/gi)),
      dash,
    };
  }

  throw new StreamCollectionError(
    "UNSUPPORTED_MANIFEST",
    "The response is not a recognized HLS or DASH manifest",
    false,
  );
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}
