# Fase 2 - Evidencia Deterministica

Status: **em andamento**

## Objetivo

Substituir o pipeline placeholder por coleta e analise real de HLS MPEG-TS.

## Escopo

- Importacao controlada das partes necessarias do VHS.
- [x] Deteccao inicial HLS e DASH.
- Amostragem limitada de HLS MPEG-TS.
- FFprobe estruturado; MediaInfo fica posterior ao MVP.
- Manifest, codec, timeline, GOP e delivery evidence.
- [x] Evidence bundle v1 para o root manifest.
- [x] Evidence bundle v2 preparado para multiplos manifests e media samples.
- [x] Persistencia do root manifest em artifact local.
- [x] Registro atomico de artifacts em lote e substituicao idempotente em retries.
- [x] Protecao SSRF, redirects, timeout e limite de manifest.
- [x] Parsing profundo de variants e renditions HLS.
- [x] Selecao limitada de uma variant e uma rendition de audio vinculada.
- [x] Coleta protegida e persistencia dos manifests HLS derivados.
- [x] Amostragem limitada de init/media segments HLS e FFprobe estruturado local.
- [x] Tres posicoes deterministicas por playlist: inicio, meio e fim (modo
  `sample`); o default `full` materializa todos os segmentos ate o budget.
- [x] Media playlist submetida diretamente e amostrada a partir do root.
- [x] Compose local acessa `localhost` do host por um alias SSRF restrito.
- [x] Evidencia complementar opcional de playback browser e `EvidenceBundle` v3.
- [x] Evals locais deterministicas geram HLS MPEG-TS sintetico sem versionar
  binarios: freeze visual, controle saudavel, tela preta e silencio de audio.
- [x] Perfil inicial de forense DASH VOD: parsing de MPD, `BaseURL`, `Period`,
  `AdaptationSet`, `Representation` e `SegmentTemplate`/`SegmentTimeline`.
- [x] Coleta de janela candidata DASH para 4K, Full HD, nivel intermediario e
  audio, guiada apenas por horario explicitamente relatado pelo usuario.
- [x] Inspecao local fMP4 de `moof`/`tfdt`/`tfhd`/`trun`/`mdat` e de `hvcC`, com
  PTS/DTS, flags, IRAP inicial e hashes de parameter sets.

## Proxima fatia recomendada

1. Conectar os evals de fixture ao pipeline completo e avaliar shell runs,
   evidencias citadas e conclusoes do report.
2. Ampliar probes deterministicas apenas por ferramentas tipadas e limitadas.

## Definition of Done

- Uma URL HLS valida produz evidence bundle persistido.
- Falhas de rede e formato geram eventos e erros compreensiveis.
- Fixtures conhecidas detectam pelo menos discontinuity e atraso A/V.
- Nenhuma analise tecnica depende de inferencia do LLM.

## Contrato de artifacts

- Cada artifact coletado recebe um `logicalKey` estavel por investigation.
- O worker escreve arquivos novos antes da transacao PostgreSQL.
- `recordEvidenceBatch` registra todo o lote e o evidence bundle atomicamente.
- Em retry, a mesma logical key substitui o registro anterior sem duplicacao.
- Arquivos superados sao removidos somente depois do commit; arquivos de um lote
  rejeitado sao removidos pelo worker.
- Reports antigos com `EvidenceBundle` v1 continuam legiveis; novas coletas usam v2.

## Modelo do pipeline

- `Manifest` e o modelo interno canonico durante coleta, inspecao e persistencia.
- O collector preenche origem, bytes e `ManifestInspection`; o worker acrescenta a
  referencia de `artifact` depois de gravar o arquivo.
- `ManifestEvidence` existe somente na fronteira persistida do report e nao carrega
  os bytes do runtime.
- Segmentos e resultados de probe devem seguir a mesma estrategia: enriquecer um
  modelo claro e criar outra representacao apenas quando houver uma fronteira ou
  invariante real.
- Nomes baseados somente na etapa do pipeline, como `Collected` ou `Promoted`, nao
  fazem parte da arquitetura da fase.

## Amostragem HLS implementada

- Segmentos de inicio, meio e fim por variant/rendition selecionada, ou pelo root
  quando ele ja e uma media playlist, e seu init segment quando declarado por
  `EXT-X-MAP`.
- O modo de coleta e configurável por `VIDEO_HARNESS_MEDIA_SAMPLE_MODE`:
  `full` (padrao) materializa todos os segmentos ate o budget agregado; `sample`
  baixa apenas inicio/meio/fim.
- Cada resposta e limitada a 20 MiB por padrao e a soma da amostra a 20 MiB;
  ambos os limites sao configuraveis pelo worker.
- FFprobe recebe somente arquivo temporario local, usa argumentos estruturados,
  timeout e limite de output. O arquivo e removido no fim do probe.
- Streams com criptografia declarada ou byte ranges sao preservados como uma
  limitacao explicita nesta primeira fatia; nao ha download de chaves.

## Corte do MVP

- Suportado: HLS e container MPEG-TS sem criptografia, com uma variant selecionada
  e amostras de inicio/meio/fim.
- Fora do MVP: DASH, CMAF/fMP4, byte ranges, DRM, LL-HLS e comparacao de ladder.

## Perfil DASH forense inicial

- Suportado: MPD estatico com `SegmentTemplate` e `SegmentTimeline` ou duracao,
  fMP4 clear, representations de video/audio e coleta limitada por budget.
- O relato livre do usuario e convertido em contexto `reported`; ele prioriza uma
  janela quando contem `HH:MM[:SS]`, mas nunca comprova a troca ABR ou o buffer.
- A matriz A->A, B->B, A->B e B->A e estrutural nesta fatia. Ela compara
  containers, init segments, timestamps e IRAP; resultado de decoder/Tizen exige
  experimentacao externa e permanece explicitamente `not_run`.
- Pendencias: `SegmentBase`/`sidx`, MPD dinamico completo, byte ranges, DRM
  decriptado, downloads repetidos por POP e reproducao em hardware Tizen.
