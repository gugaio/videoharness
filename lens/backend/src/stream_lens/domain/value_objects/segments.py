"""Modelo de captura limitada e timeline de segmentos (Fase 4).

Tudo aqui é declarativo: o que foi planejado, o que foi capturado (com
hash/tamanho/status) e como os segmentos se distribuem no tempo por
representação. Bytes ficam em arquivos isolados por inspeção (adapter),
referenciados por `file`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

MAX_WINDOW_SECONDS = 60.0  # teto absoluto da janela, independente de config


@dataclass(frozen=True, slots=True)
class CaptureLimits:
    """Limites conservadores da janela de captura (fonte: env/bootstrap)."""

    window_seconds: float = 10.0  # default conservador
    max_window_seconds: float = 60.0  # teto absoluto
    max_total_bytes: int = 500_000_000
    max_segment_bytes: int = 20_000_000
    max_playlists_followed: int = 8  # rendições HLS seguidas a partir do master


@dataclass(frozen=True, slots=True)
class PlannedSegment:
    """Segmento selecionado para captura dentro da janela."""

    rep_id: str
    group_kind: str
    uri: str  # absoluta (resolvida contra a base do manifesto)
    index: int  # ordem declarada na representação
    start_number: int | None = None  # DASH $Number$
    # Identidade canônica para parear rendições: EXT-X-MEDIA-SEQUENCE no HLS
    # ou $Number$ (quando disponível) no DASH. Não é o índice local da janela.
    segment_sequence: int | None = None
    declared_duration_seconds: float | None = None
    byte_range: tuple[int, int] | None = None  # (offset, length)
    is_init: bool = False


@dataclass(frozen=True, slots=True)
class DeliveryObservation:
    """Medição observada de uma única requisição HTTP.

    Não guarda headers arbitrários nem URLs de redirect: apenas sinais de
    cache seguros e valores de tempo medidos pelo cliente. ``None`` significa
    que a fonte (por exemplo, fixture local) não forneceu essa evidência.
    """

    http_status: int | None = None
    ttfb_ms: int | None = None
    download_duration_ms: int | None = None
    effective_throughput_bps: int | None = None
    redirect_count: int | None = None
    cache_control: tuple[str, ...] = ()
    cache_max_age_seconds: int | None = None
    cache_age_seconds: int | None = None
    cache_etag_present: bool | None = None
    provenance: str = "observed (HTTP client)"


@dataclass(frozen=True, slots=True)
class LivePlaylistObservation:
    """Uma leitura de playlist live, sem inferir saúde ou latência de player."""

    rep_id: str | None
    playlist_url: str
    observed_at: datetime
    media_sequence: int | None = None
    last_segment_sequence: int | None = None
    target_duration_seconds: float | None = None
    playlist_window_duration_seconds: float | None = None
    live_edge_program_date_time: datetime | None = None
    live_edge_distance_seconds: float | None = None
    delivery: DeliveryObservation | None = None
    advancement: str = "not measured (single playlist observation)"
    # Mudança da borda e do início da janela são fatos distintos. Em uma DVR
    # deslizante, a janela pode avançar mesmo quando a live edge não publicou nada.
    live_edge_advance_segments: int | None = None
    window_shift_segments: int | None = None
    provenance: str = "declared (HLS playlist)"


@dataclass(frozen=True, slots=True)
class DeliveryReport:
    """Evidência HTTP dos manifestos e, quando aplicável, das playlists live."""

    manifest_requests: tuple[tuple[str, DeliveryObservation | None], ...] = ()
    live_playlists: tuple[LivePlaylistObservation, ...] = ()
    live_note: str | None = None


@dataclass(frozen=True, slots=True)
class CapturedSegment:
    """Resultado da captura de um segmento planejado."""

    rep_id: str
    group_kind: str
    uri: str  # serializada redacted
    index: int
    is_init: bool
    segment_sequence: int | None = None
    declared_duration_seconds: float | None = None
    byte_range: tuple[int, int] | None = None
    byte_size: int | None = None
    sha256: str | None = None
    http_status: int | None = None
    fetched_at: datetime | None = None
    file: str | None = None  # nome relativo dentro de segments/ da inspeção
    error: str | None = None  # sem segredos; falha de segmento ≠ inspeção falha
    delivery: DeliveryObservation | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.byte_size is not None


@dataclass(frozen=True, slots=True)
class TimelineEntry:
    """Posição normalizada de um segmento na timeline da representação."""

    index: int
    start_seconds: float | None  # None = duração declarada desconhecida
    duration_seconds: float | None
    status: str  # captured | failed | planned | init
    # HLS: EXT-X-MEDIA-SEQUENCE; DASH: $Number$ quando conhecido.
    # Permite distinguir a mesma posição local de segmentos de instantes distintos.
    segment_sequence: int | None = None
    discontinuity: bool = False  # EXT-X-DISCONTINUITY / quebra declarada


@dataclass(frozen=True, slots=True)
class RepresentationTimeline:
    """Timeline de uma representação dentro da janela inspecionada."""

    rep_id: str
    group_kind: str
    entries: tuple[TimelineEntry, ...] = field(default_factory=tuple)

    @property
    def captured_count(self) -> int:
        return sum(1 for e in self.entries if e.status == "captured")


@dataclass(frozen=True, slots=True)
class AbrSegmentAlignment:
    """Comparação de um par de segmentos entre referência e rendição.

    ``index`` identifica o segmento da referência; ``candidate_index`` identifica
    o da outra rendição. Quando ``segment_sequence`` existe, o par foi formado
    por essa identidade canônica, não pela posição local da janela.

    Os deltas declarados vêm do manifesto normalizado. O delta de keyframe só
    existe quando ambos os fragments fornecem um keyframe com PTS via ffprobe.
    Valores ausentes não indicam que o switch seja seguro ou inseguro.
    """

    index: int
    candidate_index: int | None = None
    segment_sequence: int | None = None
    declared_start_delta_seconds: float | None = None
    declared_duration_delta_seconds: float | None = None
    keyframe_pts_delta_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class AbrAlignment:
    """Evidência de alinhamento entre uma rendição e sua referência do grupo."""

    group_kind: str
    reference_rep_id: str
    rep_id: str
    segments: tuple[AbrSegmentAlignment, ...] = ()
    comparison_basis: str = "capture-window index (sequence unavailable)"
    unmatched_reference_segments: int = 0
    unmatched_candidate_segments: int = 0
    comparable_declared_segments: int = 0
    comparable_keyframes: int = 0
    max_abs_declared_start_delta_seconds: float | None = None
    max_abs_declared_duration_delta_seconds: float | None = None
    max_abs_keyframe_pts_delta_seconds: float | None = None
    declared_provenance: str = "declared (manifest timeline)"
    keyframe_provenance: str = "derived (ffprobe)"


@dataclass(frozen=True, slots=True)
class SegmentBitrate:
    """Taxa calculada de um segmento e indicadores de tamanho de unidades.

    A taxa é ``bytes do arquivo * 8 / duração``. A duração observada no
    container é preferida quando as tracks concordam; na falta dela, usa-se a
    duração declarada no manifesto. Tamanho de sample/frame é somente um
    indicador de distribuição de payload — não mede a complexidade do codec.
    """

    index: int
    byte_size: int
    duration_seconds: float
    duration_provenance: str
    bitrate_bps: int
    bitrate_ratio_to_declared: float | None = None
    unit_count: int = 0
    average_unit_bytes: int | None = None
    largest_unit_bytes: int | None = None
    unit_provenance: str | None = None


@dataclass(frozen=True, slots=True)
class RepresentationBitrate:
    """Resumo dos segmentos capturados de uma representação."""

    group_kind: str
    rep_id: str
    declared_bandwidth_bps: int | None = None
    segments: tuple[SegmentBitrate, ...] = ()
    average_bitrate_bps: int | None = None
    peak_bitrate_bps: int | None = None
    lowest_bitrate_bps: int | None = None
    bitrate_provenance: str = "calculated (captured segment bytes / duration)"


@dataclass(frozen=True, slots=True)
class EffectiveStreamConfiguration:
    """Configuração que o ffprobe observou em uma stream de um segmento.

    É uma leitura derivada do decoder, não uma promessa de compatibilidade com
    dispositivos. ``start_time_seconds`` pertence apenas ao arquivo combinado
    observado (init + fragmento quando fMP4), e só pode ser comparado com outra
    stream do mesmo segmento.
    """

    stream_index: int | None
    kind: str
    codec_name: str | None = None
    profile: str | None = None
    level: int | None = None
    pixel_format: str | None = None
    width: int | None = None
    height: int | None = None
    frame_rate: str | None = None
    sample_rate: int | None = None
    channels: int | None = None
    channel_layout: str | None = None
    start_time_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class BitstreamSegmentObservation:
    """Configuração efetiva e relação temporal A/V de um segmento observado.

    PTS bruto e segundos normalizados tornam o cálculo do delta auditável.
    ``av_start_provenance`` distingue timestamp de apresentação do fallback de
    ``ffprobe.start_time``; estes dois nunca são misturados no mesmo cálculo.
    """

    index: int
    segment_sequence: int | None = None
    streams: tuple[EffectiveStreamConfiguration, ...] = ()
    video_start_pts: int | None = None
    video_start_seconds: float | None = None
    audio_start_pts: int | None = None
    audio_start_seconds: float | None = None
    # áudio - vídeo; positivo = o áudio começa depois do vídeo neste container.
    av_start_delta_seconds: float | None = None
    av_start_provenance: str = "not available"


@dataclass(frozen=True, slots=True)
class BitstreamConfigurationChange:
    """Campos de configuração diferentes entre dois segmentos observados."""

    from_index: int
    to_index: int
    changed_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RepresentationBitstream:
    """Evidência derivada de codec/áudio para uma representação capturada.

    Mudanças só comparam segmentos onde o ffprobe produziu configuração. A
    ausência de uma observação é preservada por ``observed_segments`` e não é
    tratada como estabilidade ou incompatibilidade.
    """

    group_kind: str
    rep_id: str
    observed_segments: tuple[BitstreamSegmentObservation, ...] = ()
    configuration_changes: tuple[BitstreamConfigurationChange, ...] = ()
    provenance: str = "derived (ffprobe stream configuration)"


@dataclass(frozen=True, slots=True)
class CaptureReport:
    """Resumo da janela de captura aplicada nesta inspeção."""

    window_seconds: float
    max_total_bytes: int
    max_segment_bytes: int
    max_playlists_followed: int
    planned: int
    captured: int
    failed: int
    total_bytes: int
