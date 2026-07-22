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

## Proxima fatia recomendada

1. Importar/adaptar somente os parsers de manifest necessarios do VHS.
2. Extrair variants/renditions HLS e representations DASH com limites.
3. Selecionar uma amostra pequena orientada pelo problema relatado.
4. Preservar manifests derivados como artifacts relacionados.
5. Adicionar fixtures conhecidas sem depender da rede nos testes.

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
