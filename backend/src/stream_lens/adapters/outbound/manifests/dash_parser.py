"""Parser DASH (MPD) -> modelo unificado, com xml.etree (ADR-0002)."""

from __future__ import annotations

import base64
import binascii
import dataclasses
import hashlib
import math
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from urllib.parse import urljoin

from stream_lens.domain.services.redaction import redact_url
from stream_lens.domain.value_objects.media import (
    Capability,
    CapabilityStatus,
    DashDrmDeclaration,
    DashPsshDeclaration,
    DrmSystem,
    MediaKind,
    Representation,
    Resolution,
    SegmentDeclaration,
    TrackGroup,
    UnifiedManifest,
)
from stream_lens.domain.value_objects.protocol import ManifestKind, Protocol

NS = "{urn:mpeg:dash:schema:mpd:2011}"
MAX_TIMELINE_SEGMENTS = 10_000


def _local(tag: str) -> str:
    """Nome local da tag, ignorando namespace/prefixo (MPDs podem omitir ns)."""
    return tag.rsplit("}", 1)[-1]


def _iter(el: ET.Element, name: str):
    for child in el.iter():
        if _local(child.tag) == name:
            yield child


def _find(el: ET.Element, name: str) -> ET.Element | None:
    for child in el:
        if _local(child.tag) == name:
            return child
    return None


def _children(el: ET.Element, name: str) -> Iterator[ET.Element]:
    for child in el:
        if _local(child.tag) == name:
            yield child


def _text(el: ET.Element, name: str) -> str | None:
    child = _find(el, name)
    if child is None or child.text is None:
        return None
    value = child.text.strip()
    return value or None

_KNOWN_DRM = {
    "urn:mpeg:dash:mp4protection:2011": "mp4-protection",
    "urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b": "common-pssh",
    "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed": "widevine",
    "urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95": "playready",
    "urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2": "fairplay",
    "urn:uuid:f239e769-efa3-4850-9c16-a903c6932efb": "adobe-primetime",
}


def parse_dash(content: str) -> UnifiedManifest:
    root = ET.fromstring(content)
    if not _local(root.tag) == "MPD":
        raise ValueError("raiz do documento não é <MPD>")
    is_live = root.get("type", "static") == "dynamic"

    groups: list[TrackGroup] = []
    drm: list[DrmSystem] = []
    dash_drm: list[DashDrmDeclaration] = []
    warnings: list[str] = []
    has_segment_timeline = False
    periods = list(_iter(root, "Period"))
    mpd_duration = _parse_iso_duration(root.get("mediaPresentationDuration"))
    mpd_base = _text(root, "BaseURL")

    for period_index, period in enumerate(periods):
        period_id = period.get("id")
        for cp in _children(period, "ContentProtection"):
            drm.append(_drm_system(cp))
            dash_drm.append(
                _dash_drm_declaration(
                    cp,
                    scope="period",
                    period_index=period_index,
                    period_id=period_id,
                )
            )
        period_duration = _period_duration(periods, period_index, mpd_duration)
        period_base = _join_ref(mpd_base, _text(period, "BaseURL"))
        period_template = _find(period, "SegmentTemplate")
        for aset in _iter(period, "AdaptationSet"):
            kind = _media_kind(aset)
            adaptation_set_id = aset.get("id")
            for cp in _children(aset, "ContentProtection"):
                drm.append(_drm_system(cp))
                dash_drm.append(
                    _dash_drm_declaration(
                        cp,
                        scope="adaptation_set",
                        period_index=period_index,
                        period_id=period_id,
                        adaptation_set_id=adaptation_set_id,
                        group_kind=kind.value,
                    )
                )
            roles = tuple(
                f"{role.get('schemeIdUri', '')}:{role.get('value', '')}".strip(":")
                for role in _iter(aset, "Role")
            )
            reps = []
            aset_codecs = aset.get("codecs")
            # SegmentTemplate pode viver no AdaptationSet (herdado pelas reps)
            aset_template = _find(aset, "SegmentTemplate")
            inherited_template = (
                aset_template if aset_template is not None else period_template
            )
            aset_base = _join_ref(period_base, _text(aset, "BaseURL"))
            for rep_el in _iter(aset, "Representation"):
                for cp in _children(rep_el, "ContentProtection"):
                    drm.append(_drm_system(cp))
                    dash_drm.append(
                        _dash_drm_declaration(
                            cp,
                            scope="representation",
                            period_index=period_index,
                            period_id=period_id,
                            adaptation_set_id=adaptation_set_id,
                            representation_id=rep_el.get("id"),
                            group_kind=kind.value,
                        )
                    )
                rep, timeline_used, rep_warnings = _parse_representation(
                    rep_el,
                    aset_codecs,
                    inherited_template,
                    inherited_base=aset_base,
                    period_duration_seconds=period_duration,
                )
                has_segment_timeline = has_segment_timeline or timeline_used
                warnings.extend(
                    f"representação '{rep_el.get('id') or ''}': {warning}"
                    for warning in rep_warnings
                )
                if rep is None:
                    continue
                reps.append(dataclasses.replace(rep, roles=roles) if roles else rep)

            if not reps:
                warnings.append(
                    f"AdaptationSet '{aset.get('id') or aset.get('contentType')}' "
                    "sem representações utilizáveis"
                )
                continue
            groups.append(
                TrackGroup(
                    kind=kind,
                    name=aset.get("id") or aset.get("contentType"),
                    language=aset.get("lang"),
                    representations=tuple(reps),
                )
            )

    return UnifiedManifest(
        protocol=Protocol.DASH.value,
        kind=ManifestKind.DASH_MPD.value,
        is_live=is_live,
        track_groups=tuple(groups),
        drm_systems=tuple(drm),
        dash_drm=tuple(dash_drm),
        protocol_specific={
            "dash": {
                "mpd_type": root.get("type", "static"),
                "media_presentation_duration": root.get("mediaPresentationDuration"),
                "min_buffer_time": root.get("minBufferTime"),
                "profiles": root.get("profiles"),
                "period_count": len(periods),
            }
        },
        capabilities={
            "segment_download": Capability(
                CapabilityStatus.NOT_COLLECTED, "Fase 3 inspeciona apenas declarações"
            ),
            "segment_timeline": (
                Capability(CapabilityStatus.SUPPORTED)
                if has_segment_timeline
                else Capability(CapabilityStatus.NOT_APPLICABLE, "MPD sem SegmentTimeline")
            ),
        },
        warnings=tuple(warnings),
    )


def _parse_representation(
    el: ET.Element,
    aset_codecs: str | None,
    inherited_template: ET.Element | None = None,
    inherited_base: str | None = None,
    period_duration_seconds: float | None = None,
) -> tuple[Representation | None, bool, list[str]]:
    resolution = None
    width, height = el.get("width"), el.get("height")
    if width and height:
        resolution = Resolution(width=int(width), height=int(height))

    init_segment = None
    segments: list[SegmentDeclaration] = []
    timeline_used = False
    timeline_complete = True
    rep_warnings: list[str] = []
    own_base = _text(el, "BaseURL")
    representation_base = _join_ref(inherited_base, own_base)

    own = _find(el, "SegmentTemplate")
    template = own if own is not None else inherited_template
    if template is not None:
        st = template
        timescale = _int_or_none(st.get("timescale"))
        init_uri = st.get("initialization")
        if init_uri:
            init_segment = SegmentDeclaration(
                uri=_join_ref(representation_base, _sub_ids(init_uri, el)),
                timescale=timescale,
            )
        duration = _int_or_none(st.get("duration"))
        media = st.get("media")
        media_template = (
            _join_ref(representation_base, _sub_ids(media, el)) if media else None
        )
        segment_timeline = _find(st, "SegmentTimeline")
        if media_template and segment_timeline is not None:
            timeline_used = True
            segments, timeline_complete, timeline_warnings = _timeline_segments(
                segment_timeline,
                media_template,
                timescale=timescale,
                start_number=_int_or_none(st.get("startNumber")) or 1,
                presentation_time_offset=(
                    _int_or_none(st.get("presentationTimeOffset")) or 0
                ),
                period_duration_seconds=period_duration_seconds,
            )
            rep_warnings.extend(timeline_warnings)
        elif media_template and duration is not None:
            # duração fixa por segmento: declaramos o template sem enumerar
            # segmentos (a contagem real exige a duração do Period)
            segments = [
                SegmentDeclaration(
                    uri=None,
                    template=media_template,
                    timescale=timescale,
                    template_duration=duration,
                    start_number=_int_or_none(st.get("startNumber")) or 1,
                )
            ]

    if not init_segment and not segments:
        for sl in _iter(el, "SegmentList"):
            init = _find(sl, "Initialization")
            if init is not None:
                init_segment = SegmentDeclaration(
                    uri=_join_ref(representation_base, init.get("sourceURL")),
                    timescale=_int_or_none(sl.get("timescale")),
                )
            segments = [
                SegmentDeclaration(
                    uri=_join_ref(representation_base, s.get("media"))
                )
                for s in _iter(sl, "SegmentURL")
                if s.get("media")
            ]

    total_duration = None
    if timeline_used and timeline_complete and all(
        s.template_duration is not None for s in segments
    ):
        timescale = next((s.timescale for s in segments if s.timescale), None)
        scale = timescale or 1
        total_duration = sum(s.template_duration or 0 for s in segments) / scale
    elif (
        len(segments) == 1
        and segments[0].template is not None
        and period_duration_seconds is not None
    ):
        total_duration = period_duration_seconds

    direct_uri = representation_base if own_base else None
    if direct_uri and not init_segment and not segments:
        total_duration = period_duration_seconds

    if timeline_used:
        segment_count = len(segments) if timeline_complete else None
    elif segments and segments[0].template is None:
        segment_count = len(segments)
    elif direct_uri and not init_segment:
        segment_count = 1
    else:
        segment_count = None

    rep = Representation(
        id=el.get("id") or "",
        uri=direct_uri,
        codecs=el.get("codecs") or aset_codecs,
        bandwidth_bps=_int_or_none(el.get("bandwidth")),
        resolution=resolution,
        frame_rate=_frame_rate(el.get("frameRate") or el.get("framerate")),
        audio_sampling_rate=_int_or_none(el.get("audioSamplingRate")),
        init_segment=init_segment,
        segments=tuple(segments),
        segment_count_declared=segment_count,
        total_duration_seconds=total_duration,
    )
    return rep, timeline_used, rep_warnings


def _timeline_segments(
    timeline: ET.Element,
    media_template: str,
    *,
    timescale: int | None,
    start_number: int,
    presentation_time_offset: int,
    period_duration_seconds: float | None,
) -> tuple[list[SegmentDeclaration], bool, list[str]]:
    """Expande SegmentTimeline e materializa URIs $Time$/$Number$.

    `S@r` conta repetições adicionais. Um valor negativo é limitado pelo
    próximo `S@t` ou pelo fim conhecido do Period; sem limite finito,
    preservamos apenas a primeira referência e avisamos.
    """
    entries = [child for child in timeline if _local(child.tag) == "S"]
    result: list[SegmentDeclaration] = []
    warnings: list[str] = []
    current_time: int | None = None
    number = start_number
    complete = True
    scale = timescale or 1

    for position, entry in enumerate(entries):
        explicit_time = _int_or_none(entry.get("t"))
        if explicit_time is not None:
            current_time = explicit_time
        elif current_time is None:
            current_time = 0

        duration = _int_or_none(entry.get("d"))
        if duration is None or duration <= 0:
            warnings.append(f"SegmentTimeline S[{position}] sem duração positiva")
            complete = False
            current_time = None
            continue

        repeat = _int_or_none(entry.get("r"))
        repeat = repeat if repeat is not None else 0
        count = repeat + 1
        if repeat < 0:
            next_time = next(
                (
                    value
                    for following in entries[position + 1 :]
                    if (value := _int_or_none(following.get("t"))) is not None
                ),
                None,
            )
            end_time: int | None = next_time
            if end_time is None and period_duration_seconds is not None:
                end_time = presentation_time_offset + math.ceil(
                    period_duration_seconds * scale
                )
            if end_time is None:
                count = 1
                complete = False
                warnings.append(
                    f"SegmentTimeline S[{position}] usa r=-1 sem fim de Period conhecido"
                )
            else:
                count = max(1, math.ceil((end_time - current_time) / duration))

        for repeat_index in range(count):
            if len(result) >= MAX_TIMELINE_SEGMENTS:
                warnings.append(
                    "SegmentTimeline excede o limite de "
                    f"{MAX_TIMELINE_SEGMENTS} segmentos materializados"
                )
                return result, False, warnings
            segment_time = current_time + repeat_index * duration
            result.append(
                SegmentDeclaration(
                    uri=_sub_segment(media_template, number, segment_time),
                    template=media_template,
                    timescale=timescale,
                    template_duration=duration,
                    start_number=number,
                )
            )
            number += 1
        current_time += count * duration

    return result, complete, warnings


def _media_kind(aset: ET.Element) -> MediaKind:
    content_type = aset.get("contentType") or ""
    mime = (aset.get("mimeType") or "").split("/")[0]
    mapping = {
        "video": MediaKind.VIDEO,
        "audio": MediaKind.AUDIO,
        "text": MediaKind.SUBTITLE,
        "application": (
            MediaKind.SUBTITLE if "ttml" in (aset.get("mimeType") or "") else MediaKind.UNKNOWN
        ),
    }
    return mapping.get(content_type) or mapping.get(mime, MediaKind.UNKNOWN)


def _drm_system(cp: ET.Element) -> DrmSystem:
    raw_scheme = (cp.get("schemeIdUri") or "").strip()
    scheme = redact_url(raw_scheme)
    system = _KNOWN_DRM.get(raw_scheme.lower(), scheme or "unknown")
    default_kid = _default_kid_value(cp)
    details = f"scheme={scheme}" + (f" kid={default_kid}" if default_kid else "")
    return DrmSystem(system=system, details=details)


def _dash_drm_declaration(
    cp: ET.Element,
    *,
    scope: str,
    period_index: int,
    period_id: str | None,
    adaptation_set_id: str | None = None,
    representation_id: str | None = None,
    group_kind: str | None = None,
) -> DashDrmDeclaration:
    raw_scheme = (cp.get("schemeIdUri") or "").strip()
    scheme = redact_url(raw_scheme)
    system = _KNOWN_DRM.get(raw_scheme.lower(), scheme or "unknown")
    default_kid = _default_kid_value(cp)
    return DashDrmDeclaration(
        scope=scope,
        period_index=period_index,
        period_id=period_id,
        adaptation_set_id=adaptation_set_id,
        representation_id=representation_id,
        group_kind=group_kind,
        system=system,
        scheme_id_uri=scheme,
        value=cp.get("value"),
        default_kids=_normalize_kids(default_kid),
        pssh=tuple(_summarize_pssh(item) for item in _children(cp, "pssh")),
    )


def _normalize_kids(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(token.strip("{}").lower() for token in value.split() if token.strip("{}"))


def _default_kid_value(cp: ET.Element) -> str | None:
    return (
        cp.get("{urn:mpeg:cenc:2013}default_KID")
        or cp.get("{urn:mpeg:cenc:2013}defaultKID")
        or cp.get("cenc:default_KID")
        or cp.get("cenc:defaultKID")
    )


def _summarize_pssh(element: ET.Element) -> DashPsshDeclaration:
    encoded = "".join((element.text or "").split())
    if not encoded:
        return DashPsshDeclaration(encoded_length=0, status="empty")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return DashPsshDeclaration(
            encoded_length=len(encoded), status="invalid_base64"
        )
    return DashPsshDeclaration(
        encoded_length=len(encoded),
        decoded_size=len(decoded),
        sha256=hashlib.sha256(decoded).hexdigest(),
    )


def _sub_ids(template: str, el: ET.Element) -> str:
    return (
        template.replace("$RepresentationID$", el.get("id") or "")
        .replace("$Bandwidth$", el.get("bandwidth") or "")
    )


def _sub_segment(template: str, number: int, time: int) -> str:
    return template.replace("$Number$", str(number)).replace("$Time$", str(time))


def _join_ref(base: str | None, ref: str | None) -> str | None:
    if not ref:
        return base
    if not base or "://" in ref:
        return ref
    return urljoin(base, ref)


def _period_duration(
    periods: list[ET.Element], index: int, mpd_duration: float | None
) -> float | None:
    period = periods[index]
    explicit = _parse_iso_duration(period.get("duration"))
    if explicit is not None:
        return explicit

    start = _parse_iso_duration(period.get("start"))
    if index + 1 < len(periods):
        next_start = _parse_iso_duration(periods[index + 1].get("start"))
        if start is not None and next_start is not None and next_start >= start:
            return next_start - start
    if index == len(periods) - 1 and mpd_duration is not None:
        return max(0.0, mpd_duration - (start or 0.0))
    return None


def _parse_iso_duration(value: str | None) -> float | None:
    """Subset ISO-8601 usado por MPD/Period: dias + horas/minutos/segundos."""
    if not value or not value.startswith("P"):
        return None
    import re

    match = re.fullmatch(
        r"P(?:(?P<days>\d+(?:\.\d+)?)D)?"
        r"(?:T(?:(?P<hours>\d+(?:\.\d+)?)H)?"
        r"(?:(?P<minutes>\d+(?:\.\d+)?)M)?"
        r"(?:(?P<seconds>\d+(?:\.\d+)?)S)?)?",
        value.strip(),
    )
    if match is None:
        return None
    return (
        float(match.group("days") or 0) * 86_400
        + float(match.group("hours") or 0) * 3_600
        + float(match.group("minutes") or 0) * 60
        + float(match.group("seconds") or 0)
    )


def _int_or_none(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def _frame_rate(value: str | None) -> float | None:
    if not value:
        return None
    if "/" in value:
        num, _, den = value.partition("/")
        try:
            return round(int(num) / int(den or 1), 3)
        except (ValueError, ZeroDivisionError):
            return None
    try:
        return float(value)
    except ValueError:
        return None
