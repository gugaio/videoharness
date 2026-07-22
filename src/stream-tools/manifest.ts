import { StreamCollectionError } from "./errors.js";

export type ManifestProtocol = "hls" | "dash";
export type ManifestKind = "master" | "media" | "mpd";

export type ManifestInspection = {
  protocol: ManifestProtocol;
  kind: ManifestKind;
  variantCount?: number;
  segmentCount?: number;
  representationCount?: number;
};

export function inspectManifest(text: string): ManifestInspection {
  const normalized = text.replace(/^\uFEFF/, "").trimStart();
  if (normalized.startsWith("#EXTM3U")) {
    const variantCount = countLines(normalized, "#EXT-X-STREAM-INF:");
    const segmentCount = countLines(normalized, "#EXTINF:");
    return {
      protocol: "hls",
      kind: variantCount > 0 ? "master" : "media",
      ...(variantCount > 0 ? { variantCount } : {}),
      ...(segmentCount > 0 ? { segmentCount } : {}),
    };
  }

  if (/<(?:[A-Za-z_][\w.-]*:)?MPD(?=\s|\/?>)/i.test(normalized)) {
    return {
      protocol: "dash",
      kind: "mpd",
      representationCount: countMatches(normalized, /<(?:[A-Za-z_][\w.-]*:)?Representation(?=\s|\/?>)/gi),
    };
  }

  throw new StreamCollectionError(
    "UNSUPPORTED_MANIFEST",
    "The response is not a recognized HLS or DASH manifest",
    false,
  );
}

function countLines(text: string, prefix: string): number {
  return text.split(/\r?\n/).filter((line) => line.trimStart().startsWith(prefix)).length;
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}
