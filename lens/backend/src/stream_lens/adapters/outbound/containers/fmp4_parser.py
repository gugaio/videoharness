"""Parser estrutural de ISOBMFF/fMP4 (CMAF): árvore de boxes + campos-chave.

Percorre boxes recursivamente (containers conhecidos), extraindo apenas o
que a UI precisa — sem demux, sem codec. Truncamentos marcam `truncated`.
"""

from __future__ import annotations

import struct

from stream_lens.domain.value_objects.containers import (
    BoxNode,
    ContainerAnalysis,
    ContainerSample,
    Fmp4Info,
    HdrInfo,
)

_CONTAINER_BOXES = {
    "moov", "trak", "mdia", "minf", "stbl", "mvex", "moof", "traf",
    "mfra", "udta", "edts", "dinf",
}
_MAX_SAMPLES = 1_000


def parse_fmp4(
    data: bytes, is_init: bool, init_info: Fmp4Info | None = None
) -> ContainerAnalysis:
    boxes: list[BoxNode] = []
    truncated = False
    offset = 0
    while offset + 8 <= len(data):
        node, consumed, box_truncated = _parse_box(data, offset, len(data))
        if node is None:
            break
        boxes.append(node)
        offset += consumed
        truncated = truncated or box_truncated
        if consumed <= 0:
            break
    if not boxes:
        return ContainerAnalysis(kind="mp4", error="nenhum box parseável")

    info = Fmp4Info(is_init=is_init, boxes=tuple(boxes), truncated=truncated)
    info = _summarize(info, data, init_info=init_info)
    samples, samples_truncated = _extract_samples(info, data, init_info=init_info)
    return ContainerAnalysis(
        kind="mp4",
        fmp4=info,
        samples=samples,
        samples_truncated=samples_truncated,
    )


def _parse_box(
    data: bytes, offset: int, end: int
) -> tuple[BoxNode | None, int, bool]:
    header_size = 8
    if offset + 8 > end:
        return None, 0, True
    size = struct.unpack_from(">I", data, offset)[0]
    box_type = data[offset + 4 : offset + 8].decode("latin-1")
    if size == 1:
        if offset + 16 > end:
            return None, 0, True
        size = struct.unpack_from(">Q", data, offset + 8)[0]
        header_size = 16
    elif size == 0:
        size = end - offset  # box vai até o fim do pai/arquivo
    if size < header_size or offset + size > end:
        # box truncado: ainda reportamos com o que há
        node = BoxNode(type=box_type, offset=offset, size=size,
                       fields={"truncated": True})
        return node, end - offset, True

    payload = data[offset + header_size : offset + size]
    children: tuple[BoxNode, ...] = ()
    fields: dict = {}
    if box_type in _CONTAINER_BOXES:
        children = _parse_children(data, offset + header_size, offset + size)
    elif box_type == "stsd":
        fields, children = _parse_stsd(data, offset + header_size, payload)
    else:
        fields = _parse_fields(box_type, payload)

    return (
        BoxNode(type=box_type, offset=offset, size=size, fields=fields, children=children),
        size,
        False,
    )


def _parse_children(data: bytes, start: int, end: int) -> tuple[BoxNode, ...]:
    children: list[BoxNode] = []
    pos = start
    while pos + 8 <= end:
        node, consumed, _ = _parse_box(data, pos, end)
        if node is None or consumed <= 0:
            break
        children.append(node)
        pos += consumed
    return tuple(children)


def _parse_stsd(
    data: bytes, payload_start: int, payload: bytes
) -> tuple[dict, tuple[BoxNode, ...]]:
    """Expande sample entries visuais para alcançar colr/mdcv/clli/hvcC.

    `stsd` não é um container ISOBMFF comum: após FullBox + entry_count há
    sample entries, cada uma com um cabeçalho próprio antes dos child boxes.
    """
    try:
        entry_count = struct.unpack_from(">I", payload, 4)[0]
    except struct.error:
        return {"parse_error": True}, ()

    entries: list[BoxNode] = []
    pos = payload_start + 8
    end = payload_start + len(payload)
    for _ in range(entry_count):
        if pos + 8 > end:
            return {"entry_count": entry_count, "parse_error": True}, tuple(entries)
        entry_size = struct.unpack_from(">I", data, pos)[0]
        entry_type = data[pos + 4 : pos + 8].decode("latin-1")
        if entry_size < 8 or pos + entry_size > end:
            return {"entry_count": entry_count, "parse_error": True}, tuple(entries)
        # VisualSampleEntry tem 78 bytes após size/type. Outros entry types são
        # preservados como nó opaco, sem assumir seu layout.
        child_start = pos + 8 + 78
        children = (
            _parse_children(data, child_start, pos + entry_size)
            if entry_type in {"avc1", "avc3", "hvc1", "hev1", "dvhe", "dvh1"}
            and child_start <= pos + entry_size
            else ()
        )
        entries.append(
            BoxNode(
                type=entry_type,
                offset=pos,
                size=entry_size,
                fields={"sample_entry": True},
                children=children,
            )
        )
        pos += entry_size
    return {"entry_count": entry_count}, tuple(entries)


def _parse_fields(box_type: str, payload: bytes) -> dict:
    try:
        if box_type == "ftyp":
            brand = payload[0:4].decode("latin-1")
            compat = [
                payload[i : i + 4].decode("latin-1")
                for i in range(8, len(payload) - 3, 4)
            ]
            return {"major_brand": brand, "compatible_brands": compat}
        if box_type == "styp":
            brand = payload[0:4].decode("latin-1")
            return {"major_brand": brand}
        if box_type == "mvhd":
            version = payload[0]
            if version == 1:
                timescale = struct.unpack_from(">I", payload, 20)[0]
                duration = struct.unpack_from(">Q", payload, 24)[0]
            else:
                timescale = struct.unpack_from(">I", payload, 12)[0]
                duration = struct.unpack_from(">I", payload, 16)[0]
            return {"timescale": timescale, "duration": duration}
        if box_type == "tkhd":
            version = payload[0]
            track_id = struct.unpack_from(">I", payload, 12 if version == 0 else 20)[0]
            return {"track_id": track_id}
        if box_type == "mdhd":
            version = payload[0]
            timescale_offset = 12 if version == 0 else 20
            duration_offset = 16 if version == 0 else 24
            timescale = struct.unpack_from(">I", payload, timescale_offset)[0]
            duration_format = ">I" if version == 0 else ">Q"
            duration = struct.unpack_from(duration_format, payload, duration_offset)[0]
            return {"timescale": timescale, "duration": duration}
        if box_type == "hdlr":
            return {"handler_type": payload[8:12].decode("latin-1")}
        if box_type == "stsd":
            return {"entry_count": struct.unpack_from(">I", payload, 4)[0]}
        if box_type == "colr" and payload[0:4] == b"nclx":
            primaries, transfer, matrix = struct.unpack_from(">HHH", payload, 4)
            return {
                "color_type": "nclx",
                "color_primaries": _CICP_PRIMARIES.get(primaries, f"unspecified ({primaries})"),
                "transfer_characteristics": _CICP_TRANSFER.get(
                    transfer, f"unspecified ({transfer})"
                ),
                "matrix_coefficients": _CICP_MATRIX.get(matrix, f"unspecified ({matrix})"),
                "full_range": bool(payload[10] & 0x80),
            }
        if box_type == "mdcv":
            values = struct.unpack_from(">HHHHHHHHII", payload, 0)
            return {
                "display_primaries": {
                    "red": [values[0] / 50000, values[1] / 50000],
                    "green": [values[2] / 50000, values[3] / 50000],
                    "blue": [values[4] / 50000, values[5] / 50000],
                },
                "white_point": [values[6] / 50000, values[7] / 50000],
                "max_luminance_cd_m2": values[8] / 10000,
                "min_luminance_cd_m2": values[9] / 10000,
            }
        if box_type == "clli":
            max_cll, max_fall = struct.unpack_from(">HH", payload, 0)
            return {"max_cll_cd_m2": max_cll, "max_fall_cd_m2": max_fall}
        if box_type == "hvcC":
            return {"nal_length_size": (payload[21] & 0x03) + 1}
        if box_type == "trex":
            track_id = struct.unpack_from(">I", payload, 4)[0]
            # ISO/IEC 14496-12 inclui sample_description_index antes dos defaults.
            # As fixtures históricas compactas do projeto omitem esse campo; ambos
            # os layouts são aceitos para preservar compatibilidade do snapshot.
            defaults_at = 12 if len(payload) >= 24 else 8
            fields = {
                "track_id": track_id,
                "default_sample_duration": struct.unpack_from(">I", payload, defaults_at)[0],
            }
            if defaults_at + 8 <= len(payload):
                fields["default_sample_size"] = struct.unpack_from(
                    ">I", payload, defaults_at + 4
                )[0]
            if defaults_at + 12 <= len(payload):
                fields["default_sample_flags"] = struct.unpack_from(
                    ">I", payload, defaults_at + 8
                )[0]
            return fields
        if box_type == "mfhd":
            return {"sequence_number": struct.unpack_from(">I", payload, 4)[0]}
        if box_type == "tfhd":
            flags = struct.unpack_from(">I", payload, 0)[0] & 0xFFFFFF
            track_id = struct.unpack_from(">I", payload, 4)[0]
            fields = {"track_id": track_id, "flags": flags}
            pos = 8
            if flags & 0x000001:  # base-data-offset-present
                pos += 8
            if flags & 0x000002:  # sample-description-index-present
                pos += 4
            if flags & 0x000008:  # default-sample-duration-present
                if pos + 4 > len(payload):
                    return fields | {"parse_error": True}
                fields["default_sample_duration"] = struct.unpack_from(">I", payload, pos)[0]
                pos += 4
            if flags & 0x000010:  # default-sample-size-present
                if pos + 4 > len(payload):
                    return fields | {"parse_error": True}
                fields["default_sample_size"] = struct.unpack_from(">I", payload, pos)[0]
                pos += 4
            if flags & 0x000020:  # default-sample-flags-present
                if pos + 4 > len(payload):
                    return fields | {"parse_error": True}
                fields["default_sample_flags"] = struct.unpack_from(">I", payload, pos)[0]
            return fields
        if box_type == "tfdt":
            version = payload[0]
            if version == 1:
                bmdt = struct.unpack_from(">Q", payload, 4)[0]
            else:
                bmdt = struct.unpack_from(">I", payload, 4)[0]
            return {"base_media_decode_time": bmdt}
        if box_type == "trun":
            flags = struct.unpack_from(">I", payload, 0)[0] & 0xFFFFFF
            sample_count = struct.unpack_from(">I", payload, 4)[0]
            trun_fields: dict = {"sample_count": sample_count, "flags": flags}
            pos = 8
            if flags & 0x000001:  # data-offset
                trun_fields["data_offset"] = struct.unpack_from(">i", payload, pos)[0]
                pos += 4
            if flags & 0x000004:  # first-sample-flags
                trun_fields["first_sample_flags"] = struct.unpack_from(">I", payload, pos)[0]
                pos += 4
            if flags & 0x000100 and pos + 4 <= len(payload):
                trun_fields["first_sample_duration"] = struct.unpack_from(">I", payload, pos)[0]
                pos += 4
            if flags & 0x000200 and pos + 4 <= len(payload):
                trun_fields["first_sample_size"] = struct.unpack_from(">I", payload, pos)[0]
                pos += 4
            if flags & 0x000400 and pos + 4 <= len(payload):
                trun_fields["first_composition_offset"] = struct.unpack_from(">i", payload, pos)[0]
            return trun_fields
        if box_type == "sidx":
            version = payload[0]
            reference_id = struct.unpack_from(">I", payload, 4)[0]
            timescale = struct.unpack_from(">I", payload, 8)[0]
            return {"version": version, "reference_id": reference_id, "timescale": timescale}
    except (struct.error, IndexError):
        return {"parse_error": True}
    return {}


def _walk_boxes(nodes: tuple[BoxNode, ...]):
    for node in nodes:
        yield node
        yield from _walk_boxes(node.children)


def _trex_defaults(init_info: Fmp4Info | None) -> dict[int, dict]:
    if init_info is None:
        return {}
    return {
        int(node.fields["track_id"]): node.fields
        for node in _walk_boxes(init_info.boxes)
        if node.type == "trex" and "track_id" in node.fields
    }


def _trun_entries(
    data: bytes, node: BoxNode, limit: int
) -> tuple[list[dict], bool]:
    """Lê os registros por sample de um `trun`, limitado para o snapshot."""
    header_size = 16 if data[node.offset : node.offset + 4] == b"\x00\x00\x00\x01" else 8
    payload = data[node.offset + header_size : node.offset + node.size]
    if len(payload) < 8:
        return [], True
    version = payload[0]
    flags = int.from_bytes(payload[0:4], "big") & 0xFFFFFF
    sample_count = int.from_bytes(payload[4:8], "big")
    pos = 8

    def read(fmt: str) -> int | None:
        nonlocal pos
        size = struct.calcsize(fmt)
        if pos + size > len(payload):
            return None
        value = struct.unpack_from(fmt, payload, pos)[0]
        pos += size
        return value

    if flags & 0x000001 and read(">i") is None:  # data_offset
        return [], True
    first_sample_flags = None
    if flags & 0x000004:
        first_sample_flags = read(">I")
        if first_sample_flags is None:
            return [], True

    entries: list[dict] = []
    truncated = sample_count > limit
    for index in range(min(sample_count, limit)):
        duration = read(">I") if flags & 0x000100 else None
        size = read(">I") if flags & 0x000200 else None
        sample_flags = read(">I") if flags & 0x000400 else None
        composition_offset = None
        if flags & 0x000800:
            composition_offset = read(">i" if version == 1 else ">I")
        required_missing = (
            (flags & 0x000100 and duration is None)
            or (flags & 0x000200 and size is None)
            or (flags & 0x000400 and sample_flags is None)
            or (flags & 0x000800 and composition_offset is None)
        )
        if required_missing:
            truncated = True
            break
        entries.append(
            {
                "duration": duration,
                "size": size,
                "flags": (
                    first_sample_flags
                    if index == 0 and first_sample_flags is not None
                    else sample_flags
                ),
                "composition_offset": composition_offset,
            }
        )
    return entries, truncated


def _extract_samples(
    info: Fmp4Info, data: bytes, init_info: Fmp4Info | None = None
) -> tuple[tuple[ContainerSample, ...], bool]:
    """Materializa samples de `trun` com defaults e relógio do init, se disponível."""
    if info.is_init:
        return (), False

    trex = _trex_defaults(init_info)
    samples: list[ContainerSample] = []
    truncated = False
    indexes: dict[int | None, int] = {}

    for traf in (node for node in _walk_boxes(info.boxes) if node.type == "traf"):
        tfhd = next((node for node in traf.children if node.type == "tfhd"), None)
        tfdt = next((node for node in traf.children if node.type == "tfdt"), None)
        raw_track_id = tfhd.fields.get("track_id") if tfhd is not None else None
        track_id = int(raw_track_id) if raw_track_id is not None else None
        track_defaults = trex.get(track_id, {}) if track_id is not None else {}
        default_duration = (
            tfhd.fields.get("default_sample_duration") if tfhd is not None else None
        ) or track_defaults.get("default_sample_duration")
        default_size = (
            tfhd.fields.get("default_sample_size") if tfhd is not None else None
        ) or track_defaults.get("default_sample_size")
        default_flags = (
            tfhd.fields.get("default_sample_flags") if tfhd is not None else None
        )
        if default_flags is None:
            default_flags = track_defaults.get("default_sample_flags")
        decode_time = (
            tfdt.fields.get("base_media_decode_time") if tfdt is not None else None
        )
        timescale = info.timescales.get(track_id)
        if timescale is None and len(info.track_ids) == 1:
            timescale = info.timescales.get("track")

        for trun in (node for node in traf.children if node.type == "trun"):
            remaining = max(0, _MAX_SAMPLES - len(samples))
            if remaining == 0:
                truncated = True
                break
            entries, run_truncated = _trun_entries(data, trun, remaining)
            truncated = truncated or run_truncated
            for entry in entries:
                duration = entry["duration"] or default_duration
                byte_size = entry["size"] or default_size
                sample_flags = entry["flags"]
                if sample_flags is None:
                    sample_flags = default_flags
                composition_offset = entry["composition_offset"]
                if composition_offset is None:
                    composition_offset = 0
                pts = (
                    decode_time + composition_offset
                    if decode_time is not None
                    else None
                )
                index = indexes.get(track_id, 0)
                indexes[track_id] = index + 1
                samples.append(
                    ContainerSample(
                        index=index,
                        unit_type="sample",
                        byte_size=byte_size,
                        track_id=track_id,
                        duration=duration,
                        dts=decode_time,
                        pts=pts,
                        composition_offset=composition_offset,
                        timescale=timescale,
                        is_sync=(not bool(sample_flags & 0x00010000))
                        if sample_flags is not None
                        else None,
                    )
                )
                decode_time = (
                    decode_time + duration
                    if decode_time is not None and duration is not None
                    else None
                )

    # Um fragmento de sample único sem tamanho declarado ainda permite medir o
    # payload `mdat` diretamente, sem extrapolar a divisão entre vários samples.
    if len(samples) == 1 and samples[0].byte_size is None:
        payload_size = 0
        for node in info.boxes:
            if node.type != "mdat":
                continue
            header_size = 16 if data[node.offset : node.offset + 4] == b"\x00\x00\x00\x01" else 8
            payload_size += max(0, node.size - header_size)
        if payload_size:
            import dataclasses

            samples[0] = dataclasses.replace(samples[0], byte_size=payload_size)

    return tuple(samples), truncated


_CICP_PRIMARIES = {1: "BT.709", 9: "BT.2020", 12: "P3 D65"}
_CICP_TRANSFER = {1: "BT.709", 13: "sRGB", 16: "PQ (ST 2084)", 18: "HLG"}
_CICP_MATRIX = {1: "BT.709", 9: "BT.2020 non-constant", 10: "BT.2020 constant"}


def _remove_emulation_prevention(data: bytes) -> bytes:
    return data.replace(b"\x00\x00\x03", b"\x00\x00")


def _has_hdr10_plus(data: bytes) -> bool:
    """Detecta a assinatura HDR10+ em SEI prefix/suffix HEVC observável.

    Não interpreta as janelas dinâmicas e não extrapola além deste arquivo.
    Aceita NALs Annex B e o layout length-prefixed mais comum de fMP4 (4 bytes).
    """
    nals: list[bytes] = []
    for marker in (b"\x00\x00\x01", b"\x00\x00\x00\x01"):
        start = 0
        while True:
            at = data.find(marker, start)
            if at < 0:
                break
            end = data.find(marker, at + len(marker))
            nals.append(data[at + len(marker) : end if end >= 0 else len(data)])
            start = at + len(marker)
    # Fragmentos CMAF normalmente carregam NALs com tamanho de 4 bytes.
    for at in range(0, max(0, len(data) - 6)):
        length = struct.unpack_from(">I", data, at)[0]
        if 3 <= length <= len(data) - at - 4:
            nals.append(data[at + 4 : at + 4 + length])

    for nal in nals:
        if len(nal) < 3 or ((nal[0] >> 1) & 0x3F) not in {39, 40}:
            continue
        payload = _remove_emulation_prevention(nal[2:])
        pos = 0
        while pos < len(payload) and payload[pos] != 0x80:
            payload_type = 0
            while pos < len(payload) and payload[pos] == 0xFF:
                payload_type += 0xFF
                pos += 1
            if pos >= len(payload):
                break
            payload_type += payload[pos]
            pos += 1
            payload_size = 0
            while pos < len(payload) and payload[pos] == 0xFF:
                payload_size += 0xFF
                pos += 1
            if pos >= len(payload):
                break
            payload_size += payload[pos]
            pos += 1
            message = payload[pos : pos + payload_size]
            pos += payload_size
            if payload_type == 4 and message.startswith(b"\xB5\x00\x3C\x00\x01\x04"):
                return True
    return False


def _summarize(
    info: Fmp4Info, data: bytes, init_info: Fmp4Info | None = None
) -> Fmp4Info:
    import dataclasses

    track_ids: list[int] = []
    timescales: dict = dict(init_info.timescales) if init_info is not None else {}
    brands: list[str] = []
    sequence_number = None
    bmdt = None
    sample_counts: dict = {}
    color: dict = {}
    static_metadata: dict = {}
    current_track: int | None = None
    timescale_scratch: int | None = None

    def walk(nodes) -> None:
        nonlocal color, sequence_number, bmdt, current_track, timescale_scratch
        for node in nodes:
            f = node.fields
            if node.type in ("ftyp", "styp") and "major_brand" in f:
                brands.append(f["major_brand"])
            if node.type == "mvhd" and "timescale" in f:
                timescales["movie"] = f["timescale"]
            if node.type == "tkhd" and "track_id" in f:
                track_ids.append(f["track_id"])
                current_track = f["track_id"]
                timescale_scratch = None
            if node.type == "mdhd" and "timescale" in f:
                timescale_scratch = f["timescale"]
                if current_track is not None:
                    timescales[current_track] = f["timescale"]
            if node.type == "trex" and "track_id" in f:
                track_ids.append(f["track_id"])
            if node.type == "mfhd" and "sequence_number" in f:
                sequence_number = f["sequence_number"]
            if node.type == "tfhd" and "track_id" in f:
                current_track = f["track_id"]
                track_ids.append(f["track_id"])
            if node.type == "tfdt" and "base_media_decode_time" in f:
                bmdt = f["base_media_decode_time"]
            if node.type == "trun" and "sample_count" in f:
                key = current_track if current_track is not None else "?"
                sample_counts[key] = sample_counts.get(key, 0) + f["sample_count"]
            if node.type == "colr" and f.get("color_type") == "nclx":
                color = f
            if node.type == "mdcv":
                static_metadata["mastering_display"] = f
            if node.type == "clli":
                static_metadata["content_light_level"] = f
            walk(node.children)

    walk(info.boxes)
    dynamic = ("HDR10+",) if _has_hdr10_plus(data) else ()
    hdr = None
    if color or static_metadata or dynamic:
        hdr = HdrInfo(
            color_primaries=color.get("color_primaries"),
            transfer_characteristics=color.get("transfer_characteristics"),
            matrix_coefficients=color.get("matrix_coefficients"),
            full_range=color.get("full_range"),
            static_metadata=static_metadata,
            dynamic_metadata=dynamic,
        )
    return dataclasses.replace(
        info,
        brands=tuple(dict.fromkeys(brands)),
        track_ids=tuple(dict.fromkeys(track_ids)),
        timescales=timescales or ({"track": timescale_scratch} if timescale_scratch else {}),
        sequence_number=sequence_number,
        base_media_decode_time=bmdt,
        sample_counts=sample_counts,
        hdr=hdr,
    )
