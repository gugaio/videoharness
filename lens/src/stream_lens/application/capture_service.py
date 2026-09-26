"""Orquestração da resolução e captura limitada de segmentos (Fase 4).

Pipeline: plano determinístico dentro da janela -> captura com limites ->
timeline normalizada. Nada aqui diagnostica; gaps/discontinuidades são
apenas representados.

Política de janela:
- VOD: primeiros segmentos desde o início (determinístico).
- live: últimos segmentos declarados (janela deslizante honesta).
- inspeção padrão: prioriza dois segmentos de mídia por representação, quando disponíveis.
- Ordem de representações HLS no master: variantes por bandwidth
  crescente, depois renditions por grupo; teto de playlists é opcional.
"""

from __future__ import annotations

import re
import hashlib
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from stream_lens.application.capture_plan import (
    CapturePlan,
    CaptureSelection,
    DashCandidate,
)
from stream_lens.application.ports.manifest_fetcher import FetchedManifest, ManifestFetcher
from stream_lens.application.ports.providers import Clock
from stream_lens.application.ports.segment_fetcher import SegmentFetcher
from stream_lens.application.ports.segment_store import SegmentStore
from stream_lens.domain.value_objects.media import Representation, UnifiedManifest
from stream_lens.domain.value_objects.segments import (
    CapturedSegment,
    CaptureLimits,
    LivePlaylistObservation,
    PlannedSegment,
    RepresentationTimeline,
    TimelineEntry,
)
from stream_lens.parsers.hls_playlist import (
    HlsMediaPlaylist,
    parse_hls_media_playlist,
)

_DURATION_RE = re.compile(
    r"^P(?:T(?:(?P<hours>\d+(?:\.\d+)?)H)?(?:(?P<minutes>\d+(?:\.\d+)?)M)?(?:(?P<seconds>\d+(?:\.\d+)?)S)?)?$"
)
MAX_DASH_TEMPLATE_SEGMENTS = 10_000
MINIMUM_MEDIA_SEGMENTS_PER_REPRESENTATION = 2
DEFAULT_CAPTURE_BUDGET_BYTES = 500_000_000
CAPTURE_BUDGET_MARGIN_BYTES = 64 * 1024


class SegmentCaptureService:
    def __init__(
        self,
        manifest_fetcher: ManifestFetcher,
        segment_fetcher: SegmentFetcher,
        clock: Clock,
        limits: CaptureLimits | None = None,
        store: SegmentStore | None = None,
    ) -> None:
        self._manifests = manifest_fetcher
        self._segments = segment_fetcher
        self._clock = clock
        self._limits = limits or CaptureLimits()
        self._store = store

    @property
    def limits(self) -> CaptureLimits:
        return self._limits

    def effective_budget_bytes(
        self,
        plan: CapturePlan,
        *,
        max_total_bytes: int | None = None,
        reserve_minimum: bool = False,
    ) -> int:
        """Return the byte ceiling, reserving space for default minimum coverage."""
        budget = (
            min(self._limits.max_total_bytes, max_total_bytes)
            if max_total_bytes is not None
            else self._limits.max_total_bytes
        )
        # A lower operator-configured limit remains a hard override. With the
        # standard default budget, reserve the worst case for each init + two
        # media segments so earlier renditions cannot consume another's floor.
        if (
            not reserve_minimum
            or self._limits.max_total_bytes < DEFAULT_CAPTURE_BUDGET_BYTES
            or (
                max_total_bytes is not None
                and max_total_bytes < DEFAULT_CAPTURE_BUDGET_BYTES
            )
        ):
            return budget

        by_rep: dict[tuple[str, str], list[int]] = {}
        for item in plan.planned:
            counts = by_rep.setdefault((item.group_kind, item.rep_id), [0, 0])
            counts[0 if item.is_init else 1] += 1

        count = 0
        for init_count, media_count in by_rep.values():
            if media_count:
                count += min(media_count, MINIMUM_MEDIA_SEGMENTS_PER_REPRESENTATION)
                count += init_count
        reserve = count * (
            self._limits.max_segment_bytes + CAPTURE_BUDGET_MARGIN_BYTES
        )
        return max(budget, reserve)

    # ------------------------------------------------------------------ plan

    async def plan(
        self, media: UnifiedManifest, base_url: str, root_fetched: FetchedManifest | None = None
    ) -> CapturePlan:
        """Resolve a janela e preserva a evidência de entrega já observada.

        ``root_fetched`` é opcional para manter o serviço testável isoladamente;
        quando ausente, não inventamos uma medição de manifesto.
        """
        if media.kind == "hls_media_playlist":
            plan = self._plan_hls_media(media, base_url)
            if root_fetched is not None:
                plan.manifest_requests.append((root_fetched.url, root_fetched.delivery))
                self._record_live_playlist(plan, None, root_fetched)
            self._prioritize_minimum_segments(plan)
            return plan
        if media.kind == "hls_master_playlist":
            plan = await self._plan_hls_master(media, base_url)
        else:
            plan = self._plan_dash(media, base_url)
        if root_fetched is not None:
            plan.manifest_requests.insert(0, (root_fetched.url, root_fetched.delivery))
        self._prioritize_minimum_segments(plan)
        return plan

    @staticmethod
    def _prioritize_minimum_segments(plan: CapturePlan) -> None:
        """Reserve capture order for two media segments in each planned rendition."""
        rep_order = list(
            dict.fromkeys((item.group_kind, item.rep_id) for item in plan.planned)
        )
        by_rep: dict[tuple[str, str], list[PlannedSegment]] = {
            rep_key: [] for rep_key in rep_order
        }
        for item in plan.planned:
            by_rep[(item.group_kind, item.rep_id)].append(item)

        prioritized: list[PlannedSegment] = []
        remaining: list[PlannedSegment] = []
        for rep_key in rep_order:
            items = by_rep[rep_key]
            inits = [item for item in items if item.is_init]
            media = [item for item in items if not item.is_init]
            prioritized.extend(inits)
            prioritized.extend(media[:MINIMUM_MEDIA_SEGMENTS_PER_REPRESENTATION])
            remaining.extend(media[MINIMUM_MEDIA_SEGMENTS_PER_REPRESENTATION:])
        plan.planned = prioritized + remaining

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
            minimum_segments=self._minimum_segments_for_window(),
        )
        if rep.init_segment and rep.init_segment.uri:
            init = PlannedSegment(
                    rep_id=rep.id,
                    group_kind=kind,
                    uri=_resolve(base_url, rep.init_segment.uri),
                    index=-1,
                    is_init=True,
                )
            plan.planned.append(init)
            plan.coverage.append(init)
        media_sequence = media.protocol_specific.get("hls", {}).get("media_sequence")
        for index, seg in enumerate(rep.segments):
            if seg.discontinuity:
                plan.discontinuities.setdefault(rep.id, {})[index] = True
            candidate = PlannedSegment(
                    rep_id=rep.id,
                    group_kind=kind,
                    uri=_resolve(base_url, seg.uri or ""),
                    index=index,
                    segment_sequence=(media_sequence + index)
                    if isinstance(media_sequence, int)
                    else None,
                    declared_duration_seconds=seg.duration_seconds,
                )
            plan.coverage.append(candidate)
            if seg in chosen:
                plan.planned.append(candidate)
        return plan

    async def _plan_hls_master(self, media: UnifiedManifest, base_url: str) -> CapturePlan:
        plan = CapturePlan()
        targets: list[tuple[str, str, str]] = []  # (rep_id, group_kind, playlist_url)
        for group in media.track_groups:
            for rep in group.representations:
                if rep.uri:
                    targets.append((rep.id, group.kind.value, _resolve(base_url, rep.uri)))
        # Determinístico: mantém a ordem declarada e aplica apenas um teto
        # operacional positivo; o default segue todas as playlists.
        followed = 0
        for rep_id, kind, playlist_url in targets:
            if (
                self._limits.max_playlists_followed > 0
                and followed >= self._limits.max_playlists_followed
            ):
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
            plan.manifest_requests.append((fetched.url, fetched.delivery))
            self._add_hls_playlist_segments(plan, rep_id, kind, fetched)
        return plan

    def _add_hls_playlist_segments(
        self,
        plan: CapturePlan,
        rep_id: str,
        group_kind: str,
        fetched: FetchedManifest,
    ) -> None:
        playlist_url = fetched.url
        playlist = parse_hls_media_playlist(fetched.text)
        self._record_live_playlist(plan, rep_id, fetched, playlist)
        segments = list(playlist.segments)
        if not segments:
            plan.warnings.append(f"rendição '{rep_id}' sem segmentos declarados")
            return

        is_live = not playlist.is_endlist
        media_sequence = playlist.media_sequence
        chosen = _window_segments(
            segments,
            lambda segment: segment.duration_seconds,
            self._limits.window_seconds,
            from_end=is_live,
            minimum_segments=self._minimum_segments_for_window(),
        )

        # EXT-X-MAP (init) quando presente
        if playlist.init_segment and playlist.init_segment.uri:
            init = PlannedSegment(
                    rep_id=rep_id,
                    group_kind=group_kind,
                    uri=_resolve(playlist_url, playlist.init_segment.uri),
                    index=-1,
                    is_init=True,
                    byte_range=playlist.init_segment.byte_range,
                )
            plan.planned.append(init)
            plan.coverage.append(init)

        for index, seg in enumerate(segments):
            if seg.discontinuity:
                plan.discontinuities.setdefault(rep_id, {})[index] = True
            candidate = PlannedSegment(
                    rep_id=rep_id,
                    group_kind=group_kind,
                    uri=_resolve(playlist_url, seg.uri or ""),
                    index=index,
                    segment_sequence=(media_sequence + index)
                    if isinstance(media_sequence, int)
                    else None,
                    declared_duration_seconds=seg.duration_seconds,
                    byte_range=seg.byte_range,
                )
            plan.coverage.append(candidate)
            if seg in chosen:
                plan.planned.append(candidate)

    def _plan_dash(self, media: UnifiedManifest, base_url: str) -> CapturePlan:
        plan = CapturePlan()
        period_seconds = _parse_iso_duration(
            media.protocol_specific.get("dash", {}).get("media_presentation_duration")
        )
        for group in media.track_groups:
            for rep in group.representations:
                kind = group.kind.value
                if rep.init_segment and rep.init_segment.uri:
                    init = PlannedSegment(
                            rep_id=rep.id,
                            group_kind=kind,
                            uri=_resolve(base_url, rep.init_segment.uri),
                            index=-1,
                            is_init=True,
                        )
                    plan.planned.append(init)
                    plan.coverage.append(init)
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
                    minimum_segments=self._minimum_segments_for_window(),
                )
                for candidate in candidates:
                    planned = PlannedSegment(
                            rep_id=rep.id,
                            group_kind=kind,
                            uri=_resolve(base_url, candidate.uri),
                            index=candidate.index,
                            start_number=candidate.number,
                            segment_sequence=candidate.number,
                            declared_duration_seconds=candidate.duration_seconds,
                        )
                    plan.coverage.append(planned)
                    if candidate in chosen:
                        plan.planned.append(planned)
        return plan

    def identify(self, plan: CapturePlan, inspection_id: str) -> None:
        """Atribui referências estáveis e a posição absoluta observada."""
        starts: dict[str, float] = {}
        coverage: list[PlannedSegment] = []
        for item in sorted(plan.coverage, key=lambda part: (part.rep_id, part.index)):
            start = None if item.is_init else starts.get(item.rep_id, 0.0)
            identified = replace(
                item,
                segment_ref=_segment_ref(inspection_id, item),
                timeline_start_seconds=start,
            )
            coverage.append(identified)
            if not item.is_init and item.declared_duration_seconds is not None:
                starts[item.rep_id] = (start or 0.0) + item.declared_duration_seconds
        plan.coverage = coverage
        coverage_by_key = {
            (item.rep_id, item.index, item.is_init): item for item in coverage
        }
        plan.planned = [
            coverage_by_key.get((item.rep_id, item.index, item.is_init), item)
            for item in plan.planned
        ]

    def select(self, plan: CapturePlan, selection: CaptureSelection) -> None:
        """Reduz o plano à seleção pedida, resolvida contra a playlist observada."""
        requested = set(selection.segment_refs)
        representations = set(selection.representation_ids)
        selected_media: list[PlannedSegment] = []
        for item in plan.coverage:
            if item.is_init:
                continue
            if requested:
                include = item.segment_ref in requested
            elif selection.start_seconds is not None and selection.duration_seconds is not None:
                end = selection.start_seconds + selection.duration_seconds
                start = item.timeline_start_seconds
                item_end = (
                    start + (item.declared_duration_seconds or 0)
                    if start is not None
                    else None
                )
                include = item_end is not None and start < end and item_end > selection.start_seconds
            else:
                include = False
            if include and (not representations or item.rep_id in representations):
                selected_media.append(item)

        if requested:
            found = {item.segment_ref for item in selected_media}
            if requested - found:
                plan.warnings.append(
                    f"{len(requested - found)} referências não estão disponíveis nesta leitura do manifesto"
                )
        if not selected_media:
            plan.warnings.append("nenhum segmento correspondeu à seleção solicitada")
        selected_reps = {item.rep_id for item in selected_media}
        init = [
            item for item in plan.coverage
            if item.is_init and item.rep_id in selected_reps
        ]
        plan.planned = init + selected_media

    def _record_live_playlist(
        self,
        plan: CapturePlan,
        rep_id: str | None,
        fetched: FetchedManifest,
        playlist: HlsMediaPlaylist | None = None,
    ) -> None:
        """Guarda somente fatos de uma playlist HLS live observada uma vez."""
        playlist = playlist or parse_hls_media_playlist(fetched.text)
        if playlist.is_endlist:
            return
        segments = list(playlist.segments)
        observed_at = self._clock.now()
        edge_time: datetime | None = None
        if segments:
            last = segments[-1]
            if last.program_date_time is not None and last.duration_seconds is not None:
                edge_time = last.program_date_time + timedelta(
                    seconds=last.duration_seconds
                )
        edge_distance: float | None = None
        if (
            edge_time is not None
            and edge_time.tzinfo is not None
            and observed_at.tzinfo is not None
        ):
            edge_distance = (observed_at - edge_time).total_seconds()
        media_sequence = playlist.media_sequence
        plan.live_playlists.append(
            LivePlaylistObservation(
                rep_id=rep_id,
                playlist_url=fetched.url,
                observed_at=observed_at,
                media_sequence=media_sequence,
                last_segment_sequence=(media_sequence + len(segments) - 1)
                if isinstance(media_sequence, int) and segments
                else None,
                target_duration_seconds=playlist.target_duration,
                playlist_window_duration_seconds=sum(
                    float(segment.duration_seconds or 0) for segment in segments
                )
                or None,
                live_edge_program_date_time=edge_time,
                live_edge_distance_seconds=edge_distance,
                delivery=fetched.delivery,
            )
        )

    def _minimum_segments_for_window(self) -> int:
        # The two-segment floor belongs to the standard 10-second baseline;
        # an explicitly shorter window remains a shorter inspection.
        return (
            MINIMUM_MEDIA_SEGMENTS_PER_REPRESENTATION
            if self._limits.window_seconds >= 10.0
            else 1
        )

    # --------------------------------------------------------------- capture

    async def capture(
        self,
        inspection_id: str,
        plan: CapturePlan,
        workspace: Path,
        progress=None,
        max_total_bytes: int | None = None,
        reserve_minimum: bool = False,
    ) -> list[CapturedSegment]:
        store = self._store
        if store is None:
            raise RuntimeError("capture requires a SegmentStore")
        results: list[CapturedSegment] = []
        budget = self.effective_budget_bytes(
            plan,
            max_total_bytes=max_total_bytes,
            reserve_minimum=reserve_minimum,
        )

        for position, planned in enumerate(plan.planned):
            if budget <= 0:
                if position < len(plan.planned):
                    plan.warnings.append(
                        "orçamento total de bytes esgotado; segmentos restantes não capturados"
                    )
                break
            captured = await self._capture_one(
                store,
                inspection_id,
                planned,
                position,
                workspace,
                budget - min(64 * 1024, budget // 2),
            )
            results.append(captured)
            budget -= captured.bytes_received
            if budget <= 0:
                if position + 1 < len(plan.planned):
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

    async def observe_live_advancement(self, plan: CapturePlan) -> None:
        """Repete cada leitura live após a captura, sem esperar artificialmente.

        O intervalo é o tempo real gasto capturando a janela. A conclusão separa
        a borda live (última sequence) do deslocamento da janela DVR (MEDIA-SEQUENCE).
        """
        initial = tuple(plan.live_playlists)
        for first in initial:
            try:
                fetched = await self._manifests.fetch(first.playlist_url)
                playlist = parse_hls_media_playlist(fetched.text)
                after_start = playlist.media_sequence
                after_segments = list(playlist.segments)
                after_edge = (
                    after_start + len(after_segments) - 1
                    if isinstance(after_start, int) and after_segments
                    else None
                )
                edge_delta = _sequence_delta(first.last_segment_sequence, after_edge)
                window_delta = _sequence_delta(first.media_sequence, after_start)
                if edge_delta is None:
                    advancement = "not comparable (live edge sequence unavailable)"
                elif edge_delta < 0:
                    advancement = f"live edge regressed by {-edge_delta} segments"
                elif edge_delta == 0:
                    advancement = "live edge unchanged between observations"
                else:
                    advancement = f"live edge advanced by {edge_delta} segments"
                previous_count = len(plan.live_playlists)
                self._record_live_playlist(plan, first.rep_id, fetched, playlist)
                if len(plan.live_playlists) > previous_count:
                    plan.live_playlists[-1] = replace(
                        plan.live_playlists[-1],
                        advancement=advancement,
                        live_edge_advance_segments=edge_delta,
                        window_shift_segments=window_delta,
                    )
            except Exception as exc:
                position = plan.live_playlists.index(first)
                plan.live_playlists[position] = replace(
                    first, advancement=f"second observation failed: {_short(exc)}"
                )

    async def _capture_one(
        self,
        store: SegmentStore,
        inspection_id: str,
        planned: PlannedSegment,
        position: int,
        workspace: Path,
        max_bytes: int,
    ) -> CapturedSegment:
        try:
            fetched = await self._segments.fetch(planned.uri, planned.byte_range, max_bytes)
        except Exception as exc:
            return CapturedSegment(
                rep_id=planned.rep_id,
                group_kind=planned.group_kind,
                uri=planned.uri,
                index=planned.index,
                is_init=planned.is_init,
                segment_sequence=planned.segment_sequence,
                declared_duration_seconds=planned.declared_duration_seconds,
                byte_range=planned.byte_range,
                error=_short(exc),
                fetched_at=self._clock.now(),
                http_status=getattr(getattr(exc, "delivery", None), "http_status", None),
                delivery=getattr(exc, "delivery", None),
                segment_ref=planned.segment_ref,
                bytes_received=int(getattr(exc, "bytes_received", 0)),
            )

        result = store.store(
            inspection_id=inspection_id,
            position=position,
            planned=planned,
            fetched=fetched,
            workspace=workspace,
            fetched_at=self._clock.now(),
        )
        return replace(
            result,
            segment_ref=planned.segment_ref,
            bytes_received=len(fetched.data),
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
                        start_seconds=planned.timeline_start_seconds if planned.timeline_start_seconds is not None else (start if duration is not None else None),
                        duration_seconds=duration,
                        status=status,
                        segment_sequence=planned.segment_sequence,
                        discontinuity=plan.discontinuities.get(rep_id, {}).get(
                            planned.index, False
                        ),
                        segment_ref=planned.segment_ref,
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


def _segment_ref(inspection_id: str, segment: PlannedSegment) -> str:
    """Referência opaca estável dentro da observação original da inspeção."""
    parts = urlsplit(segment.uri)
    location = f"{parts.scheme}://{parts.netloc}{parts.path}"
    identity = segment.segment_sequence
    if identity is None:
        identity = segment.index
    range_value = segment.byte_range or (0, 0)
    raw = "\0".join(
        (
            inspection_id,
            segment.rep_id,
            str(identity),
            location,
            str(range_value[0]),
            str(range_value[1]),
        )
    )
    return "seg_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]



def _window_segments(
    segments,
    duration_of,
    window: float,
    from_end: bool,
    minimum_segments: int = MINIMUM_MEDIA_SEGMENTS_PER_REPRESENTATION,
):
    chosen: list[object] = []
    total = 0.0
    iterable = reversed(segments) if from_end else segments
    for seg in iterable:
        duration = duration_of(seg)
        if duration is None or duration <= 0:
            if len(chosen) < minimum_segments:
                chosen.append(seg)
                continue
            break
        d = duration
        if (
            total > 0
            and total + d > window
            and len(chosen) >= minimum_segments
        ):
            break
        chosen.append(seg)
        total += d
    return set(chosen)


def _dash_candidates(
    rep: Representation, period_seconds: float | None, *, from_end: bool
) -> tuple[list[DashCandidate], str | None]:
    if not rep.segments:
        if rep.uri:
            return [
                DashCandidate(
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
                DashCandidate(
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
            DashCandidate(
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
    candidates: list[DashCandidate], warning: str | None = None
) -> tuple[list[DashCandidate], str | None]:
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


def _sequence_delta(before: int | None, after: int | None) -> int | None:
    if not isinstance(before, int) or not isinstance(after, int):
        return None
    return after - before


def _short(exc: Exception) -> str:
    from stream_lens.application.use_cases.create_inspection import InspectionError

    if isinstance(exc, InspectionError):
        return exc.message
    return f"{type(exc).__name__}: {exc}"[:200]
