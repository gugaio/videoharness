# SNAPSHOT_SCHEMA.md

**Status: implementado (Fase 6 + extensões de observabilidade) — `schema_version` 1.14,
analyzer 1.6.0** (schema 1.14 acrescenta cobertura e referências estáveis de segmentos). Contrato
validado por testes de round-trip, captura, parsers estruturais e adapter derivado
offline.

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
  "planned": 9, "captured": 9, "failed": 0, "total_bytes": 1126,
  "coverage": [
    { "segment_ref": "seg_0123456789abcdef01234567", "rep_id": "v360",
      "group_kind": "video", "index": 1, "segment_sequence": 1,
      "start_seconds": 0.0, "duration_seconds": 4.0,
      "status": "captured", "is_init": false }
  ]
},
"segments": [
  {
    "rep_id": "v360", "group_kind": "video",
    "uri": "fixture://dash-mpd/video/v360/1.m4s",
    "index": 1,
    "is_init": false,
    "segment_ref": "seg_0123456789abcdef01234567",
    "declared_duration_seconds": 4.0,
    "byte_range": null,
    "byte_size": 118, "sha256": "…", "http_status": null,
    "fetched_at": "ISO-8601",
    "file": "segments/0001_1.m4s",
    "error": null,
    "bytes_received": 118
  }
],
"timeline": [
  {
    "rep_id": "v360", "group_kind": "video",
    "entries": [
      { "index": -1, "start_seconds": null, "duration_seconds": null, "status": "init", "discontinuity": false },
      { "index": 1, "start_seconds": 0.0, "duration_seconds": 4.0, "status": "captured", "discontinuity": false, "segment_ref": "seg_0123456789abcdef01234567" }
    ]
  }
]
```

- Janela: default conservador 10s, **teto absoluto 60s** (`STREAM_LENS_WINDOW_SECONDS`); VOD captura desde o início, live captura os últimos declarados.
- Limites por env: `STREAM_LENS_MAX_TOTAL_BYTES` (orçamento, default 500MB), `STREAM_LENS_MAX_SEGMENT_BYTES` (cap por segmento, default 20MB), `STREAM_LENS_MAX_PLAYLISTS` (rendições HLS seguidas).
- Bytes isolados em `<workspace>/<id>/segments/` (purge TTL junto com a inspeção).
- Status de entry: `captured | failed | planned | init`; `discontinuity` marca `EXT-X-DISCONTINUITY`/quebras declaradas (representado, sem diagnóstico).
- Falha de segmento vira `partial` com `error` por segmento — nunca derruba a inspeção.
- `capture.coverage` lista candidatos declarados nas playlists efetivamente
  observadas. `captured` e `failed` refletem esta inspeção; `available` não
  significa que os bytes foram baixados. Cada candidato recebe `segment_ref`,
  estável dentro da inspeção e resolvível apenas contra uma nova leitura
  compatível do manifesto. A referência usa representação, sequence ou índice,
  caminho sem query e byte range; credenciais não entram nela.
- Coletas adicionais ficam em endpoint/documento separado e nunca alteram
  `segments`, `timeline` nem `capture.coverage` do baseline. `bytes_received` é
  incluído por segmento para contabilizar leituras parciais, inclusive falhas.
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
- `ContentProtection` → resumo legado `drm_systems` e declarações estruturadas
  `dash_drm`, preservando escopo, sistema, esquema, KIDs e resumo seguro de PSSH.
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
- Desde analyzer 1.5.3, o `stream_type` MPEG-TS `0x15` é apresentado como
  `metadata (pes)`, sem presumir ID3 quando descriptors/payload não foram analisados;
  AAC permanece `0x0F` (`audio (aac)`).
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

## Bloco 1.4 (extensão — samples e unidades temporais)

Cada `analysis` pode materializar até 1.000 itens ordenados do próprio container.
fMP4 usa os registros do `trun`, defaults `tfhd`/`trex` e `tfdt`; quando o init da
mesma representação foi capturado, ele fornece timescale e defaults ausentes no
fragmento. MPEG-TS materializa unidades PES e usa a escala fixa de 90 kHz de PTS/DTS.

```json
"analysis": {
  "kind": "mp4",
  "samples": [
    {
      "index": 0, "unit_type": "sample", "byte_size": 1800,
      "track_id": 1, "pid": null,
      "duration": 3000, "dts": 180000, "pts": 186000,
      "composition_offset": 6000, "timescale": 90000,
      "is_sync": true
    }
  ],
  "samples_truncated": false
}
```

- Tempos são inteiros nos ticks do container; segundos = valor / `timescale`.
- `is_sync` só é preenchido quando sample flags fMP4 fornecem essa evidência.
- `unit_type: "pes"` não afirma correspondência 1:1 com frame: um PES pode conter
  múltiplos access units. A UI preserva essa distinção e o chama de unidade PES.
- `samples_truncated: true` indica que a lista atingiu o limite defensivo; contagens
  totais continuam disponíveis em `fmp4.sample_counts` ou `ts.pids[].pes_count`.

## Bloco 1.5 (extensão — frames I/P/B e GOP derivados)

Para cada segmento de vídeo legível, o adapter opcional executa
`ffprobe -show_frames -show_packets`. Em fMP4, o init capturado da mesma representação é
concatenado ao fragmento via stdin para fornecer a configuração do codec. A lista é
derivada e não substitui `analysis.samples`.

```json
"probe": {
  "provenance": "derived (ffprobe)",
  "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
  "frames": [
    {
      "index": 0, "stream_index": 0, "pict_type": "I",
      "key_frame": true, "byte_size": 2991,
      "pts": 0, "pts_time": "0.000000",
      "dts": 0, "dts_time": "0.000000",
      "dts_provenance": "derived (ffprobe packet)",
      "packet_position": 1024, "packet_pts": 0,
      "duration": null, "duration_time": null
    }
  ],
  "frames_truncated": false,
  "gop": {
    "starts_with_key_frame": true,
    "first_key_frame_index": 0,
    "key_frame_count": 1,
    "i_frame_count": 1,
    "p_frame_count": 4,
    "b_frame_count": 7,
    "unknown_frame_count": 0,
    "intervals": [],
    "trailing_gop": {
      "start_frame_index": 0,
      "observed_frame_count": 12,
      "observed_duration_seconds": 1.0
    },
    "truncated": false
  },
  "streams": []
}
```

Desde analyzer 1.5.1, `dts`/`dts_time` são copiados do pacote, somente com associação
um-para-um por stream e posição, PTS original e tamanho conferidos. Não se utiliza
`frame.pkt_dts` ou cálculo por offset estrutural. Ausência, ambiguidade ou DTS
ausente produzem null. `packet_position` refere-se ao arquivo de entrada do probe
(em fMP4, init + fragmento), `packet_pts` preserva o PTS do pacote, e
`dts_provenance` identifica `derived (ffprobe packet)`. Ver ADR-0004.

Desde analyzer 1.5.2, `frame_collection` explicita `completed`, `partial`, `failed`
ou `not_requested`, a quantidade observada e o motivo conhecido. Assim, uma lista
vazia deixa de ser confundida com uma coleta completa sem frames.

- `pict_type` é `I`, `P`, `B` ou `null`, conforme reportado pelo decoder do
  `ffprobe`; não é inferido dos sample flags.
- `pts_time` vem do frame (com fallback best-effort); `dts_time` vem exclusivamente
  do pacote verificado. Os campos inteiros preservam os timestamps correspondentes.
- A lista é limitada a 1.000 frames e a entrada combinada a 40 MiB.
- `gop.intervals` contém apenas intervalos completos entre dois keyframes observados,
  com quantidade de frames e duração. `trailing_gop` é o trecho iniciado no último
  keyframe sem o próximo ponto de fechamento; a UI usa `+` para comunicar esse
  limite inferior.
- O resumo é útil para observar espaçamento de pontos de acesso, mas não diagnostica
  playback nem classifica GOP aberto/fechado.
- Se o probe estiver ausente, falhar ou não produzir frames, a UI continua usando os
  samples fMP4 ou unidades PES determinísticos do bloco 1.4.

## Bloco 1.6 (extensão — Timeline Health)

`analysis.timing` é uma medição determinística por track/PID. Ela separa ausência de
evidência de continuidade e compara somente a fronteira DTS anterior observável da
mesma representação.

```json
"timing": {
  "declared_duration_seconds": 1.0,
  "tracks": [{
    "track_id": 1, "pid": null, "timescale": 90000,
    "start_dts": 90000, "end_dts": 180000,
    "start_pts": 90000, "end_pts": 180000,
    "observed_duration_seconds": 1.0,
    "boundary_delta_seconds": 0.005556,
    "boundary_basis": "DTS current start - previous observed end"
  }],
  "provenance": "deterministic (container timestamps)"
}
```

- `boundary_delta_seconds > 0` é gap; `< 0` é overlap; `0` é fronteira contínua.
- `boundary_basis` torna auditável o cálculo. A prioridade é início DTS atual menos
  fim DTS anterior. Desde analyzer 1.5.4, quando o fim não existe, a Lens compara
  início-a-início e subtrai a duração declarada do segmento anterior; se DTS não foi
  sinalizado no PES, usa PTS explicitamente, sem preencher ou inventar DTS.
- `null` é não comparável, por exemplo quando a última PES não fornece duração.
- PTS fica visível para investigar reorder; a continuidade usa DTS.
- A matriz ABR compara rendições de vídeo equivalentes; A/V e PCR continuam extensões
  futuras documentadas em [OBSERVABILITY.md](OBSERVABILITY.md).

## Bloco 1.7 (extensão — matriz ABR; pareamento corrigido no 1.10)

`abr_alignment` compara rendições do mesmo `group_kind` contra a primeira timeline
do grupo, na ordem preservada pelo manifesto. No DASH, cada linha compara segmentos
com o mesmo número canônico. Desde analyzer 1.5.2, HLS fica explicitamente não
comparável: `EXT-X-MEDIA-SEQUENCE` pertence a cada Media Playlist e o mesmo número
em duas variantes não prova que os conteúdos representam o mesmo intervalo.

Os deltas de duração são declarativos; o delta de PTS de keyframe é derivado e só
existe se os dois fragments do mesmo par o fornecerem. Quando a sequência não está
disponível em um snapshot, o contrato identifica explicitamente o fallback pelo
índice local.

```json
"abr_alignment": [{
  "group_kind": "video",
  "reference_rep_id": "v360",
  "rep_id": "v720",
  "comparison_basis": "canonical segment sequence",
  "unmatched_reference_segments": 1,
  "unmatched_candidate_segments": 1,
  "comparable_declared_segments": 2,
  "comparable_keyframes": 1,
  "max_abs_declared_start_delta_seconds": 0.0,
  "max_abs_declared_duration_delta_seconds": 0.0,
  "max_abs_keyframe_pts_delta_seconds": 0.033333
}]
```

Valores `null` e contagem zero significam que não havia um par comparável na janela;
não são veredito sobre switching seguro ou inseguro.

`timeline.entries[]` e `segments[]` também trazem `segment_sequence` quando o
manifesto a declara. Em HLS ela é a `MEDIA-SEQUENCE` efetiva de cada fragmento; em
DASH é o `$Number$` disponível. Assim, QA pode rastrear exatamente quais índices
locais formaram cada par em `abr_alignment.segments[]` (`index`, `candidate_index`
e `segment_sequence`).

## Bloco 1.8 (extensão — bitrate por segmento)

`bitrate_observations` usa somente segmentos baixados com tamanho e duração
utilizáveis. A fórmula é `byte_size * 8 / duration_seconds`. A duração vinda de
timestamps do container é preferida somente quando as tracks observadas concordam
em até 50 ms; de outro modo, a duração declarada do manifesto é usada como fallback
e sua proveniência fica explícita.

```json
"bitrate_observations": [{
  "group_kind": "video", "rep_id": "v720", "declared_bandwidth_bps": 2000000,
  "average_bitrate_bps": 1870000, "peak_bitrate_bps": 2430000,
  "lowest_bitrate_bps": 1540000,
  "segments": [{
    "index": 1, "byte_size": 935000, "duration_seconds": 4.0,
    "duration_provenance": "deterministic (container timestamps)",
    "bitrate_bps": 1870000, "bitrate_ratio_to_declared": 0.935,
    "unit_count": 120, "average_unit_bytes": 6500, "largest_unit_bytes": 48000,
    "unit_provenance": "derived (ffprobe frame packet sizes)"
  }]
}]
```

- A média é ponderada: soma dos bytes dividida pela soma das durações da janela.
- `declared_bandwidth_bps` vem do manifesto; não é substituído pela medição.
- Tamanhos de unidades descrevem apenas a concentração de payload observado. Não
  são uma métrica de complexidade de codec, VMAF/qualidade ou taxa de entrega HTTP.
- Segmentos sem bytes, sem duração aproveitável ou `init` ficam fora do cálculo;
  ausência de observação não é taxa zero.

## Bloco 1.9 (extensão — entrega HTTP e live)

`segments[].delivery` contém a medição do cliente para aquela requisição HTTP.
`delivery.manifest_requests` registra leituras de manifesto/playlist, e
`delivery.live_playlists` só contém playlists HLS live efetivamente observadas.

```json
"delivery": {
  "manifest_requests": [{"url": "https://cdn.example/live.m3u8", "delivery": null}],
  "live_playlists": [{
    "rep_id": "v720", "media_sequence": 120, "last_segment_sequence": 125,
    "target_duration_seconds": 4.0, "playlist_window_duration_seconds": 24.0,
    "live_edge_program_date_time": "2026-01-01T00:00:20+00:00",
    "live_edge_distance_seconds": 3.2,
    "advancement": "advanced by 1 segments"
  }]
}
```

- Uma medição HTTP contém status final, TTFB, download total, throughput efetivo,
  redirects e somente sinais seguros de cache. Ela é da captura, não do player.
- Cache não persiste valores de ETag, cookies, headers arbitrários ou URLs de
  redirects. `delivery: null` significa que não houve medição HTTP, por exemplo em
  fixture local; não equivale a zero.
- Distância live requer que PDT permita datar o último segmento e usa o relógio da captura.
  Em HLS live, uma segunda leitura é feita depois da captura dos segmentos, sem espera
  artificial, e o avanço compara apenas `MEDIA-SEQUENCE` da mesma URL/representação.
  Uma leitura única permanece explicitamente não medida; DASH dinâmico não recebe
  cálculo equivalente.
- Desde analyzer 1.5.5, a segunda leitura preserva `live_edge_advance_segments` e
  `window_shift_segments` separadamente. O primeiro compara o último segmento;
  o segundo compara o início da janela DVR. Uma janela que descarta seu segmento
  mais antigo não é apresentada como novo conteúdo publicado.
  Detalhes e roteiro QA: [HTTP_LIVE_DELIVERY.md](HTTP_LIVE_DELIVERY.md).

## Bloco 1.12 (extensão — configuração efetiva e início A/V por PTS)

`bitstream_observations` reduz o resultado derivado de `ffprobe.streams` para
configuração rastreável por segmento. Só entram segmentos de mídia que o probe
conseguiu ler; init isolado não é prova de configuração efetiva no fragmento.

```json
"bitstream_observations": [{
  "group_kind": "video", "rep_id": "v720",
  "observed_segments": [{
    "index": 1, "segment_sequence": 120,
    "streams": [
      {"stream_index": 0, "kind": "video", "codec_name": "h264",
       "profile": "High", "level": 41, "pixel_format": "yuv420p",
       "width": 1280, "height": 720, "frame_rate": "30000/1001"},
      {"stream_index": 1, "kind": "audio", "codec_name": "aac",
       "profile": "LC", "sample_rate": 48000, "channels": 2,
       "channel_layout": "stereo"}
    ],
    "video_start_pts": 90000, "video_start_seconds": 0.0,
    "audio_start_pts": 2304, "audio_start_seconds": 0.048,
    "av_start_delta_seconds": 0.048,
    "av_start_provenance": "derived (ffprobe presentation timestamps)"
  }],
  "configuration_changes": [{
    "from_index": 1, "to_index": 2, "changed_fields": ["profile"]
  }],
  "provenance": "derived (ffprobe stream configuration)"
}]
```

- `av_start_delta_seconds = audio_start_seconds - video_start_seconds`, usando o
  menor PTS de apresentação que o decoder reportou para cada tipo de mídia. PTS
  bruto e segundos normalizados ficam lado a lado porque áudio e vídeo podem usar
  timebases diferentes. Positivo significa áudio depois do vídeo.
- Se não houver um par de PTS utilizável, o fallback só usa `start_time` das duas
  streams e `av_start_provenance` declara `stream start_time fallback`. `null`
  não é zero: falta uma das streams ou um timestamp aproveitável.
- `configuration_changes` compara somente segmentos consecutivos que têm
  observação derivada. Uma lacuna de probe não afirma estabilidade nem produz uma
  mudança artificial.
- Os tempos de início são locais ao arquivo/fragmento sondado; não são drift,
  lipsync percebido, nem métrica comparável entre rendições ou segmentos.
- O bloco não substitui `media.*.codecs` (declaração do manifesto), `analysis.timing`
  (timestamps determinísticos) ou uma avaliação de compatibilidade. Detalhes e
  roteiro QA: [BITSTREAM_OBSERVABILITY.md](BITSTREAM_OBSERVABILITY.md).

## Bloco 1.13 (DRM 1 — sinalização declarada no DASH)

`media.dash_drm` materializa cada `ContentProtection` no local exato em que aparece
no MPD. O bloco é aditivo: snapshots anteriores continuam válidos e HLS retorna a
coleção vazia.

```json
"dash_drm": [{
  "scope": "adaptation_set",
  "period_index": 0,
  "period_id": "p0",
  "adaptation_set_id": "video",
  "representation_id": null,
  "group_kind": "video",
  "system": "widevine",
  "scheme_id_uri": "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",
  "value": "cenc",
  "default_kids": ["11111111-2222-3333-4444-555555555555"],
  "pssh": [{
    "encoded_length": 12,
    "decoded_size": 9,
    "sha256": "…",
    "status": "valid"
  }],
  "provenance": "declared (DASH ContentProtection)"
}]
```

- `scope` é `period`, `adaptation_set` ou `representation`; a declaração não é
  duplicada nos descendentes para simular herança.
- `default_kids` contém identificadores normalizados, não chaves de conteúdo.
- `pssh.status` é `valid`, `empty` ou `invalid_base64`. O conteúdo base64 nunca é
  persistido; tamanho e SHA-256 permitem correlação segura.
- O bloco prova apenas o que o MPD declarou. Não testa init/mídia cifrada, licença,
  CDM ou compatibilidade de device.
- Detalhes, limites e roteiro QA: [DASH_DRM.md](DASH_DRM.md).

## Bloco 1.14 (cobertura e referências de segmento)

O resumo `capture` acrescenta `coverage[]`; itens em `segments[]` e
`timeline.entries[]` acrescentam `segment_ref`. A referência é opaca e escopada
ao ID da inspeção. Ela não contém query string nem credenciais e só é válida
enquanto o segmento puder ser identificado em uma leitura atual do manifesto.
Snapshots legados continuam sem o campo e permanecem válidos.

## Carregamento sob demanda

O snapshot completo pode ser baixado; rotas por recurso (`/representations/{id}`, `/segments/{id}`, …) entram nas fases seguintes conforme o volume crescer.

## Roadmap do schema

`parts`, parsing de access units/codec, evidências e diagnóstico entram nas fases
seguintes com o mesmo padrão de versionamento.
