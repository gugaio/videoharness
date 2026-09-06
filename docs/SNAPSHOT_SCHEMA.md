# SNAPSHOT_SCHEMA.md

**Status: implementado (Fase 6) — `schema_version` 1.3, analyzer 0.5.0** (1.2 +
bloco aditivo `hdr`). Contrato validado por testes de round-trip, captura e parsers
estruturais offline.

## Princípios

- **Snapshot canônico e versionado** por inspeção: `schema_version` + `analyzer_version`.
- O ID representa uma inspeção/snapshot, não uma URL (a mesma URL pode gerar snapshots diferentes, sobretudo em live).
- **Uma única fonte de verdade**: UI, CLI, API e skills leem o mesmo modelo.
- Sem equivalências forjadas entre HLS/DASH/TS/fMP4: a hierarquia comum (`media.track_groups[].representations[]`) serve UI e JSON; detalhes específicos vivem em `media.protocol_specific` (e, no futuro, `container_specific`).
- Campos `null` = **não coletado nesta inspeção**. O que não se aplica aparece em `capabilities` como `not_applicable`; o que ainda não foi implementado, como `not_collected` — limitações nunca são omitidas silenciosamente.
- URIs são preservadas como declaradas no manifesto (relativas permanecem relativas); URIs absolutas são serializadas redacted (sem query/fragment/userinfo).

## Contrato 1.0 (implementado)

```json
{
  "schema_version": "1.0",
  "analyzer_version": "0.2.0",
  "inspection_id": "uuid",
  "created_at": "ISO-8601",
  "expires_at": "ISO-8601",
  "source": {
    "display_url": "redacted",
    "protocol": "HLS | DASH",
    "is_live": false
  },
  "manifest": {
    "protocol": "HLS | DASH",
    "kind": "hls_master_playlist | hls_media_playlist | dash_mpd",
    "is_live": false,
    "variant_count": 2,
    "segment_count": null,
    "rendition_count": 1
  },
  "media": {
    "protocol": "HLS",
    "kind": "hls_master_playlist",
    "is_live": false,
    "track_groups": [
      {
        "kind": "video | audio | subtitle | closed_captions | unknown",
        "name": "variants | GROUP-ID | AdaptationSet id | null",
        "language": "pt | null",
        "representations": [
          {
            "id": "…",
            "uri": "… | null",
            "codecs": "avc1.64001e,mp4a.40.2 | null",
            "bandwidth_bps": 800000,
            "average_bandwidth_bps": null,
            "resolution": { "width": 640, "height": 360 },
            "frame_rate": 30.0,
            "audio_sampling_rate": 48000,
            "language": "pt | null",
            "roles": ["default"],
            "init_segment": { "uri": "init_v360.mp4", "duration_seconds": null, "template": null, "timescale": 1000, "template_duration": null, "start_number": null },
            "segments": [],
            "segment_count_declared": 3,
            "total_duration_seconds": 11.967
          }
        ]
      }
    ],
    "drm_systems": [{ "system": "widevine", "details": "scheme=… kid=…" }],
    "protocol_specific": { "hls": { "version": 6, "container": "mp4" } },
    "capabilities": {
      "segment_download": { "status": "not_collected", "reason": "Fase 3 inspeciona apenas declarações" }
    },
    "warnings": []
  },
  "warnings": []
}
```

`manifest` permanece como resumo rápido (derivado do modelo unificado por `summary_from_unified` — mesma fonte, sem divergência).

## Blocos 1.1 (Fase 4 — captura limitada)

```json
"capture": {
  "window_seconds": 10.0,
  "max_total_bytes": 500000000,
  "max_segment_bytes": 20000000,
  "max_playlists_followed": 8,
  "planned": 9, "captured": 9, "failed": 0, "total_bytes": 1126
},
"segments": [
  {
    "rep_id": "v360", "group_kind": "video",
    "uri": "fixture://dash-mpd/video/v360/1.m4s",
    "index": 1,
    "is_init": false,
    "declared_duration_seconds": 4.0,
    "byte_range": null,
    "byte_size": 118, "sha256": "…", "http_status": null,
    "fetched_at": "ISO-8601",
    "file": "segments/0001_1.m4s",
    "error": null
  }
],
"timeline": [
  {
    "rep_id": "v360", "group_kind": "video",
    "entries": [
      { "index": -1, "start_seconds": null, "duration_seconds": null, "status": "init", "discontinuity": false },
      { "index": 1, "start_seconds": 0.0, "duration_seconds": 4.0, "status": "captured", "discontinuity": false }
    ]
  }
]
```

- Janela: default conservador 10s, **teto absoluto 60s** (`STREAM_LENS_WINDOW_SECONDS`); VOD captura desde o início, live captura os últimos declarados.
- Limites por env: `STREAM_LENS_MAX_TOTAL_BYTES` (orçamento, default 500MB), `STREAM_LENS_MAX_SEGMENT_BYTES` (cap por segmento, default 20MB), `STREAM_LENS_MAX_PLAYLISTS` (rendições HLS seguidas).
- Bytes isolados em `<workspace>/<id>/segments/` (purge TTL junto com a inspeção).
- Status de entry: `captured | failed | planned | init`; `discontinuity` marca `EXT-X-DISCONTINUITY`/quebras declaradas (representado, sem diagnóstico).
- Falha de segmento vira `partial` com `error` por segmento — nunca derruba a inspeção.
- DASH `SegmentTemplate@duration` é enumerado pela duração do Period. Templates
  `$Number$` e `$Time$` são materializados antes da captura; em `SegmentTimeline`, o
  valor de `$Time$` é `S@t` ou o início inferido pela soma das durações anteriores.

### Mapeamento HLS → modelo comum

- Master: `EXT-X-MEDIA` por `TYPE:GROUP-ID` vira um `TrackGroup` (audio/subtitle/closed_captions); variantes `EXT-X-STREAM-INF` viram representações do grupo vídeo `variants`. `SESSION-KEY` → `drm_systems`. `is_live` não é determinável no master (fica `false` + nota em `protocol_specific.live_determination`).
- Media playlist: um grupo `unknown` com uma representação; segmentos por `EXTINF` (uri+duração); `EXT-X-MAP` → `init_segment`; `container` = `mp4` (com MAP) ou `mpeg-ts`; `is_live` = ausência de `EXT-X-ENDLIST`.

### Mapeamento DASH → modelo comum

- `AdaptationSet` → `TrackGroup` (kind por `contentType`/`mimeType`; `lang`; `Role` vira roles das representações); `Representation` → representação (codecs herdam do AdaptationSet quando ausentes na rep).
- `SegmentTemplate` (próprio ou herdado de AdaptationSet/Period): `initialization`
  → init segment; `@duration` fixo → um item compacto de template, enumerado no
  plano de captura; `SegmentTimeline` → referências concretas, expandindo `S@r`
  (`r=-1` usa o próximo `S@t` ou o fim conhecido do Period); `SegmentList` → URIs
  explícitas. Um `Representation/BaseURL` sem lista/template vira um segmento único.
- `ContentProtection` → `drm_systems` (UUIDs conhecidos mapeados: widevine/playready/fairplay/mp4-protection).
- `type="dynamic"` → `is_live`.

A materialização defensiva de uma `SegmentTimeline` é limitada a 10.000 segmentos
por representação. Se `r=-1` não tiver próximo `S@t` nem fim de Period conhecido,
apenas a primeira referência é preservada e o manifesto recebe aviso explícito.

### Capabilities (status + reason)

Estados: `supported` / `unsupported` / `not_collected` / `not_applicable`.

Fase 3 declara, para todo snapshot: `segment_download: not_collected` (bytes são Fase 4); HLS master também `media_playlist_follow: not_collected` (rendições não foram baixadas); DASH declara `segment_timeline` (`supported`/`not_applicable`).

## Bloco 1.2 (Fase 5 — containers)

Cada item de `containers` corresponde a um item capturado com sucesso em `segments`.
`analysis` é determinístico: deriva diretamente dos bytes; `probe`, quando presente,
é derivado pelo adapter opcional `ffprobe` e é identificado pela proveniência.

```json
"containers": [
  {
    "rep_id": "v360", "group_kind": "video", "index": 1,
    "is_init": false, "file": "segments/0001_1.m4s", "byte_size": 118,
    "analysis": {
      "kind": "mp4", "error": null,
      "fmp4": {
        "is_init": false, "brands": ["msdh"],
        "boxes": [{ "type": "moof", "offset": 20, "size": 72,
                    "fields": {}, "children": [] }],
        "track_ids": [1], "timescales": {"movie": 1000},
        "sequence_number": 1, "base_media_decode_time": 0,
        "sample_counts": {"1": 1}, "truncated": false,
        "provenance": "deterministic"
      },
      "ts": null
    },
    "probe": null
  }
]
```

- fMP4 expõe árvore de boxes e offsets absolutos no arquivo, além de campos de
  tempo/amostras dos boxes reconhecidos. O parser é estrutural; não decodifica codec.
- MPEG-TS usa `analysis.kind: "mpeg-ts"` e `ts` com sync, programas PAT/PMT, PIDs,
  continuity counters, PCR e timestamps PES observados.
- `analysis.kind: "unknown"` preserva `error` sem derrubar a inspeção.
- A árvore é limitada na serialização a 64 filhos por nó para evitar snapshots
  desproporcionais; não há endpoint separado por container nesta fase.

## Bloco 1.3 (Fase 6 — HDR)

Em um container fMP4, `analysis.fmp4.hdr` só aparece quando algum metadado HDR foi
encontrado nos bytes capturados. Sua ausência significa **não observado**, nunca
uma afirmação de SDR.

```json
"hdr": {
  "color_primaries": "BT.2020",
  "transfer_characteristics": "PQ (ST 2084)",
  "matrix_coefficients": "BT.2020 non-constant",
  "full_range": false,
  "static_metadata": {
    "mastering_display": {"max_luminance_cd_m2": 1000.0, "min_luminance_cd_m2": 0.005},
    "content_light_level": {"max_cll_cd_m2": 1000, "max_fall_cd_m2": 400}
  },
  "dynamic_metadata": ["HDR10+"],
  "provenance": "deterministic (ISOBMFF/HEVC bytes)"
}
```

- `colr/nclx` fornece CICP (primárias, transferência, matriz e range).
- `mdcv` e `clli` fornecem HDR estático: mastering display, MaxCLL e MaxFALL.
- `HDR10+` significa que a assinatura ITU-T T.35 foi encontrada em SEI HEVC no
  arquivo capturado. Não são expostos parâmetros por cena/quadro e não há inferência
  sobre segmentos fora da janela; Dolby Vision/RPU ainda não é coletado.
- `probe.streams[]` pode trazer propriedades de cor e side data reconhecidos pelo
  `ffprobe`, sempre com proveniência derivada e sem substituir os fatos acima.

## Carregamento sob demanda

O snapshot completo pode ser baixado; rotas por recurso (`/representations/{id}`, `/segments/{id}`, …) entram nas fases seguintes conforme o volume crescer.

## Roadmap do schema

`parts`, `samples`, parsing de codec, evidências e diagnóstico entram nas fases
seguintes com o mesmo padrão de versionamento.
