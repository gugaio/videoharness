import { describe, expect, it } from "vitest";
import { inspectFmp4Fragment, inspectFmp4Init } from "./isobmff.js";

describe("ISO BMFF deterministic inspection", () => {
  it("extracts track/sample-entry/hvcC/trex facts from an INIT", () => {
    const init = inspectFmp4Init(initFixture());
    expect(init.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(init.ftyp).toEqual({ majorBrand: "iso6", compatibleBrands: ["iso6", "dash"] });
    expect(init.mvhd).toMatchObject({ timescale: 1_000, duration: "4000" });
    expect(init.tracks[0]).toMatchObject({ trackId: 7, tkhdWidth: 1920, tkhdHeight: 1080, timescale: 90_000, handlerType: "vide" });
    expect(init.tracks[0]?.sampleEntries[0]).toMatchObject({ codingName: "hev1", codedWidth: 1920, codedHeight: 1080 });
    expect(init.hevc).toMatchObject({ configurationVersion: 1, generalProfileIdc: 2, generalLevelIdc: 153, bitDepthLumaMinus8: 2, bitDepthChromaMinus8: 2, lengthSizeMinusOne: 3 });
    expect(init.hevc?.parameterSets.map((item) => item.nalType)).toEqual(["VPS", "SPS", "PPS"]);
    expect(init.trex[0]).toMatchObject({ trackId: 7, defaultSampleDescriptionIndex: 1, defaultSampleDuration: 3_000 });
  });

  it("extracts moof timing, trun samples and HEVC IRAP evidence", () => {
    const fragment = inspectFmp4Fragment(fragmentFixture(), 4);
    expect(fragment.styp).toEqual({ majorBrand: "msdh", compatibleBrands: ["msdh", "msix"] });
    expect(fragment.sequenceNumber).toBe(12);
    expect(fragment.baseMediaDecodeTime).toBe(360_000n);
    expect(fragment.trafs[0]).toMatchObject({ tfhd: { trackId: 7 }, tfdt: { version: 1, baseMediaDecodeTime: "360000" }, truns: [{ sampleCount: 1 }] });
    expect(fragment.samples[0]).toMatchObject({ dts: 360_000n, pts: 360_000n, duration: 3_000n, size: 7, sync: true, nalTypes: [19] });
    expect(fragment.samples[0]?.accessUnit).toMatchObject({ firstVclNalType: "IDR_W_RADL", isIrap: true, irapType: "IDR_W_RADL" });
    expect(fragment.structuralErrors).toEqual([]);
  });
});

function initFixture(): Uint8Array {
  const ftyp = box("ftyp", ascii("iso6"), u32(1), ascii("iso6dash"));
  const mvhd = box("mvhd", full(0, 0, concat(u32(0), u32(0), u32(1_000), u32(4_000), new Uint8Array(80))));
  const tkhdBody = concat(u32(0), u32(0), u32(7), u32(0), u32(360_000), new Uint8Array(8), u16(0), u16(0), u16(0), u16(0), new Uint8Array(36), fixed(1920), fixed(1080));
  const tkhd = box("tkhd", full(0, 7, tkhdBody));
  const mdhd = box("mdhd", full(0, 0, concat(u32(0), u32(0), u32(90_000), u32(360_000), u16(0), u16(0))));
  const hdlr = box("hdlr", full(0, 0, concat(u32(0), ascii("vide"), new Uint8Array(12))));
  const hvcc = box("hvcC", hvccFixture());
  const visual = new Uint8Array(78); visual.set(u16(1), 6); visual.set(u16(1920), 24); visual.set(u16(1080), 26);
  const hev1 = box("hev1", visual, hvcc);
  const stsd = box("stsd", full(0, 0, concat(u32(1), hev1)));
  const stbl = box("stbl", stsd); const minf = box("minf", stbl); const mdia = box("mdia", mdhd, hdlr, minf); const trak = box("trak", tkhd, mdia);
  const trex = box("trex", full(0, 0, concat(u32(7), u32(1), u32(3_000), u32(0), u32(0))));
  return box("root", ftyp, box("moov", mvhd, trak, box("mvex", trex))).subarray(8);
}

function fragmentFixture(): Uint8Array {
  const styp = box("styp", ascii("msdh"), u32(0), ascii("msdhmsix"));
  const mfhd = box("mfhd", full(0, 0, u32(12)));
  const tfhd = box("tfhd", full(0, 0, u32(7)));
  const tfdt = box("tfdt", full(1, 0, u64(360_000n)));
  const trun = box("trun", full(0, 0x000f01, concat(u32(1), i32(0), u32(3_000), u32(7), u32(0), u32(0))));
  const moof = box("moof", mfhd, box("traf", tfhd, tfdt, trun));
  const nal = Uint8Array.from([0x26, 0x01, 0x80]);
  const mdat = box("mdat", u32(nal.byteLength), nal);
  return concat(styp, moof, mdat);
}

function hvccFixture(): Uint8Array {
  const header = new Uint8Array(23); header[0] = 1; header[1] = 2; header[5] = 4; header[12] = 153; header[13] = 0xf0; header[15] = 0xfc; header[16] = 0xfd; header[17] = 0xfa; header[18] = 0xfa; header[21] = 0x0f; header[22] = 3;
  return concat(header, hvccArray(32, Uint8Array.from([0x40, 0x01, 0x00])), hvccArray(33, Uint8Array.from([0x42, 0x01, 0x80])), hvccArray(34, Uint8Array.from([0x44, 0x01, 0xc0])));
}
function hvccArray(type: number, nal: Uint8Array): Uint8Array { return concat(Uint8Array.from([type, 0, 1]), u16(nal.byteLength), nal); }
function box(type: string, ...payload: Uint8Array[]): Uint8Array { const body = concat(...payload); return concat(u32(body.byteLength + 8), ascii(type), body); }
function full(version: number, flags: number, body: Uint8Array): Uint8Array { return concat(Uint8Array.from([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), body); }
function concat(...parts: Uint8Array[]): Uint8Array { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0)); let cursor = 0; for (const part of parts) { result.set(part, cursor); cursor += part.byteLength; } return result; }
function ascii(value: string): Uint8Array { return new TextEncoder().encode(value); }
function u16(value: number): Uint8Array { return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff]); }
function u32(value: number): Uint8Array { return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]); }
function i32(value: number): Uint8Array { return u32(value >>> 0); }
function u64(value: bigint): Uint8Array { return concat(u32(Number(value >> 32n)), u32(Number(value & 0xffffffffn))); }
function fixed(value: number): Uint8Array { return u32(value * 65_536); }
