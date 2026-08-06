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
};

export type Fmp4FragmentInspection = {
  sequenceNumber?: number;
  baseMediaDecodeTime?: bigint;
  samples: Fmp4Sample[];
  boxTypes: string[];
  structuralErrors: string[];
};

export type Fmp4InitInspection = {
  fourcc?: "hvc1" | "hev1" | string;
  timescale?: number;
  nalLengthSize?: number;
  hevc?: {
    profileIdc: number;
    levelIdc: number;
    tierFlag: boolean;
    chromaFormat: number;
    bitDepthLuma: number;
    bitDepthChroma: number;
    parameterSetHashes: Partial<Record<"vps" | "sps" | "pps", string[]>>;
  };
  boxTypes: string[];
  structuralErrors: string[];
};

type Box = { type: string; start: number; end: number; headerSize: number; payloadStart: number; payloadEnd: number; children: Box[] };

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "mvex", "moof", "traf", "edts", "dinf", "sinf", "schi"]);

export function inspectFmp4Fragment(bytes: Uint8Array, nalLengthSize = 4): Fmp4FragmentInspection {
  const errors: string[] = [];
  const roots = parseBoxes(bytes, 0, bytes.byteLength, errors);
  const all = flatten(roots);
  const moof = all.find((box) => box.type === "moof");
  const mdat = all.find((box) => box.type === "mdat");
  const mfhd = all.find((box) => box.type === "mfhd");
  const sequenceNumber = mfhd && mfhd.payloadEnd - mfhd.payloadStart >= 8 ? u32(bytes, mfhd.payloadStart + 4) : undefined;
  if (!moof) errors.push("Fragment has no moof box.");
  if (!mdat) errors.push("Fragment has no mdat box.");
  const traf = moof ? descendants(moof, "traf")[0] : undefined;
  const tfdt = traf ? descendants(traf, "tfdt")[0] : undefined;
  const tfhd = traf ? descendants(traf, "tfhd")[0] : undefined;
  const truns = traf ? descendants(traf, "trun") : [];
  const baseMediaDecodeTime = tfdt ? parseTfdt(bytes, tfdt, errors) : undefined;
  const defaults = tfhd ? parseTfhd(bytes, tfhd, errors) : {};
  const samples: Fmp4Sample[] = [];
  let decodeCursor = baseMediaDecodeTime;
  for (const trun of truns) {
    const parsed = parseTrun(bytes, trun, defaults, errors);
    for (const record of parsed.samples) {
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
      } satisfies Fmp4Sample;
      samples.push(sample);
      if (decodeCursor !== undefined && record.duration !== undefined) decodeCursor += record.duration;
    }
  }
  if (mdat && samples.length > 0) {
    let position = mdat.payloadStart;
    for (const sample of samples) {
      if (sample.size === undefined) { errors.push("trun/tfhd does not provide sample sizes; NAL boundaries could not be validated."); break; }
      if (position + sample.size > mdat.payloadEnd) { errors.push("Declared sample bytes exceed the mdat payload."); break; }
      const nals = hevcNalTypes(bytes.subarray(position, position + sample.size), nalLengthSize);
      sample.nalTypes = nals;
      if (nals[0] !== undefined) sample.firstNalType = nals[0];
      position += sample.size;
    }
    const declared = samples.reduce((sum, sample) => sum + (sample.size ?? 0), 0);
    if (declared !== mdat.payloadEnd - mdat.payloadStart) errors.push("trun sample sizes do not exactly cover mdat payload.");
  }
  return { ...(sequenceNumber === undefined ? {} : { sequenceNumber }), ...(baseMediaDecodeTime === undefined ? {} : { baseMediaDecodeTime }), samples, boxTypes: all.map((box) => box.type), structuralErrors: errors };
}

export function inspectFmp4Init(bytes: Uint8Array): Fmp4InitInspection {
  const errors: string[] = [];
  const roots = parseBoxes(bytes, 0, bytes.byteLength, errors);
  const all = flatten(roots);
  const mdhd = all.find((box) => box.type === "mdhd");
  const timescale = mdhd ? parseMdhdTimescale(bytes, mdhd, errors) : undefined;
  const sampleEntry = all.find((box) => box.type === "hvc1" || box.type === "hev1");
  const hvcc = all.find((box) => box.type === "hvcC");
  const parsedHevc = hvcc ? parseHvcc(bytes.subarray(hvcc.payloadStart, hvcc.payloadEnd), errors) : undefined;
  return {
    ...(sampleEntry ? { fourcc: sampleEntry.type } : {}),
    ...(timescale === undefined ? {} : { timescale }),
    ...(parsedHevc?.nalLengthSize === undefined ? {} : { nalLengthSize: parsedHevc.nalLengthSize }),
    ...(parsedHevc?.hevc ? { hevc: parsedHevc.hevc } : {}),
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
    else if (type === "hvc1" || type === "hev1") {
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
function u32(bytes: Uint8Array, offset: number): number { return ((bytes[offset]! * 0x1000000) + ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)) >>> 0; }
function u64(bytes: Uint8Array, offset: number): bigint { return (BigInt(u32(bytes, offset)) << 32n) | BigInt(u32(bytes, offset + 4)); }
function i32(bytes: Uint8Array, offset: number): number { const value = u32(bytes, offset); return value > 0x7fffffff ? value - 0x100000000 : value; }
function ascii(bytes: Uint8Array, start: number, end: number): string { return String.fromCharCode(...bytes.subarray(start, end)); }
function fullBox(bytes: Uint8Array, box: Box): { version: number; flags: number } { return { version: bytes[box.payloadStart] ?? 0, flags: ((bytes[box.payloadStart + 1] ?? 0) << 16) | ((bytes[box.payloadStart + 2] ?? 0) << 8) | (bytes[box.payloadStart + 3] ?? 0) }; }
function parseTfdt(bytes: Uint8Array, box: Box, errors: string[]): bigint | undefined { const { version } = fullBox(bytes, box); const offset = box.payloadStart + 4; const needed = version === 1 ? 8 : 4; if (offset + needed > box.payloadEnd) { errors.push("tfdt is truncated."); return undefined; } return version === 1 ? u64(bytes, offset) : BigInt(u32(bytes, offset)); }
function parseTfhd(bytes: Uint8Array, box: Box, errors: string[]): { duration?: bigint; size?: number; flags?: number } { const { flags } = fullBox(bytes, box); let cursor = box.payloadStart + 8; if (cursor > box.payloadEnd) { errors.push("tfhd is truncated."); return {}; } if (flags & 0x000001) cursor += 8; if (flags & 0x000002) cursor += 4; let duration: bigint | undefined; let size: number | undefined; let sampleFlags: number | undefined; if (flags & 0x000008) { if (cursor + 4 > box.payloadEnd) return {}; duration = BigInt(u32(bytes, cursor)); cursor += 4; } if (flags & 0x000010) { if (cursor + 4 > box.payloadEnd) return {}; size = u32(bytes, cursor); cursor += 4; } if (flags & 0x000020) { if (cursor + 4 > box.payloadEnd) return {}; sampleFlags = u32(bytes, cursor); } return { ...(duration === undefined ? {} : { duration }), ...(size === undefined ? {} : { size }), ...(sampleFlags === undefined ? {} : { flags: sampleFlags }) }; }
function parseTrun(bytes: Uint8Array, box: Box, defaults: { duration?: bigint; size?: number; flags?: number }, errors: string[]): { samples: Array<{ duration?: bigint; size?: number; flags?: number; compositionOffset?: bigint }> } { const { version, flags } = fullBox(bytes, box); let cursor = box.payloadStart + 4; if (cursor + 4 > box.payloadEnd) { errors.push("trun is truncated."); return { samples: [] }; } const count = u32(bytes, cursor); cursor += 4; if (flags & 0x000001) cursor += 4; let firstSampleFlags: number | undefined; if (flags & 0x000004) { if (cursor + 4 > box.payloadEnd) { errors.push("trun first-sample-flags is truncated."); return { samples: [] }; } firstSampleFlags = u32(bytes, cursor); cursor += 4; }
  const samples: Array<{ duration?: bigint; size?: number; flags?: number; compositionOffset?: bigint }> = [];
  for (let index = 0; index < count; index += 1) { let duration = defaults.duration; let size = defaults.size; let sampleFlags = index === 0 && firstSampleFlags !== undefined ? firstSampleFlags : defaults.flags; let compositionOffset: bigint | undefined;
    if (flags & 0x000100) { if (cursor + 4 > box.payloadEnd) break; duration = BigInt(u32(bytes, cursor)); cursor += 4; }
    if (flags & 0x000200) { if (cursor + 4 > box.payloadEnd) break; size = u32(bytes, cursor); cursor += 4; }
    if (flags & 0x000400) { if (cursor + 4 > box.payloadEnd) break; sampleFlags = u32(bytes, cursor); cursor += 4; }
    if (flags & 0x000800) { if (cursor + 4 > box.payloadEnd) break; compositionOffset = BigInt(version === 1 ? i32(bytes, cursor) : u32(bytes, cursor)); cursor += 4; }
    samples.push({ ...(duration === undefined ? {} : { duration }), ...(size === undefined ? {} : { size }), ...(sampleFlags === undefined ? {} : { flags: sampleFlags }), ...(compositionOffset === undefined ? {} : { compositionOffset }) }); }
  if (samples.length !== count) errors.push("trun declares more samples than its bytes contain."); return { samples }; }
function parseMdhdTimescale(bytes: Uint8Array, box: Box, errors: string[]): number | undefined { const { version } = fullBox(bytes, box); const offset = box.payloadStart + (version === 1 ? 20 : 12); if (offset + 4 > box.payloadEnd) { errors.push("mdhd is truncated."); return undefined; } return u32(bytes, offset); }
function parseHvcc(bytes: Uint8Array, errors: string[]): { nalLengthSize?: number; hevc?: Fmp4InitInspection["hevc"] } { if (bytes.length < 23) { errors.push("hvcC is truncated."); return {}; } const arrays = new Map<number, string[]>(); let cursor = 23; const arrayCount = bytes[22]!; for (let index = 0; index < arrayCount; index += 1) { if (cursor + 3 > bytes.length) { errors.push("hvcC parameter array is truncated."); break; } const type = bytes[cursor]! & 0x3f; const count = (bytes[cursor + 1]! << 8) | bytes[cursor + 2]!; cursor += 3; const hashes: string[] = []; for (let item = 0; item < count; item += 1) { if (cursor + 2 > bytes.length) { errors.push("hvcC parameter set length is truncated."); break; } const length = (bytes[cursor]! << 8) | bytes[cursor + 1]!; cursor += 2; if (cursor + length > bytes.length) { errors.push("hvcC parameter set is truncated."); break; } hashes.push(createHash("sha256").update(bytes.subarray(cursor, cursor + length)).digest("hex")); cursor += length; } arrays.set(type, hashes); }
  const vps = arrays.get(32); const sps = arrays.get(33); const pps = arrays.get(34);
  return { nalLengthSize: (bytes[21]! & 0x03) + 1, hevc: { profileIdc: bytes[1]! & 0x1f, tierFlag: (bytes[1]! & 0x20) !== 0, levelIdc: bytes[12]!, chromaFormat: bytes[16]! & 0x03, bitDepthLuma: (bytes[17]! & 0x07) + 8, bitDepthChroma: (bytes[18]! & 0x07) + 8, parameterSetHashes: { ...(vps ? { vps } : {}), ...(sps ? { sps } : {}), ...(pps ? { pps } : {}) } } }; }
function hevcNalTypes(bytes: Uint8Array, lengthSize: number): number[] { const types: number[] = []; let cursor = 0; while (cursor + lengthSize + 2 <= bytes.length) { let length = 0; for (let index = 0; index < lengthSize; index += 1) length = length * 256 + bytes[cursor + index]!; cursor += lengthSize; if (length < 2 || cursor + length > bytes.length) break; types.push((bytes[cursor]! >> 1) & 0x3f); cursor += length; } return types; }
