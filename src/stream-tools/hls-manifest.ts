export type HlsVariant = {
  index: number;
  uri: string;
  url?: string;
  bandwidth?: number;
  averageBandwidth?: number;
  resolution?: string;
  frameRate?: number;
  codecs?: string;
  audioGroupId?: string;
  subtitlesGroupId?: string;
  closedCaptions?: string;
};

export type HlsRendition = {
  index: number;
  type: string;
  groupId?: string;
  name?: string;
  language?: string;
  default?: boolean;
  autoselect?: boolean;
  forced?: boolean;
  channels?: string;
  characteristics?: string;
  uri?: string;
  url?: string;
};

export type HlsManifestInspection = {
  kind: "master" | "media";
  variants: HlsVariant[];
  renditions: HlsRendition[];
  segmentCount: number;
  targetDuration?: number;
  mediaSequence?: number;
  discontinuitySequence?: number;
  discontinuityCount: number;
  hasEndList: boolean;
  segments?: HlsSegment[];
  initSegment?: HlsInitSegment;
  encryptionMethod?: string;
};

export type HlsByteRange = { length: number; offset?: number };

export type HlsInitSegment = {
  uri: string;
  url?: string;
  byteRange?: HlsByteRange;
};

export type HlsSegment = {
  index: number;
  sequence?: number;
  uri: string;
  url?: string;
  duration?: number;
  discontinuity: boolean;
  byteRange?: HlsByteRange;
};

export type HlsManifestSelection = {
  rule: "highest-bandwidth";
  variant: HlsVariant;
  audioRendition?: HlsRendition;
};

export function parseHlsManifest(text: string, baseUrl?: string): HlsManifestInspection {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim());
  const variants: HlsVariant[] = [];
  const renditions: HlsRendition[] = [];
  let pendingVariant: Record<string, string> | undefined;
  let segmentCount = 0;
  let targetDuration: number | undefined;
  let mediaSequence: number | undefined;
  let discontinuitySequence: number | undefined;
  let discontinuityCount = 0;
  let hasEndList = false;
  const segments: HlsSegment[] = [];
  let initSegment: HlsInitSegment | undefined;
  let encryptionMethod: string | undefined;
  let pendingDuration: number | undefined;
  let pendingDiscontinuity = false;
  let pendingByteRange: HlsByteRange | undefined;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingVariant = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
      continue;
    }
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const attrs = parseAttributeList(line.slice("#EXT-X-MEDIA:".length));
      const uri = attrs.URI;
      const resolved = uri && baseUrl ? resolveReference(baseUrl, uri) : undefined;
      renditions.push({
        index: renditions.length,
        type: attrs.TYPE ?? "",
        ...(attrs["GROUP-ID"] ? { groupId: attrs["GROUP-ID"] } : {}),
        ...(attrs.NAME ? { name: attrs.NAME } : {}),
        ...(attrs.LANGUAGE ? { language: attrs.LANGUAGE } : {}),
        ...(attrs.DEFAULT ? { default: parseYesNo(attrs.DEFAULT) } : {}),
        ...(attrs.AUTOSELECT ? { autoselect: parseYesNo(attrs.AUTOSELECT) } : {}),
        ...(attrs.FORCED ? { forced: parseYesNo(attrs.FORCED) } : {}),
        ...(attrs.CHANNELS ? { channels: attrs.CHANNELS } : {}),
        ...(attrs.CHARACTERISTICS ? { characteristics: attrs.CHARACTERISTICS } : {}),
        ...(uri ? { uri } : {}),
        ...(resolved ? { url: resolved } : {}),
      });
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      segmentCount += 1;
      pendingDuration = parseFiniteNumber(line.slice("#EXTINF:".length).split(",")[0]);
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = parseAttributeList(line.slice("#EXT-X-MAP:".length));
      if (attrs.URI) {
        const byteRange = parseByteRange(attrs.BYTERANGE);
        const resolved = baseUrl ? resolveReference(baseUrl, attrs.URI) : undefined;
        initSegment = {
          uri: attrs.URI,
          ...(resolved ? { url: resolved } : {}),
          ...(byteRange ? { byteRange } : {}),
        };
      }
      continue;
    }
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      pendingByteRange = parseByteRange(line.slice("#EXT-X-BYTERANGE:".length));
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const method = parseAttributeList(line.slice("#EXT-X-KEY:".length)).METHOD;
      if (method && method.toUpperCase() !== "NONE") encryptionMethod = method;
      continue;
    }
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = parseFiniteNumber(line.slice("#EXT-X-TARGETDURATION:".length));
      continue;
    }
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = parseFiniteNumber(line.slice("#EXT-X-MEDIA-SEQUENCE:".length));
      continue;
    }
    if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
      discontinuitySequence = parseFiniteNumber(line.slice("#EXT-X-DISCONTINUITY-SEQUENCE:".length));
      continue;
    }
    if (line === "#EXT-X-DISCONTINUITY") {
      discontinuityCount += 1;
      pendingDiscontinuity = true;
      continue;
    }
    if (line === "#EXT-X-ENDLIST") {
      hasEndList = true;
      continue;
    }
    if (line.startsWith("#")) continue;

    if (pendingVariant) {
      const resolved = baseUrl ? resolveReference(baseUrl, line) : undefined;
      variants.push({
        index: variants.length,
        uri: line,
        ...(resolved ? { url: resolved } : {}),
        ...optionalNumber("bandwidth", pendingVariant.BANDWIDTH),
        ...optionalNumber("averageBandwidth", pendingVariant["AVERAGE-BANDWIDTH"]),
        ...optionalNumber("frameRate", pendingVariant["FRAME-RATE"]),
        ...(pendingVariant.RESOLUTION ? { resolution: pendingVariant.RESOLUTION } : {}),
        ...(pendingVariant.CODECS ? { codecs: pendingVariant.CODECS } : {}),
        ...(pendingVariant.AUDIO ? { audioGroupId: pendingVariant.AUDIO } : {}),
        ...(pendingVariant.SUBTITLES ? { subtitlesGroupId: pendingVariant.SUBTITLES } : {}),
        ...(pendingVariant["CLOSED-CAPTIONS"] ? { closedCaptions: pendingVariant["CLOSED-CAPTIONS"] } : {}),
      });
      pendingVariant = undefined;
      continue;
    }
    const resolved = baseUrl ? resolveReference(baseUrl, line) : undefined;
    segments.push({
      index: segments.length,
      ...(mediaSequence !== undefined ? { sequence: mediaSequence + segments.length } : {}),
      uri: line,
      ...(resolved ? { url: resolved } : {}),
      ...(pendingDuration !== undefined ? { duration: pendingDuration } : {}),
      discontinuity: pendingDiscontinuity,
      ...(pendingByteRange ? { byteRange: pendingByteRange } : {}),
    });
    pendingDuration = undefined;
    pendingDiscontinuity = false;
    pendingByteRange = undefined;
  }

  return {
    kind: variants.length > 0 || renditions.length > 0 ? "master" : "media",
    variants,
    renditions,
    segmentCount,
    ...(targetDuration !== undefined ? { targetDuration } : {}),
    ...(mediaSequence !== undefined ? { mediaSequence } : {}),
    ...(discontinuitySequence !== undefined ? { discontinuitySequence } : {}),
    discontinuityCount,
    hasEndList,
    ...(segments.length > 0 ? { segments } : {}),
    ...(initSegment ? { initSegment } : {}),
    ...(encryptionMethod ? { encryptionMethod } : {}),
  };
}

export function selectHlsManifestSample(manifest: HlsManifestInspection): HlsManifestSelection | undefined {
  const fetchable = manifest.variants.filter((variant): variant is HlsVariant & { url: string } => Boolean(variant.url));
  if (fetchable.length === 0) return undefined;
  const variant = fetchable.reduce((selected, candidate) =>
    (candidate.bandwidth ?? -1) > (selected.bandwidth ?? -1) ? candidate : selected);
  const audioCandidates = manifest.renditions.filter((rendition) =>
    rendition.type.toUpperCase() === "AUDIO"
    && rendition.groupId === variant.audioGroupId
    && Boolean(rendition.url));
  const audioRendition = [...audioCandidates].sort((left, right) =>
    Number(Boolean(right.default)) - Number(Boolean(left.default))
    || Number(Boolean(right.autoselect)) - Number(Boolean(left.autoselect))
    || left.index - right.index)[0];
  return {
    rule: "highest-bandwidth",
    variant,
    ...(audioRendition ? { audioRendition } : {}),
  };
}

export function parseAttributeList(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let index = 0;
  while (index < value.length) {
    while (value[index] === "," || value[index] === " ") index += 1;
    let key = "";
    while (index < value.length && value[index] !== "=" && value[index] !== ",") {
      key += value[index];
      index += 1;
    }
    if (!key || value[index] !== "=") {
      while (index < value.length && value[index] !== ",") index += 1;
      continue;
    }
    index += 1;
    let attributeValue = "";
    if (value[index] === "\"") {
      index += 1;
      while (index < value.length && value[index] !== "\"") {
        attributeValue += value[index];
        index += 1;
      }
      if (value[index] === "\"") index += 1;
    } else {
      while (index < value.length && value[index] !== ",") {
        attributeValue += value[index];
        index += 1;
      }
    }
    attributes[key.trim().toUpperCase()] = attributeValue.trim();
  }
  return attributes;
}

function resolveReference(baseUrl: string, uri: string): string | undefined {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function parseYesNo(value: string): boolean {
  return value.toUpperCase() === "YES";
}

function parseFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseByteRange(value: string | undefined): HlsByteRange | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+)(?:@(\d+))?$/);
  if (!match) return undefined;
  const length = Number(match[1]);
  const offset = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isSafeInteger(length) || length < 1 || (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0))) {
    return undefined;
  }
  return { length, ...(offset === undefined ? {} : { offset }) };
}

function optionalNumber<Key extends string>(key: Key, value: string | undefined): Partial<Record<Key, number>> {
  const parsed = parseFiniteNumber(value);
  return parsed === undefined ? {} : { [key]: parsed } as Partial<Record<Key, number>>;
}
