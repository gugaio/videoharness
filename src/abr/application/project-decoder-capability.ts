import type { AbrRepresentation } from "../domain/assessment.js";

export type CapabilityRepresentation = {
  id: string;
  codec?: string;
  requiredProfile?: string;
  requiredLevel?: string;
  requiredLevelNumeric?: number;
  width?: number;
  height?: number;
};

export type CapabilityProjection = {
  codecFamily: "H264" | "HEVC" | "AV1" | "VP9" | "OTHER" | "UNKNOWN";
  profiles: string[];
  maxRequiredLevelNumeric?: number;
  maxRequiredLevel?: string;
  maxResolution?: { width: number; height: number };
  representations: CapabilityRepresentation[];
};

export function projectDecoderCapability(representations: AbrRepresentation[]): CapabilityProjection {
  const projected = representations.map(projectRepresentation);
  const withCodec = projected.filter((entry) => entry.codec);
  const family = dominantCodecFamily(withCodec.map((entry) => entry.codec!));
  const profiles = [...new Set(withCodec.flatMap((entry) => entry.requiredProfile ? [entry.requiredProfile] : []))];
  const levels = withCodec.flatMap((entry) => entry.requiredLevelNumeric === undefined ? [] : [entry.requiredLevelNumeric]);
  const maxLevel = levels.length ? Math.max(...levels) : undefined;
  const resolutions = projected.flatMap((entry) => entry.width && entry.height ? [{ width: entry.width, height: entry.height }] : []);
  const maxResolution = resolutions.length
    ? resolutions.reduce((largest, entry) => (entry.width * entry.height > largest.width * largest.height ? entry : largest))
    : undefined;
  return {
    codecFamily: family,
    profiles,
    ...(maxLevel === undefined ? {} : { maxRequiredLevelNumeric: maxLevel, maxRequiredLevel: formatLevel(family, maxLevel) }),
    ...(maxResolution ? { maxResolution } : {}),
    representations: projected,
  };
}

function projectRepresentation(representation: AbrRepresentation): CapabilityRepresentation {
  const codec = representation.codecs?.split(",")[0]?.trim();
  const parsed = codec ? parseCodecDescriptor(codec) : undefined;
  return {
    id: representation.id,
    ...(representation.codecs ? { codec: representation.codecs } : {}),
    ...(parsed?.profile ? { requiredProfile: parsed.profile } : {}),
    ...(parsed?.level !== undefined ? { requiredLevel: parsed.level, requiredLevelNumeric: parsed.levelNumeric } : {}),
    ...(representation.width === undefined ? {} : { width: representation.width }),
    ...(representation.height === undefined ? {} : { height: representation.height }),
  };
}

function parseCodecDescriptor(codec: string): { profile?: string; level?: string; levelNumeric?: number } | undefined {
  const normalized = codec.trim().toLowerCase();
  if (/^(hvc1|hev1)/.test(normalized)) {
    const match = /^hvc1\.([0-9a-f])\.([0-9a-f]+)\.l([0-9a-f]+)\.b[0-9a-f]*$/i.exec(normalized);
    if (!match) return undefined;
    const profileByte = Number.parseInt(match[1]!, 16);
    const profileSpace = (profileByte >> 5) & 0x03;
    const profileIdc = profileByte & 0x1f;
    const levelIdc = Number.parseInt(match[3]!, 10);
    return {
      profile: hevcProfileName(String(profileSpace), profileIdc),
      level: `L${match[3]!.toUpperCase()}`,
      levelNumeric: levelIdc / 30,
    };
  }
  if (/^(avc1|avc3|h264)/.test(normalized)) {
    const match = /\.([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized);
    if (!match) return undefined;
    const profileIdc = Number.parseInt(match[1]!, 16);
    const levelIdc = Number.parseInt(match[3]!, 16);
    return {
      profile: avcProfileName(profileIdc),
      level: `L${(levelIdc / 10).toFixed(1)}`,
      levelNumeric: levelIdc / 10,
    };
  }
  return undefined;
}

function avcProfileName(profileIdc: number): string {
  switch (profileIdc) {
    case 66: return "Baseline";
    case 77: return "Main";
    case 88: return "Extended";
    case 100: return "High";
    case 110: return "High 10";
    case 122: return "High 4:2:2";
    case 244: return "High 4:4:4";
    default: return `Profile ${profileIdc}`;
  }
}

function hevcProfileName(profileSpace: string, profileIdc: number): string {
  if (profileSpace === "0") {
    switch (profileIdc) {
      case 1: return "Main";
      case 2: return "Main 10";
      case 3: return "Main Still Picture";
      default: return `HEVC profile ${profileIdc}`;
    }
  }
  return `HEVC profile space ${profileSpace}`;
}

function dominantCodecFamily(codecs: string[]): CapabilityProjection["codecFamily"] {
  const counts = new Map<CapabilityProjection["codecFamily"], number>();
  for (const codec of codecs) {
    const family = codecFamily(codec);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "UNKNOWN";
}

function codecFamily(codec: string): CapabilityProjection["codecFamily"] {
  const normalized = codec.toLowerCase();
  if (/^(avc1|avc3|h264)/.test(normalized)) return "H264";
  if (/^(hvc1|hev1|hevc)/.test(normalized)) return "HEVC";
  if (/^av01/.test(normalized)) return "AV1";
  if (/^vp09|vp9/.test(normalized)) return "VP9";
  return normalized ? "OTHER" : "UNKNOWN";
}

function formatLevel(family: CapabilityProjection["codecFamily"], level: number): string {
  if (family === "HEVC" || family === "H264") return `Level ${level.toFixed(1)}`;
  return `Level ${level}`;
}
