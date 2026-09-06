"""Parser estrutural de MPEG-TS: sync, PAT/PMT, PIDs, CC, PCR, PES/PTS/DTS.

Pacotes de 188 bytes; PSI com pointer_field e seções simples (sem seções
multi-pacote além do essencial). Determinístico, sem diagnóstico.
"""

from __future__ import annotations

import struct

from stream_lens.domain.value_objects.containers import (
    ContainerAnalysis,
    TsInfo,
    TsPidStats,
)

PKT = 188

_STREAM_KINDS = {
    0x1B: "video (h264)",
    0x24: "video (h265)",
    0x0F: "audio (aac)",
    0x03: "audio (mp3)",
    0x04: "audio (mp3)",
    0x06: "data (pes private)",
    0x15: "audio (aac adts)",
}


def parse_mpegts(data: bytes) -> ContainerAnalysis:
    packet_count = 0
    sync_errors = 0

    pids: dict[int, dict] = {}
    programs: dict[int, int] = {}

    pos = 0
    while pos < len(data):
        chunk = data[pos : pos + PKT]
        if len(chunk) < PKT:
            sync_errors += len(chunk)
            break
        if chunk[0] != 0x47:
            sync_errors += 1
            pos += 1
            continue
        pos += PKT
        packet_count += 1

        pusi = bool(chunk[1] & 0x40)
        pid = ((chunk[1] & 0x1F) << 8) | chunk[2]
        adaptation = (chunk[3] >> 4) & 0x03
        continuity = chunk[3] & 0x0F

        stats = pids.setdefault(
            pid,
            {
                "pid": pid, "packet_count": 0, "last_cc": None, "continuity_errors": 0,
                "pes_count": 0, "first_pts": None, "last_pts": None,
                "first_dts": None, "pcr_count": 0, "last_pcr": None,
                "discontinuity": False,
            },
        )
        stats["packet_count"] += 1
        if stats["last_cc"] is not None and not stats["discontinuity"]:
            expected = (stats["last_cc"] + 1) & 0x0F
            if adaptation != 0 and continuity != expected:
                stats["continuity_errors"] += 1
        stats["last_cc"] = continuity

        payload_start = 4
        pcr = None
        if adaptation in (0b10, 0b11):
            length = chunk[4]
            end = 5 + length
            if length >= 7 and chunk[5] & 0x10:  # PCR flag
                # base: 33 bits (6 bytes deslocados) + extension de 9 bits ignorada
                pcr = (int.from_bytes(chunk[6:11], "big") >> 7) & 0x1FFFFFFFF
            payload_start = end
        if pcr is not None:
            stats["pcr_count"] += 1
            stats["last_pcr"] = pcr

        payload = chunk[payload_start:]
        if not payload:
            continue

        if pid == 0x0000 and pusi:
            _parse_pat(payload, programs, pids)
        elif pid in programs.values() and pusi:
            _parse_pmt(payload, pids)
        elif pusi and payload[0:3] == b"\x00\x00\x01":
            pts, dts = _parse_pes_timestamps(payload)
            stats["pes_count"] += 1
            if pts is not None:
                stats["first_pts"] = stats["first_pts"] if stats["first_pts"] is not None else pts
                stats["last_pts"] = pts
            if dts is not None and stats["first_dts"] is None:
                stats["first_dts"] = dts

    mapped = tuple(
        TsPidStats(
            pid=p["pid"],
            stream_type=p.get("stream_type"),
            stream_kind=p.get("stream_kind") or _STREAM_KINDS.get(p.get("stream_type", -1)),
            packet_count=p["packet_count"],
            continuity_errors=p["continuity_errors"],
            pes_count=p["pes_count"],
            first_pts=p["first_pts"],
            last_pts=p["last_pts"],
            first_dts=p["first_dts"],
            pcr_count=p["pcr_count"],
            last_pcr=p["last_pcr"],
        )
        for p in sorted(pids.values(), key=lambda x: x["pid"])
    )
    info = TsInfo(
        packet_count=packet_count,
        sync_errors=sync_errors,
        pids=mapped,
        programs={str(k): v for k, v in programs.items()},
    )
    return ContainerAnalysis(kind="mpeg-ts", ts=info)


def _parse_pat(payload: bytes, programs: dict[int, int], pids: dict) -> None:
    pointer = payload[0]
    section = payload[1 + pointer :]
    if len(section) < 8 or section[0] != 0x00:
        return
    section_length = ((section[1] & 0x0F) << 8) | section[2]
    entries = section[8 : 8 + section_length - 5 - 4]
    for i in range(0, len(entries) - 3, 4):
        program_number = struct.unpack_from(">H", entries, i)[0]
        pmt_pid = ((entries[i + 2] & 0x1F) << 8) | entries[i + 3]
        if program_number != 0:  # 0 = network PID
            programs[program_number] = pmt_pid
            pids.setdefault(pmt_pid, _new_pid(pmt_pid))


def _parse_pmt(payload: bytes, pids: dict) -> None:
    pointer = payload[0]
    section = payload[1 + pointer :]
    if len(section) < 12 or section[0] != 0x02:
        return
    section_length = ((section[1] & 0x0F) << 8) | section[2]
    program_info_length = ((section[10] & 0x0F) << 8) | section[11]
    pos = 12 + program_info_length
    end = 3 + section_length - 4
    while pos + 5 <= min(end, len(section)):
        stream_type = section[pos]
        elementary_pid = ((section[pos + 1] & 0x1F) << 8) | section[pos + 2]
        es_info_length = ((section[pos + 3] & 0x0F) << 8) | section[pos + 4]
        stats = pids.setdefault(elementary_pid, _new_pid(elementary_pid))
        stats["stream_type"] = stream_type
        pos += 5 + es_info_length


def _parse_pes_timestamps(payload: bytes) -> tuple[int | None, int | None]:
    if len(payload) < 9 or payload[0:3] != b"\x00\x00\x01":
        return None, None
    stream_id = payload[3]
    if 0xBC in (stream_id,) or stream_id == 0xBE:  # sem PTS
        return None, None
    header_data_length = payload[8]
    flags = payload[7]
    pos = 9
    pts = dts = None
    if flags & 0x80 and pos + 5 <= len(payload):
        pts = _read_ts33(payload[pos : pos + 5])
        pos += 5
    if flags & 0x40 and pos + 5 <= len(payload):
        dts = _read_ts33(payload[pos : pos + 5])
    _ = header_data_length
    return pts, dts


def _read_ts33(b: bytes) -> int:
    return (
        ((b[0] >> 1) & 0x07) << 30
        | b[1] << 22
        | (b[2] >> 1) << 15
        | b[3] << 7
        | (b[4] >> 1)
    )


def _new_pid(pid: int) -> dict:
    return {
        "pid": pid, "packet_count": 0, "last_cc": None, "continuity_errors": 0,
        "pes_count": 0, "first_pts": None, "last_pts": None,
        "first_dts": None, "pcr_count": 0, "last_pcr": None,
        "discontinuity": False,
    }
