"""Modelo de inspeção de containers (Fase 5): fMP4 (árvore de boxes) e MPEG-TS.

Estrutural e determinístico: tudo aqui deriva 1:1 dos bytes capturados
(provenance `deterministic`). Nada de diagnóstico nem parsing de codec —
isso é papel do ffprobe (derivado) em adapter separado.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class BoxNode:
    """Um box ISOBMFF: tipo, offset, tamanho e campos-chave inspecionados."""

    type: str
    offset: int
    size: int
    # campos extraídos dos boxes que a UI precisa (truncados no serializer):
    # ftyp: major_brand; mvhd: timescale, duration; tkhd: track_id;
    # mdhd: timescale; trex: track_id, default_sample_duration;
    # mfhd: sequence_number; tfhd: track_id, flags, default_sample_duration;
    # tfdt: base_media_decode_time; trun: sample_count, data_offset,
    #       first_sample_duration, first_composition_offset
    fields: dict = field(default_factory=dict)
    children: tuple[BoxNode, ...] = ()


@dataclass(frozen=True, slots=True)
class ContainerSample:
    """Sample fMP4 ou unidade PES observada, na ordem do container.

    `unit_type` mantém explícita a diferença estrutural: um sample de vídeo fMP4
    normalmente corresponde a um frame comprimido; uma unidade PES de MPEG-TS
    pode carregar um ou mais access units e não é rotulada como frame sem prova.
    Tempos permanecem nos ticks do container e `timescale` permite convertê-los.
    """

    index: int
    unit_type: str  # "sample" | "pes"
    byte_size: int | None = None
    track_id: int | None = None
    pid: int | None = None
    duration: int | None = None
    dts: int | None = None
    pts: int | None = None
    composition_offset: int | None = None
    timescale: int | None = None
    is_sync: bool | None = None


@dataclass(frozen=True, slots=True)
class TsPidStats:
    """Estatísticas por PID declaradas/observadas no fluxo TS."""

    pid: int
    stream_type: int | None = None  # do PMT (quando mapeado)
    stream_kind: str | None = None  # "video"|"audio"|"data"|… derivado do stream_type
    packet_count: int = 0
    continuity_errors: int = 0
    pes_count: int = 0
    first_pts: int | None = None
    last_pts: int | None = None
    first_dts: int | None = None
    pcr_count: int = 0
    last_pcr: int | None = None


@dataclass(frozen=True, slots=True)
class TsInfo:
    """Resumo estrutural de um fluxo MPEG-TS."""

    packet_count: int = 0
    sync_errors: int = 0  # bytes de sync perdidos/alinhamento quebrado
    pids: tuple[TsPidStats, ...] = ()
    programs: dict = field(default_factory=dict)  # program_number -> pmt_pid
    # samples brutos (PTS/DTS/PCR são contadores de 33 bits, sem escala aqui)
    provenance: str = "deterministic"


@dataclass(frozen=True, slots=True)
class HdrInfo:
    """Metadados HDR observados em um arquivo fMP4 capturado.

    A ausência de campos não afirma SDR: o arquivo pode não declarar os dados ou
    a janela de captura pode não conter a sinalização dinâmica.
    """

    color_primaries: str | None = None
    transfer_characteristics: str | None = None
    matrix_coefficients: str | None = None
    full_range: bool | None = None
    static_metadata: dict = field(default_factory=dict)
    dynamic_metadata: tuple[str, ...] = ()
    provenance: str = "deterministic (ISOBMFF/HEVC bytes)"


@dataclass(frozen=True, slots=True)
class Fmp4Info:
    """Resumo estrutural de um segmento/init fMP4 (CMAF)."""

    is_init: bool = False
    brands: tuple[str, ...] = ()
    boxes: tuple[BoxNode, ...] = ()
    track_ids: tuple[int, ...] = ()
    timescales: dict = field(default_factory=dict)  # track_id -> timescale
    sequence_number: int | None = None
    base_media_decode_time: int | None = None
    sample_counts: dict = field(default_factory=dict)  # track_id -> count do trun
    hdr: HdrInfo | None = None
    truncated: bool = False  # box maior que os bytes disponíveis
    provenance: str = "deterministic"


@dataclass(frozen=True, slots=True)
class TimingTrack:
    """Janela temporal observada de um track/PID no segmento.

    `boundary_delta_seconds` compara fronteiras na mesma representação pela base
    explicitada em `boundary_basis`. Positivo significa gap; negativo,
    sobreposição. `None` significa que os bytes não permitiram uma comparação.
    """

    track_id: int | None = None
    pid: int | None = None
    timescale: int | None = None
    start_dts: int | None = None
    end_dts: int | None = None
    start_pts: int | None = None
    end_pts: int | None = None
    observed_duration_seconds: float | None = None
    boundary_delta_seconds: float | None = None
    boundary_basis: str | None = None


@dataclass(frozen=True, slots=True)
class ContainerTiming:
    """Evidências temporais determinísticas de um container capturado.

    Não é um diagnóstico: valores ausentes preservam o limite dos bytes e das
    amostras observadas. A comparação entre rendições entra em fase posterior.
    """

    declared_duration_seconds: float | None = None
    tracks: tuple[TimingTrack, ...] = ()
    provenance: str = "deterministic (container timestamps)"


@dataclass(frozen=True, slots=True)
class ContainerAnalysis:
    """Resultado da inspeção de um container capturado."""

    kind: str  # "mp4" | "mpeg-ts" | "unknown"
    fmp4: Fmp4Info | None = None
    ts: TsInfo | None = None
    samples: tuple[ContainerSample, ...] = ()
    samples_truncated: bool = False
    timing: ContainerTiming | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class SegmentContainer:
    """Container inspecionado de um segmento capturado."""

    rep_id: str
    group_kind: str
    index: int
    is_init: bool
    file: str
    byte_size: int
    analysis: ContainerAnalysis
    probe: dict | None = None  # ffprobe (derivado); None = not_collected
