"""Evidências derivadas de configuração efetiva de bitstream e A/V.

O módulo reduz o resultado opcional do ffprobe a um contrato pequeno e
rastreável. Não decide compatibilidade de decoder nem classifica uma diferença
de início A/V como falha de sincronismo: a janela é apenas o container capturado.
"""

from __future__ import annotations

from itertools import pairwise

from stream_lens.domain.value_objects.containers import SegmentContainer
from stream_lens.domain.value_objects.segments import (
    BitstreamConfigurationChange,
    BitstreamSegmentObservation,
    EffectiveStreamConfiguration,
    RepresentationBitstream,
)

_CONFIGURATION_FIELDS = (
    "codec_name",
    "profile",
    "level",
    "pixel_format",
    "width",
    "height",
    "frame_rate",
    "sample_rate",
    "channels",
    "channel_layout",
)


def measure_bitstream_observability(
    containers: tuple[SegmentContainer, ...],
    segment_sequences: dict[tuple[str, str, int], int | None],
) -> tuple[RepresentationBitstream, ...]:
    """Agrupa configuração derivada e transições entre segmentos capturados.

    Apenas containers de mídia entram na leitura: o init descreve uma
    configuração potencial, mas não prova que a amostra capturada foi
    decodificável. ``segment_sequences`` é usado somente para rastreabilidade
    na UI, nunca como base para comparação de configuração.
    """

    grouped: dict[tuple[str, str], list[BitstreamSegmentObservation]] = {}
    for container in sorted(
        containers, key=lambda item: (item.group_kind, item.rep_id, item.index)
    ):
        if container.is_init:
            continue
        streams = _streams_from_probe(container.probe)
        if not streams:
            continue
        av_timing = _av_start_timing(container.probe, streams)
        key = (container.group_kind, container.rep_id)
        grouped.setdefault(key, []).append(
            BitstreamSegmentObservation(
                index=container.index,
                segment_sequence=segment_sequences.get(
                    (container.rep_id, container.group_kind, container.index)
                ),
                streams=streams,
                **av_timing,
            )
        )

    result = []
    for (group_kind, rep_id), observed in grouped.items():
        observed.sort(key=lambda item: item.index)
        result.append(
            RepresentationBitstream(
                group_kind=group_kind,
                rep_id=rep_id,
                observed_segments=tuple(observed),
                configuration_changes=_configuration_changes(observed),
            )
        )
    return tuple(result)


def _streams_from_probe(probe: dict | None) -> tuple[EffectiveStreamConfiguration, ...]:
    if not probe:
        return ()
    streams = []
    for raw in probe.get("streams", []):
        kind = raw.get("codec_type")
        if kind not in {"video", "audio"}:
            continue
        streams.append(
            EffectiveStreamConfiguration(
                stream_index=_as_int(raw.get("index")),
                kind=kind,
                codec_name=_as_str(raw.get("codec_name")),
                profile=_as_str(raw.get("profile")),
                level=_as_int(raw.get("level")),
                pixel_format=_as_str(raw.get("pix_fmt")),
                width=_as_int(raw.get("width")),
                height=_as_int(raw.get("height")),
                frame_rate=_as_str(raw.get("r_frame_rate")),
                sample_rate=_as_int(raw.get("sample_rate")),
                channels=_as_int(raw.get("channels")),
                channel_layout=_as_str(raw.get("channel_layout")),
                start_time_seconds=_as_float(raw.get("start_time")),
            )
        )
    return tuple(sorted(streams, key=lambda item: (item.kind, item.stream_index or -1)))


def _av_start_timing(
    probe: dict | None, streams: tuple[EffectiveStreamConfiguration, ...]
) -> dict:
    """Retorna PTS de apresentação ou fallback homogêneo de start_time.

    Não misturamos PTS de uma track com ``start_time`` da outra: se o par de
    timestamps de apresentação não existe, o fallback usa ``start_time`` de
    ambas e informa isso explicitamente ao consumidor do snapshot.
    """

    timing = (probe or {}).get("av_timing") or {}
    video = _coordinate(timing.get("video"))
    audio = _coordinate(timing.get("audio"))
    if video[1] is not None and audio[1] is not None:
        return {
            "video_start_pts": video[0],
            "video_start_seconds": video[1],
            "audio_start_pts": audio[0],
            "audio_start_seconds": audio[1],
            "av_start_delta_seconds": round(audio[1] - video[1], 6),
            "av_start_provenance": "derived (ffprobe presentation timestamps)",
        }

    video_start = next(
        (item.start_time_seconds for item in streams if item.kind == "video"), None
    )
    audio_start = next(
        (item.start_time_seconds for item in streams if item.kind == "audio"), None
    )
    if video_start is not None and audio_start is not None:
        return {
            "video_start_seconds": video_start,
            "audio_start_seconds": audio_start,
            "av_start_delta_seconds": round(audio_start - video_start, 6),
            "av_start_provenance": "derived (ffprobe stream start_time fallback)",
        }
    return {
        "video_start_pts": video[0],
        "video_start_seconds": video[1],
        "audio_start_pts": audio[0],
        "audio_start_seconds": audio[1],
        "av_start_provenance": "not available",
    }


def _coordinate(data: object) -> tuple[int | None, float | None]:
    if not isinstance(data, dict):
        return None, None
    return _as_int(data.get("pts")), _as_float(data.get("pts_time"))


def _configuration_changes(
    observed: list[BitstreamSegmentObservation],
) -> tuple[BitstreamConfigurationChange, ...]:
    changes = []
    for previous, current in pairwise(observed):
        previous_streams = _by_stream_identity(previous.streams)
        current_streams = _by_stream_identity(current.streams)
        fields = set()
        if previous_streams.keys() != current_streams.keys():
            fields.add("streams")
        for key in previous_streams.keys() & current_streams.keys():
            before, after = previous_streams[key], current_streams[key]
            fields.update(
                field
                for field in _CONFIGURATION_FIELDS
                if getattr(before, field) != getattr(after, field)
            )
        if fields:
            changes.append(
                BitstreamConfigurationChange(
                    from_index=previous.index,
                    to_index=current.index,
                    changed_fields=tuple(sorted(fields)),
                )
            )
    return tuple(changes)


def _by_stream_identity(
    streams: tuple[EffectiveStreamConfiguration, ...],
) -> dict[tuple[str, int | None], EffectiveStreamConfiguration]:
    return {(item.kind, item.stream_index): item for item in streams}


def _as_int(value: object) -> int | None:
    if not isinstance(value, (str, int, float)):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: object) -> float | None:
    if not isinstance(value, (str, int, float)):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_str(value: object) -> str | None:
    return value if isinstance(value, str) else None
