# Fase 2 - Evidencia Deterministica

Status: **em andamento**

## Objetivo

Substituir o pipeline placeholder por coleta e analise real de streams.

## Escopo

- Importacao controlada das partes necessarias do VHS.
- [x] Deteccao inicial HLS e DASH.
- Clone/amostragem limitada.
- FFprobe e MediaInfo.
- Manifest, codec, timeline, GOP e delivery evidence.
- [x] Evidence bundle v1 para o root manifest.
- [x] Evidence bundle v2 preparado para multiplos manifests e media samples.
- [x] Persistencia do root manifest em artifact local.
- [x] Registro atomico de artifacts em lote e substituicao idempotente em retries.
- [x] Protecao SSRF, redirects, timeout e limite de manifest.
- [x] Parsing profundo de variants e renditions HLS.
- [x] Selecao limitada de uma variant e uma rendition de audio vinculada.
- [x] Coleta protegida e persistencia dos manifests HLS derivados.

## Proxima fatia recomendada

1. Extrair URLs de init/media segments da variant HLS selecionada.
2. Baixar uma amostra pequena com limite total de bytes e quantidade.
3. Executar FFprobe com binario/argumentos estruturados e timeout.
4. Produzir evidence de codecs, tracks, duracao e timestamps.
5. Aprofundar representations DASH somente depois da fatia HLS ponta a ponta.

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
