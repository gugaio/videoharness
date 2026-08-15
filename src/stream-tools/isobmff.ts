import { createHash } from "node:crypto";

export type Fmp4Sample = {
  dts: bigint;
  pts: bigint;
  duration?: bigint;
  size?: number;
  flags?: number;
  sync?: boolean;
  compositionOffset?: bigint;
  nalTypes: number[];
  firstNalType?: number;
  accessUnit: HevcAccessUnitInspection;
};

export type ParameterSetEvidence = {
  nalType: "VPS" | "SPS" | "PPS";
  parameterSetId?: number;
  rawSha256: string;
  rawSize: number;
  parsedSemanticFields: Record<string, string | number | boolean | Array<number | boolean>>;
};

export type HevcAccessUnitInspection = {
  nalTypes: string[];
  firstVclNalType?: string;
  isIrap: boolean;
  irapType?: "BLA" | "IDR_W_RADL" | "IDR_N_LP" | "CRA";
  hasVpsBeforeFirstVcl: boolean;
  hasSpsBeforeFirstVcl: boolean;
  hasPpsBeforeFirstVcl: boolean;
  parameterSetIdsReferenced: { vps: number[]; sps: number[]; pps: number[] };
  containsRasl: boolean;
  containsRadl: boolean;
};

export type Fmp4TrafInspection = {
  tfhd?: {
    trackId: number;
    flags: number;
    baseDataOffset?: string;
    sampleDescriptionIndex?: number;
    defaultSampleDuration?: string;
    defaultSampleSize?: number;
    defaultSampleFlags?: number;
  };
  tfdt?: { version: number; baseMediaDecodeTime: string };
  truns: Array<{
    version: number;
    flags: number;
    sampleCount: number;
    dataOffset?: number;
    firstSampleFlags?: number;
    samples: Array<{ sampleDuration?: string; sampleSize?: number; sampleFlags?: number; sampleCompositionTimeOffset?: string }>;
  }>;
  drmBoxTypes: string[];
};

export type Fmp4FragmentInspection = {
  styp?: { majorBrand: string; compatibleBrands: string[] };
  sidx?: { version: number; timescale: number; earliestPresentationTime: string; firstOffset: string; referenceCount: number };
  sequenceNumber?: number;
  baseMediaDecodeTime?: bigint;
  trafs: Fmp4TrafInspection[];
  samples: Fmp4Sample[];
  drmBoxTypes: string[];
  boxTypes: string[];
  structuralErrors: string[];
};

export type HevcDecoderConfiguration = {
  rawSha256: string;
  rawSize: number;
  configurationVersion: number;
  generalProfileSpace: number;
  generalTierFlag: boolean;
  generalProfileIdc: number;
  generalProfileCompatibilityFlags: number;
  generalConstraintIndicatorFlags: string;
  generalLevelIdc: number;
  minSpatialSegmentationIdc: number;
  parallelismType: number;
  chromaFormat: number;
  bitDepthLumaMinus8: number;
  bitDepthChromaMinus8: number;
  avgFrameRate: number;
  constantFrameRate: number;
  numTemporalLayers: number;
  temporalIdNested: boolean;
  lengthSizeMinusOne: number;
  parameterSets: ParameterSetEvidence[];
  profileIdc: number;
  levelIdc: number;
  tierFlag: boolean;
  bitDepthLuma: number;
  bitDepthChroma: number;
  parameterSetHashes: Partial<Record<"vps" | "sps" | "pps", string[]>>;
};

export type Fmp4TrackInspection = {
  trackId?: number;
  tkhdWidth?: number;
  tkhdHeight?: number;
  timescale?: number;
  handlerType?: string;
  sampleEntries: Array<{
    codingName: string;
    codedWidth?: number;
    codedHeight?: number;
    pasp?: { hSpacing: number; vSpacing: number };
    clap?: { cleanApertureWidthN: number; cleanApertureWidthD: number; cleanApertureHeightN: number; cleanApertureHeightD: number; horizOffN: number; horizOffD: number; vertOffN: number; vertOffD: number };
    colr?: { colourType: string; colourPrimaries?: number; transferCharacteristics?: number; matrixCoefficients?: number; fullRange?: boolean };
    hevc?: HevcDecoderConfiguration;
  }>;
  editList: Array<{ segmentDuration: string; mediaTime: string; mediaRateInteger: number; mediaRateFraction: number }>;
};

export type Fmp4InitInspection = {
  sha256: string;
  ftyp?: { majorBrand: string; compatibleBrands: string[] };
  mvhd?: { timescale: number; duration: string };
  fourcc?: "hvc1" | "hev1" | string;
  timescale?: number;
  nalLengthSize?: number;
  hevc?: HevcDecoderConfiguration;
  tracks: Fmp4TrackInspection[];
  trex: Array<{ trackId: number; defaultSampleDescriptionIndex: number; defaultSampleDuration: number; defaultSampleSize: number; defaultSampleFlags: number }>;
  drm: {
    schemes: Array<{ schemeType: string; schemeVersion: number }>;
    tenc: Array<{ isProtected: boolean; perSampleIvSize: number; defaultKid: string }>;
    pssh: Array<{ systemId: string; sha256: string; size: number; classification: DrmSchemeName }>;
  };
  boxTypes: string[];
  structuralErrors: string[];
};

type Box = { type: string; start: number; end: number; headerSize: number; payloadStart: number; payloadEnd: number; children: Box[] };

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "mvex", "moof", "traf", "edts", "dinf", "sinf", "schi", "meco", "udta"]);

export function inspectFmp4Fragment(bytes: Uint8Array, nalLengthSize = 4): Fmp4FragmentInspection {
  const errors: string[] = [];
  const roots = parseBoxes(bytes, 0, bytes.byteLength, errors);
  const all = flatten(roots);
  const moof = all.find((box) => box.type === "moof");
  const mdat = all.find((box) => box.type === "mdat");
  const stypBox = all.find((box) => box.type === "styp");
  const sidxBox = all.find((box) => box.type === "sidx");
  const mfhd = all.find((box) => box.type === "mfhd");
  const sequenceNumber = mfhd && mfhd.payloadEnd - mfhd.payloadStart >= 8 ? u32(bytes, mfhd.payloadStart + 4) : undefined;
  if (!moof) errors.push("Fragment has no moof box.");
  if (!mdat) errors.push("Fragment has no mdat box.");
  const trafBoxes = moof ? descendants(moof, "traf") : [];
  const trafs: Fmp4TrafInspection[] = [];
  const samples: Fmp4Sample[] = [];
  for (const traf of trafBoxes) {
    const tfdtBox = descendants(traf, "tfdt")[0];
    const tfhdBox = descendants(traf, "tfhd")[0];
    const trunBoxes = descendants(traf, "trun");
    const tfdt = tfdtBox ? parseTfdtDetailed(bytes, tfdtBox, errors) : undefined;
    const tfhd = tfhdBox ? parseTfhdDetailed(bytes, tfhdBox, errors) : undefined;
    let decodeCursor = tfdt?.baseMediaDecodeTime;
    const parsedTruns = trunBoxes.map((trun) => parseTrunDetailed(bytes, trun, tfhd ?? {}, errors));
    for (const parsed of parsedTruns) {
      for (const record of parsed.rawSamples) {
        const dts = decodeCursor;
        const pts = dts === undefined ? undefined : dts + (record.compositionOffset ?? 0n);
        const sample = {
          ...(dts === undefined ? { dts: 0n } : { dts }),
          ...(pts === undefined ? { pts: 0n } : { pts }),
          ...(record.duration === undefined ? {} : { duration: record.duration }),
          ...(record.size === undefined ? {} : { size: record.size }),
          ...(record.flags === undefined ? {} : { flags: record.flags, sync: (record.flags & 0x10000) === 0 }),
          ...(record.compositionOffset === undefined ? {} : { compositionOffset: record.compositionOffset }),
          nalTypes: [],
          accessUnit: emptyAccessUnitInspection(),
        } satisfies Fmp4Sample;
        samples.push(sample);
        if (decodeCursor !== undefined && record.duration !== undefined) decodeCursor += record.duration;
      }
    }
    trafs.push({
      ...(tfhd ? { tfhd: {
        trackId: tfhd.trackId,
        flags: tfhd.flags,
        ...(tfhd.baseDataOffset === undefined ? {} : { baseDataOffset: String(tfhd.baseDataOffset) }),
        ...(tfhd.sampleDescriptionIndex === undefined ? {} : { sampleDescriptionIndex: tfhd.sampleDescriptionIndex }),
        ...(tfhd.duration === undefined ? {} : { defaultSampleDuration: String(tfhd.duration) }),
        ...(tfhd.size === undefined ? {} : { defaultSampleSize: tfhd.size }),
        ...(tfhd.sampleFlags === undefined ? {} : { defaultSampleFlags: tfhd.sampleFlags }),
      } } : {}),
      ...(tfdt ? { tfdt: { version: tfdt.version, baseMediaDecodeTime: String(tfdt.baseMediaDecodeTime) } } : {}),
      truns: parsedTruns.map((entry) => entry.evidence),
      drmBoxTypes: flatten(traf.children).filter((box) => ["senc", "saiz", "saio", "sgpd", "sbgp", "pssh"].includes(box.type)).map((box) => box.type),
    });
  }
  if (mdat && samples.length > 0) {
    let position = mdat.payloadStart;
    for (const sample of samples) {
      if (sample.size === undefined) { errors.push("trun/tfhd does not provide sample sizes; NAL boundaries could not be validated."); break; }
      if (position + sample.size > mdat.payloadEnd) { errors.push("Declared sample bytes exceed the mdat payload."); break; }
      const accessUnitBytes = bytes.subarray(position, position + sample.size);
      const nals = hevcNalUnits(accessUnitBytes, nalLengthSize);
      sample.nalTypes = nals.map((nal) => nal.type);
      sample.accessUnit = inspectHevcAccessUnit(nals);
      if (nals[0]?.type !== undefined) sample.firstNalType = nals[0].type;
      position += sample.size;
    }
    const declared = samples.reduce((sum, sample) => sum + (sample.size ?? 0), 0);
    if (declared !== mdat.payloadEnd - mdat.payloadStart) errors.push("trun sample sizes do not exactly cover mdat payload.");
  }
  const baseMediaDecodeTime = trafs[0]?.tfdt ? BigInt(trafs[0].tfdt.baseMediaDecodeTime) : undefined;
  return {
    ...(stypBox ? { styp: parseBrandBox(bytes, stypBox) } : {}),
    ...(sidxBox ? { sidx: parseSidx(bytes, sidxBox, errors) } : {}),
    ...(sequenceNumber === undefined ? {} : { sequenceNumber }),
    ...(baseMediaDecodeTime === undefined ? {} : { baseMediaDecodeTime }),
    trafs,
    samples,
    drmBoxTypes: all.filter((box) => ["senc", "saiz", "saio", "sgpd", "sbgp", "pssh"].includes(box.type)).map((box) => box.type),
    boxTypes: all.map((box) => box.type),
    structuralErrors: errors,
  };
}

export function inspectFmp4Init(bytes: Uint8Array): Fmp4InitInspection {
  const errors: string[] = [];
  const roots = parseBoxes(bytes, 0, bytes.byteLength, errors);
  const all = flatten(roots);
  const ftyp = all.find((box) => box.type === "ftyp");
  const mvhd = all.find((box) => box.type === "mvhd");
  const mdhd = all.find((box) => box.type === "mdhd");
  const timescale = mdhd ? parseMdhdTimescale(bytes, mdhd, errors) : undefined;
  const sampleEntry = all.find((box) => box.type === "hvc1" || box.type === "hev1");
  const hvcc = all.find((box) => box.type === "hvcC");
  const parsedHevc = hvcc ? parseHvcc(bytes.subarray(hvcc.payloadStart, hvcc.payloadEnd), errors) : undefined;
  const tracks = all.filter((box) => box.type === "trak").map((track) => parseTrack(bytes, track, errors));
  const trex = all.filter((box) => box.type === "trex").flatMap((box) => parseTrex(bytes, box, errors));
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(ftyp ? { ftyp: parseBrandBox(bytes, ftyp) } : {}),
    ...(mvhd ? { mvhd: parseMovieHeader(bytes, mvhd, errors) } : {}),
    ...(sampleEntry ? { fourcc: sampleEntry.type } : {}),
    ...(timescale === undefined ? {} : { timescale }),
    ...(parsedHevc?.nalLengthSize === undefined ? {} : { nalLengthSize: parsedHevc.nalLengthSize }),
    ...(parsedHevc?.hevc ? { hevc: parsedHevc.hevc } : {}),
    tracks,
    trex,
    drm: parseDrm(bytes, all, errors),
    boxTypes: all.map((box) => box.type),
    structuralErrors: errors,
  };
}

export function hevcFrameKind(nalTypes: number[]): "idr" | "cra" | "bla" | "rasl" | "radl" | "other" | "unknown" {
  if (nalTypes.some((type) => type === 19 || type === 20)) return "idr";
  if (nalTypes.includes(21)) return "cra";
  if (nalTypes.some((type) => type >= 16 && type <= 18)) return "bla";
  if (nalTypes.some((type) => type === 8 || type === 9)) return "rasl";
  if (nalTypes.some((type) => type === 6 || type === 7)) return "radl";
  return nalTypes.length > 0 ? "other" : "unknown";
}

function parseBoxes(bytes: Uint8Array, start: number, end: number, errors: string[]): Box[] {
  const boxes: Box[] = [];
  let cursor = start;
  while (cursor + 8 <= end) {
    let size = u32(bytes, cursor);
    const type = ascii(bytes, cursor + 4, cursor + 8);
    let headerSize = 8;
    if (size === 1) { if (cursor + 16 > end) { errors.push(`Extended-size ${type} box is truncated.`); break; } const extended = u64(bytes, cursor + 8); if (extended > BigInt(Number.MAX_SAFE_INTEGER)) { errors.push(`${type} box is too large to inspect.`); break; } size = Number(extended); headerSize = 16; }
    if (size === 0) size = end - cursor;
    if (size < headerSize || cursor + size > end) { errors.push(`${type} box has an invalid size.`); break; }
    const box: Box = { type, start: cursor, end: cursor + size, headerSize, payloadStart: cursor + headerSize, payloadEnd: cursor + size, children: [] };
    if (CONTAINERS.has(type)) box.children = parseBoxes(bytes, box.payloadStart, box.payloadEnd, errors);
    else if (type === "stsd" && box.payloadStart + 8 <= box.payloadEnd) box.children = parseBoxes(bytes, box.payloadStart + 8, box.payloadEnd, errors);
    else if (type === "hvc1" || type === "hev1" || type === "encv") {
      const childStart = box.payloadStart + 78;
      if (childStart <= box.payloadEnd) box.children = parseBoxes(bytes, childStart, box.payloadEnd, errors);
    }
    boxes.push(box); cursor += size;
  }
  if (cursor !== end) errors.push("Trailing bytes cannot form a complete ISO BMFF box.");
  return boxes;
}
function flatten(boxes: Box[]): Box[] { return boxes.flatMap((box) => [box, ...flatten(box.children)]); }
function descendants(box: Box, type: string): Box[] { return flatten(box.children).filter((child) => child.type === type); }
function u16(bytes: Uint8Array, offset: number): number { return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0); }
function u32(bytes: Uint8Array, offset: number): number { return ((bytes[offset]! * 0x1000000) + ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)) >>> 0; }
function u64(bytes: Uint8Array, offset: number): bigint { return (BigInt(u32(bytes, offset)) << 32n) | BigInt(u32(bytes, offset + 4)); }
function i16(bytes: Uint8Array, offset: number): number { const value = u16(bytes, offset); return value > 0x7fff ? value - 0x10000 : value; }
function i32(bytes: Uint8Array, offset: number): number { const value = u32(bytes, offset); return value > 0x7fffffff ? value - 0x100000000 : value; }
function i64(bytes: Uint8Array, offset: number): bigint { const value = u64(bytes, offset); return value > 0x7fffffffffffffffn ? value - 0x10000000000000000n : value; }
function fixed16_16(bytes: Uint8Array, offset: number): number { return i32(bytes, offset) / 65_536; }
function hex(bytes: Uint8Array): string { return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function ascii(bytes: Uint8Array, start: number, end: number): string { return String.fromCharCode(...bytes.subarray(start, end)); }
function fullBox(bytes: Uint8Array, box: Box): { version: number; flags: number } { return { version: bytes[box.payloadStart] ?? 0, flags: ((bytes[box.payloadStart + 1] ?? 0) << 16) | ((bytes[box.payloadStart + 2] ?? 0) << 8) | (bytes[box.payloadStart + 3] ?? 0) }; }
type TfhdDetails = { trackId: number; flags: number; baseDataOffset?: bigint; sampleDescriptionIndex?: number; duration?: bigint; size?: number; sampleFlags?: number };
function parseTfdtDetailed(bytes: Uint8Array, box: Box, errors: string[]): { version: number; baseMediaDecodeTime: bigint } | undefined { const { version } = fullBox(bytes, box); const offset = box.payloadStart + 4; const needed = version === 1 ? 8 : 4; if (offset + needed > box.payloadEnd) { errors.push("tfdt is truncated."); return undefined; } return { version, baseMediaDecodeTime: version === 1 ? u64(bytes, offset) : BigInt(u32(bytes, offset)) }; }
function parseTfhdDetailed(bytes: Uint8Array, box: Box, errors: string[]): TfhdDetails | undefined {
  const { flags } = fullBox(bytes, box);
  let cursor = box.payloadStart + 4;
  if (cursor + 4 > box.payloadEnd) { errors.push("tfhd is truncated."); return undefined; }
  const trackId = u32(bytes, cursor); cursor += 4;
  let baseDataOffset: bigint | undefined;
  let sampleDescriptionIndex: number | undefined;
  let duration: bigint | undefined;
  let size: number | undefined;
  let sampleFlags: number | undefined;
  if (flags & 0x000001) { if (cursor + 8 > box.payloadEnd) { errors.push("tfhd base-data-offset is truncated."); return undefined; } baseDataOffset = u64(bytes, cursor); cursor += 8; }
  if (flags & 0x000002) { if (cursor + 4 > box.payloadEnd) return undefined; sampleDescriptionIndex = u32(bytes, cursor); cursor += 4; }
  if (flags & 0x000008) { if (cursor + 4 > box.payloadEnd) return undefined; duration = BigInt(u32(bytes, cursor)); cursor += 4; }
  if (flags & 0x000010) { if (cursor + 4 > box.payloadEnd) return undefined; size = u32(bytes, cursor); cursor += 4; }
  if (flags & 0x000020) { if (cursor + 4 > box.payloadEnd) return undefined; sampleFlags = u32(bytes, cursor); }
  return { trackId, flags, ...(baseDataOffset === undefined ? {} : { baseDataOffset }), ...(sampleDescriptionIndex === undefined ? {} : { sampleDescriptionIndex }), ...(duration === undefined ? {} : { duration }), ...(size === undefined ? {} : { size }), ...(sampleFlags === undefined ? {} : { sampleFlags }) };
}
function parseTrunDetailed(bytes: Uint8Array, box: Box, defaults: TfhdDetails | Record<string, never>, errors: string[]): {
  rawSamples: Array<{ duration?: bigint; size?: number; flags?: number; compositionOffset?: bigint }>;
  evidence: Fmp4TrafInspection["truns"][number];
} {
  const { version, flags } = fullBox(bytes, box);
  let cursor = box.payloadStart + 4;
  if (cursor + 4 > box.payloadEnd) { errors.push("trun is truncated."); return { rawSamples: [], evidence: { version, flags, sampleCount: 0, samples: [] } }; }
  const count = u32(bytes, cursor); cursor += 4;
  let dataOffset: number | undefined;
  if (flags & 0x000001) { if (cursor + 4 > box.payloadEnd) return { rawSamples: [], evidence: { version, flags, sampleCount: count, samples: [] } }; dataOffset = i32(bytes, cursor); cursor += 4; }
  let firstSampleFlags: number | undefined;
  if (flags & 0x000004) { if (cursor + 4 > box.payloadEnd) { errors.push("trun first-sample-flags is truncated."); return { rawSamples: [], evidence: { version, flags, sampleCount: count, samples: [] } }; } firstSampleFlags = u32(bytes, cursor); cursor += 4; }
  const rawSamples: Array<{ duration?: bigint; size?: number; flags?: number; compositionOffset?: bigint }> = [];
  for (let index = 0; index < count; index += 1) {
    let duration = "duration" in defaults ? defaults.duration : undefined;
    let size = "size" in defaults ? defaults.size : undefined;
    let sampleFlags = index === 0 && firstSampleFlags !== undefined ? firstSampleFlags : "sampleFlags" in defaults ? defaults.sampleFlags : undefined;
    let compositionOffset: bigint | undefined;
    if (flags & 0x000100) { if (cursor + 4 > box.payloadEnd) break; duration = BigInt(u32(bytes, cursor)); cursor += 4; }
    if (flags & 0x000200) { if (cursor + 4 > box.payloadEnd) break; size = u32(bytes, cursor); cursor += 4; }
    if (flags & 0x000400) { if (cursor + 4 > box.payloadEnd) break; sampleFlags = u32(bytes, cursor); cursor += 4; }
    if (flags & 0x000800) { if (cursor + 4 > box.payloadEnd) break; compositionOffset = BigInt(version === 1 ? i32(bytes, cursor) : u32(bytes, cursor)); cursor += 4; }
    rawSamples.push({ ...(duration === undefined ? {} : { duration }), ...(size === undefined ? {} : { size }), ...(sampleFlags === undefined ? {} : { flags: sampleFlags }), ...(compositionOffset === undefined ? {} : { compositionOffset }) });
  }
  if (rawSamples.length !== count) errors.push("trun declares more samples than its bytes contain.");
  return {
    rawSamples,
    evidence: {
      version,
      flags,
      sampleCount: count,
      ...(dataOffset === undefined ? {} : { dataOffset }),
      ...(firstSampleFlags === undefined ? {} : { firstSampleFlags }),
      samples: rawSamples.map((sample) => ({
        ...(sample.duration === undefined ? {} : { sampleDuration: String(sample.duration) }),
        ...(sample.size === undefined ? {} : { sampleSize: sample.size }),
        ...(sample.flags === undefined ? {} : { sampleFlags: sample.flags }),
        ...(sample.compositionOffset === undefined ? {} : { sampleCompositionTimeOffset: String(sample.compositionOffset) }),
      })),
    },
  };
}
function parseBrandBox(bytes: Uint8Array, box: Box): { majorBrand: string; compatibleBrands: string[] } {
  const majorBrand = ascii(bytes, box.payloadStart, Math.min(box.payloadStart + 4, box.payloadEnd));
  const compatibleBrands: string[] = [];
  for (let cursor = box.payloadStart + 8; cursor + 4 <= box.payloadEnd; cursor += 4) compatibleBrands.push(ascii(bytes, cursor, cursor + 4));
  return { majorBrand, compatibleBrands };
}
function parseSidx(bytes: Uint8Array, box: Box, errors: string[]): NonNullable<Fmp4FragmentInspection["sidx"]> {
  const { version } = fullBox(bytes, box);
  let cursor = box.payloadStart + 4;
  if (cursor + 8 > box.payloadEnd) { errors.push("sidx is truncated."); return { version, timescale: 0, earliestPresentationTime: "0", firstOffset: "0", referenceCount: 0 }; }
  cursor += 4; // reference_ID
  const timescale = u32(bytes, cursor); cursor += 4;
  const wide = version === 1;
  const earliestPresentationTime = wide && cursor + 8 <= box.payloadEnd ? u64(bytes, cursor) : BigInt(u32(bytes, cursor)); cursor += wide ? 8 : 4;
  const firstOffset = wide && cursor + 8 <= box.payloadEnd ? u64(bytes, cursor) : BigInt(u32(bytes, cursor)); cursor += wide ? 8 : 4;
  cursor += 2;
  const referenceCount = cursor + 2 <= box.payloadEnd ? u16(bytes, cursor) : 0;
  return { version, timescale, earliestPresentationTime: String(earliestPresentationTime), firstOffset: String(firstOffset), referenceCount };
}
function parseMovieHeader(bytes: Uint8Array, box: Box, errors: string[]): { timescale: number; duration: string } {
  const { version } = fullBox(bytes, box);
  const offset = box.payloadStart + (version === 1 ? 20 : 12);
  if (offset + (version === 1 ? 12 : 8) > box.payloadEnd) { errors.push("mvhd is truncated."); return { timescale: 0, duration: "0" }; }
  return { timescale: u32(bytes, offset), duration: String(version === 1 ? u64(bytes, offset + 4) : BigInt(u32(bytes, offset + 4))) };
}
function parseTrack(bytes: Uint8Array, track: Box, errors: string[]): Fmp4TrackInspection {
  const all = flatten(track.children);
  const tkhd = all.find((box) => box.type === "tkhd");
  const mdhd = all.find((box) => box.type === "mdhd");
  const hdlr = all.find((box) => box.type === "hdlr");
  const elst = all.find((box) => box.type === "elst");
  const sampleEntries = all.filter((box) => box.type === "hvc1" || box.type === "hev1" || box.type === "encv").map((entry) => parseSampleEntry(bytes, entry, errors));
  const tkhdDetails = tkhd ? parseTkhd(bytes, tkhd, errors) : undefined;
  const mediaTimescale = mdhd ? parseMdhdTimescale(bytes, mdhd, errors) : undefined;
  return {
    ...(tkhdDetails?.trackId === undefined ? {} : { trackId: tkhdDetails.trackId }),
    ...(tkhdDetails?.width === undefined ? {} : { tkhdWidth: tkhdDetails.width }),
    ...(tkhdDetails?.height === undefined ? {} : { tkhdHeight: tkhdDetails.height }),
    ...(mediaTimescale === undefined ? {} : { timescale: mediaTimescale }),
    ...(hdlr && hdlr.payloadStart + 12 <= hdlr.payloadEnd ? { handlerType: ascii(bytes, hdlr.payloadStart + 8, hdlr.payloadStart + 12) } : {}),
    sampleEntries,
    editList: elst ? parseEditList(bytes, elst, errors) : [],
  };
}
function parseTkhd(bytes: Uint8Array, box: Box, errors: string[]): { trackId?: number; width?: number; height?: number } {
  const { version } = fullBox(bytes, box);
  const trackOffset = box.payloadStart + (version === 1 ? 20 : 12);
  if (trackOffset + 4 > box.payloadEnd || box.payloadEnd - 8 < box.payloadStart) { errors.push("tkhd is truncated."); return {}; }
  return { trackId: u32(bytes, trackOffset), width: fixed16_16(bytes, box.payloadEnd - 8), height: fixed16_16(bytes, box.payloadEnd - 4) };
}
function parseSampleEntry(bytes: Uint8Array, entry: Box, errors: string[]): Fmp4TrackInspection["sampleEntries"][number] {
  const widthOffset = entry.payloadStart + 24;
  const nested = flatten(entry.children);
  const pasp = nested.find((box) => box.type === "pasp");
  const clap = nested.find((box) => box.type === "clap");
  const colr = nested.find((box) => box.type === "colr");
  const hvcc = nested.find((box) => box.type === "hvcC");
  return {
    codingName: entry.type,
    ...(widthOffset + 4 <= entry.payloadEnd ? { codedWidth: u16(bytes, widthOffset), codedHeight: u16(bytes, widthOffset + 2) } : {}),
    ...(pasp && pasp.payloadStart + 8 <= pasp.payloadEnd ? { pasp: { hSpacing: u32(bytes, pasp.payloadStart), vSpacing: u32(bytes, pasp.payloadStart + 4) } } : {}),
    ...(clap ? { clap: parseClap(bytes, clap, errors) } : {}),
    ...(colr ? { colr: parseColr(bytes, colr, errors) } : {}),
    ...(hvcc ? { hevc: parseHvcc(bytes.subarray(hvcc.payloadStart, hvcc.payloadEnd), errors).hevc } : {}),
  };
}
function parseClap(bytes: Uint8Array, box: Box, errors: string[]): NonNullable<Fmp4TrackInspection["sampleEntries"][number]["clap"]> {
  if (box.payloadStart + 32 > box.payloadEnd) errors.push("clap is truncated.");
  const values = Array.from({ length: 8 }, (_, index) => u32(bytes, Math.min(box.payloadStart + index * 4, Math.max(0, box.payloadEnd - 4))));
  return { cleanApertureWidthN: values[0]!, cleanApertureWidthD: values[1]!, cleanApertureHeightN: values[2]!, cleanApertureHeightD: values[3]!, horizOffN: values[4]!, horizOffD: values[5]!, vertOffN: values[6]!, vertOffD: values[7]! };
}
function parseColr(bytes: Uint8Array, box: Box, errors: string[]): NonNullable<Fmp4TrackInspection["sampleEntries"][number]["colr"]> {
  if (box.payloadStart + 4 > box.payloadEnd) { errors.push("colr is truncated."); return { colourType: "" }; }
  const colourType = ascii(bytes, box.payloadStart, box.payloadStart + 4);
  if (!["nclx", "nclc"].includes(colourType) || box.payloadStart + 10 > box.payloadEnd) return { colourType };
  return { colourType, colourPrimaries: u16(bytes, box.payloadStart + 4), transferCharacteristics: u16(bytes, box.payloadStart + 6), matrixCoefficients: u16(bytes, box.payloadStart + 8), ...(colourType === "nclx" && box.payloadStart + 11 <= box.payloadEnd ? { fullRange: (bytes[box.payloadStart + 10]! & 0x80) !== 0 } : {}) };
}
function parseEditList(bytes: Uint8Array, box: Box, errors: string[]): Fmp4TrackInspection["editList"] {
  const { version } = fullBox(bytes, box);
  let cursor = box.payloadStart + 4;
  if (cursor + 4 > box.payloadEnd) { errors.push("elst is truncated."); return []; }
  const count = u32(bytes, cursor); cursor += 4;
  const result: Fmp4TrackInspection["editList"] = [];
  for (let index = 0; index < count; index += 1) {
    const needed = version === 1 ? 20 : 12;
    if (cursor + needed > box.payloadEnd) { errors.push("elst entry is truncated."); break; }
    const segmentDuration = version === 1 ? u64(bytes, cursor) : BigInt(u32(bytes, cursor)); cursor += version === 1 ? 8 : 4;
    const mediaTime = version === 1 ? i64(bytes, cursor) : BigInt(i32(bytes, cursor)); cursor += version === 1 ? 8 : 4;
    result.push({ segmentDuration: String(segmentDuration), mediaTime: String(mediaTime), mediaRateInteger: i16(bytes, cursor), mediaRateFraction: i16(bytes, cursor + 2) }); cursor += 4;
  }
  return result;
}
function parseTrex(bytes: Uint8Array, box: Box, errors: string[]): Fmp4InitInspection["trex"] {
  const cursor = box.payloadStart + 4;
  if (cursor + 20 > box.payloadEnd) { errors.push("trex is truncated."); return []; }
  return [{ trackId: u32(bytes, cursor), defaultSampleDescriptionIndex: u32(bytes, cursor + 4), defaultSampleDuration: u32(bytes, cursor + 8), defaultSampleSize: u32(bytes, cursor + 12), defaultSampleFlags: u32(bytes, cursor + 16) }];
}
function parseDrm(bytes: Uint8Array, boxes: Box[], errors: string[]): Fmp4InitInspection["drm"] {
  const schemes = boxes.filter((box) => box.type === "schm").flatMap((box) => box.payloadStart + 12 <= box.payloadEnd ? [{ schemeType: ascii(bytes, box.payloadStart + 4, box.payloadStart + 8), schemeVersion: u32(bytes, box.payloadStart + 8) }] : []);
  const tenc = boxes.filter((box) => box.type === "tenc").flatMap((box) => {
    const { version } = fullBox(bytes, box); const cursor = box.payloadStart + 4 + (version > 0 ? 1 : 0);
    if (cursor + 18 > box.payloadEnd) { errors.push("tenc is truncated."); return []; }
    return [{ isProtected: bytes[cursor]! !== 0, perSampleIvSize: bytes[cursor + 1]!, defaultKid: hex(bytes.subarray(cursor + 2, cursor + 18)) }];
  });
  const pssh = boxes.filter((box) => box.type === "pssh").flatMap((box) => box.payloadStart + 20 <= box.payloadEnd ? [{ systemId: hex(bytes.subarray(box.payloadStart + 4, box.payloadStart + 20)), sha256: createHash("sha256").update(bytes.subarray(box.start, box.end)).digest("hex"), size: box.end - box.start, classification: classifyDrmSystemId(hex(bytes.subarray(box.payloadStart + 4, box.payloadStart + 20))) }] : []);
  return { schemes, tenc, pssh };
}

export type DrmSchemeName = "widevine" | "playready" | "fairplay" | "clearkey" | "unknown";

const KNOWN_DRM_SYSTEM_IDS: Record<string, DrmSchemeName> = {
  "edef8ba979d64acea3c827dcd51d21ed": "widevine",
  "9a04f07998404286ab92e65be0885f95": "playready",
  "94ce86fb07ff4f43adb893d2fa968ca2": "fairplay",
  "1077efecc0b24d02ace33c1e52e2fb4b": "clearkey",
};

export function classifyDrmSystemId(systemId: string): DrmSchemeName {
  const normalized = systemId.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return KNOWN_DRM_SYSTEM_IDS[normalized] ?? "unknown";
}
function parseMdhdTimescale(bytes: Uint8Array, box: Box, errors: string[]): number | undefined { const { version } = fullBox(bytes, box); const offset = box.payloadStart + (version === 1 ? 20 : 12); if (offset + 4 > box.payloadEnd) { errors.push("mdhd is truncated."); return undefined; } return u32(bytes, offset); }
function parseHvcc(bytes: Uint8Array, errors: string[]): { nalLengthSize?: number; hevc?: HevcDecoderConfiguration } {
  if (bytes.length < 23) { errors.push("hvcC is truncated."); return {}; }
  const parameterSets: ParameterSetEvidence[] = [];
  const arrays = new Map<number, string[]>();
  let cursor = 23;
  const arrayCount = bytes[22]!;
  for (let index = 0; index < arrayCount; index += 1) {
    if (cursor + 3 > bytes.length) { errors.push("hvcC parameter array is truncated."); break; }
    const type = bytes[cursor]! & 0x3f;
    const count = u16(bytes, cursor + 1); cursor += 3;
    const hashes: string[] = [];
    for (let item = 0; item < count; item += 1) {
      if (cursor + 2 > bytes.length) { errors.push("hvcC parameter set length is truncated."); break; }
      const length = u16(bytes, cursor); cursor += 2;
      if (cursor + length > bytes.length) { errors.push("hvcC parameter set is truncated."); break; }
      const nal = bytes.subarray(cursor, cursor + length);
      const evidence = parseParameterSetEvidence(type, nal);
      if (evidence) parameterSets.push(evidence);
      hashes.push(createHash("sha256").update(nal).digest("hex"));
      cursor += length;
    }
    arrays.set(type, hashes);
  }
  const constraint = hex(bytes.subarray(6, 12));
  const lengthSizeMinusOne = bytes[21]! & 0x03;
  const vps = arrays.get(32); const sps = arrays.get(33); const pps = arrays.get(34);
  const hevc: HevcDecoderConfiguration = {
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    rawSize: bytes.byteLength,
    configurationVersion: bytes[0]!,
    generalProfileSpace: bytes[1]! >> 6,
    generalTierFlag: (bytes[1]! & 0x20) !== 0,
    generalProfileIdc: bytes[1]! & 0x1f,
    generalProfileCompatibilityFlags: u32(bytes, 2),
    generalConstraintIndicatorFlags: constraint,
    generalLevelIdc: bytes[12]!,
    minSpatialSegmentationIdc: u16(bytes, 13) & 0x0fff,
    parallelismType: bytes[15]! & 0x03,
    chromaFormat: bytes[16]! & 0x03,
    bitDepthLumaMinus8: bytes[17]! & 0x07,
    bitDepthChromaMinus8: bytes[18]! & 0x07,
    avgFrameRate: u16(bytes, 19),
    constantFrameRate: bytes[21]! >> 6,
    numTemporalLayers: (bytes[21]! >> 3) & 0x07,
    temporalIdNested: (bytes[21]! & 0x04) !== 0,
    lengthSizeMinusOne,
    parameterSets,
    profileIdc: bytes[1]! & 0x1f,
    levelIdc: bytes[12]!,
    tierFlag: (bytes[1]! & 0x20) !== 0,
    bitDepthLuma: (bytes[17]! & 0x07) + 8,
    bitDepthChroma: (bytes[18]! & 0x07) + 8,
    parameterSetHashes: { ...(vps ? { vps } : {}), ...(sps ? { sps } : {}), ...(pps ? { pps } : {}) },
  };
  return { nalLengthSize: lengthSizeMinusOne + 1, hevc };
}

type HevcNal = { type: number; bytes: Uint8Array };
function hevcNalUnits(bytes: Uint8Array, lengthSize: number): HevcNal[] {
  const units: HevcNal[] = [];
  let cursor = 0;
  while (cursor + lengthSize + 2 <= bytes.length) {
    let length = 0;
    for (let index = 0; index < lengthSize; index += 1) length = length * 256 + bytes[cursor + index]!;
    cursor += lengthSize;
    if (length < 2 || cursor + length > bytes.length) break;
    const nal = bytes.subarray(cursor, cursor + length);
    units.push({ type: (nal[0]! >> 1) & 0x3f, bytes: nal });
    cursor += length;
  }
  return units;
}

function inspectHevcAccessUnit(units: HevcNal[]): HevcAccessUnitInspection {
  const firstVcl = units.findIndex((nal) => nal.type <= 31);
  const preceding = firstVcl < 0 ? units : units.slice(0, firstVcl);
  const firstType = firstVcl < 0 ? undefined : units[firstVcl]?.type;
  const ids: HevcAccessUnitInspection["parameterSetIdsReferenced"] = { vps: [], sps: [], pps: [] };
  for (const unit of units) {
    const evidence = parseParameterSetEvidence(unit.type, unit.bytes);
    if (evidence?.parameterSetId !== undefined) {
      if (unit.type === 32) ids.vps.push(evidence.parameterSetId);
      if (unit.type === 33) ids.sps.push(evidence.parameterSetId);
      if (unit.type === 34) ids.pps.push(evidence.parameterSetId);
    }
  }
  if (firstVcl >= 0) {
    const referencedPps = parseSlicePpsId(units[firstVcl]!);
    if (referencedPps !== undefined && !ids.pps.includes(referencedPps)) ids.pps.push(referencedPps);
  }
  const irapType = firstType === 21 ? "CRA" : firstType === 19 ? "IDR_W_RADL" : firstType === 20 ? "IDR_N_LP" : firstType !== undefined && firstType >= 16 && firstType <= 18 ? "BLA" : undefined;
  return {
    nalTypes: units.map((nal) => hevcNalTypeName(nal.type)),
    ...(firstType === undefined ? {} : { firstVclNalType: hevcNalTypeName(firstType) }),
    isIrap: firstType !== undefined && firstType >= 16 && firstType <= 21,
    ...(irapType ? { irapType } : {}),
    hasVpsBeforeFirstVcl: preceding.some((nal) => nal.type === 32),
    hasSpsBeforeFirstVcl: preceding.some((nal) => nal.type === 33),
    hasPpsBeforeFirstVcl: preceding.some((nal) => nal.type === 34),
    parameterSetIdsReferenced: ids,
    containsRasl: units.some((nal) => nal.type === 8 || nal.type === 9),
    containsRadl: units.some((nal) => nal.type === 6 || nal.type === 7),
  };
}

function emptyAccessUnitInspection(): HevcAccessUnitInspection {
  return { nalTypes: [], isIrap: false, hasVpsBeforeFirstVcl: false, hasSpsBeforeFirstVcl: false, hasPpsBeforeFirstVcl: false, parameterSetIdsReferenced: { vps: [], sps: [], pps: [] }, containsRasl: false, containsRadl: false };
}

function parseParameterSetEvidence(type: number, nal: Uint8Array): ParameterSetEvidence | undefined {
  if (![32, 33, 34].includes(type)) return undefined;
  let parsedSemanticFields: ParameterSetEvidence["parsedSemanticFields"] = {};
  try { parsedSemanticFields = type === 32 ? parseVps(nal) : type === 33 ? parseSps(nal) : parsePps(nal); } catch { /* A hash remains useful when the optional semantic parse is truncated. */ }
  const idKey = type === 32 ? "vps_video_parameter_set_id" : type === 33 ? "sps_seq_parameter_set_id" : "pps_pic_parameter_set_id";
  const parameterSetId = parsedSemanticFields[idKey];
  return {
    nalType: type === 32 ? "VPS" : type === 33 ? "SPS" : "PPS",
    ...(typeof parameterSetId === "number" ? { parameterSetId } : {}),
    rawSha256: createHash("sha256").update(nal).digest("hex"),
    rawSize: nal.byteLength,
    parsedSemanticFields,
  };
}

function parseVps(nal: Uint8Array): ParameterSetEvidence["parsedSemanticFields"] {
  const reader = parameterSetReader(nal);
  return { vps_video_parameter_set_id: reader.readBits(4) };
}

function parseSps(nal: Uint8Array): ParameterSetEvidence["parsedSemanticFields"] {
  const reader = parameterSetReader(nal);
  const result: ParameterSetEvidence["parsedSemanticFields"] = {};
  result.sps_video_parameter_set_id = reader.readBits(4);
  const maxSubLayers = reader.readBits(3);
  result.sps_max_sub_layers_minus1 = maxSubLayers;
  result.temporal_id_nesting_flag = reader.readBool();
  Object.assign(result, parseProfileTierLevel(reader, maxSubLayers));
  result.sps_seq_parameter_set_id = reader.readUe();
  const chromaFormat = reader.readUe(); result.chroma_format_idc = chromaFormat;
  if (chromaFormat === 3) result.separate_colour_plane_flag = reader.readBool();
  result.pic_width_in_luma_samples = reader.readUe();
  result.pic_height_in_luma_samples = reader.readUe();
  const conformanceWindow = reader.readBool(); result.conformance_window_flag = conformanceWindow;
  if (conformanceWindow) {
    result.conf_win_left_offset = reader.readUe(); result.conf_win_right_offset = reader.readUe();
    result.conf_win_top_offset = reader.readUe(); result.conf_win_bottom_offset = reader.readUe();
  }
  result.bit_depth_luma_minus8 = reader.readUe(); result.bit_depth_chroma_minus8 = reader.readUe();
  const log2Poc = reader.readUe(); result.log2_max_pic_order_cnt_lsb_minus4 = log2Poc;
  const orderingPresent = reader.readBool();
  const dpb: number[] = []; const reorder: number[] = []; const latency: number[] = [];
  for (let index = orderingPresent ? 0 : maxSubLayers; index <= maxSubLayers; index += 1) {
    dpb[index] = reader.readUe(); reorder[index] = reader.readUe(); latency[index] = reader.readUe();
  }
  result.sps_max_dec_pic_buffering_minus1 = dpb; result.sps_max_num_reorder_pics = reorder; result.sps_max_latency_increase_plus1 = latency;
  reader.readUe(); reader.readUe(); reader.readUe(); reader.readUe(); reader.readUe(); reader.readUe();
  const scalingList = reader.readBool(); result.scaling_list_enabled_flag = scalingList;
  if (scalingList && reader.readBool()) skipScalingListData(reader);
  result.amp_enabled_flag = reader.readBool(); result.sample_adaptive_offset_enabled_flag = reader.readBool();
  const pcm = reader.readBool(); result.pcm_enabled_flag = pcm;
  if (pcm) { reader.skipBits(8); reader.readUe(); reader.readUe(); reader.readBool(); }
  const shortTermCount = reader.readUe(); result.num_short_term_ref_pic_sets = shortTermCount;
  skipShortTermReferencePictureSets(reader, shortTermCount);
  const longTerm = reader.readBool(); result.long_term_ref_pics_present_flag = longTerm;
  if (longTerm) { const count = reader.readUe(); for (let index = 0; index < count; index += 1) { reader.skipBits(log2Poc + 4); reader.readBool(); } }
  result.sps_temporal_mvp_enabled_flag = reader.readBool(); result.strong_intra_smoothing_enabled_flag = reader.readBool();
  if (reader.readBool()) Object.assign(result, parseVui(reader));
  return result;
}

function parsePps(nal: Uint8Array): ParameterSetEvidence["parsedSemanticFields"] {
  const reader = parameterSetReader(nal);
  const result: ParameterSetEvidence["parsedSemanticFields"] = {};
  result.pps_pic_parameter_set_id = reader.readUe(); result.pps_seq_parameter_set_id = reader.readUe();
  result.dependent_slice_segments_enabled_flag = reader.readBool(); result.output_flag_present_flag = reader.readBool();
  result.num_extra_slice_header_bits = reader.readBits(3); result.sign_data_hiding_enabled_flag = reader.readBool(); result.cabac_init_present_flag = reader.readBool();
  result.num_ref_idx_l0_default_active_minus1 = reader.readUe(); result.num_ref_idx_l1_default_active_minus1 = reader.readUe();
  reader.readSe(); reader.readBool(); reader.readBool();
  if (reader.readBool()) reader.readUe();
  reader.readSe(); reader.readSe(); reader.readBool();
  result.weighted_pred_flag = reader.readBool(); result.weighted_bipred_flag = reader.readBool();
  reader.readBool();
  const tiles = reader.readBool(); result.tiles_enabled_flag = tiles;
  result.entropy_coding_sync_enabled_flag = reader.readBool();
  if (tiles) {
    const columns = reader.readUe(); const rows = reader.readUe(); const uniform = reader.readBool();
    if (!uniform) { for (let index = 0; index < columns; index += 1) reader.readUe(); for (let index = 0; index < rows; index += 1) reader.readUe(); }
    result.loop_filter_across_tiles_enabled_flag = reader.readBool();
  }
  reader.readBool();
  const deblocking = reader.readBool(); result.deblocking_filter_control_present_flag = deblocking;
  return result;
}

function parseProfileTierLevel(reader: BitReader, maxSubLayers: number): ParameterSetEvidence["parsedSemanticFields"] {
  const result: ParameterSetEvidence["parsedSemanticFields"] = {};
  result.general_profile_space = reader.readBits(2); result.general_tier_flag = reader.readBool(); result.general_profile_idc = reader.readBits(5);
  result.profile_compatibility_flags = reader.readBits(32); result.constraint_indicator_flags = reader.readBigBitsHex(48); result.general_level_idc = reader.readBits(8);
  const profileFlags: boolean[] = []; const levelFlags: boolean[] = [];
  for (let index = 0; index < maxSubLayers; index += 1) { profileFlags[index] = reader.readBool(); levelFlags[index] = reader.readBool(); }
  if (maxSubLayers > 0) for (let index = maxSubLayers; index < 8; index += 1) reader.skipBits(2);
  const subLayerLevels: number[] = [];
  for (let index = 0; index < maxSubLayers; index += 1) { if (profileFlags[index]) reader.skipBits(88); if (levelFlags[index]) subLayerLevels[index] = reader.readBits(8); }
  result.sub_layer_profile_present_flags = profileFlags; result.sub_layer_level_present_flags = levelFlags; result.sub_layer_level_idc = subLayerLevels;
  return result;
}

function parseVui(reader: BitReader): ParameterSetEvidence["parsedSemanticFields"] {
  const result: ParameterSetEvidence["parsedSemanticFields"] = {};
  const aspect = reader.readBool(); result.aspect_ratio_info_present_flag = aspect;
  if (aspect) { const idc = reader.readBits(8); result.aspect_ratio_idc = idc; if (idc === 255) { result.sar_width = reader.readBits(16); result.sar_height = reader.readBits(16); } }
  if (reader.readBool()) reader.readBool();
  const videoSignal = reader.readBool(); result.video_signal_type_present_flag = videoSignal;
  if (videoSignal) { reader.skipBits(3); result.video_full_range_flag = reader.readBool(); const colour = reader.readBool(); result.colour_description_present_flag = colour; if (colour) { result.colour_primaries = reader.readBits(8); result.transfer_characteristics = reader.readBits(8); result.matrix_coeffs = reader.readBits(8); } }
  const chromaLoc = reader.readBool(); result.chroma_loc_info_present_flag = chromaLoc;
  if (chromaLoc) { result.chroma_sample_loc_type_top_field = reader.readUe(); result.chroma_sample_loc_type_bottom_field = reader.readUe(); }
  reader.readBool(); result.field_seq_flag = reader.readBool(); result.frame_field_info_present_flag = reader.readBool();
  if (reader.readBool()) { reader.readUe(); reader.readUe(); reader.readUe(); reader.readUe(); }
  const timing = reader.readBool(); result.timing_info_present_flag = timing;
  if (timing) { result.num_units_in_tick = reader.readBits(32); result.time_scale = reader.readBits(32); if (reader.readBool()) reader.readUe(); }
  return result;
}

function skipScalingListData(reader: BitReader): void {
  for (let sizeId = 0; sizeId < 4; sizeId += 1) for (let matrixId = 0; matrixId < (sizeId === 3 ? 2 : 6); matrixId += 1) {
    if (!reader.readBool()) reader.readUe();
    else { const coefNum = Math.min(64, 1 << (4 + (sizeId << 1))); if (sizeId > 1) reader.readSe(); for (let index = 0; index < coefNum; index += 1) reader.readSe(); }
  }
}

function skipShortTermReferencePictureSets(reader: BitReader, count: number): void {
  const numDeltaPocs: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const predicted = index !== 0 && reader.readBool();
    if (predicted) {
      reader.readBool(); reader.readUe();
      let used = 0; const referenceCount = numDeltaPocs[index - 1] ?? 0;
      for (let item = 0; item <= referenceCount; item += 1) { const usedByCurrent = reader.readBool(); const useDelta = usedByCurrent || reader.readBool(); if (useDelta) used += 1; }
      numDeltaPocs[index] = used;
    } else {
      const negative = reader.readUe(); const positive = reader.readUe();
      for (let item = 0; item < negative + positive; item += 1) { reader.readUe(); reader.readBool(); }
      numDeltaPocs[index] = negative + positive;
    }
  }
}

function parseSlicePpsId(nal: HevcNal): number | undefined {
  if (nal.type > 31) return undefined;
  try { const reader = parameterSetReader(nal.bytes); reader.readBool(); if (nal.type >= 16 && nal.type <= 23) reader.readBool(); return reader.readUe(); } catch { return undefined; }
}

function parameterSetReader(nal: Uint8Array): BitReader {
  return new BitReader(removeEmulationPrevention(nal.subarray(Math.min(2, nal.length))));
}

function removeEmulationPrevention(bytes: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) { if (index >= 2 && bytes[index] === 0x03 && bytes[index - 1] === 0 && bytes[index - 2] === 0) continue; output.push(bytes[index]!); }
  return Uint8Array.from(output);
}

class BitReader {
  private bit = 0;
  constructor(private readonly bytes: Uint8Array) {}
  readBool(): boolean { return this.readBits(1) === 1; }
  readBits(count: number): number { let value = 0; for (let index = 0; index < count; index += 1) { if (this.bit >= this.bytes.length * 8) throw new Error("HEVC RBSP is truncated"); value = value * 2 + ((this.bytes[this.bit >> 3]! >> (7 - (this.bit & 7))) & 1); this.bit += 1; } return value >>> 0; }
  readBigBitsHex(count: number): string { let value = 0n; for (let index = 0; index < count; index += 1) value = (value << 1n) | BigInt(this.readBits(1)); return value.toString(16).padStart(Math.ceil(count / 4), "0"); }
  skipBits(count: number): void { for (let index = 0; index < count; index += 1) this.readBits(1); }
  readUe(): number { let leadingZeroBits = 0; while (!this.readBool()) { leadingZeroBits += 1; if (leadingZeroBits > 31) throw new Error("HEVC Exp-Golomb value is too large"); } return (2 ** leadingZeroBits - 1) + (leadingZeroBits === 0 ? 0 : this.readBits(leadingZeroBits)); }
  readSe(): number { const codeNum = this.readUe(); return codeNum % 2 === 0 ? -(codeNum / 2) : (codeNum + 1) / 2; }
}

function hevcNalTypeName(type: number): string {
  const names: Record<number, string> = { 0: "TRAIL_N", 1: "TRAIL_R", 2: "TSA_N", 3: "TSA_R", 4: "STSA_N", 5: "STSA_R", 6: "RADL_N", 7: "RADL_R", 8: "RASL_N", 9: "RASL_R", 16: "BLA_W_LP", 17: "BLA_W_RADL", 18: "BLA_N_LP", 19: "IDR_W_RADL", 20: "IDR_N_LP", 21: "CRA", 32: "VPS", 33: "SPS", 34: "PPS", 35: "AUD", 39: "SEI_PREFIX", 40: "SEI_SUFFIX" };
  return names[type] ?? (type <= 31 ? `VCL_${type}` : `NAL_${type}`);
}
