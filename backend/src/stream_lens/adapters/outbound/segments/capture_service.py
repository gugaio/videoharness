"""Resolução e captura limitada de segmentos (Fase 4).

Pipeline: plano determinístico dentro da janela -> captura com limites ->
timeline normalizada. Nada aqui diagnostica; gaps/discontinuidades são
apenas representados.

Política de janela:
- VOD: primeiros segmentos desde o início (determinístico).
- live: últimos segmentos declarados (janela deslizante honesta).
- Ordem de representações HLS no master: variantes por bandwidth
  crescente, depois renditions por grupo — limitada por
  `max_playlists_followed`.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin

import m3u8

from stream_lens.application.ports.manifest_fetcher import ManifestFetcher
from stream_lens.application.ports.providers import Clock
from stream_lens.application.ports.segment_fetcher import SegmentFetcher
from stream_lens.domain.value_objects.media import Representation, UnifiedManifest
from stream_lens.domain.value_objects.segments import (
    CapturedSegment,
    CaptureLimits,
    PlannedSegment,
    RepresentationTimeline,
    TimelineEntry,
)

_DURATION_RE = re.compile(
    r"^P(?:T(?:(?P<hours>\d+(?:\.\d+)?)H)?(?:(?P<minutes>\d+(?:\.\d+)?)M)?(?:(?P<seconds>\d+(?:\.\d+)?)S)?)?$"
)
MAX_DASH_TEMPLATE_SEGMENTS = 10_000


@dataclass(slots=True)
class CapturePlan:
    planned: list[PlannedSegment] = field(default_factory=list)
    # rep_id -> {index: discontinuity} para marcar a timeline
    discontinuities: dict[str, dict[int, bool]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _DashCandidate:
    uri: str
    index: int
    number: int | None
    duration_seconds: float | None


class SegmentCaptureService:
    def __init__(
        self,
        manifest_fetcher: ManifestFetcher,
        segment_fetcher: SegmentFetcher,
        clock: Clock,
        limits: CaptureLimits | None = None,
    ) -> None:
        self._manifests = manifest_fetcher
        self._segments = segment_fetcher
        self._clock = clock
        self._limits = limits or CaptureLimits()

    @property
    def limits(self) -> CaptureLimits:
        return self._limits

    # ------------------------------------------------------------------ plan

    async def plan(self, media: UnifiedManifest, base_url: str) -> CapturePlan:
        if media.kind == "hls_media_playlist":
            return self._plan_hls_media(media, base_url)
        if media.kind == "hls_master_playlist":
            return await self._plan_hls_master(media, base_url)
        return self._plan_dash(media, base_url)

    def _plan_hls_media(self, media: UnifiedManifest, base_url: str) -> CapturePlan:
        plan = CapturePlan()
        group = media.track_groups[0] if media.track_groups else None
        rep = group.representations[0] if group and group.representations else None
        if rep is None:
            plan.warnings.append("media playlist sem representação utilizável")
            return plan
        assert group is not None  # garantido acima
        kind = group.kind.value
        chosen = _window_segments(
            list(rep.segments),
            lambda s: s.duration_seconds,
            self._limits.window_seconds,
            from_end=media.is_live,
        )
        if rep.init_segment and rep.init_segment.uri:
            plan.planned.append(
                PlannedSegment(
                    rep_id=rep.id,
                    group_kind=kind,
                    uri=_resolve(base_url, rep.init_segment.uri),
                    index=-1,
                    is_init=True,
                )
            )
        for index, seg in enumerate(rep.segments):
            if seg.discontinuity:
                plan.discontinuities.setdefault(rep.id, {})[index] = True
            if seg not in chosen:
                continue
            plan.planned.append(
                PlannedSegment(
                    rep_id=rep.id,
                    group_kind=kind,
                    uri=_resolve(base_url, seg.uri or ""),
                    index=index,
                    declared_duration_seconds=seg.duration_seconds,
                )
            )
        return plan

    async def _plan_hls_master(self, media: UnifiedManifest, base_url: str) -> CapturePlan:
        plan = CapturePlan()
        targets: list[tuple[str, str, str]] = []  # (rep_id, group_kind, playlist_url)
        for group in media.track_groups:
            for rep in group.representations:
                if rep.uri:
                    targets.append((rep.id, group.kind.value, _resolve(base_url, rep.uri)))
        # determinístico: variantes (vídeo) por bandwidth crescente já vem em ordem
        # declarada; apenas limitamos a quantidade de playlists seguidas.
        followed = 0
        for rep_id, kind, playlist_url in targets:
            if followed >= self._limits.max_playlists_followed:
                plan.warnings.append(
                    f"limite de {self._limits.max_playlists_followed} rendições seguidas; "
                    f"'{rep_id}' não foi inspecionada"
                )
                continue
            followed += 1
            try:
                fetched = await self._manifests.fetch(playlist_url)
            except Exception as exc:  # falha de rendição não derruba a inspeção
                plan.warnings.append(f"rendição '{rep_id}' inacessível: {_short(exc)}")
                continue
            self._add_hls_playlist_segments(
                plan, rep_id, kind, fetched.url, fetched.text, from_master=True
            )
        return plan

    def _add_hls_playlist_segments(
        self,
        plan: CapturePlan,
        rep_id: str,
        group_kind: str,
        playlist_url: str,
        playlist_text: str,
        from_master: bool = False,
    ) -> None:
        playlist = m3u8.loads(playlist_text)
        segments = list(playlist.segments)
        if not segments:
            plan.warnings.append(f"rendição '{rep_id}' sem segmentos declarados")
            return

        is_live = not playlist.is_endlist
        chosen = _window_segments(
            segments,
            lambda s: s.duration,
            self._limits.window_seconds,
            from_end=is_live,
        )

        # EXT-X-MAP (init) quando presente
        if playlist.segment_map:
            seg_map = playlist.segment_map[0]
            if seg_map and seg_map.uri:
                byte_range = None
                byterange = getattr(seg_map, "byterange", None)
                if byterange:
                    byte_range = _format_byterange(byterange, 0)
                plan.planned.append(
                    PlannedSegment(
                        rep_id=rep_id,
                        group_kind=group_kind,
                        uri=_resolve(playlist_url, seg_map.uri),
                        index=-1,
                        is_init=True,
                        byte_range=byte_range,
                    )
                )

        next_range_offset = 0
        for index, seg in enumerate(playlist.segments):
            byte_range = None
            byterange = getattr(seg, "byterange", None)
            if byterange:
                byte_range = _format_byterange(byterange, next_range_offset)
                if byte_range is not None:
                    next_range_offset = byte_range[0] + byte_range[1]
            if seg not in chosen:
                if getattr(seg, "discontinuity", False):
                    plan.discontinuities.setdefault(rep_id, {})[index] = True
                continue
            if getattr(seg, "discontinuity", False):
                plan.discontinuities.setdefault(rep_id, {})[index] = True
            plan.planned.append(
                PlannedSegment(
                    rep_id=rep_id,
                    group_kind=group_kind,
                    uri=_resolve(playlist_url, seg.uri or ""),
                    index=index,
                    declared_duration_seconds=seg.duration,
                    byte_range=byte_range,
                )
            )

    def _plan_dash(self, media: UnifiedManifest, base_url: str) -> CapturePlan:
        plan = CapturePlan()
        period_seconds = _parse_iso_duration(
            media.protocol_specific.get("dash", {}).get("media_presentation_duration")
        )
        for group in media.track_groups:
            for rep in group.representations:
                kind = group.kind.value
                if rep.init_segment and rep.init_segment.uri:
                    plan.planned.append(
                        PlannedSegment(
                            rep_id=rep.id,
                            group_kind=kind,
                            uri=_resolve(base_url, rep.init_segment.uri),
                            index=-1,
                            is_init=True,
                        )
                    )
                candidate_period = (
                    rep.total_duration_seconds
                    if rep.total_duration_seconds is not None
                    else period_seconds
                )
                candidates, candidate_warning = _dash_candidates(
                    rep, candidate_period, from_end=media.is_live
                )
                if candidate_warning:
                    plan.warnings.append(
                        f"representação '{rep.id}': {candidate_warning}"
                    )
                if not candidates:
                    if not (rep.init_segment and rep.init_segment.uri):
                        plan.warnings.append(
                            f"representação '{rep.id}' sem segmentos declarados"
                        )
                    continue

                chosen = _window_segments(
                    candidates,
                    lambda candidate: candidate.duration_seconds,
                    self._limits.window_seconds,
                    from_end=media.is_live,
                )
                for candidate in candidates:
                    if candidate not in chosen:
                        continue
                    plan.planned.append(
                        PlannedSegment(
                            rep_id=rep.id,
                            group_kind=kind,
                            uri=_resolve(base_url, candidate.uri),
                            index=candidate.index,
                            start_number=candidate.number,
                            declared_duration_seconds=candidate.duration_seconds,
                        )
                    )
        return plan

    # --------------------------------------------------------------- capture

    async def capture(
        self,
        inspection_id: str,
        plan: CapturePlan,
        workspace: Path,
        progress=None,
    ) -> list[CapturedSegment]:
        segments_dir = workspace / inspection_id / "segments"
        segments_dir.mkdir(parents=True, exist_ok=True)
        results: list[CapturedSegment] = []
        budget = self._limits.max_total_bytes

        for position, planned in enumerate(plan.planned):
            captured = await self._capture_one(planned, position, segments_dir, budget)
            results.append(captured)
            if captured.ok and captured.byte_size is not None:
                budget -= captured.byte_size
            if budget <= 0:
                plan.warnings.append(
                    "orçamento total de bytes esgotado; segmentos restantes não capturados"
                )
                break
            if progress is not None:
                progress(
                    done=len(results),
                    ok=sum(1 for r in results if r.ok),
                    failed=sum(1 for r in results if not r.ok),
                )
        return results

    async def _capture_one(
        self, planned: PlannedSegment, position: int, segments_dir: Path, budget: int
    ) -> CapturedSegment:
        try:
            fetched = await self._segments.fetch(planned.uri, planned.byte_range)
        except Exception as exc:
            return CapturedSegment(
                rep_id=planned.rep_id,
                group_kind=planned.group_kind,
                uri=planned.uri,
                index=planned.index,
                is_init=planned.is_init,
                declared_duration_seconds=planned.declared_duration_seconds,
                byte_range=planned.byte_range,
                error=_short(exc),
                fetched_at=self._clock.now(),
            )

        size = len(fetched.data)
        digest = hashlib.sha256(fetched.data).hexdigest()
        name = f"{position:04d}_{_safe_name(planned.uri, planned.is_init)}"
        target = segments_dir / name
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(fetched.data)
        tmp.replace(target)
        return CapturedSegment(
            rep_id=planned.rep_id,
            group_kind=planned.group_kind,
            uri=planned.uri,
            index=planned.index,
            is_init=planned.is_init,
            declared_duration_seconds=planned.declared_duration_seconds,
            byte_range=planned.byte_range,
            byte_size=size,
            sha256=digest,
            http_status=fetched.status,
            fetched_at=self._clock.now(),
            file=f"segments/{name}",
        )

    # --------------------------------------------------------------- timeline

    def timeline(
        self, plan: CapturePlan, captured: list[CapturedSegment]
    ) -> list[RepresentationTimeline]:
        by_rep: dict[str, dict[int, CapturedSegment]] = {}
        for item in captured:
            by_rep.setdefault(item.rep_id, {})[item.index] = item

        timelines: list[RepresentationTimeline] = []
        for rep_id in dict.fromkeys(p.rep_id for p in plan.planned):
            entries: list[TimelineEntry] = []
            start = 0.0
            for planned in (p for p in plan.planned if p.rep_id == rep_id):
                cap: CapturedSegment | None = by_rep.get(rep_id, {}).get(planned.index)
                if planned.is_init:
                    entries.append(
                        TimelineEntry(index=-1, start_seconds=None, duration_seconds=None,
                                      status="init")
                    )
                    continue
                duration = planned.declared_duration_seconds
                status = "captured" if cap and cap.ok else ("failed" if cap else "planned")
                entries.append(
                    TimelineEntry(
                        index=planned.index,
                        start_seconds=start if duration is not None else None,
                        duration_seconds=duration,
                        status=status,
                        discontinuity=plan.discontinuities.get(rep_id, {}).get(
                            planned.index, False
                        ),
                    )
                )
                if duration is not None:
                    start += duration
            timelines.append(
                RepresentationTimeline(
                    rep_id=rep_id,
                    group_kind=next(
                        (p.group_kind for p in plan.planned if p.rep_id == rep_id), "unknown"
                    ),
                    entries=tuple(entries),
                )
            )
        return timelines


# ------------------------------------------------------------------ helpers

def _resolve(base_url: str, ref: str | None) -> str:
    """urljoin que também entende fixture:// (esquema não hierárquico p/ stdlib)."""
    if not ref:
        return base_url
    if "://" in ref:
        return ref
    if base_url.startswith("fixture://") and not ref.startswith("/"):
        return base_url.rsplit("/", 1)[0] + "/" + ref.lstrip("./")
    return urljoin(base_url, ref)



def _window_segments(segments, duration_of, window: float, from_end: bool):
    chosen: list[object] = []
    total = 0.0
    iterable = reversed(segments) if from_end else segments
    for seg in iterable:
        duration = duration_of(seg)
        if duration is None or duration <= 0:
            if not chosen:
                chosen.append(seg)
            break
        d = duration
        if total > 0 and total + d > window:
            break
        chosen.append(seg)
        total += d
    return set(chosen)


def _dash_candidates(
    rep: Representation, period_seconds: float | None, *, from_end: bool
) -> tuple[list[_DashCandidate], str | None]:
    if not rep.segments:
        if rep.uri:
            return [
                _DashCandidate(
                    uri=rep.uri,
                    index=0,
                    number=None,
                    duration_seconds=rep.total_duration_seconds or period_seconds,
                )
            ], None
        return [], None

    first = rep.segments[0]
    # SegmentTemplate@duration é mantido compacto pelo parser e enumerado
    # somente aqui, quando a duração do Period é conhecida.
    if (
        len(rep.segments) == 1
        and first.uri is None
        and first.template
        and first.template_duration is not None
        and period_seconds is not None
    ):
        timescale = first.timescale or 1
        count = _template_count(period_seconds, timescale, first.template_duration)
        limited = count > MAX_DASH_TEMPLATE_SEGMENTS
        first_offset = (
            count - MAX_DASH_TEMPLATE_SEGMENTS if limited and from_end else 0
        )
        last_offset = min(count, first_offset + MAX_DASH_TEMPLATE_SEGMENTS)
        start_number = first.start_number or 1
        candidates = []
        for offset in range(first_offset, last_offset):
            candidate_number = start_number + offset
            segment_time = offset * first.template_duration
            candidate_uri = _sub_dash_template(
                first.template, candidate_number, segment_time
            )
            candidates.append(
                _DashCandidate(
                    uri=candidate_uri,
                    index=candidate_number,
                    number=candidate_number,
                    duration_seconds=first.template_duration / timescale,
                )
            )
        limit_warning = (
            "SegmentTemplate excede o limite de "
            f"{MAX_DASH_TEMPLATE_SEGMENTS} segmentos materializados"
            if limited
            else None
        )
        return _validated_dash_candidates(candidates, limit_warning)

    candidates = []
    for position, segment in enumerate(rep.segments):
        number = segment.start_number
        uri = segment.uri
        if uri is None and segment.template:
            uri = segment.template.replace("$Number$", str(number or position + 1))
        if not uri:
            continue
        timescale = segment.timescale or 1
        duration = (
            segment.duration_seconds
            if segment.duration_seconds is not None
            else (
                segment.template_duration / timescale
                if segment.template_duration is not None
                else None
            )
        )
        candidates.append(
            _DashCandidate(
                uri=uri,
                index=number if number is not None else position,
                number=number,
                duration_seconds=duration,
            )
        )
    return _validated_dash_candidates(candidates)


def _sub_dash_template(template: str, number: int, time: int) -> str:
    return template.replace("$Number$", str(number)).replace("$Time$", str(time))


def _validated_dash_candidates(
    candidates: list[_DashCandidate], warning: str | None = None
) -> tuple[list[_DashCandidate], str | None]:
    unresolved = sorted(
        token
        for token in ("$Time$", "$Number$")
        if any(token in candidate.uri for candidate in candidates)
    )
    if not unresolved:
        return candidates, warning
    valid = [
        candidate
        for candidate in candidates
        if not any(token in candidate.uri for token in unresolved)
    ]
    unresolved_warning = (
        f"template DASH ainda contém identificador não resolvido: "
        f"{', '.join(unresolved)}"
    )
    return valid, "; ".join(item for item in (warning, unresolved_warning) if item)


def _template_count(period_seconds: float, timescale: int, duration: int) -> int:
    if duration <= 0:
        return 0
    import math

    return max(1, math.ceil(period_seconds * timescale / duration))


def _parse_iso_duration(value: str | None) -> float | None:
    if not value:
        return None
    m = _DURATION_RE.match(value.strip())
    if not m:
        return None
    hours = float(m.group("hours") or 0)
    minutes = float(m.group("minutes") or 0)
    seconds = float(m.group("seconds") or 0)
    return hours * 3600 + minutes * 60 + seconds


def _format_byterange(spec: str, default_offset: int) -> tuple[int, int] | None:
    """EXT-X-BYTERANGE: 'len[@offset]' -> (offset, length)."""
    try:
        if "@" in spec:
            length, _, offset = spec.partition("@")
            return int(offset), int(length)
        return default_offset, int(spec)
    except ValueError:
        return None


def _safe_name(uri: str, is_init: bool) -> str:
    tail = uri.rstrip("/").split("?")[0].rsplit("/", 1)[-1] or ("init" if is_init else "segment")
    return re.sub(r"[^A-Za-z0-9._-]", "_", tail)[:120]


def _short(exc: Exception) -> str:
    from stream_lens.application.use_cases.create_inspection import InspectionError

    if isinstance(exc, InspectionError):
        return exc.message
    return f"{type(exc).__name__}: {exc}"[:200]
