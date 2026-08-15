export type TsSanity = {
  isTs: boolean;
  packetCount: number;
  syncErrors: number;
  hasPat: boolean;
  hasPmt: boolean;
  hasPcr: boolean;
  pcrDiscontinuities: number;
  continuityDiscontinuities: number;
  truncatedTail: boolean;
};

const TS_PACKET_LENGTH = 188;
const SYNC_BYTE = 0x47;
const PAT_PID = 0;
const NULL_PID = 0x1fff;

export function looksLikeMpegTs(bytes: Uint8Array): boolean {
  return bytes.byteLength >= TS_PACKET_LENGTH && bytes[0] === SYNC_BYTE;
}

export function inspectTsSanity(bytes: Uint8Array): TsSanity {
  const packetCount = Math.floor(bytes.byteLength / TS_PACKET_LENGTH);
  const truncatedTail = bytes.byteLength % TS_PACKET_LENGTH !== 0;
  let syncErrors = 0;
  let hasPat = false;
  let hasPmt = false;
  let hasPcr = false;
  let pcrDiscontinuities = 0;
  let continuityDiscontinuities = 0;
  const lastContinuity = new Map<number, number>();
  const pmtPids = new Set<number>();
  let lastPcr: number | undefined;

  for (let index = 0; index < packetCount; index += 1) {
    const offset = index * TS_PACKET_LENGTH;
    if (bytes[offset] !== SYNC_BYTE) {
      syncErrors += 1;
      continue;
    }
    const pid = ((bytes[offset + 1]! & 0x1f) << 8) | bytes[offset + 2]!;
    const flags = bytes[offset + 3]!;
    const continuityCounter = flags & 0x0f;
    const adaptationFieldControl = (flags >> 4) & 0x03;
    const hasPayload = adaptationFieldControl === 1 || adaptationFieldControl === 3;

    if (pid === PAT_PID) {
      hasPat = true;
      collectPmtPids(bytes, offset, pmtPids);
    } else if (pmtPids.has(pid)) {
      hasPmt = true;
    }

    if (pid !== NULL_PID && hasPayload) {
      const previous = lastContinuity.get(pid);
      if (previous !== undefined && continuityCounter !== ((previous + 1) & 0x0f)) {
        continuityDiscontinuities += 1;
      }
      lastContinuity.set(pid, continuityCounter);
    }

    if (adaptationFieldControl === 2 || adaptationFieldControl === 3) {
      const pcr = parsePcr(bytes, offset);
      if (pcr !== undefined) {
        hasPcr = true;
        if (lastPcr !== undefined) {
          const delta = pcr - lastPcr;
          if (delta < 0 || delta > 27_000_000) pcrDiscontinuities += 1;
        }
        lastPcr = pcr;
      }
    }
  }

  return {
    isTs: syncErrors < packetCount,
    packetCount,
    syncErrors,
    hasPat,
    hasPmt,
    hasPcr,
    pcrDiscontinuities,
    continuityDiscontinuities,
    truncatedTail,
  };
}

function collectPmtPids(bytes: Uint8Array, offset: number, target: Set<number>): void {
  const payloadStart = adaptationFieldStart(bytes, offset);
  if (payloadStart === undefined) return;
  const pointerField = bytes[payloadStart];
  const tableStart = payloadStart + 1 + (pointerField ?? 0);
  if (tableStart + 8 > offset + TS_PACKET_LENGTH) return;
  if (bytes[tableStart] !== 0x00) return;
  const sectionLength = ((bytes[tableStart + 1]! & 0x0f) << 8) | bytes[tableStart + 2]!;
  const end = Math.min(tableStart + 3 + sectionLength, offset + TS_PACKET_LENGTH);
  let cursor = tableStart + 8;
  while (cursor + 4 <= end) {
    const programNumber = (bytes[cursor]! << 8) | bytes[cursor + 1]!;
    const programMapPid = ((bytes[cursor + 2]! & 0x1f) << 8) | bytes[cursor + 3]!;
    if (programNumber !== 0) target.add(programMapPid);
    cursor += 4;
  }
}

function parsePcr(bytes: Uint8Array, offset: number): number | undefined {
  const adaptationFieldStartIndex = offset + 4;
  if (adaptationFieldStartIndex + 1 >= offset + TS_PACKET_LENGTH) return undefined;
  const adaptationFieldLength = bytes[adaptationFieldStartIndex]!;
  const flagsIndex = adaptationFieldStartIndex + 1;
  if (adaptationFieldLength < 1 || flagsIndex + 6 > offset + TS_PACKET_LENGTH) return undefined;
  const flags = bytes[flagsIndex]!;
  if ((flags & 0x10) === 0) return undefined;
  const base = ((bytes[flagsIndex + 1]! & 0xff) << 25)
    | ((bytes[flagsIndex + 2]! & 0xff) << 17)
    | ((bytes[flagsIndex + 3]! & 0xff) << 9)
    | ((bytes[flagsIndex + 4]! & 0xff) << 1)
    | ((bytes[flagsIndex + 5]! >> 7) & 0x01);
  return base;
}

function adaptationFieldStart(bytes: Uint8Array, offset: number): number | undefined {
  const controlByte = bytes[offset + 3]!;
  if ((controlByte & 0x20) !== 0) {
    const length = bytes[offset + 4]!;
    return offset + 5 + length;
  }
  return offset + 4;
}
