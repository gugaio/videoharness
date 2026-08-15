import { describe, expect, it } from "vitest";
import { inspectTsSanity, looksLikeMpegTs } from "./ts-sanity.js";

function packet(pid: number, continuity: number, payload?: Uint8Array, flags = 1): Uint8Array {
  const buffer = new Uint8Array(188);
  buffer[0] = 0x47;
  buffer[1] = (pid >> 8) & 0x1f;
  buffer[2] = pid & 0xff;
  buffer[3] = (flags << 4) | (continuity & 0x0f);
  if (payload) buffer.set(payload.subarray(0, 184), 4);
  return buffer;
}

function patPacket(continuity: number): Uint8Array {
  // PAT: pointer 0, table_id 0x00, section_length covering the 4-byte program loop.
  const payload = new Uint8Array([
    0x00, // pointer_field
    0x00, // table_id PAT
    0xb0, 0x0d, // section_syntax + length 13
    0x00, 0x01, // transport_stream_id
    0xc1, 0x00, 0x00, // version, section_number, last_section_number
    0x00, 0x01, // program_number 1
    0xe1, 0x10, // program_map_PID 0x110
    0x00, 0x00, 0x00, 0x00, // CRC (ignored)
  ]);
  const base = packet(0x0000, continuity, payload);
  base[1] = (base[1] ?? 0) | 0x40; // payload_unit_start_indicator
  return base;
}

function pcrPacket(pid: number, continuity: number, pcrBase: number): Uint8Array {
  const buffer = packet(pid, continuity, undefined, 2);
  buffer[4] = 7; // adaptation field length
  buffer[5] = 0x10; // PCR flag
  buffer[6] = (pcrBase >> 25) & 0xff;
  buffer[7] = (pcrBase >> 17) & 0xff;
  buffer[8] = (pcrBase >> 9) & 0xff;
  buffer[9] = (pcrBase >> 1) & 0xff;
  buffer[10] = (pcrBase & 0x01) << 7;
  return buffer;
}

describe("inspectTsSanity", () => {
  it("recognizes a well-formed transport stream with PAT, PMT and PCR", () => {
    const pmtPacket = packet(0x110, 0);
    const video = packet(0x100, 0, new TextEncoder().encode("video"));
    const bytes = new Uint8Array([
      ...patPacket(0),
      ...pmtPacket,
      ...pcrPacket(0x100, 1, 90_000),
      ...video,
    ]);

    const result = inspectTsSanity(bytes);

    expect(result.isTs).toBe(true);
    expect(result.packetCount).toBe(4);
    expect(result.syncErrors).toBe(0);
    expect(result.hasPat).toBe(true);
    expect(result.hasPmt).toBe(true);
    expect(result.hasPcr).toBe(true);
    expect(result.continuityDiscontinuities).toBe(0);
    expect(result.pcrDiscontinuities).toBe(0);
    expect(result.truncatedTail).toBe(false);
  });

  it("detects sync loss, a truncated tail and continuity discontinuities", () => {
    const bytes = new Uint8Array(188 * 2 + 10);
    bytes[0] = 0x47;
    bytes[188] = 0x99;
    const result = inspectTsSanity(bytes);

    expect(result.packetCount).toBe(2);
    expect(result.syncErrors).toBe(1);
    expect(result.truncatedTail).toBe(true);

    const discontinuous = inspectTsSanity(new Uint8Array([
      ...packet(0x100, 3, new TextEncoder().encode("a")),
      ...packet(0x100, 7, new TextEncoder().encode("b")),
    ]));
    expect(discontinuous.continuityDiscontinuities).toBe(1);
  });

  it("detects PCR discontinuities and stays quiet when PCRs are continuous", () => {
    const continuous = inspectTsSanity(new Uint8Array([
      ...pcrPacket(0x100, 0, 90_000),
      ...pcrPacket(0x100, 1, 90_000 + 9_000),
    ]));
    expect(continuous.pcrDiscontinuities).toBe(0);

    const discontinuous = inspectTsSanity(new Uint8Array([
      ...pcrPacket(0x100, 0, 90_000),
      ...pcrPacket(0x100, 1, 45_000),
    ]));
    expect(discontinuous.pcrDiscontinuities).toBe(1);
  });

  it("flags non-MPEG-TS bytes as not a transport stream", () => {
    expect(looksLikeMpegTs(new TextEncoder().encode("not-ts"))).toBe(false);
    expect(looksLikeMpegTs(new Uint8Array(188))).toBe(false);
  });
});
